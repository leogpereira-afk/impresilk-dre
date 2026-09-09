
"""Módulo financeiro: processa dados recebidos da origem autenticada."""
import json
import unicodedata
import re

def nivel(code):
    return code.count(".") + 1

def pai(code):
    return code.rsplit(".", 1)[0] if "." in code else None

def _acumular(folhas, nomes):
    """_acumular: processa dados recebidos da origem autenticada."""
    tot = {}
    for code, v in folhas.items():
        partes = code.split(".")
        for i in range(1, len(partes) + 1):
            c = ".".join(partes[:i])
            tot[c] = round(tot.get(c, 0.0) + v, 2)
    return [{"code": c, "name": nomes.get(c, c), "level": nivel(c),
             "parent": pai(c), "value": v} for c, v in sorted(tot.items())]

NOMES_BASE = {
    "1": "Receitas", "1.1": "Comunicação Visual", "1.1.1": "Produtos",
    "1.1.2": "Serviços", "1.2": "Portas/Painéis", "1.3": "Rendimentos",
    "1.4": "Empréstimos", "1.5": "Material Político", "1.6": "PDV",
    "1.1.98":"Recebimentos sem O.S. completa", "1.1.99":"Produtos aguardando classificação", "1.7":"Entradas a identificar",
    "2": "Despesas",
}

GALHOS = {"1.1.2": "1.1.2", "1.2": "1.2", "1.5": "1.5", "1.6": "1.6"}
PRIMEIRO_CODIGO = 51

DE_PARA_PLANO_NOVO = [

    ("2.13.5", "2.13.6"),
    ("2.13.3", "2.14.3.5"),
    ("2.13.4", "2.16"),
    ("2.13.2", "2.13.7.1"),
    ("2.13.1", "2.13.7.1"),

    ("2.11", "2.14"),
    ("2.10", "2.13"),
    ("2.9",  "2.12"),

    ("2.8",  "2.11"),
    ("2.7",  "2.8"),
    ("2.6",  "2.7"),
    ("2.5",  "2.6"),
    ("2.4",  "2.5"),
    ("2.3",  "2.4"),

]

DE_PARA_SUBCONTA = [
    ("2.1.12.1.4", "2.1.15.4"),
    ("2.1.12.1.5", "2.1.15.5"),
    ("2.2.4.5.1", "2.2.5.5.1"),
    ("2.2.7.2.1", "2.3.2.1"),
    ("2.1.11.1", "2.1.12.1"),
    ("2.1.11.2", "2.1.12.2"),
    ("2.1.11.3", "2.1.11.1"),
    ("2.1.11.4", "2.1.16"),
    ("2.1.11.6", "2.1.11.4"),
    ("2.1.11.7", "2.1.19"),
    ("2.1.15.1", "2.1.18"),
    ("2.1.18.1", "2.9.1"),
    ("2.1.18.2", "2.9.2"),

    ("2.13.4.1", "2.16.3"),

    ("2.2.7.1", "2.3.1"),
    ("2.8.1.1", "2.10.1.1"),
    ("2.8.1.2", "2.10.1.2"),
    ("2.8.1.3", "2.10.1.3"),
    ("2.8.1.5", "2.10.1.5"),
    ("2.8.9.1", "2.11.1"),
    ("2.8.9.3", "2.11.3"),
    ("2.8.9.4", "2.11.4"),
    ("2.1.11", "2.1.13"),
    ("2.1.12", "2.1.14"),
    ("2.1.14", "2.2.2"),
    ("2.2.2", "2.2.3"),
    ("2.2.5", "2.2.6"),
    ("2.2.6", "2.2.7"),
    ("2.8.2", "2.10.2"),
    ("2.8.3", "2.10.3"),
    ("2.8.4", "2.10.4"),
    ("2.8.7", "2.10.7"),
]

DE_PARA_FIXAS = [("2.4.1", "2.5.1"), ("2.4.3", "2.5.3")]

