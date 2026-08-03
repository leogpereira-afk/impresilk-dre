#!/usr/bin/env python3
"""Lê o mês corrente do Mubisys e grava a prévia em cfg.previaERP.

Roda no GitHub Actions (.github/workflows/erp-previa.yml) e também na mão:
    python3 scripts/erp_previa.py            # mês corrente
    python3 scripts/erp_previa.py 2026-07    # mês específico

Regras que este script respeita (aprendidas na marra, não mexer sem medir):
  * O ERP engasga com chamadas simultâneas — aqui é SEQUENCIAL, uma fatia por vez.
  * Janela mensal inteira estoura o tempo — busca em fatias de 7 dias.
  * Dia/semana sem lançamento devolve HTTP 404: é vazio, NÃO é erro.
  * Só entra no total quem tem compoe_dre = "Sim".
  * Título pode ter vários pagamentos: soma só os que caem dentro da janela.
  * NÃO filtrar por empresa. O ERP tem duas (Impresilk e Universo) e o caixa é
    um só — a planilha oficial já vem consolidada. Medido em jun/26: somando as
    duas, receita e despesa batem com a planilha em 0,4%; filtrando só a
    Impresilk, sobra Universo de fora e a conferência acusa rombo falso.
"""
import json
import re
import sys
import time
import datetime
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_os                                             # noqa: E402
import erp_mes                                            # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
cfg_js = (RAIZ / "config.js").read_text(encoding="utf-8")
TOKEN = re.search(r"const TOKEN\s*=\s*'([^']+)'", cfg_js).group(1)
BASE = re.search(r"const API_BASE\s*=\s*'([^']+)'", cfg_js).group(1)

PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def call(fn, payload, timeout=90, tentativas=4):
    """POST na Edge Function. 404 do ERP vira lista vazia (é ausência de dado)."""
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
            if "404" in corpo or "não encontrado" in corpo.lower():
                return {"ok": True, "itens": []}          # janela sem lançamento
            ultimo = f"HTTP {e.code}: {corpo}"
        except Exception as e:                             # rede/timeout
            ultimo = str(e)[:160]
        if eh_estouro(ultimo):
            # Janela grande demais para o tempo que a Edge Function tem (22s).
            # Repetir a MESMA janela não adianta — quem chamou precisa partir
            # o período. Sai na primeira, sem gastar as 4 tentativas.
            raise JanelaGrande(ultimo)
        time.sleep(5 * (n + 1))                            # espera crescente
    raise RuntimeError(ultimo)


class JanelaGrande(Exception):
    """A Edge Function abortou por tempo — o período pedido é grande demais."""


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
    """Valor de CAIXA do título dentro da janela (o topo às vezes vem zerado)."""
    pgs = t.get("pagamentos") or []
    if pgs:
        s = 0.0
        for p in pgs:
            dp = str(p.get("data_pagamento") or p.get("data_credito") or "")[:10]
            if ini <= dp <= fim:
                s += float(p.get("valor") or 0)
        if s:
            return s
    return float(t.get("valor_pagamento") or 0) or float(t.get("valor_titulo") or 0)


def codigo(pc):
    m = re.match(r"^([\d][\d.]*?)\s*-\s*(.*)$", str(pc or "").strip())
    return (m.group(1).rstrip("."), (m.group(2) or "").strip()) if m else ("", "")


def por_dia(titulos, ini, fim):
    """Quanto entrou/saiu em cada dia do mês.

    Serve para comparar com uma planilha exportada no meio do mês: sem isto o
    painel compara mês inteiro do ERP contra planilha parcial e acusa um rombo
    que não existe (jul/26 aparecia +21% de receita só por causa disso).
    """
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


def coletar(recurso, ini, fim):
    """Devolve os títulos únicos do período (dedup por id — fatias podem repetir).

    Fatia de 7 dias é o ponto de partida. Se a Edge Function abortar por tempo
    (ela tem 22s por chamada), a janela é PARTIDA AO MEIO e cada metade tenta
    de novo, até o dia isolado. Foi o que derrubou o robô em 02/08: julho ficou
    grande demais para a fatia semanal e as 4 tentativas repetiram a mesma
    janela, falhando igual. Um dia que nem sozinho passa vira erro de verdade —
    melhor falhar do que gravar mês pela metade sem ninguém saber.
    """
    vistos = {}

    def buscar(a, b, nivel=0):
        try:
            r = call("dre-financas", {
                "action": "listar", "recurso": recurso, "status": "PAGO",
                "filtrodata": "PAGAMENTO",
                "datainicial": a.isoformat(), "datafinal": b.isoformat(),
            })
        except JanelaGrande:
            if a >= b:
                raise
            meio = a + (b - a) // 2
            print(f"  janela {a} → {b} estourou o tempo; partindo ao meio", flush=True)
            buscar(a, meio, nivel + 1)
            buscar(meio + datetime.timedelta(days=1), b, nivel + 1)
            return
        for t in (r.get("itens") or []):
            vistos[t.get("id")] = t
        time.sleep(1.2)                                   # não afogar o ERP

    for a, b in fatias(ini, fim):
        buscar(a, b)
    return list(vistos.values())


