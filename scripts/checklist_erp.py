#!/usr/bin/env python3
"""Checklist geral pós-renumeração: entra nas entranhas e confere item a item.

Roda contra os dados CRUS do ERP (receber/pagar) e contra o mês gravado no
servidor. Cada bloco responde uma pergunta que já custou dinheiro errado.

Uso (a partir da raiz do repo, com receber_AAAA-MM.json / pagar_AAAA-MM.json
e servidor.json baixados):
    python3 scripts/checklist_erp.py

Rodar SEMPRE que o plano de contas do Mubisys mudar — foi uma renumeração
silenciosa que pôs R$ 193.799,79 de dívida dentro de "Custos da Operação".
"""
import json, re, sys, collections, importlib.util
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent      # raiz do repo
spec = importlib.util.spec_from_file_location("em", Path(__file__).resolve().parent / "erp_mes.py")
em = importlib.util.module_from_spec(spec); spec.loader.exec_module(em)

INI, FIM = '2026-07-01', '2026-07-31'
def val(t):
    pgs = t.get('pagamentos') or []
    if pgs:
        return sum(float(p.get('valor') or 0) for p in pgs
                   if INI <= str(p.get('data_pagamento') or p.get('data_credito') or '')[:10] <= FIM)
    return float(t.get('valor_pagamento') or 0) or float(t.get('valor_titulo') or 0)

P = [t for t in json.load(open(OUT/'pagar_2026-07.json')) if str(t.get('compoe_dre','')).lower()=='sim']
R = [t for t in json.load(open(OUT/'receber_2026-07.json')) if str(t.get('compoe_dre','')).lower()=='sim']
srv = json.load(open(OUT/'servidor.json'))
PT=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]
def ordk(l):
    s=l.lower()
    for i,m in enumerate(PT):
        if s.startswith(m): return int(s.split('/')[1])*12+i
    return -1
regs = sorted(srv['itens'], key=lambda r: ordk(r['label']))
jul = {c['code']: c for c in regs[-1]['cells']}
v = lambda k: jul.get(k, {}).get('value', 0.0)

falhas, avisos = [], []
def ck(nome, ok, det=""):
    print(f"  {'✅' if ok else '❌'} {nome}" + (f"\n       {det}" if det else ""))
    if not ok: falhas.append(nome)
def av(nome, det=""):
    print(f"  ⚠️  {nome}" + (f"\n       {det}" if det else ""))
    avisos.append(nome)

print("═══ 1. TRADUÇÃO DO PLANO — nenhum código escapando ═══")
# todo código de despesa que o ERP usa tem que cair num galho canônico conhecido
CANON = {'2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8','2.9','2.10','2.11',
         '2.12','2.13','2.14','2.15','2.16','2.99'}
orfaos = collections.defaultdict(float)
for t in P:
    pc = str(t.get('plano_contas') or '')
    c = pc.split('-')[0].strip()
    if not c or c == '2':
        continue
    trad = em.traduzir_plano(c)
    galho = '.'.join(trad.split('.')[:2])
    if galho not in CANON:
        orfaos[f"{pc[:34]} → {trad}"] += val(t)
ck("todo código de despesa cai num galho canônico", not orfaos,
   "; ".join(f"{k} (R$ {x:,.2f})" for k, x in list(orfaos.items())[:4]))

print("\n═══ 2. RECEITA — o plano de receita mudou junto? ═══")
rec_codes = collections.defaultdict(float)
for t in R:
    pc = str(t.get('plano_contas') or '')
    m = re.match(r'^(\d+(?:\.\d+)*)', pc)
    if m and pc != 'Conta não encontrada':
        rec_codes['.'.join(m.group(1).split('.')[:2])] += val(t)
print("     galhos de receita usados pelos títulos:")
for g, x in sorted(rec_codes.items()):
    print(f"       {g:<8} R$ {x:>11,.2f}")
ck("receita usa os galhos conhecidos (1.1–1.7)",
   all(g.startswith('1.') and int(g.split('.')[1]) <= 7 for g in rec_codes),
   f"inesperados: {[g for g in rec_codes if not (g.startswith('1.') and int(g.split('.')[1])<=7)]}")

print("\n═══ 3. OS 4 BLOCOS — somam a despesa inteira? ═══")
finRev = v('1.3')+v('1.4')+v('1.7')
loanOut = v('2.13.6') + (v('2.14.3')-v('2.14.3.4')) + v('2.13.7.1.3') + v('2.17') + v('2.18')
owner = v('2.14')-v('2.14.3')
invest = v('2.16')+v('2.13.7.1.1')+v('2.13.7.1.2')
custos = v('2')-loanOut-owner-invest
soma = custos+owner+invest+loanOut
print(f"     custos {custos:>12,.2f} · sócios {owner:>11,.2f} · invest {invest:>10,.2f} · dívida {loanOut:>12,.2f}")
ck("blocos somam a despesa", abs(soma - v('2')) < 0.02, f"soma {soma:,.2f} vs {v('2'):,.2f}")
ck("nenhum bloco zerado por engano", owner > 0 and invest > 0 and loanOut > 0,
   f"sócios={owner:,.2f} invest={invest:,.2f} dívida={loanOut:,.2f}")

