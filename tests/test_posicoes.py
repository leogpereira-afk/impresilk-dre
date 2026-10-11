"""Histórico de posições (Fase 6.2): reconstrução do fim de cada mês e coleta
que nunca grava com janela incompleta nem põe valores no log público."""
import datetime as dt
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
os.environ.setdefault("DRE_MACHINE_TOKEN", "fixture-only")
import erp_posicoes as P

D = dt.date


def receber(id_, valor, emissao, venc, pagamentos=(), **extra):
    return {"id": id_, "empresa_id": 1, "valor_titulo": valor, "data_despesa": emissao, "data_vencimento": venc,
            "pagamentos": [{"data_pagamento": d, "valor": v} for d, v in pagamentos], "compoe_dre": "sim",
            "origem": "Cliente Sigiloso", **extra}


def pagar(id_, valor, emissao, venc, centro, pagamentos=(), **extra):
    return {**receber(id_, valor, emissao, venc, pagamentos, **extra), "centro_custo": centro, "origem": "Fornecedor Sigiloso"}


def tit(recurso, id_, valor, emissao, venc, pagamentos=(), **x):
    t = {"id": id_, "empresa_id": 1, "valor_titulo": valor, "data_despesa": emissao, "data_vencimento": venc, "compoe_dre": "sim",
         "pagamentos": [{"data_pagamento": d, "valor": v} for d, v in pagamentos], **x}
    n, m = P.normalizar(t, recurso); assert m is None, m
    return n


def titulos(*pares):
    out = []
    for recurso, t in pares:
        n, motivo = P.normalizar(t, recurso)
        assert motivo is None, motivo
        out.append(n)
    return out