CACHE_OS = RAIZ / ".cache" / "os.json"


def buscar_os(recebimentos, orcamento_s=1500):
    """Baixa as OS citadas pelos recebimentos, com cache em disco.

    Uma OS entregue não muda mais, então o cache poupa quase tudo: no dia a dia
    só entram as OS novas do mês. O orçamento de tempo evita que um ERP lento
    trave o robô — o que não deu tempo fica registrado no diagnóstico em vez de
    virar número incompleto com cara de completo.
    """
    cache = {}
    if CACHE_OS.exists():
        try:
            cache = json.loads(CACHE_OS.read_text())
        except Exception:
            cache = {}
    querer = []
    for t in recebimentos:
        querer.extend(erp_os.numeros_de_os(t.get("despesa")))
    falta = [n for n in sorted(set(querer)) if n not in cache]
    print(f"OS citadas: {len(set(querer))} · em cache: {len(set(querer)) - len(falta)} · a buscar: {len(falta)}")

    inicio = time.time()
    buscadas = 0
    for n in falta:
        if time.time() - inicio > orcamento_s:
            print(f"  orçamento de tempo estourou com {len(falta) - buscadas} OS pendentes")
            break
        try:
            r = call("dre-financas", {"action": "raw", "recurso": f"ordem-servico/numero/{n}"},
                     timeout=60, tentativas=2)
            cache[n] = r.get("resposta") if r.get("ok") else {"_erro": r.get("http")}
        except Exception as e:
            cache[n] = {"_erro": str(e)[:80]}
        buscadas += 1
        time.sleep(0.8)

    CACHE_OS.parent.mkdir(parents=True, exist_ok=True)
    CACHE_OS.write_text(json.dumps(cache, ensure_ascii=False))
    return cache


def main():
    hoje = datetime.date.today()
    arg_mes = next((a for a in sys.argv[1:] if not a.startswith("--")), None)
    if arg_mes:                                            # "2026-07"
        ano, mes = (int(x) for x in arg_mes.split("-")[:2])
        alvos = [datetime.date(ano, mes, 1)]
    else:
        corrente = hoje.replace(day=1)
        alvos = [corrente]
        # Até o dia 7, consolida TAMBÉM o mês anterior. Pagamento datado do fim
        # do mês entra no ERP com dias de atraso (a Cemig de 27/07 só apareceu
        # depois) — sem esta releitura, o mês fecharia para sempre com o que
        # existia na manhã do dia 1º. O anterior roda primeiro, para a prévia
        # (cfg.previaERP) terminar apontando para o mês corrente.
        if hoje.day <= 7:
            alvos.insert(0, (corrente - datetime.timedelta(days=1)).replace(day=1))
    for ini in alvos:
        processar(ini)


