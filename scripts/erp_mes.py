#!/usr/bin/env python3
"""Monta o mês do DRE direto do ERP, no formato de células que o painel usa.

Substitui o .xlsx. O que muda em relação à planilha:

  * DESPESA — igual. O ERP entrega o plano de contas em 100% dos pagamentos e
    a árvore bate conta a conta (medido em jun/26: R$ 428.500,64 contra
    R$ 430.433,54 da planilha, e a diferença é fatura de cartão).
  * RECEITA — por PRODUTO, não pela árvore 1.1.1.x. No Mubisys a venda é
    classificada pela Ordem de Serviço, e a API não expõe a que conta cada
    produto está amarrado; tentar adivinhar errava ~R$ 85 mil/mês de linha
    (o total sempre bateu). Então a receita de venda entra em 1.7, uma conta
    nova, com um filho por produto vendido — cada real cai no produto que o
    gerou. 1.3/1.4 (rendimentos e empréstimos) continuam vindo classificados
    pelo próprio título.

Por que 1.7: o plano de contas vai de 1.1 a 1.6, então 1.7 está livre e não
colide com o histórico. Meses antigos ficam com 1.7 = 0 e os novos com
1.1/1.2 = 0 — nenhum número do passado é reescrito.
"""
import json
import re


def nivel(code):
    return code.count(".") + 1


def pai(code):
    return code.rsplit(".", 1)[0] if "." in code else None


def _acumular(folhas, nomes):
    """Soma cada conta em todos os pais. O painel lê o valor do pai direto —
    não rola a soma sozinho —, então quem monta as células precisa fechar."""
    tot = {}
    for code, v in folhas.items():
        partes = code.split(".")
        for i in range(1, len(partes) + 1):
            c = ".".join(partes[:i])
            tot[c] = round(tot.get(c, 0.0) + v, 2)
    return [{"code": c, "name": nomes.get(c, c), "level": nivel(c),
             "parent": pai(c), "value": v} for c, v in sorted(tot.items())]


# Nomes das contas de topo, para quando o mês não tiver lançamento no galho e
# o nome não vier de nenhum título.
NOMES_BASE = {
    "1": "Receitas", "1.3": "Rendimentos", "1.4": "Empréstimos",
    "1.7": "Vendas por produto", "2": "Despesas",
}


def montar(label, receber, pagar, por_produto, valor_janela, codigo):
    """Devolve o registro de mês pronto para o dre-sync.

    valor_janela(t) -> caixa do título no mês; codigo(pc) -> (code, nome).
    """
    folhas, nomes = {}, dict(NOMES_BASE)

    for t in pagar:
        c, nome = codigo(t.get("plano_contas"))
        if not c:
            c, nome = "2", "Despesas"
        # Fatura de cartão vem com plano de contas "2-Despesas": o código é o
        # topo da árvore. Vai para uma conta própria em vez de sumir dentro do
        # total, senão some da leitura de custo sem ninguém perceber.
        if c == "2":
            c, nome = "2.99", "Fatura de cartão (sem detalhamento)"
        nomes.setdefault(c, nome)
        folhas[c] = round(folhas.get(c, 0.0) + valor_janela(t), 2)

    for t in receber:
        if t.get("tipo") == "Receita operacional":
            continue                      # essa entra por produto, abaixo
        c, nome = codigo(t.get("plano_contas"))
        if not c:
            continue
        nomes.setdefault(c, nome)
        folhas[c] = round(folhas.get(c, 0.0) + valor_janela(t), 2)

    # Receita de venda: um filho de 1.7 por produto, na ordem do maior valor.
    for i, (prod, v) in enumerate(sorted(por_produto.items(), key=lambda x: -x[1]), 1):
        c = f"1.7.{i}"
        nomes[c] = prod
        folhas[c] = round(v, 2)

    return {"id": re.sub(r"[^\w]+", "_", label.strip()), "label": label,
            "company": "Impresilk", "basis": "Competência de Caixa",
            "origem": "erp", "cells": _acumular(folhas, nomes)}
