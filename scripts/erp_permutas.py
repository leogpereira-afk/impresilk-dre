"""Separa quitações em permuta sem refazer contas, valores ou classificações."""
import datetime,copy,os,uuid,json,unicodedata
import erp_previa as E

def forma(pg,titulo):
    v=pg.get('_forma_confirmada',pg.get('forma_pagamento'))
    if v is None:v=titulo.get('forma_pagamento')
    if isinstance(v,dict):v=v.get('nome') or v.get('descricao')
    return v.strip() if isinstance(v,str) and v.strip() else None

def normal(s):
    return unicodedata.normalize('NFD',str(s or '')).encode('ascii','ignore').decode().strip().casefold()

def separar(pagar,receber,ini,fim,confirmacoes=()):
    from erp_permutas_confirmacoes import aplicar
    pagar,receber,confirmadas=aplicar(pagar,receber,ini,fim,confirmacoes)
    p={'versao':2,'mistosEntradas':0,'mistosSaidas':0,'mistosQuantidade':0,'conferido':True,'fonte':'Mubisys · forma de pagamento Permuta','entradas':0,'saidas':0,'totalEntradas':0,'totalSaidas':0,'naoIdentificados':0,'coletadoEm':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    for itens,side,total in [(receber,'entradas','totalEntradas'),(pagar,'saidas','totalSaidas')]:
        for t in itens:
            p[total]+=round(E.valor_na_janela(t,ini,fim)*100)
            pgs=t.get('pagamentos') or [{'data_pagamento':t.get('data_pagamento'),'data_credito':t.get('data_credito'),'valor':t.get('valor_pagamento')}]
            for pg in pgs:
                data=str(pg.get('data_pagamento') or pg.get('data_credito') or '')[:10]
                if not ini<=data<=fim:continue
                v=round(E.valor_na_janela({'pagamentos':[pg]},ini,fim)*100)
                f=forma(pg,t)
                if normal(f)=='permuta':p[side]+=v
                elif f and 'permuta' in normal(f):
                    p['mistosEntradas' if side=='entradas' else 'mistosSaidas']+=v
                    p['mistosQuantidade']+=1
                elif f is None and v:p['naoIdentificados']+=1
    for k in ['entradas','saidas','totalEntradas','totalSaidas','mistosEntradas','mistosSaidas']:p[k]/=100
    p['conferido']=p['naoIdentificados']==0 and p['mistosQuantidade']==0
    if confirmadas:
        p['confirmacoesDinheiro']=confirmadas
        p['fonte']+=' + confirmações do responsável'
    return p

def main():
    regras=E.call('dre-sync',{'action':'getCfg'}).get('cfg',{}).get('regras',{}).get('permutas',{}).get('confirmacoesDinheiro',[])
    rs=E.listar_meses();rs.sort(key=lambda r: (int(r['label'].split('/')[1]),E.PT.index(r['label'].split('/')[0])),reverse=True)
    limit=os.environ.get('DRE_MES','');done=unknown=divergent=0
    for r in rs:
        if r.get('origem')!='erp':continue
        m,y=r['label'].split('/');ini=datetime.date(int(y),E.PT.index(m)+1,1)
        if limit and ini.strftime('%Y-%m')!=limit:continue
        if r.get('permutas',{}).get('versao')==2:continue
        fim=min((ini+datetime.timedelta(days=32)).replace(day=1)-datetime.timedelta(days=1),datetime.date.today())
        pagar=E.coletar('contas-pagar',ini,fim);receber=E.coletar('contas-receber',ini,fim)
        pagar=[t for t in pagar if str(t.get('compoe_dre','')).lower()=='sim'];receber=[t for t in receber if str(t.get('compoe_dre','')).lower()=='sim']
        p=separar(pagar,receber,ini.isoformat(),fim.isoformat(),regras);cells={c['code']:c['value'] for c in r['cells']}
        if any(round(p[k]*100)!=round(cells[c]*100) for k,c in [('totalEntradas','1'),('totalSaidas','2')]):
            divergent+=1;print(r['label']+': totais da origem mudaram; preservado.',flush=True);continue
        if not p['conferido']:unknown+=1
        if os.environ.get('DRE_PUBLISH')!='1':
            print(r['label']+': conferido em simulação; nada gravado.',flush=True);continue
        new=copy.deepcopy(r);new['permutas']=p
        ans=E.call('dre-sync',{'action':'upsert','registro':new,'baseAtualizadoEm':r.get('atualizadoEm'),'operacaoId':'permutas:'+str(uuid.uuid4())})
        if ans.get('ok') is not True:raise RuntimeError('Gravação não confirmada')
        done+=1;print(r['label']+(': separação conferida.' if p['conferido'] else ': parte identificada; mistos ou sem meio pendentes.')+' Totais preservados.',flush=True)
    print(f'Meses conferidos: {done}; sem identificação: {unknown}; divergentes preservados: {divergent}',flush=True)
if __name__=='__main__':main()
