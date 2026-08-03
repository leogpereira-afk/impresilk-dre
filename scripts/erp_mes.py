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
import unicodedata
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


# ---------------------------------------------------------------------------
# DE-PARA DO PLANO NOVO (renumeração do Leonardo, 02/08/2026)
#
# O Mubisys foi renumerado INTEIRO: todo centro de custo trocou de código.
# Traduzimos para os códigos CANÔNICOS (os que os 7 meses de planilha usam e
# que as fórmulas do painel leem), porque:
#   * a série histórica precisa continuar sendo uma só — sem isso, Materiais
#     "morre" em 2.12 e "nasce" em 2.9, e o painel compara com o nada;
#   * as fórmulas dos 4 blocos vivem no app.js e no conferencia.py; traduzir
#     aqui é UM ponto, e é o único lugar onde o nome da conta está junto do
#     código para conferir se a tradução faz sentido.
#
# Medido em jul/26 sem a tradução: R$ 193.799,79 de dívida e retirada caindo
# em "Custos da Operação", retiradas e investimentos zerados.
#
# ORDEM IMPORTA: prefixo mais específico primeiro (2.13.5 antes de 2.13).
DE_PARA_PLANO_NOVO = [
    # dívida e financiamento: o galho novo 2.13 junta tudo
    ("2.13.5", "2.13.6"),        # devolução a sócio (Leonardo/LGP/Impresilk)
    ("2.13.3", "2.14.3.5"),      # empréstimo terceiros
    ("2.13.4", "2.16"),          # "investimentos" dentro do galho de dívida
    ("2.13.2", "2.13.7.1"),      # Banco do Nordeste (o split por descrição roda depois)
    ("2.13.1", "2.13.7.1"),      # Credinor/outros financiamentos bancários
    # centros de custo renumerados
    ("2.11", "2.14"),            # societárias (retiradas + arrendamento)
    ("2.10", "2.13"),            # bancárias (tarifas e juros)
    ("2.9",  "2.12"),            # materiais e insumos
    # 2.8 novo = logística e serviços externos: Frete 4.549, Gráfica Rápida
    # 3.100, Freelancer 1.714, viagem (hotel/alimentação/pedágio) 2.257,
    # Andaimes, Material de Construção. O centro velho mais próximo é
    # "Terceirização de Serviços" — é onde o Freelancer sempre morou.
    ("2.8",  "2.11"),
    ("2.7",  "2.8"),             # terceiros (consultoria, contabilidade)
    ("2.6",  "2.7"),             # veículos
    ("2.5",  "2.6"),             # máquinas e equipamentos
    ("2.4",  "2.5"),             # fixas (água/luz/telefonia/aluguel)
    ("2.3",  "2.4"),             # impostos
    # 2.2 novo = administrativas + limpeza juntas (Material de Escritório, CDL,
    # ACI, Material de Limpeza, Limpeza Escritório). Fica em 2.2
    # Administrativas, que é o rótulo que descreve o conjunto; o galho velho
    # 2.3 Limpeza para de receber a partir de Jul/26 — a fusão foi de propósito.
    # 2.1 Funcionários não mudou (e agora abriga Segurança do Trabalho em
    # 2.1.18 e Empreita em 2.1.11.4, que antes eram centros próprios — o
    # Leonardo moveu de propósito, então NÃO forçamos volta para 2.9/2.10).
]

# Dentro de "fixas" o Leonardo passou a separar por MEDIDOR/ENDEREÇO
# (2.4.1.x Copasa, 2.4.3.x Cemig). O painel acompanha energia e água pelas
# contas canônicas 2.5.3 e 2.5.1 — o de-para acima já leva 2.4 → 2.5, e estas
# duas linhas garantem que os medidores caiam no galho certo.
DE_PARA_FIXAS = [("2.4.1", "2.5.1"), ("2.4.3", "2.5.3")]


def traduzir_plano(c):
    """Código do plano NOVO -> código canônico. Devolve o próprio se não casar."""
    for novo, canon in DE_PARA_FIXAS + DE_PARA_PLANO_NOVO:
        if c == novo or c.startswith(novo + "."):
            return canon + c[len(novo):]
    return c


