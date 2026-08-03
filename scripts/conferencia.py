#!/usr/bin/env python3
"""Conferência pesada do DRE: reconstrói o dataset como o painel faz e testa
todas as invariantes, conta a conta, mês a mês."""
import json, sys
from collections import defaultdict

PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def chave(label):
    s = label.lower()
    for i, m in enumerate(PT):
        if s.startswith(m):
            return int(s.split("/")[1]) * 12 + i
    return -1


regs = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "m3.json"))["itens"]
regs.sort(key=lambda r: chave(r["label"]))
MESES = [r["label"] for r in regs]
ORIGEM = [r.get("origem") or "planilha" for r in regs]

# dataset: code -> {name, level, parent, values[]}
contas = {}
for i, r in enumerate(regs):
    for c in r["cells"]:
        a = contas.setdefault(c["code"], {"name": c["name"], "level": c["level"],
                                          "parent": c["parent"], "values": [0.0] * len(regs)})
        a["values"][i] = c["value"]
        if c.get("name") and c["name"] != c["code"]:
            a["name"] = c["name"]

filhos = defaultdict(list)
for code, a in contas.items():
    if a["parent"]:
        filhos[a["parent"]].append(code)

val = lambda code, i: contas.get(code, {"values": [0] * len(regs)})["values"][i]
sub = lambda p, i: round(sum(v["values"][i] for k, v in contas.items()
                             if k == p or k.startswith(p + ".")), 2)

falhas = []


def check(nome, ok, detalhe=""):
    print(f"  {'OK  ' if ok else 'FALHA'}  {nome}{('  — ' + detalhe) if detalhe else ''}")
    if not ok:
        falhas.append(nome + (" — " + detalhe if detalhe else ""))


print(f"=== {len(MESES)} meses: {', '.join(f'{m}({o})' for m, o in zip(MESES, ORIGEM))}")
print(f"=== {len(contas)} contas no plano\n")

print("1) PAI = SOMA DOS FILHOS (o painel lê o pai direto, não rola a soma)")
for i, m in enumerate(MESES):
    ruins = []
    for code, a in contas.items():
        if not filhos.get(code):
            continue
        soma = sum(val(f, i) for f in filhos[code])
        # conta pai pode ter lançamento próprio: só acusa se o pai for MENOR
        if a["values"][i] + 0.02 < soma:
            ruins.append(f"{code} pai={a['values'][i]:,.2f} filhos={soma:,.2f}")
    check(f"{m}", not ruins, "; ".join(ruins[:3]))

print("\n2) ALOCAÇÃO DOS 4 BLOCOS — as contas-fonte existem onde as fórmulas esperam")
# CUIDADO: "op − sócios − invest + financ = caixa" é identidade ALGÉBRICA —
# fecha para qualquer alocação, certa ou errada, então não serve de teste.
# O que pega erro de verdade é conferir se as contas que as fórmulas do painel
# leem (2.13.7.1.1/.2/.3, 2.14.3…) estão preenchidas nos meses em que o pai
# tem valor. Foi assim que Jul/26 ficou com R$ 23 mil do Nordeste em "Custos
# da Operação": a parcela veio inteira no pai 2.13.7.1 e os filhos zerados.
for i, m in enumerate(MESES):
    problemas = []
    pai_bnb = val("2.13.7.1", i)
    filhos_bnb = val("2.13.7.1.1", i) + val("2.13.7.1.2", i) + val("2.13.7.1.3", i)
    if pai_bnb > 1 and abs(pai_bnb - filhos_bnb) > 1:
        problemas.append(f"Nordeste sem split: pai 2.13.7.1={pai_bnb:,.2f} filhos={filhos_bnb:,.2f} "
                         f"(diferença cai em Custos da Operação)")
    # fatura de cartão: 2.99 só existe em mês ERP; em mês de planilha é rateada
    if ORIGEM[i] == "planilha" and val("2.99", i):
        problemas.append(f"2.99 (fatura de cartão) em mês de planilha: {val('2.99', i):,.2f}")
    # Empréstimo Terceiros deve estar no código histórico 2.14.3.5
    if val("2.14.3.3", i) and ORIGEM[i] == "erp":
        problemas.append(f"2.14.3.3 com valor em mês ERP ({val('2.14.3.3', i):,.2f}) — "
                         f"deveria ter sido mapeado para 2.14.3.5")
    check(f"{m}", not problemas, "; ".join(problemas))

print("\n3) CEMIG (2.5.3) e COPASA (2.5.1) — o que o Leonardo pediu atenção")
print(f"     {'mês':<11}{'origem':<10}{'⚡ Cemig':>12}{'💧 Copasa':>12}{'total':>12}")
eV, wV = [], []
for i, m in enumerate(MESES):
    e, w = val("2.5.3", i), val("2.5.1", i)
    eV.append(e); wV.append(w)
    print(f"     {m:<11}{ORIGEM[i]:<10}{e:>12,.2f}{w:>12,.2f}{e + w:>12,.2f}")
# O mês CORRENTE está pela metade: no dia 3 ainda não venceu conta de luz nem
# de água, e o teste acusava falha todo começo de mês. Só cobra mês fechado.
import datetime as _dt
_hoje = _dt.date.today()
_corrente = chave(f"{PT[_hoje.month - 1]}/{_hoje.year}")
FECHADO = [i for i, m in enumerate(MESES) if chave(m) < _corrente]
if len(FECHADO) < len(MESES):
    print(f"     (fora da conta: {MESES[-1]} ainda está em andamento)")
check("Cemig presente em todos os meses fechados", all(eV[i] > 0 for i in FECHADO),
      f"zerado em: {[MESES[i] for i in FECHADO if not eV[i]]}")
check("Copasa presente em todos os meses fechados", all(wV[i] > 0 for i in FECHADO),
      f"zerado em: {[MESES[i] for i in FECHADO if not wV[i]]}")

print("\n4) COMPARAÇÃO MÊS A MÊS — contas que aparecem/somem entre meses vizinhos")
for i in range(1, len(MESES)):
    sumiram, nasceram = [], []
    for code, a in contas.items():
        if filhos.get(code):
            continue                       # só folhas
        ant, atu = a["values"][i - 1], a["values"][i]
        if ant and not atu:
            sumiram.append((code, a["name"], ant))
        if atu and not ant:
            nasceram.append((code, a["name"], atu))
    vs = sum(x[2] for x in sumiram); vn = sum(x[2] for x in nasceram)
    grave = (vs + vn) > 50000
    print(f"  {'!!' if grave else '  '} {MESES[i-1]:>9} → {MESES[i]:<9} "
          f"sumiram {len(sumiram):>3} contas ({vs:>12,.2f})  "
          f"nasceram {len(nasceram):>3} ({vn:>12,.2f})")
    if grave:
        for code, nome, v in sorted(sumiram, key=lambda x: -x[2])[:5]:
            print(f"          sumiu  {code:<12}{nome[:30]:<32}{v:>12,.2f}")
        for code, nome, v in sorted(nasceram, key=lambda x: -x[2])[:5]:
            print(f"          nasceu {code:<12}{nome[:30]:<32}{v:>12,.2f}")

print("\n" + ("TUDO OK" if not falhas else f"{len(falhas)} FALHA(S):"))
for f in falhas:
    print("   -", f)