class Reconstrucao(unittest.TestCase):
    def test_saldo_no_fim_do_mes_conta_so_parcelas_ate_o_fim(self):
        ts = titulos(("contas-receber", receber(1, "1000.00", "2025-11-05", "2025-12-05", [("2025-11-20", 300), ("2025-12-10", 700)])),
                     ("contas-receber", receber(2, 500, "2025-12-02", "2026-01-02")),                 # emitido depois de 30/11
                     ("contas-receber", receber(3, 200, "2025-10-01", "2025-10-31", [("2025-11-30", 200)])))  # quitado no dia
        pos = P.posicao_no_fim(ts, D(2025, 11, 30), "2025-01-01")["receber"]
        self.assertEqual(pos["total"], 700.0)
        self.assertEqual(pos["quantidade"], 1)
        self.assertEqual(pos["faixas"]["avencer"], 700.0)
        dez = P.posicao_no_fim(ts, D(2025, 12, 31), "2025-01-01")["receber"]
        self.assertEqual((dez["total"], dez["faixas"]["avencer"]), (500.0, 500.0), "título 1 quitado em 10/12; o 2 vence em janeiro")

    def test_faixas_pelo_vencimento_contra_o_fim_do_mes(self):
        fim = D(2026, 3, 31)
        vencs = {"avencer": fim, "d1_30": fim - dt.timedelta(days=30), "d31_60": fim - dt.timedelta(days=31),
                 "d61_90": fim - dt.timedelta(days=90), "d91": fim - dt.timedelta(days=91)}
        ts = titulos(*[("contas-pagar", pagar(i, 100 * (i + 1), "2025-01-02", v.isoformat(), "1.01 Impressão")) for i, v in enumerate(vencs.values())])
        f = P.posicao_no_fim(ts, fim, "2025-01-01")["pagar"]["faixas"]
        self.assertEqual(f, {"avencer": 100.0, "d1_30": 200.0, "d31_60": 300.0, "d61_90": 400.0, "d91": 500.0})

    def test_antigas_fora_do_dre_e_centros(self):
        ts = titulos(("contas-pagar", pagar(1, 900, "2024-05-01", "2024-12-31", "1.04 Serralheria")),
                     ("contas-pagar", pagar(2, 100, "2024-05-01", "2025-01-01", "1.04 Serralheria")),
                     ("contas-pagar", pagar(3, 50, "2025-11-01", "2025-12-15", "3.04 Empréstimos", compoe_dre="nao")),
                     ("contas-pagar", pagar(4, 25, "2025-11-01", "2025-12-15", "")))
        p = P.posicao_no_fim(ts, D(2025, 11, 30), "2025-01-01")["pagar"]
        self.assertEqual(p["antigas"], {"quantidade": 1, "valor": 900.0}, "vencido no dia do corte não é antigo")
        self.assertEqual(p["total"], 175.0)
        self.assertEqual(p["foraDRE"], {"quantidade": 1, "valor": 50.0}, "fora do DRE entra e é contado")
        self.assertEqual(p["porCentro"], [{"rotulo": "1.04 Serralheria", "valor": 100.0, "quantidade": 1},
                                          {"rotulo": "3.04 Empréstimos", "valor": 50.0, "quantidade": 1},
                                          {"rotulo": "Sem centro de custo", "valor": 25.0, "quantidade": 1}])

    def test_pagamento_acima_do_titulo_e_lancado_depois(self):
        ts = titulos(("contas-receber", receber(1, 100, "2025-11-01", "2025-11-30", [("2025-11-10", 150)])),
                     ("contas-receber", receber(2, 80, "2025-11-01", "2025-12-30", data_cadastro="2025-12-05 09:00:00")))
        r = P.posicao_no_fim(ts, D(2025, 11, 30), "2025-01-01")["receber"]
        self.assertEqual((r["total"], r["lancadoDepois"]), (80.0, 1))

    def test_fluxos_emitido_pago_e_prazos(self):
        ts = titulos(("contas-receber", receber(1, 1000, "2026-01-05", "2026-02-04", [("2026-01-25", 400), ("2026-02-10", 600)])),
                     ("contas-receber", receber(2, 3000, "2026-01-20", "2026-01-30")),
                     ("contas-pagar", pagar(3, 500, "2026-01-10", "2026-02-09", "1.01 Impressão", [("2026-01-31", 500)])))
        f = P.fluxos_do_mes(ts, D(2026, 1, 1), D(2026, 1, 31))
        self.assertEqual((f["receber"]["emitido"], f["receber"]["pago"]), (4000.0, 400.0))
        self.assertEqual(f["receber"]["prazoConcedido"], round((1000 * 30 + 3000 * 10) / 4000))
        self.assertEqual(f["receber"]["prazoReal"], 20, "25/01 − 05/01")
        self.assertEqual(f["pagar"]["emitidoPorCentro"], [{"rotulo": "1.01 Impressão", "valor": 500.0}])
        self.assertEqual(f["pagar"]["prazoReal"], 21)
        vazio = P.fluxos_do_mes(ts, D(2025, 6, 1), D(2025, 6, 30))
        self.assertIsNone(vazio["receber"]["prazoReal"], "sem pagamento no mês: prazo não apurado, não zero")

    def test_normalizar_recusa_sem_valor_sem_emissao_e_pagamento_ilegivel(self):
        self.assertEqual(P.normalizar(receber(1, None, "2025-11-01", "2025-12-01"), "contas-receber")[1], "semValor")
        self.assertEqual(P.normalizar(receber(1, "abc", "2025-11-01", "2025-12-01"), "contas-receber")[1], "semValor")
        self.assertEqual(P.normalizar(receber(1, 10, "", "2025-12-01"), "contas-receber")[1], "semEmissao")
        self.assertEqual(P.normalizar(receber(1, 10, "2025-11-01", "2025-12-01", [("", 5)]), "contas-receber")[1], "pagamentoInvalido")
        n, _ = P.normalizar({**receber(1, 10, "", "2025-12-01"), "data_cadastro": "2025-11-03 10:00:00"}, "contas-receber")
        self.assertEqual(n["emissao"], D(2025, 11, 3), "sem data_despesa, a emissão é o cadastro")
        n, _ = P.normalizar({**receber(1, 10, "2025-11-01", "2025-12-01"), "pagamentos": [], "valor_pagamento": 4, "data_pagamento": "2025-11-20"}, "contas-receber")
        self.assertEqual(n["pagamentos"], [(D(2025, 11, 20), 400)], "título antigo sem lista: usa o pagamento do topo")
        self.assertEqual(P.cent("0.29") + P.cent("1234.57") + P.cent(0.57), 123543)

    def test_horizonte_de_60_dias_e_tres_meses_de_fluxo(self):
        ts = titulos(("contas-receber", receber(1, 100, "2025-11-01", "2026-01-29")),   # 60 dias depois de 30/11: entra
                     ("contas-receber", receber(2, 300, "2025-11-01", "2026-01-30")),   # 61 dias: fica à parte
                     ("contas-receber", receber(3, 50, "2025-09-10", "2025-10-10", [("2025-10-20", 50)])))
        r = P.posicao_no_fim(ts, D(2025, 11, 30), "2025-01-01")["receber"]
        self.assertEqual((r["total"], r["alemHorizonte"]), (100.0, {"quantidade": 1, "valor": 300.0}))
        reg = P.montar_registros(ts, [(2025, 11)], {}, gerado_em="x", execucao="y")[0]
        self.assertEqual(reg["fluxos3m"]["receber"]["emitido"], 450.0, "setembro a novembro")
        self.assertEqual(reg["fluxos"]["receber"]["emitido"], 400.0, "só novembro")
        jan = P.montar_registros(ts, [(2026, 2)], {}, gerado_em="x", execucao="y")[0]
        self.assertEqual(jan["fluxos3m"]["receber"]["emitido"], 0.0, "dez a fev: virada de ano")

    def test_meses_fechados_e_registros(self):
        self.assertEqual(P.meses_fechados(D(2026, 1, 15)), [(2025, 11), (2025, 12)])
        self.assertEqual(P.meses_fechados(D(2025, 11, 30)), [], "30/11 ainda não fechou o dia")
        regs = P.montar_registros([], [(2025, 11)], {"titulos": 0}, gerado_em="x", execucao="y")
        self.assertEqual((regs[0]["id"], regs[0]["mes"], regs[0]["fim"], regs[0]["regra"]), ("2025-11", "Nov/2025", "2025-11-30", "posicao-v1"))