def ajustar_conta(c, nome, texto):
    """Correções de conta que a planilha fazia à mão e o ERP não faz.

    Devolve (codigo, nome, pendencia|None). Cada regra nasceu de um caso real:

    * NORDESTE SEM SPLIT — a parcela do Banco do Nordeste vem inteira em
      2.13.7.1, mas são TRÊS coisas (medido lançamento a lançamento: 53%
      máquinas, 6% veículo, 41% capital de giro). Sem o split, os R$ 23 mil/mês
      caem em "Custos da Operação": máquina financiada é investimento e capital
      de giro é dívida. A planilha fazia essa quebra nas subcontas .1/.2/.3 —
      aqui ela sai da DESCRIÇÃO do lançamento, que é padronizada no banco.
    * PLANO RENUMERADO — ver DE_PARA_PLANO_NOVO acima.
    """
    t = str(texto or "").upper()
    if c.startswith("2."):
        c = traduzir_plano(c)
    # Fatura de cartão ainda sem itemizar, lançada em "Juros Cartão": não é
    # juros, é a fatura inteira esperando quebra. Em jul/26 eram R$ 15.021,09
    # ("aguardando lancamento do cartao") de R$ 16.456 do galho — o sinal de
    # custo financeiro apontava 11x o real. Vai para 2.99, junto das outras
    # faturas sem detalhamento.
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
        c = pc.split("-")[0].strip()
        # (Pró Vida: já foi listado aqui como "plano de saúde na conta errada".
        #  O Leonardo confirmou em 01/08/2026 que É incentivo de produtividade
        #  para os funcionários — 2.1.13 está CERTO, regra removida.)
        # AMIL do Pedro Henrique é do grupo do Sr. Pedro (confirmado pelo
        # Leonardo em 01/08/2026) — o lugar é 2.14.1.4 (conta que o Leonardo criou), não o
        # plano de saúde das retiradas do Leonardo.
        # Só o PLANO DE SAÚDE do Pedro Henrique: salário e adiantamento dele
        # (é funcionário, "Colab: Pedro Henrique") estão certos em 2.1.
        if "AMIL PEDRO HENRIQUE" in d and traduzir_plano(c).startswith("2.14.2"):
            out.append({"tipo": "amil-pedro-henrique", "conta": c,
                        "valor": round(valor_janela(t), 2),
                        "texto": "AMIL Pedro Henrique quem paga é o Sr. Pedro — está nas retiradas do "
                                 "Leonardo; o lugar é o grupo do arrendamento (Amil Pedro & Maria)."})
        # Conta de consumo (Cemig/Copasa) fora do galho de energia/água. O
        # de-para leva 2.4.3→2.5.3 e 2.4.1→2.5.1; qualquer medidor lançado em
        # outro galho vira imposto ou material em silêncio.
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
    # Pagamento possivelmente EM DUPLICIDADE: mesmo fornecedor, mesmo valor e
    # mesma data de baixa em títulos diferentes. Achado real em jul/26:
    # HANNOVER BH R$ 1.311,72 e BOA LED R$ 757,45, ambos lançados dia 14/07 e
    # de novo dia 15/07 — R$ 2.403,57 no total com o caso da UNIGRAF.
    vistos = {}
    for t in pagar:
        forn = str(t.get("origem") or "").strip()
        if not forn:
            continue
        for pg in (t.get("pagamentos") or []):
            dt = str(pg.get("data_pagamento") or pg.get("data_credito") or "")[:10]
            v = round(float(pg.get("valor") or 0), 2)
            if v < 300:                      # centavos e tarifas não interessam
                continue
            vistos.setdefault((forn, v, dt), []).append(t.get("id"))
    for (forn, v, dt), ids in vistos.items():
        if len(ids) > 1:
            out.append({"tipo": "possivel-duplicidade", "conta": "", "valor": round(v * (len(ids) - 1), 2),
                        "texto": f"{forn[:30]} — R$ {v:,.2f} pago {len(ids)}x em {dt[8:10]}/{dt[5:7]} "
                                 f"(títulos {', '.join(str(i) for i in ids)}). Conferir se não é pagamento repetido."})
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


def _texto_igual(a, b):
    """A conta é a MESMA, só com outro nome?

    Ignora acento, caixa e pontuação. Aceita também um nome contido no outro:
    "Banco do Nordeste" → "Nordeste" é renome, não conta nova (e são R$ 23 mil
    por mês — quebrar essa série seria pior que o problema). Já "Horas Extras"
    → "Honorários Adicionais" não tem containment e é remanejamento de verdade.
    """
    limpa = lambda s: re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFD", str(s or "").lower())
                             .encode("ascii", "ignore").decode())
    x, y = limpa(a), limpa(b)
    if not x or not y:
        return True                       # sem nome dos dois lados: não remaneja
    if x == y:
        return True
    menor, maior = (x, y) if len(x) <= len(y) else (y, x)
    return len(menor) >= 5 and menor in maior


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
    usados_no_pai = {}          # pai -> maior sufixo já dado a conta remanejada

    def sem_colisao(c, nome):
        """Um código canônico só é reaproveitado se o NOME bater.

        A renumeração de 02/08 mexeu TAMBÉM nas subcontas, não só no nível 2:
        o velho 2.1.11 era "Horas Extras" e o novo é "Honorários Adicionais".
        Traduzir o prefixo e manter o sufixo fazia o painel exibir o rótulo
        ANTIGO em cima do valor NOVO — R$ 41.815,37 de julho com nome errado,
        e uma série histórica que compara coisas diferentes.

        Quando o nome não bate, a conta ganha um código livre sob o MESMO pai
        (sufixo a partir de 51, como já é feito com produto). O total do centro
        continua exato, a série do pai continua comparável, e ninguém vê
        'Horas Extras R$ 17.185' sendo na verdade honorários + comissão + diária.
        """
        antigo = nomes_conhecidos.get(c) if nomes_conhecidos else None
        if not antigo or not nome or _texto_igual(antigo, nome):
            return c
        p = pai(c) or "2"
        n = usados_no_pai.get(p, 50)
        while True:
            n += 1
            novo = f"{p}.{n}"
            if novo not in nomes and novo not in folhas:
                usados_no_pai[p] = n
                return novo

    pendencias = pendencias_de_classificacao(pagar, receber, valor_janela)
    remanejadas = {}
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
        if c not in remanejadas:
            remanejadas[c] = sem_colisao(c, nome)
        c = remanejadas[c]
        nomes[c] = nome or nomes.get(c, c)
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
