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
"""
import json
import re
import sys
import time
import datetime
import urllib.request
import urllib.error
from pathlib import Path

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
        time.sleep(5 * (n + 1))                            # espera crescente
    raise RuntimeError(ultimo)


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


def coletar(recurso, ini, fim):
    """Devolve os títulos únicos do período (dedup por id — fatias podem repetir)."""
    vistos = {}
    for a, b in fatias(ini, fim):
        r = call("dre-financas", {
            "action": "listar", "recurso": recurso, "status": "PAGO",
            "filtrodata": "PAGAMENTO",
            "datainicial": a.isoformat(), "datafinal": b.isoformat(),
        })
        for t in (r.get("itens") or []):
            vistos[t.get("id")] = t
        time.sleep(1.2)                                   # não afogar o ERP
    return list(vistos.values())


def main():
    hoje = datetime.date.today()
    if len(sys.argv) > 1:                                  # "2026-07"
        ano, mes = (int(x) for x in sys.argv[1].split("-")[:2])
        ini = datetime.date(ano, mes, 1)
    else:
        ini = hoje.replace(day=1)
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

    previa = {
        "label": label,
        "geradoEm": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "periodo": {"de": si, "ate": sf},
        "totais": {"receita": rec_total, "despesa": desp_total},
        "receitaClassificada": rec_class,
        "porCodigo": por_codigo,
        "diag": {
            "titulosReceita": len(receber),
            "titulosDespesa": len(pagar),
            "despesaSemCodigo": round(sem_codigo_desp, 2),
            "receitaSemCodigo": round(rec_total - rec_class, 2),
            "contas": len(por_codigo),
        },
    }

    atual = (call("dre-sync", {"action": "getCfg"}, 60) or {}).get("cfg") or {}
    atual["previaERP"] = previa
    call("dre-sync", {"action": "setCfg", "cfg": atual}, 90)

    d = previa["diag"]
    print(f"receita R$ {rec_total:,.2f} ({d['titulosReceita']} títulos · "
          f"R$ {d['receitaSemCodigo']:,.2f} sem quebra por produto)")
    print(f"despesa R$ {desp_total:,.2f} ({d['titulosDespesa']} títulos · "
          f"{d['contas']} contas)")


if __name__ == "__main__":
    main()