class Coleta(unittest.TestCase):
    def chamar_com(self, respostas):
        pedidos = []

        def chamar(fn, payload, *a, **kw):
            pedidos.append(payload)
            r = respostas(payload)
            if isinstance(r, Exception):
                raise r
            return r
        return chamar, pedidos

    def test_janela_que_estoura_e_partida_ao_meio_e_pede_um_dia_alem(self):
        def resp(p):
            if p["datainicial"] == "2026-01-01" and p["datafinal"] == "2026-02-01":
                return {"ok": True, "parcial": True, "diagnostico": {"motivo": "tempo-ou-rede"}}
            return {"ok": True, "itens": [{"id": p["datainicial"]}]}
        chamar, pedidos = self.chamar_com(resp)
        itens = P.listar("contas-pagar", "PAGO", "PAGAMENTO", D(2026, 1, 1), D(2026, 1, 31), chamar, lambda s: None)
        self.assertEqual([i["id"] for i in itens], ["2026-01-01", "2026-01-17"])
        self.assertEqual(pedidos[1]["datafinal"], "2026-01-17", "datafinal corta na meia-noite: pede-se o dia seguinte")

    def test_429_espera_e_tenta_de_novo(self):
        estado = {"n": 0}

        def resp(p):
            estado["n"] += 1
            return {"ok": True, "parcial": True, "diagnostico": {"motivo": "http", "http": 429}} if estado["n"] == 1 else {"ok": True, "itens": []}
        esperas = []
        chamar, _ = self.chamar_com(resp)
        self.assertEqual(P.listar("contas-pagar", "PAGO", "PAGAMENTO", D(2026, 1, 1), D(2026, 1, 1), chamar, esperas.append), [])
        self.assertEqual(esperas[0], 65)

    def test_janela_incompleta_aborta_sem_gravar(self):
        chamar, pedidos = self.chamar_com(lambda p: {"ok": False, "erro": "Mubisys HTTP 500"})
        with patch.dict(os.environ, {"DRE_PUBLISH": "1"}):
            with self.assertRaises(P.ColetaIncompleta):
                P.main(D(2026, 1, 15), chamar, lambda s: None, lambda m: None)
        self.assertFalse(any(p.get("action") == "posicoesGravar" for p in pedidos))

    def test_titulo_alterado_entre_consultas_aborta(self):
        with self.assertRaises(P.ColetaIncompleta):
            P.juntar([("contas-pagar", [pagar(1, 100, "2025-11-01", "2025-12-01", "1.01")]),
                      ("contas-pagar", [pagar(1, 150, "2025-11-01", "2025-12-01", "1.01")])])
        self.assertEqual(len(P.juntar([("contas-pagar", [pagar(1, 100, "2025-11-01", "2025-12-01", "1.01")]),
                                       ("contas-pagar", [pagar(1, 100, "2025-11-01", "2025-12-01", "1.01")]),
                                       ("contas-receber", [receber(1, 100, "2025-11-01", "2025-12-01")])])), 2,
                         "mesmo id em receber e pagar são títulos diferentes")

    def test_rodada_completa_grava_um_registro_por_mes_e_log_sem_valores(self):
        def resp(p):
            if p.get("action") == "posicoesGravar":
                return {"ok": True, "id": p["registro"]["id"]}
            if p["recurso"] == "contas-receber" and p["status"] == "PAGO" and p["datainicial"] == "2025-12-01":
                return {"ok": True, "itens": [receber(7, "12345.67", "2025-11-10", "2025-12-10", [("2025-12-08", "12345.67")])]}
            return {"ok": True, "itens": []}
        chamar, pedidos = self.chamar_com(resp)
        log = []
        with patch.dict(os.environ, {"DRE_PUBLISH": "1"}):
            regs = P.main(D(2026, 1, 15), chamar, lambda s: None, log.append)
        gravados = [p["registro"] for p in pedidos if p.get("action") == "posicoesGravar"]
        self.assertEqual([r["id"] for r in gravados], ["2025-11", "2025-12"])
        self.assertEqual(gravados[0]["receber"]["total"], 12345.67, "em 30/11 o título estava em aberto")
        self.assertEqual(gravados[1]["receber"]["total"], 0.0)
        self.assertEqual(regs[0]["fluxos"]["receber"]["emitido"], 12345.67)
        texto = "\n".join(log)
        for proibido in ("12345", "12.345", "Cliente Sigiloso", "Fornecedor Sigiloso"):
            self.assertNotIn(proibido, texto, "o log do GitHub é público")

    def test_simulacao_nao_grava(self):
        chamar, pedidos = self.chamar_com(lambda p: {"ok": True, "itens": []})
        with patch.dict(os.environ, {"DRE_PUBLISH": "0"}):
            P.main(D(2026, 1, 15), chamar, lambda s: None, lambda m: None)
        self.assertFalse(any(p.get("action") == "posicoesGravar" for p in pedidos))

    def test_servidor_que_nao_confirma_para_a_gravacao(self):
        chamar, _ = self.chamar_com(lambda p: {"erro": "Posição inválida."} if p.get("action") == "posicoesGravar" else {"ok": True, "itens": []})
        with patch.dict(os.environ, {"DRE_PUBLISH": "1"}):
            with self.assertRaises(RuntimeError):
                P.main(D(2026, 1, 15), chamar, lambda s: None, lambda m: None)


