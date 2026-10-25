"""Histórico de posições a receber e a pagar (Fase 6.2 do DRE).

A API do Mubisys não guarda a carteira de cada fim de mês: só o título como ele
está hoje. A posição de um fechamento passado é remontada assim: o título que
estava em aberto no fim do mês M ou continua aberto hoje, ou foi pago depois de
M. Para cada título emitido até M, o saldo em M é o valor do título menos as
parcelas pagas até M (nunca negativo).

Coleta (pelo conector dre-financas, ação 'listar', token da coleta):
- em aberto hoje: VENCIDO e PENDENTE pelo VENCIMENTO, de 2015 até dois anos à frente;
- pagos: PAGO pelo PAGAMENTO, de 01/09/2025 até hoje (três meses antes do primeiro
  fechamento, para as médias de prazo).
Qualquer janela incompleta aborta a rodada inteira: nada é gravado e a última
versão no servidor fica como estava. Nada ausente vira zero.

Grava uma posição por mês (dre-sync, ação 'posicoesGravar', coleção 'posicoes').
O repositório é público e o log do GitHub também: só contagens vão para o log,
nunca valores, nomes de clientes ou de fornecedores.

Limites, ditos na tela: título cancelado, apagado ou renegociado depois do mês
some da reconstrução (a API não guarda o passado); título sem a lista de
pagamentos só tem a data do topo; a ordem de grandeza é a do ERP de hoje.
"""
import datetime
import json
import os
import sys
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_previa as previa

PT = previa.PT
REGRA = "posicao-v1"
PRIMEIRO_FECHAMENTO = (2025, 11)          # 30/11/2025: abertura do DRE de Dez/2025
PAGOS_DESDE = datetime.date(2025, 9, 1)   # três meses antes, para as médias
VENCIDOS_DESDE = datetime.date(2015, 1, 1)
CORTE_ANTIGAS = os.environ.get("DRE_CORTE_ANTIGAS", "2025-01-01")
RECURSOS = {"contas-receber": "receber", "contas-pagar": "pagar"}
FAIXAS = ("avencer", "d1_30", "d31_60", "d61_90", "d91")
# Mesmo horizonte da posição de hoje (a carga do Painel traz a pagar até 60 dias):
# o que vence depois disso fica à parte, para o histórico comparar com hoje.
HORIZONTE_DIAS = 60
# Parcelamento do DAS (conta do painel; no Mubisys é a 2.3.1.1): as parcelas lançadas
# como contas a pagar vão somadas à parte, para o balanço não contá-las de novo junto
# com o saldo do parcelamento informado em Parâmetros (Fase 9.4).
PARCELAMENTO_DAS = "2.4.1.1"


class ColetaIncompleta(Exception):
    """Janela do ERP que não voltou inteira: a rodada para sem gravar."""


# ── conversões ──────────────────────────────────────────────────────────────
def cent(v):
    """Reais do ERP em centavos inteiros; None quando não é número."""
    if v is None or isinstance(v, bool) or (isinstance(v, str) and not v.strip()):
        return None
    try:
        d = Decimal(str(v).strip())
    except (InvalidOperation, ValueError):
        return None
    if not d.is_finite():
        return None
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def dia(v):
    """'2026-09-15', '2026-09-15 10:00:00' ou '2026-09-15T10:00' → date; senão None."""
    s = str(v or "").strip()[:10]
    try:
        return datetime.date.fromisoformat(s) if len(s) == 10 else None
    except ValueError:
        return None


def reais(c):
    return round(c / 100, 2)


def faixa(dias):
    if dias <= 0:
        return "avencer"
    if dias <= 30:
        return "d1_30"
    if dias <= 60:
        return "d31_60"
    if dias <= 90:
        return "d61_90"
    return "d91"


def fim_do_mes(ano, mes):
    prox = datetime.date(ano + (mes == 12), mes % 12 + 1, 1)
    return prox - datetime.timedelta(days=1)


