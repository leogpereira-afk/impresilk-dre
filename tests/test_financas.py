# Dados de teste sintéticos, sem valores de clientes ou da operação real.
import datetime
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import erp_previa as previa
import erp_os
import erp_mes

class CaixaTest(unittest.TestCase):
    def test_pagamento_fora_do_mes_nao_vira_valor_integral(self):
        t = {'valor_titulo':100,'pagamentos':[{'data_pagamento':'2026-07-30','valor':100}]}
        self.assertEqual(previa.valor_na_janela(t,'2026-08-01','2026-08-31'),0)
    def test_estorno_que_zera_o_mes_permanece_zero(self):
        t = {'valor_titulo':100,'pagamentos':[{'data_pagamento':'2026-08-03','valor':100},{'data_pagamento':'2026-08-04','valor':-100}]}
        self.assertEqual(previa.valor_na_janela(t,'2026-08-01','2026-08-31'),0)
    def test_fallback_exige_data_no_periodo(self):
        self.assertEqual(previa.valor_na_janela({'valor_pagamento':100,'data_pagamento':'2026-07-31'},'2026-08-01','2026-08-31'),0)
    def test_parcelas_somente_do_periodo(self):
        t = {'valor_titulo':100,'pagamentos':[{'data_pagamento':'2026-07-31','valor':60},{'data_pagamento':'2026-08-01','valor':40}]}
        self.assertEqual(previa.valor_na_janela(t,'2026-08-01','2026-08-31'),40)
    def test_rateio_fecha_centavos(self):
        por,diag=erp_os.ratear([{'despesa':'123','valor':100}],{'123':{'itens':[{'item':n,'valor_final':1} for n in ['A','B','C']]}},lambda t:t['valor'])
        self.assertEqual(por,{'A':33.34,'B':33.33,'C':33.33})
    def test_estorno_rateado_conserva_centavos(self):
        por,_=erp_os.ratear([{'despesa':'123','valor':-100}],{'123':{'itens':[{'item':n,'valor_final':1} for n in ['A','B','C']]}},lambda t:t['valor'])
        self.assertEqual(sum(round(v*100) for v in por.values()),-10000)
    def test_duas_os_uma_ausente_nao_recebe_rateio_total(self):
        por,diag=erp_os.ratear([{'despesa':'123-456','valor':1000}],{'123':{'itens':[{'item':'A','valor_final':500}]}},lambda t:t['valor'])
        self.assertEqual(por,{})
        self.assertEqual(diag['valorSemOS'],1000)
    def test_recebimento_sem_os_preservado_no_total(self):
        r,_,_=erp_mes.montar('Ago/2026',[{'tipo':'Receita operacional','valor':100}],[],{},lambda t:t['valor'],previa.codigo)
        self.assertEqual({c['code']:c['value'] for c in r['cells']}.get('1',0),100)
    def test_recebimento_sem_conta_preservado(self):
        r,_,_=erp_mes.montar('Ago/2026',[{'tipo':'Outra','valor':75}],[],{},lambda t:t['valor'],previa.codigo)
        self.assertEqual({c['code']:c['value'] for c in r['cells']}.get('1.7',0),75)
    def test_produto_desconhecido_vira_pendencia(self):
        r,_,_=erp_mes.montar('Ago/2026',[{'tipo':'Receita operacional','valor':40}],[],{'Novo produto':40},lambda t:t['valor'],previa.codigo)
        self.assertTrue(any(p['tipo']=='produto-sem-categoria' for p in r['pendencias']))
    def test_resposta_parcial_nao_e_promovida(self):
        with patch.object(previa,'call',return_value={'ok':True,'parcial':True,'itens':[]}),patch.object(previa.time,'sleep'):
            with self.assertRaises(RuntimeError):
                previa.coletar('contas-pagar',datetime.date(2026,8,1),datetime.date(2026,8,1))
    def test_falha_explicita_nao_vira_mes_vazio(self):
        with patch.object(previa,'call',return_value={'ok':False,'erro':'falha','itens':[]}),patch.object(previa.time,'sleep'):
            with self.assertRaises(RuntimeError):
                previa.coletar('contas-pagar',datetime.date(2026,8,1),datetime.date(2026,8,1))