class CasosDaRevisao(unittest.TestCase):
    """Testes da revisão adversarial da 6.2 (matam mutantes que sobreviviam)."""
    def test_parcial_com_itens_nao_e_aceito(self):
        chamadas = []
        def chamar(fn, p):
            chamadas.append(p)
            return {"ok": True, "parcial": True, "itens": [{"id": 1}], "diagnostico": {"motivo": "paginacao-inconsistente"}}
        with self.assertRaises(P.ColetaIncompleta):
            P.listar("contas-pagar", "PAGO", "PAGAMENTO", D(2026, 1, 1), D(2026, 1, 1), chamar, lambda s: None)
        self.assertEqual(len(chamadas), 3, "duas novas tentativas antes de desistir")

    def test_consultas_de_abertos_e_pagos(self):
        pedidos = []
        def chamar(fn, p):
            pedidos.append(p)
            if p.get("action") == "posicoesGravar":
                return {"ok": True}
            if p["recurso"] == "contas-receber" and p["status"] == "PENDENTE":
                return {"ok": True, "itens": [{"id": 9, "empresa_id": 1, "valor_titulo": 700, "data_despesa": "2025-11-10", "data_vencimento": "2026-01-20", "compoe_dre": "sim", "pagamentos": [{"data_pagamento": "2026-01-20", "valor": 700}]}]}
            if p["recurso"] == "contas-receber" and p["status"] == "PAGO" and p["datainicial"] == "2025-09-01":
                return {"ok": True, "itens": [{"id": 8, "empresa_id": 1, "valor_titulo": 300, "data_despesa": "2025-09-05", "data_vencimento": "2025-09-25", "compoe_dre": "sim", "pagamentos": [{"data_pagamento": "2025-09-25", "valor": 300}]}]}
            return {"ok": True, "itens": []}
        with patch.dict(os.environ, {"DRE_PUBLISH": "0"}):
            regs = P.main(D(2026, 1, 15), chamar, lambda s: None, lambda m: None)
        self.assertEqual(regs[0]["receber"]["total"], 700.0, "título em aberto que só volta na consulta PENDENTE")
        self.assertEqual(regs[0]["fluxos3m"]["receber"]["emitido"], 1000.0, "pago em setembro entra no emitido de set–nov")
        tipos = {(p["status"], p["filtrodata"]) for p in pedidos if "status" in p}
        self.assertEqual(tipos, {("VENCIDO", "VENCIMENTO"), ("PENDENTE", "VENCIMENTO"), ("PAGO", "PAGAMENTO")})
        pend = [p for p in pedidos if p.get("status") == "PENDENTE"]
        self.assertGreaterEqual(max(p["datafinal"] for p in pend), "2027-01-15")

    def test_janela_de_tres_meses_em_fevereiro_e_marco(self):
        ts = [tit("contas-receber", 1, 100, "2025-12-10", "2026-01-10"), tit("contas-receber", 2, 200, "2025-01-15", "2025-02-15", [("2025-02-15", 200)])]
        fev = P.montar_registros(ts, [(2026, 2)], {}, gerado_em="x", execucao="y")[0]
        self.assertEqual(fev["fluxos3m"]["receber"]["emitido"], 100.0, "dez a fev")
        mar = P.montar_registros([tit("contas-receber", 3, 50, "2025-03-10", "2025-04-10", [("2025-04-10", 50)]), tit("contas-receber", 4, 70, "2026-01-02", "2026-02-02", [("2026-02-02", 70)])], [(2026, 3)], {}, gerado_em="x", execucao="y")[0]
        self.assertEqual(mar["fluxos3m"]["receber"]["emitido"], 70.0, "jan a mar de 2026, não de 2025")

    def test_emitido_no_ultimo_dia_entra_na_posicao_e_no_fluxo(self):
        ts = [tit("contas-receber", 1, 100, "2025-11-30", "2025-12-30")]
        self.assertEqual(P.posicao_no_fim(ts, D(2025, 11, 30), "2025-01-01")["receber"]["total"], 100.0)
        self.assertEqual(P.fluxos_do_mes(ts, D(2025, 11, 1), D(2025, 11, 30))["receber"]["emitido"], 100.0)

    def test_mesmo_id_em_empresas_diferentes(self):
        a = {"id": 5, "empresa_id": 1, "valor_titulo": 100, "data_despesa": "2025-11-01", "data_vencimento": "2025-12-01"}
        self.assertEqual(len(P.juntar([("contas-pagar", [a, {**a, "empresa_id": 2, "valor_titulo": 300}])])), 2)

    def test_pagamento_novo_entre_consultas_aborta(self):
        a = {"id": 5, "empresa_id": 1, "valor_titulo": 100, "data_despesa": "2025-11-01", "data_vencimento": "2025-12-01", "pagamentos": []}
        with self.assertRaises(P.ColetaIncompleta):
            P.juntar([("contas-pagar", [a]), ("contas-pagar", [{**a, "pagamentos": [{"data_pagamento": "2025-12-01", "valor": 100}]}])])


