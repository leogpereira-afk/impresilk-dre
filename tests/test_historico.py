"""Carga histórica (Fase 10.1): meses do intervalo, um por vez, sem parar na falha,
sem dado no log e sem a trilha por pagamento."""
import datetime as dt
import io
import os
import sys
import tempfile
import unittest
from unittest import mock
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
        def processar(ini, servidor=None):
            if ini.month == 2:
                raise RuntimeError("Título 123 do cliente Fulano não fecha")
            return {"label": ini.isoformat(), "estado": "preservado" if ini.month == 1 else "gravado"}
        saida = io.StringIO()
        with redirect_stdout(saida), self.assertRaisesRegex(SystemExit, "1 mês\\(es\\) falharam"):
            H.main(["2015-01", "2015-04"], processar=processar, listar=lambda: [])
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
        reg2 = {"eventos": [{"valor": 1}], "trilhaClassificacao": {"versao": 1, "movimentosVinculados": 5}}
        P.sem_trilha(reg2)
        self.assertEqual(reg2["trilhaClassificacao"]["movimentosVinculados"], 0, "sem trilha não diz que tem vínculos")

    def rodar(self, argv, processar, servidor=(), env=None, relogio=None):
        saida, chamados = io.StringIO(), []
        def proc(ini, srv=None):
            chamados.append(ini.isoformat()[:7])
            return processar(ini)
        with tempfile.TemporaryDirectory() as d, redirect_stdout(saida), mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": d + "/resumo.md", **(env or {})}):
            try:
                r = H.main(argv, processar=proc, listar=lambda: list(servidor), **({"relogio": relogio} if relogio else {}))
            except SystemExit as e:
                r = e
            quadro = Path(d, "resumo.md").read_text() if Path(d, "resumo.md").exists() else ""
        return r, chamados, saida.getvalue(), quadro

    def test_pula_planilha_e_mes_ja_trazido_sem_consultar_o_erp(self):
        servidor = [{"label": "Jan/2015", "origem": "planilha"}, {"label": "Fev/2015", "origem": "erp"}]
        r, chamados, log, quadro = self.rodar(["2015-01", "2015-03"], lambda ini: {"estado": "gravado"}, servidor)
        self.assertEqual(chamados, ["2015-03"], "só o mês que falta vai ao Mubisys")
        self.assertEqual(r, {"preservado": 1, "ja-carregado": 1, "gravado": 1})
        self.assertIn("| Jan/2015 | veio da planilha: preservado |", quadro)
        self.assertIn("| Fev/2015 | já estava no DRE: pulado |", quadro)

    def test_para_antes_do_limite_de_tempo_e_diz_de_onde_continuar(self):
        t = iter([0, 0, 10 * 60, 400 * 60])
        r, chamados, log, quadro = self.rodar(["2015-01", "2015-04"], lambda ini: {"estado": "gravado"}, env={"DRE_PUBLISH": "1", "DRE_HIST_LIMITE_MIN": "300"}, relogio=lambda: next(t))
        self.assertEqual(chamados, ["2015-01", "2015-02"])
        self.assertEqual(r, {"gravado": 2, "sem-tempo": 2})
        self.assertIn("Rode de novo de 2015-03 a 2015-04 (os meses já no DRE são pulados).", log)
        self.assertIn("| Mar/2015 | não começou: limite de tempo |", quadro)

    def test_tres_falhas_seguidas_param_a_carga(self):
        def falha(ini):
            raise RuntimeError("fora do ar")
        r, chamados, log, quadro = self.rodar(["2015-01", "2015-06"], falha)
        self.assertEqual(len(chamados), 3)
        self.assertIn("3 falhas seguidas", log)
        self.assertIsInstance(r, SystemExit)
        self.assertIn("interrompido: 3", log)

    def test_os_nao_lidas_vao_para_o_log_e_o_quadro_so_como_contagem(self):
        r, chamados, log, quadro = self.rodar(["2015-01", "2015-01"], lambda ini: {"estado": "gravado", "osFaltando": 4})
        self.assertIn("Jan/2015: 4 O.S. citada(s) não lida(s)", log)
        self.assertIn("| Jan/2015 | gravado | 4 |", quadro)

    def test_lista_do_servidor_que_falha_nao_consulta_o_mubisys(self):
        def quebra():
            raise RuntimeError("x")
        with self.assertRaisesRegex(SystemExit, "nada foi consultado"):
            H.main(["2015-01", "2015-02"], processar=lambda *a: self.fail("não devia consultar"), listar=quebra)

    def test_simulacao_diz_o_que_a_gravacao_faria(self):
        def api(fn, payload, *a, **kw):
            if payload["action"] == "getCfg":
                return {"ok": True, "cfg": {"regras": {"classificacaoPrivada": {"versao": 1, "renomes": {}, "alertas": []}}}}
            raise AssertionError("não devia chamar " + payload["action"])
        def collect(resource, *a):
            return [{"id": 1, "empresa": "T", "compoe_dre": "Sim", "tipo": "Outra", "plano_contas": "1.4 - X" if resource == "contas-receber" else "2.3 - Y", "valor_pagamento": 10, "data_pagamento": "2015-01-04"}]
        servidor = [{"id": "Jan_2015", "label": "Jan/2015", "origem": "planilha", "cells": [], "atualizadoEm": "2020-01-01"}]
        with mock.patch.object(P, "call", side_effect=api), mock.patch.object(P, "coletar", side_effect=collect), mock.patch.object(P, "buscar_os", return_value={}), \
                mock.patch.object(sys, "argv", ["x"]), mock.patch.dict(os.environ, {"DRE_PUBLISH": "0"}), redirect_stdout(io.StringIO()):
            self.assertEqual(P.processar(dt.date(2015, 1, 1), servidor)["estado"], "preservado")
            self.assertEqual(P.processar(dt.date(2015, 2, 1), servidor), {"label": "Fev/2015", "estado": "simulado", "osFaltando": 0})


if __name__ == "__main__":
    unittest.main()
