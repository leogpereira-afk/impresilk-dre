
"""Módulo financeiro: processa dados recebidos da origem autenticada."""
import json
import os
import uuid
import re
import sys
import time
import datetime
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_os
import erp_mes

RAIZ = Path(__file__).resolve().parent.parent
cfg_js = (RAIZ / "config.js").read_text(encoding="utf-8")
TOKEN = os.environ.get("DRE_MACHINE_TOKEN", "")
BASE = re.search(r"const API_BASE\s*=\s*'([^']+)'", cfg_js).group(1)

PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

def call(fn, payload, timeout=90, tentativas=4):
    """call: processa dados recebidos da origem autenticada."""
    if not TOKEN:
        raise RuntimeError("Configure DRE_MACHINE_TOKEN no ambiente da rotina. Não use credencial de navegador.")
    ultimo = None
    for n in range(tentativas):
        try:
            req = urllib.request.Request(
                f"{BASE}/{fn}",
                data=json.dumps(payload).encode(),
                headers={"content-type": "application/json", "x-token": TOKEN},
            )
            return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())
        except urllib.error.HTTPError as e:
            corpo = e.read().decode()[:200]
            ultimo = f"HTTP {e.code}: falha no serviço {fn}"
            if e.code in (401, 403):
                raise RuntimeError("Autenticação da rotina recusada; configure o segredo do servidor no GitHub.")
        except Exception as e:
            ultimo = str(e)[:160]
        if eh_estouro(ultimo):

            raise JanelaGrande(ultimo)
        time.sleep(5 * (n + 1))
    raise RuntimeError(ultimo)

class JanelaGrande(Exception):
    """JanelaGrande: processa dados recebidos da origem autenticada."""

def eh_estouro(msg):
    m = str(msg or "").lower()
    return ("signal has been aborted" in m or "aborted" in m
            or "timed out" in m or "timeout" in m
            or "http 504" in m or "http 502" in m)

def fatias(ini, fim, dias=7):
    out, d = [], ini
    while d <= fim:
        b = min(d + datetime.timedelta(days=dias - 1), fim)
        out.append((d, b))
        d = b + datetime.timedelta(days=1)
    return out

def valor_na_janela(t, ini, fim):
    """valor_na_janela: processa dados recebidos da origem autenticada."""
    from decimal import Decimal, ROUND_HALF_UP
    def centavos(v):
        if v is None or v == "": raise ValueError("Pagamento sem valor válido")
        n = Decimal(str(v))
        if not n.is_finite(): raise ValueError("Pagamento sem valor finito")
        return n.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    def data(x):
        d = str(x.get("data_pagamento") or x.get("data_credito") or "")[:10]
        datetime.date.fromisoformat(d)
        return d
    pgs = t.get("pagamentos") or []
    if pgs:
        soma = Decimal("0")
        for pg in pgs:
            dp = data(pg)
            if ini <= dp <= fim: soma += centavos(pg.get("valor"))
        return float(soma)
    dp = data(t)
    return float(centavos(t.get("valor_pagamento"))) if ini <= dp <= fim else 0.0

def codigo(pc):
    m = re.match(r"^([\d][\d.]*?)\s*-\s*(.*)$", str(pc or "").strip())
    return (m.group(1).rstrip("."), (m.group(2) or "").strip()) if m else ("", "")

def por_dia(titulos, ini, fim):
    """por_dia: processa dados recebidos da origem autenticada."""
    dias = {}
    for t in titulos:
        pgs = t.get("pagamentos") or []
        if pgs:
            for p in pgs:
                d = str(p.get("data_pagamento") or p.get("data_credito") or "")[:10]
                if ini <= d <= fim:
                    dias[d] = round(dias.get(d, 0.0) + float(p.get("valor") or 0), 2)
        else:
            d = str(t.get("data_pagamento") or "")[:10]
            if ini <= d <= fim:
                dias[d] = round(dias.get(d, 0.0) + valor_na_janela(t, ini, fim), 2)
    return dict(sorted(dias.items()))

def eventos_financeiros(titulos, natureza, ini, fim):
    """eventos_financeiros: processa dados recebidos da origem autenticada."""
    eventos = []
    for t in titulos:
        code, nome = codigo(t.get("plano_contas"))
        pgs = t.get("pagamentos") or [{"data_pagamento":t.get("data_pagamento"),"data_credito":t.get("data_credito"),"valor":t.get("valor_pagamento")}]
        for i, pg in enumerate(pgs):
            data = str(pg.get("data_pagamento") or pg.get("data_credito") or "")[:10]
            if not (ini <= data <= fim): continue
            valor = valor_na_janela({"pagamentos":[pg]}, ini, fim)
            eventos.append({"natureza":natureza,"empresa":str(t.get("empresa") or t.get("empresa_id") or "Não informada"),
                "tituloId":str(t.get("id")),"pagamentoId":str(pg["id"]) if pg.get("id") is not None else None,
                "indiceNaColeta":i,"data":data,"valor":valor,"contaOrigem":code,"nomeConta":nome,
                "ordensServico":erp_os.numeros_de_os(t.get("despesa")) if natureza=="entrada" else []})
    return eventos

