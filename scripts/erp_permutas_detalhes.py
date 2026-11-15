"""Detalhamento privado de permutas. Preserva valores e lançamentos da DRE."""
import datetime,copy,os,uuid
import erp_previa as E
from erp_permutas import forma,normal,separar

def contraparte(t,lado):
    for v in [t.get('cliente' if lado=='entrada' else 'fornecedor'),t.get('origem')]:
        if isinstance(v,dict):v=v.get('nome') or v.get('razao_social') or v.get('nome_fantasia')
        if isinstance(v,str) and v.strip():return v.strip()
    return 'Não informado pelo Mubisys'

def detalhar(pagar,receber,si,sf,confirmacoes=()):
    from erp_permutas_confirmacoes import aplicar
    pagar,receber,confirmadas=aplicar(pagar,receber,si,sf,confirmacoes)
    p=separar(pagar,receber,si,sf);itens=[]
    if confirmadas:
        p['confirmacoesDinheiro']=confirmadas
        p['fonte']+=' + confirmações do responsável'
    for ts,lado in [(receber,'entrada'),(pagar,'saida')]:
        for t in ts:
            for pg in t.get('pagamentos') or [{'data_pagamento':t.get('data_pagamento'),'data_credito':t.get('data_credito'),'valor':t.get('valor_pagamento')}]:
                d=str(pg.get('data_pagamento') or pg.get('data_credito') or '')[:10];f=forma(pg,t)
                if not si<=d<=sf or 'permuta' not in normal(f):continue
                v=E.valor_na_janela({'pagamentos':[pg]},si,sf)
                if not v:continue
                code,nome=E.codigo(t.get('plano_contas'))
                itens.append({'data':d,'lado':lado,'valor':v,'contraparte':contraparte(t,lado),'conta':code,'nomeConta':nome,'forma':f,'mista':normal(f)!='permuta'})
    p.update({'versaoDetalhes':1,'itens':itens});return p

def main():
    regras=E.call('dre-sync',{'action':'getCfg'}).get('cfg',{}).get('regras',{}).get('permutas',{}).get('confirmacoesDinheiro',[])
    rs=E.listar_meses();rs.sort(key=lambda r:(int(r['label'].split('/')[1]),E.PT.index(r['label'].split('/')[0])),reverse=True)
    for r in rs:
        if r.get('origem')!='erp' or r.get('permutasDetalhes',{}).get('versaoDetalhes')==1:continue
        m,y=r['label'].split('/');ini=datetime.date(int(y),E.PT.index(m)+1,1)
        if os.environ.get('DRE_MES') and ini.strftime('%Y-%m')!=os.environ['DRE_MES']:continue
        fim=min((ini+datetime.timedelta(days=32)).replace(day=1)-datetime.timedelta(days=1),datetime.date.today())
        pagar=E.coletar('contas-pagar',ini,fim);receber=E.coletar('contas-receber',ini,fim)
        pagar=[t for t in pagar if str(t.get('compoe_dre','')).lower()=='sim'];receber=[t for t in receber if str(t.get('compoe_dre','')).lower()=='sim']
        p=detalhar(pagar,receber,ini.isoformat(),fim.isoformat(),regras);cs={c['code']:c['value'] for c in r['cells']}
        p['totaisConferemDRE']=all(round(p[k]*100)==round(cs[c]*100) for k,c in [('totalEntradas','1'),('totalSaidas','2')])
        if os.environ.get('DRE_PUBLISH')!='1':print('Período consultado; nenhuma gravação.',flush=True);continue
        new=copy.deepcopy(r);new['permutasDetalhes']=p
        ans=E.call('dre-sync',{'action':'upsert','registro':new,'baseAtualizadoEm':r.get('atualizadoEm'),'operacaoId':'permutas-detalhes:'+str(uuid.uuid4())})
        if ans.get('ok') is not True:raise RuntimeError('Gravação não confirmada')
        print('Detalhamento privado disponível; valores originais preservados.',flush=True)
if __name__=='__main__':main()