def traduzir_plano(c):
    """traduzir_plano: processa dados recebidos da origem autenticada."""
    for novo, canon in DE_PARA_SUBCONTA + DE_PARA_FIXAS + DE_PARA_PLANO_NOVO:
        if c == novo or c.startswith(novo + "."):
            return canon + c[len(novo):]
    return c

def ajustar_conta(c, nome, texto):
    """ajustar_conta: processa dados recebidos da origem autenticada."""
    t = str(texto or "").upper()
    if c.startswith("2."):
        c = traduzir_plano(c)

    if c.startswith("2.13.5") and ("AGUARDANDO" in t and "CART" in t):
        return "2.99", "Fatura de cartão (sem detalhamento)", {
            "tipo": "fatura-cartao-em-juros", "conta": c,
            "texto": "Fatura de cartão lançada em Juros Cartão ('aguardando lançamento'). "
                     "Não é juros — enquanto não for itemizada, infla o custo financeiro."}
    if c == "2.13.7.1":
        if "CAPITAL DE GIRO" in t or "GIRO" in t:
            return "2.13.7.1.3", "Capital de Giro", None
        if "SAVEIRO" in t or "VEICUL" in t:
            return "2.13.7.1.2", "Financiamento de Veículo", None
        if t.strip():
            return "2.13.7.1.1", "Financiamento de Máquinas", None

        return c, nome, {"tipo": "nordeste-sem-descricao", "conta": c,
                         "texto": "Parcela do Nordeste sem descrição — não dá para separar máquina/veículo/giro."}

    return c, nome, None

def pendencias_de_classificacao(pagar, receber, valor_janela, regras_privadas=None):
    """pendencias_de_classificacao: processa dados recebidos da origem autenticada."""
    out = []
    for t in pagar:
        d = (str(t.get("descricao") or "") + " " + str(t.get("origem") or "")).upper()
        pc = str(t.get("plano_contas") or "")
        c = pc.split("-")[0].strip()

        for regra in (regras_privadas or {}).get("alertas", []):
            marcador = str(regra.get("contem") or "").upper()
            prefixo = str(regra.get("prefixo") or "")
            if marcador and prefixo and marcador in d and traduzir_plano(c).startswith(prefixo):
                out.append({"tipo":regra["tipo"],"conta":c,"valor":round(valor_janela(t),2),"texto":regra["texto"]})

        forn = str(t.get("origem") or "").upper()
        if "CEMIG" in forn and not traduzir_plano(c).startswith("2.5.3"):
            out.append({"tipo": "consumo-fora-do-galho", "conta": c,
                        "valor": round(valor_janela(t), 2),
                        "texto": f"Conta da CEMIG lançada em {pc[:34]} — fora do galho de energia. "
                                 f"O painel vai contar como outra coisa."})
        if ("COPASA" in forn or "SANEAMENTO" in forn) and not traduzir_plano(c).startswith("2.5.1"):
            out.append({"tipo": "consumo-fora-do-galho", "conta": c,
                        "valor": round(valor_janela(t), 2),
                        "texto": f"Conta de água lançada em {pc[:34]} — fora do galho de água."})

    LOAN_WORDS = ("TERCEIRO", "CAPITAL DE GIRO", "PRONAMPE", "EMPRESTIMO",
                  "EMPRÉSTIMO", "CREDINOR", "NORDESTE")
    for t in pagar:
        pc = str(t.get("plano_contas") or "")
        c = pc.split("-")[0].strip()
        nome = pc.split("-", 1)[-1].upper() if "-" in pc else ""
        if c.startswith("2.16") and any(w in nome for w in LOAN_WORDS):
            out.append({"tipo": "dois-significados-216", "conta": c,
                        "valor": round(valor_janela(t), 2),
                        "texto": f"'{pc[:44]}' está em 2.16, que o painel conta como INVESTIMENTO "
                                 f"Pelo nome é empréstimo. "
                                 f"Reaponte o lançamento ou me avise para trocar a fórmula."})

    def _quem(t):
        forn = str(t.get("origem") or "").strip()
        if forn:
            return forn
        d = re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFD", str(t.get("descricao") or "").lower())
                   .encode("ascii", "ignore").decode())[:30]
        return (d + "|" + str(t.get("plano_contas") or "")[:20]) if d else ""

    vistos, quando = {}, {}
    for t in pagar:
        quem = _quem(t)
        if not quem:
            continue
        cad = str(t.get("data_cadastro") or "")[:13]
        for pg in (t.get("pagamentos") or []):
            dt = str(pg.get("data_pagamento") or pg.get("data_credito") or "")[:10]
            v = round(float(pg.get("valor") or 0), 2)
            if not v:
                continue
            vistos.setdefault((quem, v, dt), []).append((t.get("id"), cad))

    grupos, janelas = [], set()
    for chave, its in vistos.items():
        if len(its) > 1 and chave[1] >= 300:
            grupos.append((chave, its))
            cads = sorted({c for _, c in its})
            if len(cads) > 1:
                janelas.add(tuple(cads))

    for chave, its in vistos.items():
        if len(its) > 1 and chave[1] < 300:
            par = [x for x in its
                   if any(x[1] in j and any(y[1] in j and y[0] != x[0] for y in its) for j in janelas)]
            if len(par) > 1:
                grupos.append((chave, par))

    for (quem, v, dt), its in grupos:
        ids = [i for i, _ in its]
        cads = sorted({c for _, c in its})
        lote = f" — redigitado em {cads[-1][8:10]}/{cads[-1][5:7]} {cads[-1][11:13]}h" if len(cads) > 1 else ""
        out.append({"tipo": "possivel-duplicidade", "conta": "", "valor": round(v * (len(ids) - 1), 2),
                    "texto": f"{quem.split('|')[0][:30]} — R$ {v:,.2f} pago {len(ids)}x em {dt[8:10]}/{dt[5:7]}"
                             f"{lote} (títulos {', '.join(str(i) for i in ids)}). Conferir se não foi pago em duplicidade."})
    return out

