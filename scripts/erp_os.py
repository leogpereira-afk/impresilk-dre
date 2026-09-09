
"""Módulo financeiro: processa dados recebidos da origem autenticada."""
import re
from decimal import Decimal, ROUND_HALF_UP, ROUND_FLOOR

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
    """por_conta: processa dados recebidos da origem autenticada."""
    contas, sem = {}, {}
    for nome, v in por_produto.items():
        c = MAPA_CONTA.get(nome)
        if c:
            contas[c] = round(contas.get(c, 0.0) + v, 2)
        else:
            sem[nome] = round(sem.get(nome, 0.0) + v, 2)
    return contas, sem

def numeros_de_os(despesa):
    """numeros_de_os: processa dados recebidos da origem autenticada."""
    s = str(despesa or "").strip()
    if not s:
        return []
    return [p for p in (x.strip() for x in s.split("-")) if re.fullmatch(r"\d{3,}", p)]

def itens_da_os(os_obj):
    """itens_da_os: processa dados recebidos da origem autenticada."""
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
    """ratear: processa dados recebidos da origem autenticada."""
    por_produto, diag = {}, {"titulos": 0, "rateados": 0, "semOS": 0,
                             "valorSemOS": 0.0, "valorRateado": 0.0, "osFaltando": []}
    for t in recebimentos:
        v = valor_de(t)
        if not v:
            continue
        diag["titulos"] += 1
        itens = []
        incompleta = False
        for n in dict.fromkeys(numeros_de_os(t.get("despesa"))):
            o = cache_os.get(n)
            if isinstance(o, dict) and "_erro" not in o:
                obtidos = itens_da_os(o)
                if not obtidos: incompleta = True
                itens.extend(obtidos)
            else:
                diag["osFaltando"].append(n)
                incompleta = True
        total = sum(i["valor"] for i in itens if i["valor"] > 0)
        if total <= 0 or incompleta:
            diag["semOS"] += 1
            diag["valorSemOS"] = round(diag["valorSemOS"] + v, 2)
            continue
        diag["rateados"] += 1
        diag["valorRateado"] = round(diag["valorRateado"] + v, 2)
        pesos = {}
        for i in itens:
            if i["valor"] > 0:
                pesos[i["item"]] = pesos.get(i["item"], Decimal("0")) + Decimal(str(i["valor"]))
        centavos = int((Decimal(str(abs(v))) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        total_pesos = sum(pesos.values())
        exatos = {nome: Decimal(centavos) * peso / total_pesos for nome, peso in pesos.items()}
        partes = {nome: int(x.to_integral_value(rounding=ROUND_FLOOR)) for nome, x in exatos.items()}
        ordem = sorted(partes, key=lambda nome: (-(exatos[nome] - partes[nome]), nome))
        for nome in ordem[:centavos - sum(partes.values())]:
            partes[nome] += 1
        sinal = 1 if v >= 0 else -1
        for nome, parte in partes.items():
            por_produto[nome] = round(por_produto.get(nome, 0.0) + sinal * parte / 100, 2)
    diag["osFaltando"] = sorted(set(diag["osFaltando"]))
    return dict(sorted(por_produto.items(), key=lambda x: -x[1])), diag