def meses_fechados(hoje, desde=PRIMEIRO_FECHAMENTO):
    """Do primeiro fechamento ao último mês que já acabou."""
    ano, mes = desde
    fora = []
    while fim_do_mes(ano, mes) < hoje:
        fora.append((ano, mes))
        ano, mes = (ano + (mes == 12), mes % 12 + 1)
    return fora


# ── título ──────────────────────────────────────────────────────────────────
def normalizar(t, recurso, quitado=False):
    """Título cru do ERP → o que a reconstrução usa. Devolve (titulo, motivo_fora).
    `quitado`: veio na consulta de pagos. Ele zera na data da quitação mesmo que as
    parcelas legíveis somem menos que o título (desconto, topo zerado ou só a última
    parcela no topo); a diferença vai para a cobertura, nunca vira dívida aberta."""
    lado = RECURSOS[recurso]
    valor = cent(t.get("valor_titulo"))
    if valor is None or valor <= 0:
        return None, "semValor"
    emissao = dia(t.get("data_despesa")) or dia(t.get("data_cadastro"))
    if emissao is None:
        return None, "semEmissao"
    pagamentos = []
    lista = t.get("pagamentos") if isinstance(t.get("pagamentos"), list) else []
    if lista:
        for p in lista:
            d = dia((p or {}).get("data_pagamento") or (p or {}).get("data_credito"))
            v = cent((p or {}).get("valor"))
            if d is None or v is None:
                return None, "pagamentoInvalido"
            pagamentos.append((d, v))
    else:
        v = cent(t.get("valor_pagamento"))
        d = dia(t.get("data_pagamento") or t.get("data_credito"))
        if v and v > 0:
            if d is None:
                return None, "pagamentoInvalido"
            pagamentos.append((d, v))
    quitado_em = None
    if quitado:
        datas = [d for d, _ in pagamentos] or [d for d in [dia(t.get("data_pagamento") or t.get("data_credito"))] if d]
        if not datas:
            return None, "pagamentoInvalido"
        quitado_em = max(datas)
    return {
        "lado": lado,
        "valor": valor,
        "quitadoEm": quitado_em,
        "residuo": max(0, valor - sum(v for _, v in pagamentos)) if quitado else 0,
        "emissao": emissao,
        "cadastro": dia(t.get("data_cadastro")),
        "vencimento": dia(t.get("data_vencimento")),
        "pagamentos": pagamentos,
        "centro": str(t.get("centro_custo") or "").strip() if lado == "pagar" else "",
        # Conta do plano no código do painel (o mesmo que a DRE usa), só no a pagar.
        "plano": previa.erp_mes.traduzir_plano(previa.codigo(t.get("plano_contas"))[0]) if lado == "pagar" else "",
        "noDre": str(t.get("compoe_dre") or "").strip().lower() == "sim",
    }, None


def juntar(listas):
    """Une as consultas (abertos e pagos) por (recurso, empresa, id); título que
    mudou entre consultas aborta, como no robô do DRE. Guarda de quais consultas
    o título veio: só o que veio apenas da de pagos está quitado."""
    vistos, origens = {}, {}
    for entrada in listas:
        recurso, origem, itens = entrada if len(entrada) == 3 else (entrada[0], "aberto", entrada[1])
        for t in itens:
            if t.get("id") is None:
                raise ColetaIncompleta("Título sem identificador; coleta não verificável.")
            chave = (recurso, str(t.get("empresa_id") or t.get("empresa") or ""), str(t["id"]))
            marca = json.dumps([t.get(k) for k in ("valor_titulo", "data_despesa", "data_vencimento", "pagamentos", "valor_pagamento", "data_pagamento", "centro_custo")], sort_keys=True, default=str)
            if chave in vistos and vistos[chave][1] != marca:
                raise ColetaIncompleta("Título alterado durante a coleta; repita para obter uma versão consistente.")
            vistos[chave] = (t, marca)
            origens.setdefault(chave, set()).add(origem)
    return [(c[0], v[0], origens[c]) for c, v in vistos.items()]