if __name__=='__main__': unittest.main()

class RotinaTest(unittest.TestCase):
    def test_resposta_parcial_transitoria_repete_antes_de_dividir_janela(self):
        respostas=[{'ok':True,'parcial':True,'diagnostico':{'motivo':'http','http':404},'itens':[]},
                   {'ok':True,'parcial':False,'itens':[{'id':7}]}]
        with patch.object(previa,'call',side_effect=respostas),patch.object(previa.time,'sleep'),patch('builtins.print'):
            self.assertEqual(previa.coletar('contas-pagar',datetime.date(2026,9,1),datetime.date(2026,9,1)),[{'id':7}])
    def test_mes_atual_consulta_somente_ate_hoje(self):
        self.assertEqual(previa.fim_consulta(datetime.date(2026,9,1),datetime.date(2026,9,30),datetime.date(2026,9,12)),datetime.date(2026,9,12))
        self.assertEqual(previa.fim_consulta(datetime.date(2026,8,1),datetime.date(2026,8,31),datetime.date(2026,9,12)),datetime.date(2026,8,31))
    def test_fluxo_do_mes_atual_entrega_hoje_ao_conector(self):
        class Hoje(datetime.date):
            @classmethod
            def today(cls): return cls(2026,9,12)
        class Interromper(Exception): pass
        with patch.object(previa.datetime,'date',Hoje),patch.object(previa,'call',return_value={'ok':True,'cfg':{'regras':{'classificacaoPrivada':{'versao':1}}}}),patch.object(previa,'coletar',side_effect=Interromper) as coletar,patch('builtins.print'):
            with self.assertRaises(Interromper): previa.processar(Hoje(2026,9,1))
        self.assertEqual(coletar.call_args.args[2],Hoje(2026,9,12))
    def test_timeout_em_resposta_parcial_divide_janela_sem_perder_titulos(self):
        calls=[]
        def api(fn,payload):
            calls.append((payload['datainicial'],payload['datafinal']))
            if payload['datainicial'] != payload['datafinal']:
                return {'ok':True,'parcial':True,'diagnostico':{'motivo':'tempo-ou-rede'},'itens':[]}
            return {'ok':True,'itens':[{'id':payload['datainicial']}]}
        with patch.object(previa,'call',side_effect=api),patch.object(previa.time,'sleep'),patch('builtins.print'):
            r=previa.coletar('contas-pagar',datetime.date(2026,8,1),datetime.date(2026,8,2))
        self.assertEqual([t['id'] for t in r],['2026-08-01','2026-08-02'])
        self.assertEqual(calls,[('2026-08-01','2026-08-02')]*3+
                               [('2026-08-01','2026-08-01'),('2026-08-02','2026-08-02')])
    def test_sem_regras_privadas_interrompe_antes_de_consultar_erp(self):
        with patch.object(previa,'call',return_value={'ok':True,'cfg':{}}),patch.object(previa,'coletar') as collect,patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError,'Configuração privada'):
                previa.processar(datetime.date(2026,8,1))
            collect.assert_not_called()
    def test_rotina_revisa_mes_anterior_apos_dia_sete(self):
        class Hoje(datetime.date):
            @classmethod
            def today(cls):return cls(2026,9,9)
        with patch.object(previa.datetime,'date',Hoje),patch.object(sys,'argv',['erp_previa.py']),patch.object(previa,'processar') as proc:
            previa.main()
            self.assertEqual([c.args[0].isoformat() for c in proc.call_args_list],['2026-08-01','2026-09-01'])
    def test_produto_novo_nao_e_classificado_como_produto_conhecido(self):
        self.assertEqual(erp_mes.galho_do_produto('Novo',{}),'1.1.99')

