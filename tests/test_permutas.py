import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from erp_permutas import separar
class Permutas(unittest.TestCase):
 def test_misto_e_estorno(self):
  t={'pagamentos':[{'data_pagamento':'2026-01-02','valor':30,'forma_pagamento':'Permuta'},{'data_pagamento':'2026-01-02','valor':70,'forma_pagamento':'Pix'},{'data_pagamento':'2026-01-03','valor':-10,'forma_pagamento':'Permuta'}]}
  p=separar([], [t], '2026-01-01','2026-01-31');self.assertTrue(p['conferido']);self.assertEqual(p['entradas'],20);self.assertEqual(p['totalEntradas'],90)
 def test_sem_forma_nao_e_zero_conferido(self):
  p=separar([],[{'valor_pagamento':10,'data_pagamento':'2026-01-02'}],'2026-01-01','2026-01-31');self.assertFalse(p['conferido'])
 def test_janela_e_ambos_lados(self):
  t={'forma_pagamento':'Permuta','pagamentos':[{'data_pagamento':'2026-01-02','valor':10},{'data_pagamento':'2025-12-31','valor':99}]}
  p=separar([t],[t],'2026-01-01','2026-01-31');self.assertEqual(p['entradas'],10);self.assertEqual(p['saidas'],10)
 def test_forma_pagamento_sobrepoe_titulo(self):
  p=separar([],[{'forma_pagamento':'Permuta','pagamentos':[{'forma_pagamento':'Pix','data_pagamento':'2026-01-02','valor':10}]}],'2026-01-01','2026-01-31');self.assertTrue(p['conferido']);self.assertEqual(p['entradas'],0)
 def test_misto_fica_pendente(self):
  p=separar([],[{'forma_pagamento':'Dinheiro e permuta','valor_pagamento':100,'data_pagamento':'2026-01-02'}],'2026-01-01','2026-01-31');self.assertFalse(p['conferido']);self.assertEqual(p['mistosEntradas'],100);self.assertEqual(p['entradas'],0)
 def test_mistos_nao_ficam_conferidos_so_por_somar_zero(self):
  t={'forma_pagamento':'Dinheiro e permuta','pagamentos':[{'data_pagamento':'2026-01-02','valor':100},{'data_pagamento':'2026-01-03','valor':-100}]}
  p=separar([],[t],'2026-01-01','2026-01-31');self.assertFalse(p['conferido']);self.assertEqual(p['mistosQuantidade'],2)