# ── reconstrução (pura) ─────────────────────────────────────────────────────
def _media(pares):
    peso = sum(c for c, _ in pares)
    return round(sum(c * d for c, d in pares) / peso) if peso > 0 else None


def posicao_no_fim(titulos, fim, corte):
    """Carteira a receber e a pagar no fim do dia `fim`, até 60 dias à frente."""
    corte_d, limite = dia(corte), fim + datetime.timedelta(days=HORIZONTE_DIAS)
    out = {}
    for lado in ("receber", "pagar"):
        faixas = {f: 0 for f in FAIXAS}
        centros, centros_alem, antigas, fora_dre, alem, sem_venc = {}, {}, [0, 0], [0, 0], [0, 0], [0, 0]
        parcelamento, parc_centros = [0, 0], {}
        total = qtd = lancado_depois = 0
        for t in titulos:
            if t["lado"] != lado or t["emissao"] > fim:
                continue
            if t.get("quitadoEm") and t["quitadoEm"] <= fim:
                continue
            pago = sum(v for d, v in t["pagamentos"] if d <= fim)
            saldo = max(0, t["valor"] - pago)
            if saldo <= 0:
                continue
            if t["vencimento"] is None:
                sem_venc[0] += 1
                sem_venc[1] += saldo
                continue
            if corte_d and t["vencimento"] < corte_d:
                antigas[0] += 1
                antigas[1] += saldo
                continue
            plano = t.get("plano", "")
            if lado == "pagar" and (plano == PARCELAMENTO_DAS or plano.startswith(PARCELAMENTO_DAS + ".")):
                # Carteira inteira (dentro e além dos 60 dias), como o total sem horizonte.
                parcelamento[0] += 1
                parcelamento[1] += saldo
                c = parc_centros.setdefault(t["centro"] or "Sem centro de custo", [0, 0])
                c[0] += saldo
                c[1] += 1
            if t["vencimento"] > limite:
                alem[0] += 1
                alem[1] += saldo
                if lado == "pagar":
                    k = t["centro"] or "Sem centro de custo"
                    c = centros_alem.setdefault(k, [0, 0])
                    c[0] += saldo
                    c[1] += 1
                continue
            if t["cadastro"] and t["cadastro"] > fim:
                lancado_depois += 1
            if not t["noDre"]:
                fora_dre[0] += 1
                fora_dre[1] += saldo
            total += saldo
            qtd += 1
            faixas[faixa((fim - t["vencimento"]).days)] += saldo
            if lado == "pagar":
                k = t["centro"] or "Sem centro de custo"
                c = centros.setdefault(k, [0, 0])
                c[0] += saldo
                c[1] += 1
        item = {
            "total": reais(total), "quantidade": qtd,
            "faixas": {f: reais(v) for f, v in faixas.items()},
            "antigas": {"quantidade": antigas[0], "valor": reais(antigas[1])},
            "foraDRE": {"quantidade": fora_dre[0], "valor": reais(fora_dre[1])},
            "alemHorizonte": {"quantidade": alem[0], "valor": reais(alem[1])},
            "semVencimento": {"quantidade": sem_venc[0], "valor": reais(sem_venc[1])}, "lancadoDepois": lancado_depois,
        }
        if lado == "pagar":
            lista = lambda d: [{"rotulo": k, "valor": reais(v[0]), "quantidade": v[1]} for k, v in sorted(d.items(), key=lambda kv: (-kv[1][0], kv[0]))]
            item["porCentro"] = lista(centros)
            # Além dos 60 dias, por centro: os prazos médios usam a carteira inteira.
            item["alemPorCentro"] = lista(centros_alem)
            # Por centro: o balanço tira as parcelas da classe em que caíram (em geral 3.02).
            item["parcelamentoDAS"] = {"quantidade": parcelamento[0], "valor": reais(parcelamento[1]), "porCentro": lista(parc_centros)}
        out[lado] = item
    return out