class Quitados(unittest.TestCase):
    def rodar(self, itens_pagos):
        def chamar(fn, p, *a, **kw):
            if p.get("action") == "posicoesGravar":
                return {"ok": True}
            if p["recurso"] == "contas-receber" and p["status"] == "PAGO" and p["datainicial"] == "2026-01-01":
                return {"ok": True, "itens": itens_pagos}
            return {"ok": True, "itens": []}
        with patch.dict(os.environ, {"DRE_PUBLISH": "0"}):
            return P.main(D(2026, 3, 15), chamar, lambda s: None, lambda m: None)

    def test_quitado_com_topo_zerado_desconto_ou_so_a_ultima_parcela_zera_na_quitacao(self):
        itens = [
            {"id": "a", "empresa_id": 1, "valor_titulo": 100000, "data_despesa": "2025-12-01", "data_vencimento": "2025-12-20", "pagamentos": [], "valor_pagamento": 0, "data_pagamento": "2026-01-05"},
            {"id": "b", "empresa_id": 1, "valor_titulo": 10000, "data_despesa": "2025-12-01", "data_vencimento": "2025-12-20", "pagamentos": [{"data_pagamento": "2026-01-10", "valor": 9500}]},
            {"id": "c", "empresa_id": 1, "valor_titulo": 6000, "data_despesa": "2025-12-01", "data_vencimento": "2025-12-20", "pagamentos": [], "valor_pagamento": 1500, "data_pagamento": "2026-01-20"},
        ]
        regs = self.rodar(itens)
        dez, jan, fev = (next(r for r in regs if r["id"] == m) for m in ("2025-12", "2026-01", "2026-02"))
        self.assertEqual(dez["receber"]["total"], 116000.0, "em 31/12 os três estavam em aberto")
        self.assertEqual((jan["receber"]["total"], fev["receber"]["total"]), (0.0, 0.0), "quitados em janeiro: nada sobra em aberto")
        self.assertEqual(dez["cobertura"]["quitadoComResiduo"], {"quantidade": 3, "valor": 105000.0}, "o que não veio em parcela é dito, não somado")

    def test_quitado_sem_nenhuma_data_de_pagamento_e_ilegivel(self):
        regs = self.rodar([{"id": "z", "empresa_id": 1, "valor_titulo": 500, "data_despesa": "2025-12-01", "data_vencimento": "2025-12-20", "pagamentos": [], "valor_pagamento": 500}])
        self.assertEqual((regs[0]["cobertura"]["pagamentoInvalido"], regs[1]["receber"]["total"]), (1, 0.0))

    def test_sem_vencimento_guarda_o_valor_e_alem_dos_60_dias_vai_por_centro(self):
        ts = [tit("contas-pagar", 1, 300, "2025-11-01", None, centro_custo="1.01 Impressão"),
              tit("contas-pagar", 2, 800, "2025-11-01", "2026-03-01", centro_custo="1.01 Impressão"),
              tit("contas-pagar", 3, 200, "2025-11-01", "2025-12-15", centro_custo="1.01 Impressão")]
        p = P.posicao_no_fim(ts, D(2025, 11, 30), "2025-01-01")["pagar"]
        self.assertEqual(p["semVencimento"], {"quantidade": 1, "valor": 300.0})
        self.assertEqual((p["total"], p["alemPorCentro"]), (200.0, [{"rotulo": "1.01 Impressão", "valor": 800.0, "quantidade": 1}]))


