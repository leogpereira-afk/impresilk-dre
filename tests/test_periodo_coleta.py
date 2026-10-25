"""Contrato de datas do ERP com pagamentos sintéticos e sem acesso à rede."""
import datetime
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import erp_previa as previa


class PeriodoColetaTest(unittest.TestCase):
    def api_exclusiva(self, titulos, chamadas):
        """O limite final do ERP é a meia-noite, sem incluir esse dia."""
        def consultar(fn, payload):
            self.assertEqual(fn, "dre-financas")
            self.assertEqual(payload["filtrodata"], "PAGAMENTO")
            chamadas.append(payload)
            inicio = datetime.datetime.fromisoformat(payload["datainicial"])
            limite = datetime.datetime.fromisoformat(payload["datafinal"])
            return {"ok": True, "itens": [
                t for t in titulos
                if inicio <= datetime.datetime.fromisoformat(t["data_pagamento"]) < limite
            ]}
        return consultar

    def test_mes_inclui_todos_os_dias_sem_buracos_entre_semanas(self):
        for recurso in ("contas-pagar", "contas-receber"):
            for inicio, fim in (
                (datetime.date(2026, 1, 1), datetime.date(2026, 1, 31)),
                (datetime.date(2026, 2, 1), datetime.date(2026, 2, 28)),
                (datetime.date(2024, 2, 1), datetime.date(2024, 2, 29)),
                (datetime.date(2026, 12, 1), datetime.date(2026, 12, 31)),
            ):
                with self.subTest(recurso=recurso, inicio=inicio):
                    dias = [inicio + datetime.timedelta(days=n) for n in range((fim - inicio).days + 1)]
                    # Inclui uma baixa anterior e outra posterior para detectar vazamento do período.
                    fonte = [inicio - datetime.timedelta(days=1), *dias, fim + datetime.timedelta(days=1)]
                    titulos = [{"id": d.isoformat(), "data_pagamento": d.isoformat() + "T12:00:00",
                                "valor_pagamento": 1} for d in fonte]
                    chamadas = []
                    with patch.object(previa, "call", side_effect=self.api_exclusiva(titulos, chamadas)), \
                            patch.object(previa.time, "sleep"):
                        coletados = previa.coletar(recurso, inicio, fim)
                    self.assertEqual([t["id"] for t in coletados], [d.isoformat() for d in dias])
                    self.assertEqual(sum(previa.valor_na_janela(t, inicio.isoformat(), fim.isoformat())
                                         for t in coletados), len(dias))
                    self.assertEqual(chamadas[-1]["datafinal"], (fim + datetime.timedelta(days=1)).isoformat())

    def test_um_dia_inclui_meia_noite_e_ultima_baixa_sem_incluir_o_seguinte(self):
        titulos = [{"id": i, "data_pagamento": d, "valor_pagamento": 1} for i, d in enumerate([
            "2026-01-30T23:59:59", "2026-01-31T00:00:00",
            "2026-01-31T23:59:59", "2026-02-01T00:00:00",
        ])]
        with patch.object(previa, "call", side_effect=self.api_exclusiva(titulos, [])), \
                patch.object(previa.time, "sleep"):
            coletados = previa.coletar("contas-pagar", datetime.date(2026, 1, 31), datetime.date(2026, 1, 31))
        self.assertEqual([t["id"] for t in coletados], [1, 2])

    def test_mes_atual_mantem_hoje_como_ultimo_dia_contabilizado(self):
        inicio, hoje = datetime.date(2026, 1, 1), datetime.date(2026, 1, 12)
        fim = previa.fim_consulta(inicio, datetime.date(2026, 1, 31), hoje)
        titulo = {"id": "sintetico", "data_pagamento": "2026-01-12T23:59:59", "valor_pagamento": 5,
                  "pagamentos": [{"id": 1, "data_pagamento": "2026-01-12T23:59:59", "valor": 5},
                                 {"id": 2, "data_pagamento": "2026-01-13T00:00:00", "valor": 99}]}
        chamadas = []
        with patch.object(previa, "call", side_effect=self.api_exclusiva([titulo], chamadas)), \
                patch.object(previa.time, "sleep"):
            coletados = previa.coletar("contas-receber", inicio, fim)
        self.assertEqual(len(coletados), 1)
        self.assertEqual(fim, hoje)
        self.assertEqual(chamadas[-1]["datafinal"], "2026-01-13")
        self.assertEqual(previa.valor_na_janela(coletados[0], inicio.isoformat(), fim.isoformat()), 5)
        self.assertEqual(previa.por_dia(coletados, inicio.isoformat(), fim.isoformat()), {"2026-01-12": 5})
        eventos = previa.eventos_financeiros(coletados, "entrada", inicio.isoformat(), fim.isoformat())
        self.assertEqual([(e["data"], e["valor"]) for e in eventos], [("2026-01-12", 5)])


if __name__ == "__main__":
    unittest.main()
