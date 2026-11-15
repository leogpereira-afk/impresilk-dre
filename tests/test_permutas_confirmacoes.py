import unittest,sys,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from erp_permutas import separar
from erp_permutas_detalhes import detalhar
class Confirmacoes(unittest.TestCase):
 def base(self):return {'plano_contas':'2.1 - Exemplo','pagamentos':[{'data_pagamento':'2000-01-02','valor':10}]}
 def regra(self):return {'data':'2000-01-02','lado':'saida','valor':10,'conta':'2.1','formaOriginal':'Ausente'}
 def test_confirma_sem_mudar_valor_ou_origem(self):
  t=self.base();old=copy.deepcopy(t);p=separar([t],[],'2000-01-01','2000-01-31',[self.regra()]);self.assertEqual(t,old);self.assertTrue(p['conferido']);self.assertEqual(p['naoIdentificados'],0);self.assertEqual(p['totalSaidas'],10);self.assertEqual(p['saidas'],0);self.assertEqual(len(p['confirmacoesDinheiro']),1)
 def test_ambiguo_nao_aplica(self):
  p=separar([self.base(),self.base()],[],'2000-01-01','2000-01-31',[self.regra()]);self.assertEqual(p['naoIdentificados'],2);self.assertFalse(p['conferido'])
 def test_misto_confirmado_nao_aparece_como_permuta(self):
  t=self.base();t['forma_pagamento']='Dinheiro e permuta';t['origem']='Contraparte exemplo';r=self.regra();r.update(formaOriginal='Dinheiro e permuta',contraparte='Contraparte exemplo')
  p=detalhar([t],[],'2000-01-01','2000-01-31',[r]);self.assertEqual(p['itens'],[]);self.assertEqual(p['mistosSaidas'],0);self.assertEqual(p['totalSaidas'],10);self.assertTrue(p['conferido']);self.assertEqual(len(p['confirmacoesDinheiro']),1)
 def test_valor_ou_contraparte_diferente_nao_aplica(self):
  r=self.regra();r['valor']=11;p=separar([self.base()],[],'2000-01-01','2000-01-31',[r]);self.assertEqual(p['naoIdentificados'],1)