class JanelaVazia(unittest.TestCase):
    def test_tres_404_sem_titulo_e_janela_vazia(self):
        n = {"c": 0}

        def chamar(fn, p, *a, **kw):
            n["c"] += 1
            return {"ok": True, "parcial": True, "itens": [], "diagnostico": {"motivo": "http", "http": 404}}
        self.assertEqual(P.listar("contas-receber", "PAGO", "PAGAMENTO", D(2026, 11, 1), D(2026, 11, 1), chamar, lambda s: None), [])
        self.assertEqual(n["c"], 3)

    def test_404_depois_de_titulos_lidos_aborta(self):
        def chamar(fn, p, *a, **kw):
            return {"ok": True, "parcial": True, "itens": [{"id": 1}], "diagnostico": {"motivo": "http", "http": 404}}
        with self.assertRaises(P.ColetaIncompleta):
            P.listar("contas-receber", "PAGO", "PAGAMENTO", D(2026, 1, 1), D(2026, 1, 31), chamar, lambda s: None)

    def test_metade_vazia_depois_da_divisao(self):
        def chamar(fn, p, *a, **kw):
            if p["datainicial"] == "2015-01-01" and p["datafinal"] == "2026-01-16":
                return {"ok": True, "parcial": True, "diagnostico": {"motivo": "tempo-ou-rede"}}
            if p["datainicial"] == "2015-01-01":
                return {"ok": True, "parcial": True, "itens": [], "diagnostico": {"motivo": "http", "http": 404}}
            return {"ok": True, "itens": [{"id": 7}]}
        self.assertEqual(P.listar("contas-receber", "VENCIDO", "VENCIMENTO", D(2015, 1, 1), D(2026, 1, 15), chamar, lambda s: None), [{"id": 7}])


if __name__ == "__main__":
    unittest.main()
