"""Arquivo das importações do Painel (Fase 9.3) na rotina de coleta: roda a cada
passagem, nunca derruba a coleta e só escreve contagens no log (que é público)."""
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
os.environ.setdefault("DRE_MACHINE_TOKEN", "fixture-only")
import erp_rotina as R


class ArquivoIntel(unittest.TestCase):
    def test_conta_e_nao_mostra_valores(self):
        resp = {"ok": True, "arquivos": [{"chave": "intel_nfe", "id": "intel_nfe:2026-09-01:2026-09-30", "estado": "gravado"},
                                         {"chave": "intel_compras", "estado": "incompleto"}, {"chave": "intel_detalhes", "estado": "igual"}]}
        out = io.StringIO()
        with patch.object(R.previa, "call", return_value=resp) as call, redirect_stdout(out):
            self.assertEqual(R.arquivar_intel(), ["gravado", "incompleto", "igual"])
        self.assertEqual(call.call_args[0][:2], ("dre-sync", {"action": "intelArquivar"}))
        self.assertEqual(out.getvalue().strip(), "Arquivo do Painel: 1 recorte(s) novo(s), 1 já guardado(s), 1 incompleto(s).")
        self.assertNotIn("2026-09", out.getvalue(), "nem o período vai para o log")

    def test_falha_nao_derruba(self):
        for efeito in (RuntimeError("servidor fora"), None):
            out = io.StringIO()
            kw = {"side_effect": efeito} if efeito else {"return_value": {"erro": "Ação desconhecida"}}
            with patch.object(R.previa, "call", **kw), redirect_stdout(out):
                self.assertIsNone(R.arquivar_intel())
            self.assertIn("tenta de novo na próxima passagem", out.getvalue())

    def test_roda_a_cada_passagem_mesmo_sem_coleta(self):
        chamadas = []
        def call(fn, payload, **kw):
            chamadas.append(payload["action"])
            return {"ok": True, "executar": False} if payload["action"] == "coletaIniciar" else {"ok": True, "arquivos": []}
        with patch.dict(os.environ, {"DRE_PUBLISH": "1", "GITHUB_RUN_ID": "123"}), patch.object(R.previa, "call", side_effect=call), redirect_stdout(io.StringIO()):
            R.main()
        self.assertEqual(chamadas, ["coletaIniciar", "intelArquivar"])


if __name__ == "__main__":
    unittest.main()
