"""Diagnóstico da coleta: respostas simuladas, sem ERP, rede ou dados reais."""
import datetime
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import erp_previa as previa


class DiagnosticoColetaTest(unittest.TestCase):
    def test_http_502_nao_e_rotulado_como_timeout_e_janela_minima_aborta(self):
        chamadas, out = [], io.StringIO()

        def api(fn, payload):
            chamadas.append((payload["datainicial"], payload["datafinal"]))
            return {"ok": True, "parcial": True, "itens": [],
                    "diagnostico": {"motivo": "http", "http": 502}}

        with patch.object(previa, "call", side_effect=api), patch.object(previa.time, "sleep"), redirect_stdout(out):
            with self.assertRaisesRegex(RuntimeError, "Coleta incompleta; última versão preservada"):
                previa.coletar("contas-pagar", datetime.date(2026, 9, 1), datetime.date(2026, 9, 7))
        self.assertEqual(chamadas, [("2026-09-01", fim) for fim in ["2026-09-07", "2026-09-04", "2026-09-02", "2026-09-01"] for _ in range(3)])
        self.assertIn("contas-pagar", out.getvalue())
        self.assertIn("HTTP 502", out.getvalue())
        self.assertIn("tentativa 3/3", out.getvalue())
        self.assertIn("janela mínima", out.getvalue())
        self.assertNotIn("estourou o tempo", out.getvalue())

    def test_diagnostico_nao_imprime_corpo_itens_ou_texto_arbitrario(self):
        segredo = "DADO_SINTETICO_NAO_PUBLICAR"
        resposta = {"ok": True, "parcial": True,
                    "itens": [{"id": segredo, "valor": 12345}], "erro": segredo,
                    "diagnostico": {"motivo": segredo, "http": segredo, "detalhe": segredo}}
        out = io.StringIO()
        with patch.object(previa, "call", return_value=resposta), patch.object(previa.time, "sleep"), redirect_stdout(out):
            with self.assertRaises(RuntimeError):
                previa.coletar("contas-pagar", datetime.date(2026, 9, 1), datetime.date(2026, 9, 1))
        self.assertNotIn(segredo, out.getvalue())
        self.assertNotIn("12345", out.getvalue())
        self.assertIn("motivo não informado", out.getvalue())

    def test_resposta_fora_do_contrato_aborta_sem_erro_de_atributo(self):
        for resposta in [None, [], "conteúdo arbitrário"]:
            with self.subTest(resposta=resposta), patch.object(previa, "call", return_value=resposta), patch.object(previa.time, "sleep"), patch("builtins.print"):
                with self.assertRaisesRegex(RuntimeError, "Coleta incompleta; última versão preservada"):
                    previa.coletar("contas-pagar", datetime.date(2026, 9, 1), datetime.date(2026, 9, 1))

    def test_incompleta_na_primeira_coleta_nao_grava_nem_le_recebimentos(self):
        chamadas = []

        def api(fn, payload, *args, **kwargs):
            chamadas.append(payload)
            if payload["action"] == "getCfg":
                return {"ok": True, "cfg": {"regras": {"classificacaoPrivada": {"versao": 1}}}}
            self.assertEqual(payload.get("recurso"), "contas-pagar")
            self.assertEqual(payload["action"], "listar")
            return {"ok": True, "parcial": True, "itens": [], "diagnostico": {"motivo": "tempo-ou-rede"}}

        with patch.object(previa, "call", side_effect=api), patch.object(previa.time, "sleep"), patch("builtins.print"), patch.dict(previa.os.environ, {"DRE_PUBLISH": "1"}):
            with self.assertRaises(RuntimeError):
                previa.processar(datetime.date(2026, 9, 1), meses_servidor=[])
        self.assertNotIn("upsert", [x["action"] for x in chamadas])
        self.assertNotIn("setCfg", [x["action"] for x in chamadas])

    def test_metadado_http_do_gateway_permanece_distinto_de_timeout_de_rede(self):
        import urllib.error
        erro = urllib.error.HTTPError("https://exemplo.invalid", 502, "gateway", {}, io.BytesIO(b"{}"))
        with patch.object(previa, "TOKEN", "fixture"), patch.object(previa.urllib.request, "urlopen", side_effect=erro), patch.object(previa.time, "sleep"):
            with self.assertRaises(previa.JanelaGrande) as falha:
                previa.call("dre-financas", {})
        self.assertEqual(falha.exception.http, 502)


if __name__ == "__main__":
    unittest.main()
