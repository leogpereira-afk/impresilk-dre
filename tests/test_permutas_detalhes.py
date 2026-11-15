import sys,unittest,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from erp_permutas_detalhes import detalhar
class Detalhes(unittest.TestCase):
 def test_puras_mistas_dinheiro_e_janela(self):
  ts=[{'origem':'Contraparte exemplo','forma_pagamento':'Permuta','pagamentos':[{'data_pagamento':'2000-01-02','valor':10},{'data_pagamento':'2000-02-02','valor':99}]},{'origem':'Outra exemplo','forma_pagamento':'Dinheiro e permuta','pagamentos':[{'data_pagamento':'2000-01-03','valor':20}]},{'forma_pagamento':'Dinheiro','pagamentos':[{'data_pagamento':'2000-01-04','valor':30}]}]
  before=copy.deepcopy(ts);r=detalhar([],ts,'2000-01-01','2000-01-31')
  self.assertEqual(ts,before);self.assertEqual(len(r['itens']),2);self.assertEqual(r['entradas'],10);self.assertEqual(r['mistosEntradas'],20);self.assertEqual(r['totalEntradas'],60);self.assertFalse(r['conferido']);self.assertEqual(r['itens'][0]['contraparte'],'Contraparte exemplo')
 def test_forma_baixa_e_fornecedor(self):
  r=detalhar([{'origem':'Fornecedor exemplo','forma_pagamento':'Dinheiro','pagamentos':[{'data_pagamento':'2000-01-02','valor':5,'forma_pagamento':'Permuta'}]}],[],'2000-01-01','2000-01-31')
  self.assertEqual(r['saidas'],5);self.assertEqual(r['itens'][0]['lado'],'saida');self.assertTrue(r['conferido'])