def processar(ini):
    fim = (ini + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)
    label = f"{PT[ini.month - 1]}/{ini.year}"
    si, sf = ini.isoformat(), fim.isoformat()
    print(f"lendo {label} ({si} → {sf})")

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

    # Fatura de cartão vem com plano de contas "2-Despesas" — o código existe,
    # mas é o topo da árvore: o ERP não abre o que foi comprado dentro dela.
    # Em jun/26 eram R$ 17.154,88 (duas faturas) e respondiam por quase toda a
    # divergência contra a planilha, que traz a fatura já rateada.
    fatura = [t for t in pagar if codigo(t.get("plano_contas"))[0] in ("2", "")]
    fatura_v = round(sum(valor_na_janela(t, si, sf) for t in fatura), 2)

    # Quebra por produto: o total da receita já está certo, mas só a OS diz de
    # QUE produto veio cada real. O rateio devolve exatamente o mesmo total.
    operacionais = [t for t in receber if t.get("tipo") == "Receita operacional"]
    cache_os = buscar_os(operacionais)
    por_produto, diag_os = erp_os.ratear(operacionais, cache_os,
                                         lambda t: valor_na_janela(t, si, sf))

    # Mesma receita lida por conta do DRE. Junta o rateio da OS com os títulos
    # que já vêm com plano de contas (receita não operacional), para poder pôr
    # lado a lado com a planilha e achar produto cadastrado na conta errada.
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

    # O mês oficial, montado direto do ERP — é isto que aposenta o .xlsx.
    # Os códigos de produto vêm do servidor para serem os mesmos todo mês, e os
    # nomes das contas vêm dos meses que já estão lá (o plano de contas inteiro).
    cfg_atual = (call("dre-sync", {"action": "getCfg"}, 60) or {}).get("cfg") or {}
    lista = call("dre-sync", {"action": "list"}, 90) or {}
    meses_servidor = lista.get("itens") or []
    nomes_contas = {}
    for r in meses_servidor:
        for c in (r.get("cells") or []):
            # Descarta nome igual ao código: é o preenchimento de emergência de
            # um mês que este robô gerou antes de saber o nome. Sem esta linha o
            # erro se propaga — a primeira leitura ruim vira a definitiva.
            if c.get("name") and c.get("code") and c["name"] != c["code"]:
                nomes_contas.setdefault(c["code"], c["name"])

    registro, cod_produtos, cod_remanejadas = erp_mes.montar(
        label, receber, pagar, por_produto, lambda t: valor_na_janela(t, si, sf),
        codigo, cfg_atual.get("produtosCodigo"), erp_os.MAPA_CONTA, nomes_contas,
        cfg_atual.get("contasRemanejadas"))

    # As pendências de classificação (Pró Vida, receita não-operacional em
    # conta de produto, Nordeste sem descrição…) viajam na prévia: é o que a
    # aba Conferência já lê, sem precisar de chamada nova.
    previa["pendencias"] = registro.get("pendencias") or []

    if "--dry" in sys.argv:
        print("(--dry: não gravou nada no servidor)")
    elif not (receber or pagar):
        # Mês sem lançamento não grava NADA — nem registro, nem prévia.
        # O registro vazio já zerou o painel uma vez (01/08, cron do dia 1º);
        # a prévia vazia sobrescreveria a do mês anterior na Conferência,
        # apagando totais e pendências que ainda interessam.
        print(f"NÃO gravei {label}: nenhum lançamento no período ainda.")
    else:
        cfg_atual["previaERP"] = previa
        cfg_atual["produtosCodigo"] = cod_produtos
        # a escolha de código das contas remanejadas TEM que sobreviver entre
        # execuções, senão a conta muda de código a cada leitura do robô
        cfg_atual["contasRemanejadas"] = cod_remanejadas
        call("dre-sync", {"action": "setCfg", "cfg": cfg_atual}, 90)

        # TRAVA: nunca reescrever mês que veio da planilha. Os 8 meses do
        # histórico (Dez/25→Jul/26) foram conferidos conta a conta e não podem
        # ser sobrescritos por uma leitura automática. Só grava mês novo ou mês
        # que este mesmo robô gerou antes (origem "erp").
        antigo = next((r for r in meses_servidor if r.get("id") == registro["id"]), None)
        if antigo and antigo.get("origem") != "erp" and "--forcar" not in sys.argv:
            print(f"NÃO gravei {label}: já existe e veio da planilha "
                  f"(atualizado em {antigo.get('atualizadoEm')}). "
                  f"Use --forcar para substituir.")
        else:
            registro["atualizadoEm"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            r = call("dre-sync", {"action": "upsert", "registro": registro}, 90)
            if r.get("conflito"):
                print(f"NÃO gravei {label}: o servidor tem versão mais nova.")
            else:
                print(f"mês {label} gravado do ERP ({len(registro['cells'])} contas)")

    d = previa["diag"]
    print(f"receita R$ {rec_total:,.2f} ({d['titulosReceita']} títulos · "
          f"R$ {d['receitaSemCodigo']:,.2f} sem plano de contas no título)")
    print(f"despesa R$ {desp_total:,.2f} ({d['titulosDespesa']} títulos · "
          f"{d['contas']} contas · R$ {fatura_v:,.2f} em fatura de cartão sem quebra)")
    print(f"produtos: {len(por_produto)} · rateado R$ {diag_os['valorRateado']:,.2f} "
          f"de {diag_os['rateados']}/{diag_os['titulos']} títulos operacionais"
          + (f" · R$ {diag_os['valorSemOS']:,.2f} sem OS" if diag_os["valorSemOS"] else ""))
    for nome, v in list(por_produto.items())[:8]:
        print(f"   {v:>12,.2f}  {nome}")


if __name__ == "__main__":
    main()
