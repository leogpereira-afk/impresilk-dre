#!/usr/bin/env python3
"""Monta o mês do DRE direto do ERP, no formato de células que o painel usa.

Substitui o .xlsx. O que muda em relação à planilha:

  * DESPESA — igual. O ERP entrega o plano de contas em 100% dos pagamentos e
    a árvore bate conta a conta (medido em jun/26: R$ 428.500,64 contra
    R$ 430.433,54 da planilha, e a diferença é fatura de cartão).
  * RECEITA — a venda entra em COMUNICAÇÃO VISUAL, como sempre foi: cada
    produto vendido vira um filho de `1.1.1 Produtos`, e o que é serviço vai
    para `1.1.2 Serviços`. Portas/Painéis, PDV e Material Político seguem nos
    seus galhos (1.2, 1.6, 1.5), que batem no centavo contra a planilha.
    O que NÃO dá para fazer é dizer em qual subconta (Acrílicos, Lonas,
    Placas…) cada produto cai: a API não expõe o vínculo produto→conta e
    adivinhar errava ~R$ 85 mil/mês de linha. Então o produto aparece com o
    próprio nome. 1.3/1.4 continuam classificados pelo próprio título.

Os códigos dos produtos começam em .51 para não colidir com o plano de contas
real (que vai até 1.1.1.17), e são ESTÁVEIS: ficam guardados em
`cfg.produtosCodigo`, então "Placa ACM" é sempre o mesmo código em todo mês.
Se o código dependesse da ordem de valor, o mesmo código teria nome diferente
a cada mês e a árvore do painel embaralharia.
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
    "1": "Receitas", "1.1": "Comunicação Visual", "1.1.1": "Produtos",
    "1.1.2": "Serviços", "1.2": "Portas/Painéis", "1.3": "Rendimentos",
    "1.4": "Empréstimos", "1.5": "Material Político", "1.6": "PDV",
    "2": "Despesas",
}

# Em que GALHO da receita cada produto entra. Só o galho — a subconta exata
# (Acrílicos, Lonas, Placas…) a API não diz. Estes quatro batem no centavo
# contra a planilha nos dois meses medidos; o resto é Comunicação Visual.
GALHOS = {"1.1.2": "1.1.2", "1.2": "1.2", "1.5": "1.5", "1.6": "1.6"}
PRIMEIRO_CODIGO = 51        # o plano de contas real vai até .17; .51 é terra livre


def ajustar_conta(c, nome, texto):
    """Correções de conta que a planilha fazia à mão e o ERP não faz.

    Devolve (codigo, nome, pendencia|None). Cada regra nasceu de um caso real:

    * NORDESTE SEM SPLIT — a parcela do Banco do Nordeste vem inteira em
      2.13.7.1, mas são TRÊS coisas (medido lançamento a lançamento: 53%
      máquinas, 6% veículo, 41% capital de giro). Sem o split, os R$ 23 mil/mês
      caem em "Custos da Operação": máquina financiada é investimento e capital
      de giro é dívida. A planilha fazia essa quebra nas subcontas .1/.2/.3 —
      aqui ela sai da DESCRIÇÃO do lançamento, que é padronizada no banco.
    * EMPRÉSTIMO TERCEIROS MUDOU DE CÓDIGO — a planilha usava 2.14.3.5
      (2.14.3.3 era Credinosso); os títulos do ERP agora dizem 2.14.3.3.
      Mapeia para o código histórico para a série dos 8 meses ser uma só.
      (Mesma armadilha do Nordeste, que já mudou de 2.14.3.4 para 2.13.7.1.)
    """
    t = str(texto or "").upper()
    if c == "2.13.7.1":
        if "CAPITAL DE GIRO" in t or "GIRO" in t:
            return "2.13.7.1.3", "Capital de Giro", None
        if "SAVEIRO" in t or "VEICUL" in t:
            return "2.13.7.1.2", "Financiamento de Veículo", None
        if t.strip():
            return "2.13.7.1.1", "Financiamento de Máquinas", None
        # sem descrição não dá para saber o que é — fica no pai e vira pendência
        return c, nome, {"tipo": "nordeste-sem-descricao", "conta": c,
                         "texto": "Parcela do Nordeste sem descrição — não dá para separar máquina/veículo/giro."}
    # (Empréstimo Terceiros: houve uma regra aqui mapeando 2.14.3.3 → 2.14.3.5.
    #  Removida em 01/08/2026: o Leonardo criou a família 2.17 "Devolução de
    #  Empréstimo" no Mubisys e o título passou a vir como 2.17.3 — código novo
    #  e legítimo, aceito como está. A ponte do histórico vive em
    #  CONTAS_UNIFICADAS no app.js.)
    return c, nome, None


def pendencias_de_classificacao(pagar, receber, valor_janela):
    """O que está lançado em conta suspeita DENTRO do Mubisys.

    O robô não corrige por conta própria (número fiel ao ERP) — ele lista, e a
    aba Conferência mostra para alguém arrumar na origem. Regras já validadas
    com o Leonardo; cada uma tem um caso concreto por trás.
    """
    out = []
    for t in pagar:
        d = (str(t.get("descricao") or "") + " " + str(t.get("origem") or "")).upper()
        pc = str(t.get("plano_contas") or "")
        # (Pró Vida: já foi listado aqui como "plano de saúde na conta errada".
        #  O Leonardo confirmou em 01/08/2026 que É incentivo de produtividade
        #  para os funcionários — 2.1.13 está CERTO, regra removida.)
        # AMIL do Pedro Henrique é do grupo do Sr. Pedro (confirmado pelo
        # Leonardo em 01/08/2026) — o lugar é 2.14.1.4 (conta que o Leonardo criou), não o
        # plano de saúde das retiradas do Leonardo.
        if "PEDRO HENRIQUE" in d and pc.startswith("2.14.2.4"):
            out.append({"tipo": "amil-pedro-henrique", "conta": "2.14.2.4",
                        "valor": round(valor_janela(t), 2),
                        "texto": "AMIL Pedro Henrique é do Sr. Pedro — mover de 2.14.2.4 (Leonardo) para 2.14.1.4 Amil Pedro Henrique."})
    # 2.16 MUDOU DE SIGNIFICADO em 01/08/2026: era "Investimentos" (e é assim
    # que os 8 meses de histórico usam — R$ 29 mil em dez/25, R$ 38 mil em
    # mar/26) e o Leonardo renomeou para "Empréstimos Bancários", pendurando
    # Credinor, Nordeste e Empréstimo Terceiros embaixo. A fórmula do painel
    # ainda lê `2.16` inteiro como investimento; enquanto os dois significados
    # convivem, todo título de 2.16 com CARA DE EMPRÉSTIMO vira pendência em
    # vez de virar patrimônio em silêncio.
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
                                 f"(é assim nos 8 meses de histórico). Pelo nome é empréstimo. "
                                 f"Reaponte o lançamento ou me avise para trocar a fórmula."})

    # (Receita "não operacional" em conta de produto: já foi listado aqui como
    #  suspeita — 12 títulos, R$ 51.799 em jul/26. O Leonardo conferiu um a um
    #  em 01/08/2026 e confirmou que a CONTA está certa: são relançamentos de
    #  venda real, com NF ou OS de referência, marcados como não operacionais
    #  porque o título original já tinha sido baixado. A regra foi removida —
    #  o tipo do título não diz nada sobre a conta estar certa ou errada.)
    return out


def galho_do_produto(nome, mapa_conta):
    conta = mapa_conta.get(nome, "")
    for pref, galho in GALHOS.items():
        if conta == pref or conta.startswith(pref + "."):
            return galho
    return "1.1.1"


def codigos_estaveis(por_produto, registro_codigos, mapa_conta):
    """Código fixo por produto, guardado entre execuções.

    Sem isto o código seguiria a ordem de valor do mês e "1.1.1.51" seria
    Placa ACM em julho e outra coisa em agosto — a mesma conta com dois nomes.
    """
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


def montar(label, receber, pagar, por_produto, valor_janela, codigo,
           registro_codigos=None, mapa_conta=None, nomes_conhecidos=None):
    """Devolve (registro do mês, códigos de produto atualizados).

    nomes_conhecidos: code -> nome, tirado dos meses que já estão no servidor.
    Sem isso uma conta-pai que o mês não usa diretamente (1.1.1.1 Acrílicos,
    quando só o neto 1.1.1.1.9 teve lançamento) sairia com o código no lugar
    do nome, e a árvore do painel mostraria "1.1.1.1" na tela.
    """
    folhas = {}
    nomes = dict(nomes_conhecidos or {})
    nomes.update(NOMES_BASE)

    pendencias = pendencias_de_classificacao(pagar, receber, valor_janela)
    for t in pagar:
        c, nome = codigo(t.get("plano_contas"))
        if not c:
            c, nome = "2", "Despesas"
        # Fatura de cartão vem com plano de contas "2-Despesas": o código é o
        # topo da árvore. Vai para uma conta própria em vez de sumir dentro do
        # total, senão some da leitura de custo sem ninguém perceber.
        if c == "2":
            c, nome = "2.99", "Fatura de cartão (sem detalhamento)"
        c, nome, pend = ajustar_conta(c, nome, t.get("descricao"))
        if pend:
            pend["valor"] = round(valor_janela(t), 2)
            pendencias.append(pend)
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

    # Receita de venda: cada produto vira filho do seu galho — Produtos e
    # Serviços dentro de Comunicação Visual, Portas/Painéis e PDV nos deles.
    reg = codigos_estaveis(por_produto, registro_codigos, mapa_conta or {})
    for prod, v in por_produto.items():
        c = reg[prod]
        nomes[c] = prod
        folhas[c] = round(folhas.get(c, 0.0) + v, 2)

    return ({"id": re.sub(r"[^\w]+", "_", label.strip()), "label": label,
             "company": "Impresilk", "basis": "Competência de Caixa",
             "origem": "erp", "cells": _acumular(folhas, nomes),
             "pendencias": pendencias}, reg)