def fluxos_do_mes(titulos, ini, fim):
    """Emitido e pago no mês, com os prazos: concedido (vencimento − emissão dos
    emitidos) e real (pagamento − emissão das parcelas pagas no mês)."""
    out = {}
    for lado in ("receber", "pagar"):
        emitido, pago, concedido, real, centros = 0, 0, [], [], {}
        for t in titulos:
            if t["lado"] != lado:
                continue
            if ini <= t["emissao"] <= fim:
                emitido += t["valor"]
                if t["vencimento"]:
                    concedido.append((t["valor"], (t["vencimento"] - t["emissao"]).days))
                if lado == "pagar":
                    k = t["centro"] or "Sem centro de custo"
                    centros[k] = centros.get(k, 0) + t["valor"]
            for d, v in t["pagamentos"]:
                if ini <= d <= fim:
                    pago += v
                    real.append((v, (d - t["emissao"]).days))
        item = {"emitido": reais(emitido), "pago": reais(pago),
                "prazoConcedido": _media(concedido), "prazoReal": _media(real)}
        if lado == "pagar":
            item["emitidoPorCentro"] = [{"rotulo": k, "valor": reais(v)} for k, v in sorted(centros.items(), key=lambda kv: (-kv[1], kv[0]))]
        out[lado] = item
    return out


def montar_registros(titulos, meses, cobertura, corte=CORTE_ANTIGAS, gerado_em=None, execucao=None):
    gerado_em = gerado_em or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    execucao = execucao or str(uuid.uuid4())
    regs = []
    for ano, mes in meses:
        fim = fim_do_mes(ano, mes)
        regs.append({
            "id": f"{ano}-{mes:02d}", "mes": f"{PT[mes - 1]}/{ano}", "fim": fim.isoformat(),
            "regra": REGRA, "modo": "reconstruido", "corte": corte,
            "geradoEm": gerado_em, "execucaoId": execucao,
            **posicao_no_fim(titulos, fim, corte),
            "fluxos": fluxos_do_mes(titulos, datetime.date(ano, mes, 1), fim),
            # Três meses até o fechamento: base dos prazos médios (dias de venda e de compra).
            "fluxos3m": fluxos_do_mes(titulos, datetime.date(ano - (mes <= 2), (mes - 3) % 12 + 1, 1), fim),
            "cobertura": cobertura,
        })
    return regs


# ── coleta ──────────────────────────────────────────────────────────────────
def listar(recurso, status, filtrodata, a, b, chamar=None, dormir=time.sleep):
    """Uma janela [a, b] inteira, partindo ao meio quando estoura o tempo e
    esperando quando o ERP pede (429). A data final do ERP corta na meia-noite:
    pede-se um dia além e a junção tira as repetições."""
    chamar = chamar or previa.call
    falhas = vazios = 0
    for _ in range(8):
        try:
            r = chamar("dre-financas", {
                "action": "listar", "recurso": recurso, "status": status, "filtrodata": filtrodata,
                "datainicial": a.isoformat(), "datafinal": (b + datetime.timedelta(days=1)).isoformat(),
            })
        except previa.JanelaGrande:
            r = {"ok": True, "parcial": True, "diagnostico": {"motivo": "tempo-ou-rede"}}
        if r.get("ok") is True and not r.get("parcial") and isinstance(r.get("itens"), list):
            return r["itens"]
        diag = r.get("diagnostico") or {}
        if diag.get("motivo") == "http" and diag.get("http") == 429:
            dormir(65)
            continue
        # O ERP responde 404 quando a janela não tem lançamento, e às vezes pisca 404
        # em rota válida: três seguidos sem nenhum título = vazio (regra da casa).
        if diag.get("motivo") == "http" and diag.get("http") == 404 and not r.get("itens"):
            vazios += 1
            if vazios >= 3:
                return []
            dormir(5)
            continue
        expansiva = diag.get("motivo") in ("tempo-esgotado", "tempo-ou-rede", "orcamento-esgotado", "limite-de-paginas") or (
            diag.get("motivo") == "http" and diag.get("http") in (502, 504))
        if expansiva and a < b:
            meio = a + (b - a) // 2
            return (listar(recurso, status, filtrodata, a, meio, chamar, dormir)
                    + listar(recurso, status, filtrodata, meio + datetime.timedelta(days=1), b, chamar, dormir))
        falhas += 1
        if falhas < 3:
            dormir(5 * falhas)
            continue
        break
    raise ColetaIncompleta(f"{recurso} {status} de {a} a {b} não voltou inteiro; nada foi gravado.")


