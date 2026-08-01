#!/usr/bin/env python3
"""Quebra a receita do mês por PRODUTO, lendo a Ordem de Serviço.

Por que existe: no Mubisys a venda é classificada pela OS, não pelo título
financeiro. Medido em 258 recebimentos de jul/26, a regra é determinística:

    receita operacional      -> nunca tem plano de contas (228 de 228)
    receita não operacional  -> sempre tem            (30 de 30)

Ou seja: o título de venda diz QUANTO entrou, e só a OS diz DE QUE produto.
O campo `despesa` do recebimento guarda o número da OS (às vezes vários,
colados por hífen).

Duas armadilhas que custaram caro e estão resolvidas aqui:

1. **Item agrupado.** Quando a OS junta peças (um logo com várias partes), o
   item vem com `item` VAZIO, a descrição em `uniao_item` e os componentes em
   `itens_agrupados[]`. Ler só `item` perde os lançamentos de maior valor.
   E o `valor_final` dos componentes NÃO soma o do pai (OS 21442: pai
   R$ 1.857,73, filhos R$ 4.720,28) — o preço de venda é o do pai; os filhos
   só dizem a composição. Por isso escalamos os filhos para o total do pai.

2. **Somar o valor da OS não dá a receita do mês.** A OS é o pedido, o
   recebimento é o pagamento: uma OS de R$ 10 mil pode ser paga em parcelas de
   meses diferentes. Somando itens de OS deu R$ 286.590 contra ~R$ 460 mil
   reais. Aqui rateamos o valor RECEBIDO entre os itens, na proporção deles —
   assim o total fecha por construção, sem inventar número.

Conferido em jun/26 e jul/26: 100% dos títulos operacionais casaram com uma OS
com itens, e a soma do rateio bate com o total recebido até o centavo.
"""
import re


def numeros_de_os(despesa):
    """'21805-21870' -> ['21805','21870'] · texto livre -> []"""
    s = str(despesa or "").strip()
    if not s:
        return []
    return [p for p in (x.strip() for x in s.split("-")) if re.fullmatch(r"\d{3,}", p)]


def itens_da_os(os_obj):
    """Itens vendáveis da OS, já com o valor do agrupamento normalizado."""
    saida = []
    for it in (os_obj.get("itens") or []):
        agr = it.get("itens_agrupados") or []
        nome = str(it.get("item") or "").strip()
        if not nome and agr:
            pai = float(it.get("valor_final") or it.get("sub_total") or 0)
            soma = sum(float(a.get("valor_final") or a.get("sub_total") or 0) for a in agr)
            escala = (pai / soma) if (pai > 0 and soma > 0) else 1.0
            for a in agr:
                v = float(a.get("valor_final") or a.get("sub_total") or 0) * escala
                if v:
                    saida.append({"item": str(a.get("item") or "").strip() or "(sem nome)",
                                  "modelo": str(a.get("modelo") or "").strip(), "valor": v})
            continue
        v = float(it.get("valor_final") or it.get("sub_total") or 0)
        if v:
            saida.append({"item": nome or "(sem nome)",
                          "modelo": str(it.get("modelo") or "").strip(), "valor": v})
    return saida


def ratear(recebimentos, cache_os, valor_de):
    """Distribui o valor recebido de cada título entre os itens da OS dele.

    `valor_de(titulo)` devolve o valor de caixa do título na janela.
    `cache_os` é {numero_da_os: objeto_da_os}.
    Devolve (porProduto, diagnóstico).
    """
    por_produto, diag = {}, {"titulos": 0, "rateados": 0, "semOS": 0,
                             "valorSemOS": 0.0, "valorRateado": 0.0, "osFaltando": []}
    for t in recebimentos:
        v = valor_de(t)
        if not v:
            continue
        diag["titulos"] += 1
        itens = []
        for n in numeros_de_os(t.get("despesa")):
            o = cache_os.get(n)
            if isinstance(o, dict) and "_erro" not in o:
                itens.extend(itens_da_os(o))
            else:
                diag["osFaltando"].append(n)
        total = sum(i["valor"] for i in itens if i["valor"] > 0)
        if total <= 0:
            diag["semOS"] += 1
            diag["valorSemOS"] = round(diag["valorSemOS"] + v, 2)
            continue
        diag["rateados"] += 1
        diag["valorRateado"] = round(diag["valorRateado"] + v, 2)
        for i in itens:
            if i["valor"] > 0:
                por_produto[i["item"]] = round(por_produto.get(i["item"], 0.0)
                                               + v * i["valor"] / total, 2)
    diag["osFaltando"] = sorted(set(diag["osFaltando"]))
    return dict(sorted(por_produto.items(), key=lambda x: -x[1])), diag
