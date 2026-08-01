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


# ---------------------------------------------------------------------------
# De-para produto da OS -> conta do DRE.
#
# NÃO é a classificação oficial: a árvore de receita continua vindo da planilha.
# Isto existe para pôr as duas leituras lado a lado e achar produto cadastrado
# na conta errada dentro do Mubisys.
#
# Confirmado pelo Leonardo: Brindes vai INTEIRO para 1.1.1.15 (sem quebrar em
# Copos/Garrafas/Kits); fita LED, fonte, neon e módulo LED vão para 1.1.1.9;
# Placa Luminosa vai para 1.1.1.13.
#
# Confirmado medindo contra a planilha nos dois meses: "Placa Frontlight" cai
# em LONAS, não em Placas — existe conta 1.1.1.13.6 Frontlight dentro de
# Placas, mas pôr o produto lá afasta o resultado em ~R$ 28 mil por mês.
# MDF, Outdoor, Totem, Portas/Painéis e PDV batem no centavo nos dois meses.
# ---------------------------------------------------------------------------
MAPA_CONTA = {
    "Acrilico Cristal*": "1.1.1.1", "Acrilico Leitoso*": "1.1.1.1",
    "Acrilicos Especiais": "1.1.1.1", "Letra Acrílica": "1.1.1.1",

    "Adesivo Leitoso Brilho*": "1.1.1.2", "Adesivo Leitoso Fosco*": "1.1.1.2",
    "Adesivo Transparente": "1.1.1.2", "Adesivo Leitoso Brilho Impresso UV": "1.1.1.2",
    "Adesivo Colorido": "1.1.1.2", "Adesivos Especiais": "1.1.1.2",
    "Adesivo Transparente Impresso UV": "1.1.1.2",
    "Adesivo Leitoso Fosco Impresso UV": "1.1.1.2",
    "FITA CREPE AUTOMOTIVA AMARELA 48MMX40M": "1.1.1.2",

    "Lona Front Brilho*": "1.1.1.3", "Lona Front Fosca*": "1.1.1.3",
    "Lona Backlight*": "1.1.1.3", "Lona Texturizada": "1.1.1.3",
    "Placa Frontlight": "1.1.1.3",

    "Letras Caixa*": "1.1.1.4", "Letra Caixa Chapa Galvanizada": "1.1.1.4",
    "Letras Diversas": "1.1.1.4",

    "Placa Pvc Impressão UV*": "1.1.1.5",
    "Totem": "1.1.1.6",
    "MDF": "1.1.1.7",
    "Outdoor": "1.1.1.8",

    "Iluminação": "1.1.1.9", "Fit Led Neon 12V": "1.1.1.9",
    "Fonte 12V 5A": "1.1.1.9", "NEON": "1.1.1.9",
    "MÓDULO LED BRANCO QUENTE (3000K)": "1.1.1.9",

    "Pergolado": "1.1.1.10", "Toldo": "1.1.1.10",
    "Poliondas": "1.1.1.14",
    "Brindes": "1.1.1.15",
    "Impressão 3D": "1.1.1.17",

    "Placa ACM": "1.1.1.13", "Placa ACM Kynnar": "1.1.1.13",
    "Placa Complementos": "1.1.1.13", "Placa Chapa Galvanizada": "1.1.1.13",
    "Placa Chapa Inox": "1.1.1.13", "Placa Luminosa*": "1.1.1.13",
    "Placa de Patrimônio": "1.1.1.13", "Estruturas Metalicas*": "1.1.1.13",
    "Molduras": "1.1.1.13",

    "Servicos": "1.1.2", "Impressão": "1.1.2",

    "Painel de ACM": "1.2", "Porta ACM Kynnar": "1.2",
    "Porta ACM Complementos": "1.2", "Porta ACM Poliéster": "1.2", "Alumínio": "1.2",

    "Material Político 2024": "1.5",
    "PDV": "1.6",
}


def por_conta(por_produto):
    """Agrupa a receita por produto nas contas do DRE.

    Devolve (contas, semConta). O que não está no de-para sai à parte em vez de
    ser empurrado para uma conta qualquer — produto novo aparece como pendência,
    não como número errado escondido dentro de um total.
    """
    contas, sem = {}, {}
    for nome, v in por_produto.items():
        c = MAPA_CONTA.get(nome)
        if c:
            contas[c] = round(contas.get(c, 0.0) + v, 2)
        else:
            sem[nome] = round(sem.get(nome, 0.0) + v, 2)
    return contas, sem


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
