"""Carga histórica (Fase 10.1): meses do intervalo, um por vez, sem parar na falha,
sem dado no log e sem a trilha por pagamento."""
import datetime as dt
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
os.environ.setdefault("DRE_MACHINE_TOKEN", "fixture-only")
import erp_historico as H
import erp_previa as P


class Historico(unittest.TestCase):
    def test_meses_do_intervalo_so_os_ja_fechados_e_anteriores_ao_mes_passado(self):
        hoje = dt.date(2026, 10, 11)
        self.assertEqual([d.isoformat() for d in H.meses("2025-11", "2026-02", hoje)], ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"])
        for de, ate, msg in [("2026-08", "2026-09", "robô de cada dia"), ("2026-03", "2026-01", "depois do último"), ("2026-1", "2026-02", "AAAA-MM"), ("2000-01", "2025-12", "20 anos")]:
            with self.assertRaisesRegex(ValueError, msg):
                H.meses(de, ate, hoje)

    def test_segue_na_falha_conta_e_termina_com_erro_sem_dado_no_log(self):
        def processar(ini):
            if ini.month == 2:
                raise RuntimeError("Título 123 do cliente Fulano não fecha")
            return {"label": ini.isoformat(), "estado": "preservado" if ini.month == 1 else "gravado"}
        saida = io.StringIO()
        with redirect_stdout(saida), self.assertRaisesRegex(SystemExit, "1 mês\\(es\\) falharam"):
            H.main(["2015-01", "2015-04"], processar=processar)
        log = saida.getvalue()
        self.assertIn("Fev/2015: falhou (RuntimeError); a carga segue para o próximo mês.", log)
        self.assertIn("Carga histórica de 4 mês(es): falhou: 1, gravado: 2, preservado: 1.", log)
        self.assertNotIn("Fulano", log)
        self.assertNotIn("123", log)

    def test_sem_trilha_tira_so_os_eventos_e_marca(self):
        reg = {"cells": [{"code": "1", "value": 10}], "eventos": [{"valor": 10}], "qualidade": {"estado": "aguardando-conferencia"}}
        P.sem_trilha(reg)
        self.assertNotIn("eventos", reg)
        self.assertEqual(reg["qualidade"], {"estado": "aguardando-conferencia", "trilha": "resumida"})
        self.assertEqual(reg["cells"], [{"code": "1", "value": 10}])


if __name__ == "__main__":
    unittest.main()
