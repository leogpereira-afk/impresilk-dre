import sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import erp_previa as p
class RecuperacaoOS(unittest.TestCase):
 def test_retoma_mesma_os_apos_limite_sem_perder_recebimento(self):
  respostas=[{'ok':True,'parcial':True,'diagnostico':{'http':429}}, {'ok':True,'itens':[{'id':123,'itens':[{'item':'Teste','valor_final':10}]}]}]
  with tempfile.TemporaryDirectory() as d,patch.object(p,'CACHE_OS',Path(d)/'os.json'),patch.object(p,'call',side_effect=respostas) as c,patch.object(p.time,'sleep') as pausa:
   cache=p.buscar_os([{'despesa':'123'}]);self.assertIn('123',cache)
   self.assertEqual(c.call_count,2);self.assertTrue(any(x.args[0]>=60 for x in pausa.call_args_list))
 def test_ritmo_nao_ultrapassa_limite_de_conta(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'CACHE_OS',Path(d)/'os.json'),patch.object(p,'call',return_value={'ok':True,'itens':[{'id':123,'itens':[]}]}),patch.object(p.time,'sleep') as pausa:
   p.buscar_os([{'despesa':'123-124'}]);self.assertTrue(all(x.args[0]>=2.1 for x in pausa.call_args_list))
