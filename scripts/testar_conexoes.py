#!/usr/bin/env python3
"""Testa TODAS as pontas de conexão do DRE: Supabase, Mubisys, site e robô.

Uso (da raiz do repo):
    python3 scripts/testar_conexoes.py

Roda sempre que mexer em credencial, publicar Edge Function ou desconfiar que
"o painel não está atualizando". Cada bloco responde uma pergunta específica e o
resumo no fim diz o que quebrou — não é um "ok" genérico.

Regras aprendidas na marra (não mexer sem medir):
  * O Mubisys devolve 404 para JANELA SEM LANÇAMENTO e 422 quando falta a data.
    Nos dois casos ele falou conosco e aceitou a credencial: a conexão está boa.
  * O cron do robô é 09/15/21 UTC. O intervalo da NOITE é de 12h, não de 6h —
    cobrar 6h de madrugada dá alarme falso todo dia.
  * O CACHE do sw.js e o ?v= do index.html têm que ser o mesmo número.
"""
import json
import re
import time
import datetime
import urllib.request
import urllib.error
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
cfg_js = (RAIZ / "config.js").read_text(encoding="utf-8")
TOKEN = re.search(r"const TOKEN\s*=\s*'([^']+)'", cfg_js).group(1)
BASE = re.search(r"const API_BASE\s*=\s*'([^']+)'", cfg_js).group(1)
SITE = "https://leogpereira-afk.github.io/impresilk-dre"

OK, FALHA, AVISO = [], [], []


def http(url, payload=None, headers=None, timeout=60):
    """Devolve (status, corpo, ms). Nunca levanta exceção."""
    t0 = time.time()
    try:
        dados = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=dados, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), int((time.time() - t0) * 1000)
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}", int((time.time() - t0) * 1000)


def fn(nome, payload, timeout=60):
    return http(f"{BASE}/{nome}", payload,
                {"content-type": "application/json", "x-token": TOKEN}, timeout)


def ck(nome, ok, ms=0, detalhe="", aviso=False):
    marca = "✅" if ok else ("⚠️ " if aviso else "❌")
    print(f"  {marca} {nome:<46} {ms:>6} ms   {detalhe}")
    (OK if ok else (AVISO if aviso else FALHA)).append(f"{nome} — {detalhe}")


agora = datetime.datetime.now(datetime.timezone.utc)
hoje = agora.date()
mes1 = hoje.replace(day=1)

print("=" * 82)
print(f"CONEXÕES DO DRE · {hoje.strftime('%d/%m/%Y')} {agora.strftime('%H:%M')} UTC")
print("=" * 82)

# ── 1 ────────────────────────────────────────────────────────────────────────
print("\n1) SUPABASE · dre-sync — os meses e a configuração do painel")
st, body, ms = fn("dre-sync", {"action": "ping"}, 30)
ck("responde", st == 200 and '"ok":true' in body, ms, f"HTTP {st}")

meses, itens = [], []
off = 0
t0 = time.time()
while off is not None:
    st, body, _ = fn("dre-sync", {"action": "list", "offset": off}, 60)
    if st != 200:
        break
    d = json.loads(body)
    itens += d.get("itens") or []
    off = d.get("nextOffset")
meses = [i.get("label") for i in itens]
ck("lista os meses", bool(meses), int((time.time() - t0) * 1000), f"{len(meses)} meses gravados")

st, body, ms = fn("dre-sync", {"action": "getCfg"}, 45)
cfg_srv = json.loads(body).get("cfg") or {} if st == 200 else {}
ck("lê a configuração global", st == 200, ms, f"{len(cfg_srv)} chaves: {', '.join(list(cfg_srv))}")

st, body, ms = http(f"{BASE}/dre-sync", {"action": "ping"},
                    {"content-type": "application/json", "x-token": "token-errado"}, 20)
ck("recusa token errado", st == 401, ms, f"HTTP {st}")

st, body, ms = fn("dre-sync", {"action": "acao-inexistente"}, 20)
ck("recusa ação desconhecida", st == 400, ms, f"HTTP {st}")

# ── 2 ────────────────────────────────────────────────────────────────────────
print("\n2) SUPABASE · dre-financas — a ponte para o Mubisys")
st, body, ms = fn("dre-financas", {"action": "statusConfig"}, 30)
conf = json.loads(body) if st == 200 else {}
ck("credenciais cadastradas", bool(conf.get("configurado")), ms,
   f"base {conf.get('base', '—')}")

st, body, ms = http(f"{BASE}/dre-financas", {"action": "ping"},
                    {"content-type": "application/json", "x-token": "token-errado"}, 20)
ck("recusa token errado", st == 401, ms, f"HTTP {st}")

# ping com janela cheia: é o único que prova credencial boa de ponta a ponta
st, body, ms = fn("dre-financas", {"action": "ping", "datainicial": mes1.isoformat(),
                                   "datafinal": hoje.isoformat()}, 60)
d = json.loads(body) if st == 200 else {}
ck("ping com período cheio", bool(d.get("ok")), ms, f"Mubisys HTTP {d.get('http')}")

# ping com janela vazia: NÃO pode acusar queda (404 = sem lançamento)
ontem = hoje - datetime.timedelta(days=1)
st, body, ms = fn("dre-financas", {"action": "ping", "datainicial": ontem.isoformat(),
                                   "datafinal": ontem.isoformat()}, 60)