def coletar(recurso, ini, fim):
    """coletar: processa dados recebidos da origem autenticada."""
    vistos = {}

    def buscar(a, b, nivel=0):
        try:
            r = call("dre-financas", {
                "action": "listar", "recurso": recurso, "status": "PAGO",
                "filtrodata": "PAGAMENTO",
                "datainicial": a.isoformat(), "datafinal": b.isoformat(),
            })
            diag = r.get("diagnostico") or {}
            if r.get("parcial") and (diag.get("motivo") in ("tempo-ou-rede", "orcamento-esgotado")
                    or (diag.get("motivo") == "http" and diag.get("http") in (502,504))):
                raise JanelaGrande("A origem não concluiu a janela no prazo.")
        except JanelaGrande:
            if a >= b:
                raise
            meio = a + (b - a) // 2
            print(f"  janela {a} → {b} estourou o tempo; partindo ao meio", flush=True)
            buscar(a, meio, nivel + 1)
            buscar(meio + datetime.timedelta(days=1), b, nivel + 1)
            return
        if r.get("ok") is not True or r.get("parcial") or not isinstance(r.get("itens"), list):
            raise RuntimeError("Coleta incompleta; última versão preservada.")
        for t in (r.get("itens") or []):
            if t.get("id") is None:
                raise RuntimeError("Título sem identificador; coleta não verificável.")
            key = (str(t.get("empresa_id") or t.get("empresa") or ""), str(t["id"]))
            def financeiro(x): return [x.get(k) for k in ("compoe_dre","plano_contas","valor_pagamento","data_pagamento","pagamentos")]
            if key in vistos and financeiro(vistos[key]) != financeiro(t):
                raise RuntimeError("Título alterado durante a coleta; repita para obter uma versão consistente.")
            vistos[key] = t
        time.sleep(1.2)

    for a, b in fatias(ini, fim):
        buscar(a, b)
    return list(vistos.values())

CACHE_OS = RAIZ / ".cache" / "os.json"

def buscar_os(recebimentos, orcamento_s=1500):
    """buscar_os: processa dados recebidos da origem autenticada."""
    cache = {}
    if CACHE_OS.exists():
        try:
            cache = json.loads(CACHE_OS.read_text())
        except Exception:
            cache = {}
    querer = []
    for t in recebimentos:
        querer.extend(erp_os.numeros_de_os(t.get("despesa")))

    def _precisa(n):
        o = cache.get(n)
        if not isinstance(o, dict) or "_erro" in o:
            return True
        return (str(o.get("status") or "").strip().lower() != "entregue"
                or time.time() - float(o.get("_dreConsultadoEm") or 0) > 6 * 3600)
    falta = [n for n in sorted(set(querer)) if _precisa(n)]
    print(f"OS citadas: {len(set(querer))} · em cache: {len(set(querer)) - len(falta)} · a buscar: {len(falta)}")

    inicio = time.time()
    buscadas = 0
    falhou = []
    for n in falta:
        if time.time() - inicio > orcamento_s:
            print(f"  orçamento de tempo estourou com {len(falta) - buscadas} OS pendentes")
            break
        try:
            r = call("dre-financas", {"action": "listar", "recurso": f"ordem-servico/numero/{n}"},
                     timeout=60, tentativas=2)
            if r.get("ok") and not r.get("parcial"):
                itens = r.get("itens")
                resposta = itens[0] if isinstance(itens, list) and len(itens) == 1 else None
                if not isinstance(resposta, dict): raise ValueError("O.S. inválida")
                cache[n] = {**resposta, "_dreConsultadoEm": time.time()}
            else:

                cache.pop(n, None)
                falhou.append(n)
        except Exception:
            cache.pop(n, None)
            falhou.append(n)
        buscadas += 1
        time.sleep(0.8)

    if falhou:
        print(f"  {len(falhou)} OS falharam e NÃO entraram no cache (serão rebuscadas)")
    CACHE_OS.parent.mkdir(parents=True, exist_ok=True)
    CACHE_OS.write_text(json.dumps(cache, ensure_ascii=False))

    return {n:o for n,o in cache.items() if isinstance(o,dict) and "_erro" not in o
            and time.time() - float(o.get("_dreConsultadoEm") or 0) <= 6 * 3600}