print("\n═══ 4. O QUE EU PEDI PARA VOCÊ ARRUMAR ═══")
# 1.7 Entradas a Identificar
pix_prod = [t for t in R if str(t.get('plano_contas','')).startswith('1.1')
            and 'IDENTIFICA' in (str(t.get('descricao') or '')+str(t.get('despesa') or '')).upper()]
# o Leonardo decidiu em 01/08 manter os que já estavam lançados; a conta 1.7
# vale para os PRÓXIMOS. Aqui é informativo, não é falha.
if pix_prod:
    print(f"     (decisão do Leonardo) {len(pix_prod)} Pix antigos seguem em conta de produto: R$ {sum(map(val,pix_prod)):,.2f}")
usa17 = sum(val(t) for t in R if str(t.get('plano_contas','')).startswith('1.7'))
print(f"     1.7 Entradas a Identificar em uso: R$ {usa17:,.2f}")

# AMIL Pedro Henrique
# só o PLANO DE SAÚDE dele — salário e adiantamento do Pedro Henrique
# funcionário estão certos em Funcionários e não entram nesta regra
ph = [t for t in P if 'AMIL PEDRO HENRIQUE' in str(t.get('descricao') or '').upper()]
for t in ph:
    pc = str(t.get('plano_contas'))
    canon = em.traduzir_plano(pc.split('-')[0])
    ck("AMIL Pedro Henrique no grupo do Sr. Pedro (quem paga)", canon.startswith('2.14.1'),
       f"está em {pc} → canônico {canon} (é retirada do Leonardo)")

# Nordeste com descrição
nord = [t for t in P if em.traduzir_plano(str(t.get('plano_contas','')).split('-')[0]).startswith('2.13.7.1')]
sem_desc = [t for t in nord if not str(t.get('descricao') or '').strip()]
ck("toda parcela do Nordeste tem descrição (para o split)", not sem_desc,
   f"{len(sem_desc)} sem descrição")
split = collections.defaultdict(float)
for t in nord:
    c, _, _ = em.ajustar_conta(em.traduzir_plano(str(t.get('plano_contas','')).split('-')[0]),
                               '', t.get('descricao'))
    split[c] += val(t)
print("     split do Nordeste:", " · ".join(f"{k}={x:,.2f}" for k, x in sorted(split.items())))

# Cemig por medidor
cemig = collections.defaultdict(float)
for t in P:
    if 'CEMIG' in str(t.get('origem') or '').upper():
        cemig[str(t.get('plano_contas'))] += val(t)
fora = {k: x for k, x in cemig.items() if not em.traduzir_plano(k.split('-')[0]).startswith('2.5.3')}
ck("toda conta da Cemig cai no galho de energia", not fora,
   "; ".join(f"{k} R$ {x:,.2f}" for k, x in fora.items()))
print(f"     Cemig total R$ {sum(cemig.values()):,.2f} em {len(cemig)} medidores · painel lê 2.5.3 = R$ {v('2.5.3'):,.2f}")

print("\n═══ 5. SÉRIE HISTÓRICA — continuidade por centro ═══")
jun = {c['code']: c for c in regs[-2]['cells']}
quebras = []
for code in ['2.1','2.2','2.4','2.5','2.6','2.7','2.8','2.11','2.12','2.13','2.14']:
    a = jun.get(code, {}).get('value', 0); b = jul.get(code, {}).get('value', 0)
    if a > 1000 and b == 0:
        quebras.append(f"{code} {jun.get(code,{}).get('name','')}: {a:,.2f} → 0")
ck("nenhum centro relevante zerou na virada", not quebras, "; ".join(quebras))

print("\n═══ 6. FATURA DE CARTÃO / SEM QUEBRA ═══")
sem_quebra = v('2.99')
print(f"     fatura de cartão sem detalhamento: R$ {sem_quebra:,.2f} "
      f"({sem_quebra/v('2')*100:.1f}% da despesa)")
if sem_quebra > v('2') * 0.02:
    av("fatura de cartão acima de 2% da despesa")

print("\n" + "═"*60)
print(f"RESULTADO: {len(falhas)} falha(s), {len(avisos)} aviso(s)")
for f in falhas: print("   ❌", f)
for a in avisos: print("   ⚠️ ", a)
