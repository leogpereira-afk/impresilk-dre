import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import erp_mes,erp_os
class ProdutosAprovados(unittest.TestCase):
 def test_aprovacao_move_apenas_sem_categoria_preservando_identidades(self):
  anterior={'Produto antigo*':'1.1.1.51','Produto novo':'1.1.99.51','Sem decisao':'1.1.99.52'}
  atual=erp_mes.codigos_estaveis({'Produto novo':10,'Sem decisao':20},anterior,{'Produto novo':'1.1.1.4'})
  self.assertNotEqual(atual['Produto novo'],anterior['Produto novo']);self.assertTrue(atual['Produto novo'].startswith('1.1.1.'))
  self.assertEqual(atual['Produto antigo*'],anterior['Produto antigo*']);self.assertEqual(atual['Sem decisao'],anterior['Sem decisao']);self.assertEqual(anterior['Produto novo'],'1.1.99.51')
 def test_rateio_respeita_mapa_privado_aprovado(self):
  contas,sem=erp_os.por_conta({'Produto novo':10},{'Produto novo':'1.1.1.4'})
  self.assertEqual(contas,{'1.1.1.4':10});self.assertFalse(sem)