def galho_do_produto(nome, mapa_conta):
    conta = mapa_conta.get(nome, "")
    if not conta: return "1.1.99"
    for pref, galho in GALHOS.items():
        if conta == pref or conta.startswith(pref + "."):
            return galho
    return "1.1.1"

def codigos_estaveis(por_produto, registro_codigos, mapa_conta):
    """codigos_estaveis: processa dados recebidos da origem autenticada."""
    reg = dict(registro_codigos or {})
    usados = {g: set() for g in set(list(GALHOS.values()) + ["1.1.1"])}
    for nome, code in reg.items():
        g = code.rsplit(".", 1)[0]
        usados.setdefault(g, set()).add(int(code.rsplit(".", 1)[1]))
    for nome in sorted(por_produto):
        if nome in reg:
            continue
        g = galho_do_produto(nome, mapa_conta)
        n = PRIMEIRO_CODIGO
        while n in usados.setdefault(g, set()):
            n += 1
        usados[g].add(n)
        reg[nome] = f"{g}.{n}"
    return reg

RENOMES = {}  # Renomes aprovados vêm da configuração privada.

def _renome_conhecido(c, nome, regras_privadas=None):
    """_renome_conhecido: processa dados recebidos da origem autenticada."""
    return any(_texto_igual(a, nome) for a in (regras_privadas or {}).get("renomes",RENOMES).get(c, ()))

def _texto_igual(a, b):
    """_texto_igual: processa dados recebidos da origem autenticada."""
    limpa = lambda s: re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFD", str(s or "").lower())
                             .encode("ascii", "ignore").decode())
    x, y = limpa(a), limpa(b)
    if not x or not y:
        return True
    if x == y:
        return True
    menor, maior = (x, y) if len(x) <= len(y) else (y, x)
    return len(menor) >= 5 and menor in maior

