import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import erp_mes, erp_previa as p

class TrilhaTest(unittest.TestCase):
    def titulo(self,ident,valor,conta='2.1.3 - Energia',empresa='Empresa teste'):
        return {'id':ident,'empresa':empresa,'plano_contas':conta,'pagamentos':[{'id':'p'+str(ident),'data_pagamento':'2026-09-03','valor':valor}]}
    def registro(self,receber,pagar):
        r,_,_=erp_mes.montar('Set/2026',receber,pagar,{},lambda t:p.valor_na_janela(t,'2026-09-01','2026-09-30'),p.codigo)
        r['eventos']=p.eventos_financeiros(receber,'entrada','2026-09-01','2026-09-30')+p.eventos_financeiros(pagar,'saida','2026-09-01','2026-09-30')
        p.aplicar_trilha(r,'2026-09-01','2026-09-30','2026-10-08T15:00:00Z')
        return r
    def test_classificacao_real_e_totais_preservados(self):
        r=self.registro([], [self.titulo(1,100,'2.11 - Pro-labore diretoria')])
        e=r['eventos'][0]
        self.assertEqual(e['contaGerencial'],'2.14')
        self.assertEqual(e['contaOrigem'],'2.11')
        self.assertEqual(next(c['value'] for c in r['cells'] if c['code']=='2'),100)
        self.assertNotIn('titulos',r['trilhaClassificacao'])
    def test_operacional_nao_vincula_a_produto_por_semelhanca(self):
        t=self.titulo(1,50,'1.1 - Vendas');t['tipo']='Receita operacional'
        self.assertNotIn('contaGerencial',self.registro([t],[])['eventos'][0])
    def test_identidade_ambigua_nao_vincula(self):
        t=self.titulo(1,50)
        self.assertTrue(all('contaGerencial' not in e for e in self.registro([],[t,t])['eventos']))
    def test_mesmo_id_em_empresas_diferentes(self):
        r=self.registro([],[self.titulo(1,50),self.titulo(1,60,empresa='Outra')])
        self.assertTrue(all('contaGerencial' in e for e in r['eventos']))
    def test_valor_inconsistente_nao_vincula(self):
        r={'trilhaClassificacao':{'versao':'caixa-trilha-1','titulos':[{'natureza':'saida','empresa':'A','tituloId':'1','valor':100,'contaGerencial':'2.5'}]},'eventos':[{'natureza':'saida','empresa':'A','tituloId':'1','valor':99}]}
        p.aplicar_trilha(r,'2026-09-01','2026-09-30','2026-10-08T15:00:00Z')
        self.assertNotIn('contaGerencial',r['eventos'][0])
