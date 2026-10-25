import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import erp_mes,erp_previa
class AlertaProdutoTest(unittest.TestCase):
    def montar(self,codigo):
        return erp_mes.montar('Out/2026',[{'tipo':'Receita operacional','valor':40}],[],{'Produto conhecido':40},lambda t:t['valor'],erp_previa.codigo,{'Produto conhecido':codigo},{})[0]
    def test_conta_propria_preservada_sem_alerta_falso(self):
        r=self.montar('1.1.1.88')
        self.assertFalse(any(p['tipo']=='produto-sem-categoria' for p in r['pendencias']))
        self.assertEqual(next(c['value'] for c in r['cells'] if c['code']=='1.1.1.88'),40)
    def test_conta_pendente_nao_e_aprovada_por_existir(self):
        self.assertTrue(any(p['tipo']=='produto-sem-categoria' for p in self.montar('1.1.99.88')['pendencias']))