def montar(label, receber, pagar, por_produto, valor_janela, codigo,
           registro_codigos=None, mapa_conta=None, nomes_conhecidos=None,
           registro_remanejadas=None, regras_privadas=None):
    """montar: processa dados recebidos da origem autenticada."""
    folhas = {}
    nomes = dict(nomes_conhecidos or {})
    nomes.update(NOMES_BASE)

    reman = dict(registro_remanejadas or {})
    _chave = lambda p, n: f"{p}|{re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFD', str(n or '').lower()).encode('ascii', 'ignore').decode())}"

    def sem_colisao(c, nome):
        """sem_colisao: processa dados recebidos da origem autenticada."""

        partes = c.split(".")
        for i in range(len(partes) - 1, 1, -1):
            base = ".".join(partes[:i])
            if base in remanejadas and remanejadas[base] != base:
                return remanejadas[base] + c[len(base):]
        antigo = nomes_conhecidos.get(c) if nomes_conhecidos else None
        if not antigo or not nome or _texto_igual(antigo, nome) or _renome_conhecido(c, nome, regras_privadas):
            return c
        p = pai(c) or "2"
        k = _chave(p, nome)
        if k in reman:
            return reman[k]
        usados = {v for v in reman.values()}
        n = 50
        while True:
            n += 1
            novo = f"{p}.{n}"
            if novo not in nomes and novo not in folhas and novo not in usados:
                reman[k] = novo
                return novo

    pendencias = pendencias_de_classificacao(pagar, receber, valor_janela, regras_privadas)

    remanejadas = {}
    vistos_cod = {}
    for t in pagar:
        c0, n0 = codigo(t.get("plano_contas"))
        if not c0:
            c0, n0 = "2", "Despesas"
        if c0 == "2":
            c0, n0 = "2.99", "Fatura de cartão (sem detalhamento)"
        c0, n0, _ = ajustar_conta(c0, n0, t.get("descricao"))
        vistos_cod.setdefault(c0, n0)
    for c0 in sorted(vistos_cod, key=lambda x: (x.count("."), x)):
        remanejadas[c0] = sem_colisao(c0, vistos_cod[c0])

    for t in pagar:
        c, nome = codigo(t.get("plano_contas"))
        if not c:
            c, nome = "2", "Despesas"

        if c == "2":
            c, nome = "2.99", "Fatura de cartão (sem detalhamento)"
        c, nome, pend = ajustar_conta(c, nome, t.get("descricao"))
        if pend:
            pend["valor"] = round(valor_janela(t), 2)
            pendencias.append(pend)
        c = remanejadas.get(c, c)
        nomes[c] = nome or nomes.get(c, c)
        folhas[c] = round(folhas.get(c, 0.0) + valor_janela(t), 2)

    for t in receber:
        if t.get("tipo") == "Receita operacional":
            continue
        c, nome = codigo(t.get("plano_contas"))
        if not c:
            c, nome = "1.7", "Entradas a identificar"
            pendencias.append({"tipo":"receita-sem-conta", "conta":c, "valor":round(valor_janela(t),2), "texto":"Entrada sem natureza identificada."})
        nomes.setdefault(c, nome)
        folhas[c] = round(folhas.get(c, 0.0) + valor_janela(t), 2)

    sem_rateio = round(sum(valor_janela(t) for t in receber if t.get("tipo") == "Receita operacional") - sum(por_produto.values()), 2)
    if sem_rateio:
        folhas["1.1.98"] = sem_rateio
        nomes["1.1.98"] = "Recebimentos operacionais sem O.S. completa"
        pendencias.append({"tipo":"receita-sem-os", "conta":"1.1.98", "valor":sem_rateio,
                           "texto":"Valor recebido preservado; rateio aguarda todas as O.S."})
    for prod, v in por_produto.items():
        if prod not in (mapa_conta or {}):
            pendencias.append({"tipo":"produto-sem-categoria", "conta":"1.1.99", "valor":v,
                               "texto":f"Categoria do produto {prod} precisa de revisão."})

    reg = codigos_estaveis(por_produto, registro_codigos, mapa_conta or {})
    for prod, v in por_produto.items():
        c = reg[prod]
        nomes[c] = prod
        folhas[c] = round(folhas.get(c, 0.0) + v, 2)

    return ({"id": re.sub(r"[^\w]+", "_", label.strip()), "label": label,
             "company": "Impresilk + Universo", "basis": "Caixa gerencial · compõe DRE",
             "origem": "erp", "cells": _acumular(folhas, nomes),
             "pendencias": pendencias}, reg, reman)