d = json.loads(body) if st == 200 else {}
vazio_ok = bool(d.get("ok")) or d.get("http") == 404
ck("ping com período vazio não dá alarme falso", vazio_ok, ms,
   f"Mubisys HTTP {d.get('http')} · {d.get('detalhe', 'função ainda não republicada')}",
   aviso=(not d.get("ok") and d.get("http") == 404))

# ── 3 ────────────────────────────────────────────────────────────────────────
print("\n3) MUBISYS · leitura real de cada recurso que o painel usa")
ini, fim = mes1.isoformat(), hoje.isoformat()
num_os = None
for recurso, rot in (("contas-pagar", "contas a pagar (mês corrente)"),
                     ("contas-receber", "contas a receber (mês corrente)")):
    st, body, ms = fn("dre-financas", {"action": "listar", "recurso": recurso, "status": "PAGO",
                                       "filtrodata": "PAGAMENTO",
                                       "datainicial": ini, "datafinal": fim}, 90)
    if st == 200:
        d = json.loads(body)
        soma = 0.0
        for t in (d.get("itens") or []):
            pgs = t.get("pagamentos") or []
            soma += (sum(float(p.get("valor") or 0) for p in pgs) if pgs
                     else float(t.get("valor_pagamento") or 0) or float(t.get("valor_titulo") or 0))
            if recurso == "contas-receber" and not num_os:
                m = re.search(r"\b(\d{4,6})\b", str(t.get("descricao") or ""))
                if m:
                    num_os = m.group(1)
        ck(rot, True, ms, f"{d.get('total', 0)} títulos · R$ {soma:,.2f}")
    else:
        ck(rot, False, ms, f"HTTP {st} {body[:70]}")

if num_os:
    st, body, ms = fn("dre-financas", {"action": "raw", "recurso": f"ordem-servico/numero/{num_os}"}, 60)
    ck(f"ordem de serviço #{num_os}", st == 200, ms, f"HTTP {st} · {len(body)} bytes")
else:
    ck("ordem de serviço", True, 0, "nenhuma OS citada no mês ainda", aviso=True)

# ── 4 ────────────────────────────────────────────────────────────────────────
print("\n4) SUPABASE · equipe-auth — a porta de entrada")
st, body, ms = http(f"{BASE}/equipe-auth", {"acao": "conferir", "sistema": "dre"},
                    {"content-type": "application/json"}, 30)
ck("responde e exige crachá", st in (200, 400, 401, 403), ms, f"HTTP {st} {body[:60]}")

# ── 5 ────────────────────────────────────────────────────────────────────────
print("\n5) SITE · GitHub Pages e PWA")
st, body, ms = http(f"{SITE}/index.html?t={int(time.time())}", timeout=30)
vhtml = sorted(set(re.findall(r"\?v=(\d+)", body))) if st == 200 else []
ck("index.html no ar", st == 200, ms, f"assets em v{','.join(vhtml)}")

st, body, ms = http(f"{SITE}/sw.js?t={int(time.time())}", timeout=30)
m = re.search(r"app-shell-v(\d+)", body or "")
vsw = m.group(1) if m else "?"
ck("sw.js no ar", st == 200, ms, f"CACHE v{vsw}")
ck("versão do sw casa com a do index", vhtml == [vsw], 0,
   f"html=v{','.join(vhtml)} sw=v{vsw}" + ("" if vhtml == [vsw] else "  ← quem abrir offline vê tela velha"))

for arq in ("app.js", "styles.css", "config.js", "auth.js", "data.js",
            "manifest.webmanifest", "instalacao/index.html"):
    st, body, ms = http(f"{SITE}/{arq}", timeout=30)
    ck(arq, st == 200, ms, f"{len(body) // 1024} KB")

# ── 6 ────────────────────────────────────────────────────────────────────────
print("\n6) ROBÔ · GitHub Actions lendo o ERP (09/15/21 UTC)")
p = cfg_srv.get("previaERP") or {}
ger = p.get("geradoEm") or ""
if ger:
    t = datetime.datetime.fromisoformat(ger.replace("Z", "+00:00"))
    horas = (agora - t).total_seconds() / 3600
    # o intervalo da NOITE (21h → 09h) é de 12h; folga de 2h para o atraso
    # normal do agendador do GitHub, que quase nunca dispara no minuto exato
    limite = 14
    ck("leitura recente do ERP", horas <= limite, 0,
       f"última {t.strftime('%d/%m %H:%M')} UTC · há {horas:.1f}h (limite {limite}h)")
    ck("prévia aponta para o mês corrente",
       str(p.get("label", "")).lower().startswith(
           ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][hoje.month - 1]),
       0, f"prévia de {p.get('label')}")
else:
    ck("leitura recente do ERP", False, 0, "não há prévia gravada no servidor")

erp = [i for i in itens if (i.get("origem") == "erp")]
ck("meses vindos do robô", bool(erp), 0,
   ", ".join(sorted(i["label"] for i in erp)) or "nenhum")

print("\n" + "=" * 82)
print(f"RESULTADO: {len(OK)} ok · {len(AVISO)} aviso(s) · {len(FALHA)} falha(s)")
for f in FALHA:
    print("   ❌", f)
for a in AVISO:
    print("   ⚠️ ", a)