def main(on_month=None):
    hoje = datetime.date.today()
    arg_mes = next((a for a in sys.argv[1:] if not a.startswith("--")), None)
    if arg_mes:
        ano, mes = (int(x) for x in arg_mes.split("-")[:2])
        alvos = [datetime.date(ano, mes, 1)]
    else:
        corrente = hoje.replace(day=1)
        alvos = [corrente]

        alvos.insert(0, (corrente - datetime.timedelta(days=1)).replace(day=1))
    for ini in alvos:
        resultado = processar(ini)
        if on_month:
            on_month(resultado)

def processar(ini):
    fim = (ini + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)
    label = f"{PT[ini.month - 1]}/{ini.year}"
    si, sf = ini.isoformat(), fim.isoformat()
    execucao_id = os.environ.get("GITHUB_RUN_ID") or str(uuid.uuid4())
    print(f"lendo {label} ({si} → {sf})")

    cfg_res = call("dre-sync", {"action": "getCfg"}, 60)
    if cfg_res.get("ok") is not True: raise RuntimeError("Configurações não confirmadas")
    cfg_atual = cfg_res.get("cfg") or {}
    regras_privadas = (cfg_atual.get("regras") or {}).get("classificacaoPrivada")
    if not isinstance(regras_privadas,dict) or regras_privadas.get("versao") != 1:
        raise RuntimeError("Configuração privada de classificação não validada; nada foi gravado.")

    pagar = coletar("contas-pagar", ini, fim)
    receber = coletar("contas-receber", ini, fim)
    na_dre = lambda L: [t for t in L if str(t.get("compoe_dre", "")).lower() == "sim"]
    pagar, receber = na_dre(pagar), na_dre(receber)

    por_codigo, sem_codigo_desp = {}, 0.0
    for t in pagar:
        v = valor_na_janela(t, si, sf)
        c, nome = codigo(t.get("plano_contas"))
        if not c:
            sem_codigo_desp += v
            continue
        e = por_codigo.setdefault(c, {"nome": nome, "valor": 0.0})
        e["valor"] += v
    for c in por_codigo:
        por_codigo[c]["valor"] = round(por_codigo[c]["valor"], 2)

    rec_total = round(sum(valor_na_janela(t, si, sf) for t in receber), 2)
    rec_class = round(sum(valor_na_janela(t, si, sf) for t in receber if codigo(t.get("plano_contas"))[0]), 2)
    desp_total = round(sum(valor_na_janela(t, si, sf) for t in pagar), 2)

    fatura = [t for t in pagar if codigo(t.get("plano_contas"))[0] in ("2", "")]
    fatura_v = round(sum(valor_na_janela(t, si, sf) for t in fatura), 2)

    operacionais = [t for t in receber if t.get("tipo") == "Receita operacional"]
    cache_os = buscar_os(operacionais)
    por_produto, diag_os = erp_os.ratear(operacionais, cache_os,
                                         lambda t: valor_na_janela(t, si, sf))

    contas_os, produtos_sem_conta = erp_os.por_conta(por_produto)
    for t in receber:
        if t.get("tipo") == "Receita operacional":
            continue
        c, _ = codigo(t.get("plano_contas"))
        if c:
            contas_os[c] = round(contas_os.get(c, 0.0) + valor_na_janela(t, si, sf), 2)

    empresas = {}
    for nome, L in (("receita", receber), ("despesa", pagar)):
        for t in L:
            e = empresas.setdefault(str(t.get("empresa") or "?"), {"receita": 0.0, "despesa": 0.0})
            e[nome] = round(e[nome] + valor_na_janela(t, si, sf), 2)

    previa = {
        "label": label,
        "geradoEm": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "periodo": {"de": si, "ate": sf},
        "totais": {"receita": rec_total, "despesa": desp_total},
        "receitaClassificada": rec_class,
        "porCodigo": por_codigo,
        "porDia": {"receita": por_dia(receber, si, sf), "despesa": por_dia(pagar, si, sf)},
        "receitaPorProduto": por_produto,
        "receitaPorConta": contas_os,
        "produtosSemConta": produtos_sem_conta,
        "diagOS": diag_os,
        "empresas": empresas,
        "faturaCartao": {
            "valor": fatura_v,
            "titulos": [{"origem": t.get("origem"), "descricao": t.get("descricao"),
                         "valor": round(valor_na_janela(t, si, sf), 2)} for t in fatura],
        },
        "diag": {
            "titulosReceita": len(receber),
            "titulosDespesa": len(pagar),
            "despesaSemCodigo": round(sem_codigo_desp, 2),
            "despesaSemQuebra": fatura_v,
            "receitaSemCodigo": round(rec_total - rec_class, 2),
            "contas": len(por_codigo),
        },
    }

    lista = call("dre-sync", {"action": "list"}, 90) or {}
    if lista.get("ok") is not True or not isinstance(lista.get("itens"),list): raise RuntimeError("Histórico não confirmado")
    meses_servidor = lista["itens"]
    offset = lista.get("nextOffset")
    while offset is not None:
        lista = call("dre-sync", {"action":"list", "offset":offset}, 90)
        if lista.get("ok") is not True or not isinstance(lista.get("itens"),list): raise RuntimeError("Histórico parcial")
        meses_servidor.extend(lista["itens"])
        prox = lista.get("nextOffset")
        if prox is not None and prox <= offset: raise RuntimeError("Paginação inválida")
        offset = prox
    for reg in sorted(meses_servidor, key=lambda r:r.get("atualizadoEm", "")):
        for campo, mapa in (reg.get("mapeamento") or {}).items():
            cfg_atual.setdefault(campo, {}).update(mapa)
    nomes_contas = {}
    for r in meses_servidor:
        for c in (r.get("cells") or []):

            if c.get("name") and c.get("code") and c["name"] != c["code"]:
                nomes_contas.setdefault(c["code"], c["name"])

    registro, cod_produtos, cod_remanejadas = erp_mes.montar(
        label, receber, pagar, por_produto, lambda t: valor_na_janela(t, si, sf),
        codigo, cfg_atual.get("produtosCodigo"), erp_os.MAPA_CONTA, nomes_contas,
        cfg_atual.get("contasRemanejadas"), regras_privadas)

    previa["pendencias"] = registro.get("pendencias") or []

    registro["eventos"] = eventos_financeiros(receber,"entrada",si,sf) + eventos_financeiros(pagar,"saida",si,sf)
    for natureza,total in (("entrada",rec_total),("saida",desp_total)):
        if abs(sum(e["valor"] for e in registro["eventos"] if e["natureza"]==natureza)-total) > .011:
            raise RuntimeError("Trilha de pagamentos não fecha; nada foi gravado.")
    registro["previaERP"] = previa
    registro["mapeamento"] = {"produtosCodigo":cod_produtos, "contasRemanejadas":cod_remanejadas}
    registro["qualidade"] = {
        "execucaoId":execucao_id, "coletadoEm":previa["geradoEm"], "de":si,
        "ate":min(fim, datetime.date.today()).isoformat(), "regra":"caixa-v2",
        "estado":"parcial" if fim >= datetime.date.today() else "aguardando-conferencia",
        "escopo":"compõe DRE", "conciliado":False, "apiContratoValidado":False,
        "titulosReceita":len(receber), "titulosDespesa":len(pagar)
    }
    valores = {c["code"]:c["value"] for c in registro["cells"]}
    if abs(valores.get("1",0)-rec_total) > .011 or abs(valores.get("2",0)-desp_total) > .011:
        raise RuntimeError("Os totais de controle não fecham; nada foi gravado.")

    estado = 'simulado'
    if "--dry" in sys.argv or os.environ.get("DRE_PUBLISH") != "1":
        print("(--dry: não gravou nada no servidor)")
    elif not (receber or pagar):

        print(f"NÃO gravei {label}: nenhum lançamento no período ainda.")
        estado = 'vazio'
    else:

        antigo = next((r for r in meses_servidor if r.get("id") == registro["id"]), None)
        if antigo and antigo.get("origem") != "erp" and "--forcar" not in sys.argv:
            print(f"NÃO gravei {label}: já existe e veio da planilha "
                  f"(atualizado em {antigo.get('atualizadoEm')}). "
                  f"Use --forcar para substituir.")
            estado = 'preservado'
        else:
            registro["atualizadoEm"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            r = call("dre-sync", {"action": "upsert", "registro": registro, "baseAtualizadoEm":(antigo or {}).get("atualizadoEm"), "operacaoId":execucao_id+":"+registro["id"]}, 90)
            if r.get("conflito"):
                raise RuntimeError("Conflito: versão concorrente preservada.")
            elif r.get("ok") is not True:
                raise RuntimeError("Gravação não confirmada pelo servidor.")
            else:
                print(f"mês {label} gravado do ERP ({len(registro['cells'])} contas)")
                estado = 'gravado'

    d = previa["diag"]
    print(f"Conferência: {d['titulosReceita']} títulos de receita; {d['titulosDespesa']} de despesa; "
          f"{d['contas']} contas; {diag_os['rateados']}/{diag_os['titulos']} títulos rateados; "
          f"{len(registro['pendencias'])} pendências. Valores comerciais omitidos do log.")
    return {'label': label, 'estado': estado}

if __name__ == "__main__":
    main()
