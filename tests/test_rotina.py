import os, sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
try:
    import erp_rotina as rotina
except ImportError:
    rotina = None

class AgendamentoTest(unittest.TestCase):
    def run_flow(self, claim, fail=False, publish='1'):
        self.assertIsNotNone(rotina, 'A rotina precisa atender o pedido feito pelo botão')
        calls=[]
        def api(fn, payload, *a, **kw):
            calls.append(payload)
            if payload['action']=='coletaIniciar': return claim
            return {'ok':True}
        def collect(on_month=None):
            if on_month: on_month({'label':'Ago/2026','estado':'gravado'})
            if fail: raise RuntimeError('Falha sintética da origem')
            if on_month: on_month({'label':'Set/2026','estado':'vazio'})
        with patch.object(rotina.previa,'call',side_effect=api),patch.object(rotina.previa,'main',side_effect=collect),patch.dict(os.environ,{'GITHUB_RUN_ID':'123','GITHUB_EVENT_NAME':'schedule','DRE_PUBLISH':publish}),patch('builtins.print'):
            error=None
            try: rotina.main()
            except RuntimeError as e: error=e
        return calls,error
    def test_sem_pedido_nem_janela_nao_coleta_novamente(self):
        calls,error=self.run_flow({'ok':True,'executar':False})
        self.assertIsNone(error);self.assertEqual(len(calls),1)
    def test_pedido_coleta_e_confirma_resultado_dos_meses(self):
        calls,error=self.run_flow({'ok':True,'executar':True})
        self.assertIsNone(error);self.assertEqual(calls[-1]['action'],'coletaConcluir')
        self.assertTrue(calls[-1]['ok']);self.assertEqual([m['estado'] for m in calls[-1]['meses']],['gravado','vazio'])
    def test_falha_mostra_mes_ja_gravado_sem_fingir_conclusao_total(self):
        calls,error=self.run_flow({'ok':True,'executar':True},fail=True)
        self.assertIsNotNone(error);self.assertFalse(calls[-1]['ok'])
        self.assertEqual(calls[-1]['meses'],[{'label':'Ago/2026','estado':'gravado'}])
        self.assertNotIn('Falha sintética',str(calls[-1]))
    def test_simulacao_nao_ativa_nem_muda_fila(self):
        calls,error=self.run_flow({},publish='0');self.assertEqual(calls,[]);self.assertIsNone(error)