class CacheTest(unittest.TestCase):
    def test_os_em_producao_recem_lida_participa_do_rateio(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d,patch.object(previa,'CACHE_OS',Path(d)/'os.json'),patch.object(previa,'call',return_value={'ok':True,'itens':[{'status':'Produção','itens':[{'item':'A','valor_final':100}]}]}),patch.object(previa.time,'sleep'):
            cache=previa.buscar_os([{'despesa':'123'}])
            self.assertIn('123',cache)
    def test_os_entregue_antiga_precisa_ser_revalidada(self):
        import tempfile,json
        with tempfile.TemporaryDirectory() as d:
            arq=Path(d)/'os.json';arq.write_text(json.dumps({'123':{'status':'Entregue','itens':[{'item':'A','valor_final':100}]}}))
            with patch.object(previa,'CACHE_OS',arq),patch.object(previa,'call',return_value={'ok':True,'itens':[{'status':'Entregue','itens':[{'item':'A','valor_final':80}]}]}),patch.object(previa.time,'sleep'):
                cache=previa.buscar_os([{'despesa':'123'}])
                self.assertEqual(cache['123']['itens'][0]['valor_final'],80)

class DadosInvalidosTest(unittest.TestCase):
    def test_baixa_sem_data_nao_vira_zero(self):
        with self.assertRaises(ValueError):previa.valor_na_janela({'valor_pagamento':100},'2026-08-01','2026-08-31')
    def test_pagamento_sem_valor_nao_vira_zero(self):
        with self.assertRaises(ValueError):previa.valor_na_janela({'pagamentos':[{'data_pagamento':'2026-08-01'}]},'2026-08-01','2026-08-31')
    def test_titulo_mudando_durante_coleta_nao_e_promovido(self):
        responses=[{'ok':True,'itens':[{'id':1,'valor_pagamento':100}]},{'ok':True,'itens':[{'id':1,'valor_pagamento':200}]}]
        with patch.object(previa,'call',side_effect=responses),patch.object(previa.time,'sleep'):
            with self.assertRaises(RuntimeError):previa.coletar('contas-pagar',datetime.date(2026,8,1),datetime.date(2026,8,10))

class EventosTest(unittest.TestCase):
    def test_eventos_preservam_empresa_data_e_soma_sem_dados_pessoais(self):
        t={'id':10,'empresa':'A','compoe_dre':'Sim','despesa':'123','cliente':'NÃO COPIAR','pagamentos':[{'id':1,'data_pagamento':'2026-08-01','valor':40},{'id':2,'data_pagamento':'2026-08-09','valor':-10},{'id':3,'data_pagamento':'2026-07-01','valor':70}]}
        out=previa.eventos_financeiros([t],'entrada','2026-08-01','2026-08-31')
        self.assertEqual(sum(e['valor'] for e in out),30)
        self.assertEqual(len(out),2)
        self.assertEqual(out[0]['empresa'],'A')
        self.assertEqual(out[0]['tituloId'],'10')
        self.assertNotIn('cliente',out[0])

class PromocaoTest(unittest.TestCase):
    def run_pipeline(self, origem=None, publish='1'):
        calls=[]
        def api(fn,payload,*a,**kw):
            calls.append(payload)
            if payload['action']=='getCfg':return {'ok':True,'cfg':{'regras':{'classificacaoPrivada':{'versao':1,'renomes':{},'alertas':[]}}}}
            if payload['action']=='list':return {'ok':True,'itens':([{'id':'Ago_2026','label':'Ago/2026','origem':origem,'cells':[],'atualizadoEm':'2026-08-10'}] if origem else [])}
            if payload['action']=='upsert':return {'ok':True,'registro':payload['registro']}
            raise AssertionError('Ação não prevista: '+payload['action'])
        def collect(resource,*a):return [{'id':1,'empresa':'Teste','compoe_dre':'Sim','tipo':'Outra','plano_contas':'1.4 - Emprestimo' if resource=='contas-receber' else '2.3 - Materiais','valor_pagamento':100 if resource=='contas-receber' else 40,'data_pagamento':'2026-08-04'}]
        with patch.object(previa,'call',side_effect=api),patch.object(previa,'coletar',side_effect=collect),patch.object(previa,'buscar_os',return_value={}),patch.object(sys,'argv',['erp_previa.py']),patch.dict(previa.os.environ,{'DRE_PUBLISH':publish}),patch('builtins.print'):
            previa.processar(datetime.date(2026,8,1))
        return calls
    def test_mes_e_regras_sao_promovidos_juntos_sem_substituir_cfg(self):
        calls=self.run_pipeline();self.assertNotIn('setCfg',[c['action'] for c in calls]);record=next(c['registro'] for c in calls if c['action']=='upsert')
        self.assertEqual(record['previaERP']['totais'],{'receita':100,'despesa':40})
        self.assertIn('mapeamento',record);self.assertEqual(len(record['eventos']),2)
    def test_planilha_permanece_protegida(self):self.assertNotIn('upsert',[c['action'] for c in self.run_pipeline('planilha')])
    def test_simulacao_nao_grava_mes(self):self.assertNotIn('upsert',[c['action'] for c in self.run_pipeline(publish='0')])

class RegrasPrivadasTest(unittest.TestCase):
    def test_alerta_configurado_no_servidor_preserva_regra_sem_nome_no_codigo(self):
        regras={'versao':1,'renomes':{},'alertas':[{'contem':'ITEM SINTETICO','prefixo':'2.14.2','tipo':'fixture','texto':'Rever classificação da fixture'}]}
        pagar=[{'descricao':'Item sintetico','plano_contas':'2.11.2 - Categoria sintética','valor_pagamento':100}]
        out=erp_mes.pendencias_de_classificacao(pagar,[],lambda t:100,regras)
        self.assertTrue(any(p['tipo']=='fixture' and p['valor']==100 for p in out))
    def test_renome_privado_e_aceito_sem_mudar_o_codigo_da_conta(self):
        self.assertTrue(erp_mes._renome_conhecido('2.14.1.1','Nome sintético',{'renomes':{'2.14.1.1':['Nome sintético']}}))


class ContaRenomeadaTest(unittest.TestCase):
    """Conta renomeada ou grupo novo no ERP (revisão de 25/09/2026)."""
    montar = staticmethod(lambda pagar, nomes: erp_mes.montar('Ago/2026', [], pagar, {}, lambda t: t['valor'], previa.codigo, nomes_conhecidos=nomes))

    def celulas(self, r):
        return {c['code']: c['value'] for c in r['cells']}

    def test_socios_renomeado_continua_em_socios_e_vira_pendencia(self):
        r, _, reman = self.montar([{'plano_contas': '2.11 - Pro-labore diretoria', 'valor': 1000}], {'2': 'Despesas', '2.14': 'Retirada de sócios'})
        cel = self.celulas(r)
        novo = next(c for c in cel if c.startswith('2.14.') and c != '2.14')
        self.assertEqual(cel['2.14'], 1000)
        self.assertEqual(erp_mes.natureza(novo), 'sócios')
        self.assertNotIn('2.51', cel)
        pend = [p for p in r['pendencias'] if p['tipo'] == 'conta-renomeada-no-erp']
        self.assertEqual([(p['conta'], p['valor']) for p in pend], [(novo, 1000)])
        self.assertIn('Retirada de sócios', pend[0]['texto'])

    def test_divida_e_investimento_renomeados_nao_viram_pagamento_operacional(self):
        for erp, canon, nat in (('2.17', '2.17', 'dívidas'), ('2.13.4', '2.16', 'investimentos')):
            r, _, _ = self.montar([{'plano_contas': f'{erp} - Nome novo qualquer', 'valor': 500}], {canon: 'Nome antigo diferente'})
            cel = self.celulas(r)
            self.assertEqual(cel[canon], 500, canon)
            self.assertTrue(any(c.startswith(canon + '.') for c in cel), canon)
            self.assertEqual(r['pendencias'][0]['texto'].count(nat), 1, canon)

    def test_renomeada_operacional_segue_como_antes_mas_avisa(self):
        r, _, _ = self.montar([{'plano_contas': '2.1.3 - Internet fibra', 'valor': 80}], {'2.1': 'Pessoal e estrutura', '2.1.3': 'Energia elétrica'})
        cel = self.celulas(r)
        self.assertIn('2.1.51', cel)
        self.assertEqual(r['pendencias'][0]['tipo'], 'conta-renomeada-no-erp')

    def test_mesmo_nome_nao_gera_pendencia(self):
        r, _, _ = self.montar([{'plano_contas': '2.1.3 - Energia elétrica', 'valor': 80}], {'2.1': 'Pessoal', '2.1.3': 'Energia elétrica'})
        self.assertEqual(r['pendencias'], [])

    def test_grupo_novo_no_erp_vira_pendencia_e_folha_nova_em_grupo_conhecido_nao(self):
        r, _, _ = self.montar([{'plano_contas': '2.20.1 - Consorcio', 'valor': 300}, {'plano_contas': '2.1.9 - Material novo', 'valor': 20}],
                              {'2.1': 'Pessoal', '2.1.3': 'Energia'})
        novos = [(p['conta'], p['valor']) for p in r['pendencias'] if p['tipo'] == 'conta-nova-no-erp']
        self.assertEqual(novos, [('2.20', 300)])

    def test_blocos_iguais_aos_do_painel(self):
        import re
        js = (Path(__file__).resolve().parents[1] / 'financeiro.js').read_text()
        i = js.find('function resumo(reg)')
        corpo = js[i:js.find('return Object.fromEntries', i)]
        codigos = set(re.findall(r"v\('([\d.]+)'\)", corpo)) - {'1', '2'}
        self.assertEqual(codigos, set(erp_mes.BLOCOS_CAIXA))


class ReleituraRetroativaTest(unittest.TestCase):
    """Baixa retroativa em mês antigo (revisão de 25/09/2026)."""
    agora = datetime.datetime(2026, 9, 25, 12, tzinfo=datetime.timezone.utc)

    def reg(self, label, dias, origem='erp'):
        ts = (self.agora - datetime.timedelta(days=dias)).isoformat()
        return {'label': label, 'origem': origem, 'qualidade': {'coletadoEm': ts}}

    def test_relê_so_meses_do_erp_parados_ha_uma_semana(self):
        corrente = datetime.date(2026, 9, 1)
        casos = [
            ([self.reg('Jun/2026', 8), self.reg('Jul/2026', 8)], ['2026-06-01', '2026-07-01']),
            ([self.reg('Jun/2026', 2), self.reg('Jul/2026', 8)], ['2026-07-01']),
            ([self.reg('Jun/2026', 30, 'planilha'), self.reg('Jul/2026', 3)], []),
            ([], []),
        ]
        for meses, esperado in casos:
            self.assertEqual([d.isoformat() for d in previa.retroativos(corrente, meses, self.agora)], esperado)

    def test_rotina_publicando_inclui_os_antigos_antes_do_mes_anterior(self):
        class Hoje(datetime.date):
            @classmethod
            def today(cls): return cls(2026, 9, 9)
        meses = [self.reg('Jun/2026', 10), self.reg('Jul/2026', 10)]
        with patch.object(previa.datetime, 'date', Hoje), patch.object(sys, 'argv', ['erp_previa.py']), \
             patch.dict(previa.os.environ, {'DRE_PUBLISH': '1'}), patch.object(previa, 'listar_meses', return_value=meses), \
             patch.object(previa, 'processar') as proc:
            previa.main()
        self.assertEqual([c.args[0].isoformat() for c in proc.call_args_list], ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'])

    def test_falha_na_lista_nao_impede_a_coleta_normal(self):
        class Hoje(datetime.date):
            @classmethod
            def today(cls): return cls(2026, 9, 9)
        with patch.object(previa.datetime, 'date', Hoje), patch.object(sys, 'argv', ['erp_previa.py']), \
             patch.dict(previa.os.environ, {'DRE_PUBLISH': '1'}), patch.object(previa, 'listar_meses', side_effect=RuntimeError('fora')), \
             patch.object(previa, 'processar') as proc:
            previa.main()
        self.assertEqual([c.args[0].isoformat() for c in proc.call_args_list], ['2026-08-01', '2026-09-01'])
