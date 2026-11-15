import datetime,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import erp_previa as p
class RateLimitTest(unittest.TestCase):
 def test_backoff_429_preserva_janela(self):
  respostas=[{'ok':True,'parcial':True,'diagnostico':{'motivo':'http','http':429}}]*2+[{'ok':True,'itens':[]}]
  with patch.object(p,'call',side_effect=respostas) as call,patch.object(p.time,'sleep') as sleep:
   p.coletar('contas-pagar',datetime.date(2026,1,1),datetime.date(2026,1,1))
  self.assertEqual(call.call_count,3);self.assertEqual([x.args[0] for x in sleep.call_args_list][:2],[60,120])

 def test_404_intercalado_com_429_exige_tres_novas_confirmacoes(self):
  respostas=[{'ok':True,'parcial':True,'diagnostico':{'motivo':'http','http':s}} for s in [404,429,404,404,404]]
  with patch.object(p,'call',side_effect=respostas) as chamada,patch.object(p.time,'sleep'):
   p.coletar('contas-pagar',datetime.date(2026,1,1),datetime.date(2026,1,1))
  self.assertEqual(chamada.call_count,5)