def janelas_mensais(ini, fim):
    out, d = [], ini
    while d <= fim:
        b = min(fim_do_mes(d.year, d.month), fim)
        out.append((d, b))
        d = b + datetime.timedelta(days=1)
    return out


def coletar(hoje, chamar=None, dormir=time.sleep, aviso=print):
    listas = []
    for recurso in RECURSOS:
        abertos = listar(recurso, "VENCIDO", "VENCIMENTO", VENCIDOS_DESDE, hoje, chamar, dormir)
        abertos += listar(recurso, "PENDENTE", "VENCIMENTO", hoje - datetime.timedelta(days=400), hoje + datetime.timedelta(days=730), chamar, dormir)
        pagos = []
        for a, b in janelas_mensais(PAGOS_DESDE, hoje):
            pagos += listar(recurso, "PAGO", "PAGAMENTO", a, b, chamar, dormir)
            dormir(1.2)
        aviso(f"{recurso}: {len(abertos)} em aberto, {len(pagos)} pagos desde {PAGOS_DESDE:%m/%Y} (contagens; valores omitidos do log).")
        listas += [(recurso, "aberto", abertos), (recurso, "pago", pagos)]
    return listas


def reconstruir(listas):
    titulos = []
    cobertura = {"titulos": 0, "semValor": 0, "semEmissao": 0, "pagamentoInvalido": 0, "quitadoComResiduo": {"quantidade": 0, "valor": 0.0}}
    residuo = 0
    for recurso, t, origens in juntar(listas):
        n, motivo = normalizar(t, recurso, quitado=origens == {"pago"})
        cobertura["titulos"] += 1
        if motivo:
            cobertura[motivo] += 1
            continue
        if n["residuo"]:
            cobertura["quitadoComResiduo"]["quantidade"] += 1
            residuo += n["residuo"]
        titulos.append(n)
    cobertura["quitadoComResiduo"]["valor"] = reais(residuo)
    return titulos, cobertura


def gravar(regs, chamar=None):
    chamar = chamar or previa.call
    for reg in regs:
        r = chamar("dre-sync", {"action": "posicoesGravar", "registro": reg})
        if not (isinstance(r, dict) and r.get("ok") is True):
            raise RuntimeError(f"O servidor não confirmou a posição de {reg['mes']}; as seguintes não foram gravadas.")


def main(hoje=None, chamar=None, dormir=time.sleep, aviso=print):
    hoje = hoje or datetime.date.today()
    publicar = os.environ.get("DRE_PUBLISH") == "1"
    meses = meses_fechados(hoje)
    if not meses:
        aviso("Nenhum fechamento de mês a remontar ainda.")
        return []
    listas = coletar(hoje, chamar, dormir, aviso)
    titulos, cobertura = reconstruir(listas)
    regs = montar_registros(titulos, meses, cobertura)
    aviso(f"{len(regs)} fechamento(s) remontado(s), de {regs[0]['mes']} a {regs[-1]['mes']}; "
          f"{cobertura['titulos']} títulos lidos, {cobertura['semValor']} sem valor, {cobertura['semEmissao']} sem emissão, "
          f"{cobertura['pagamentoInvalido']} com pagamento ilegível (fora da conta).")
    if publicar:
        gravar(regs, chamar)
        aviso("Posições gravadas no servidor.")
    else:
        aviso("Simulação: nada foi gravado (DRE_PUBLISH diferente de 1).")
    return regs


if __name__ == "__main__":
    try:
        main()
    except ColetaIncompleta as e:
        print(str(e))
        sys.exit(1)
