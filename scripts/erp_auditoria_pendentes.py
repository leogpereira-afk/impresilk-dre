"""Read-only diagnostic. Financial output is encrypted before artifact upload."""
import datetime,json,copy
from collections import defaultdict
import erp_previa as E
from erp_permutas import forma,normal,separar

def cents(v):return round(float(v)*100)
def agrupados(eventos):
    out=defaultdict(int)
    for e in eventos:out[(e['natureza'],e['data'],e.get('contaOrigem',''),e.get('nomeConta',''))]+=cents(e['valor'])
    return out

def analisar(r,pagar,receber,si,sf):
    p=separar(pagar,receber,si,sf)
    cs={c['code']:c['value'] for c in r['cells']}
    out={'mes':r['label'],'coletadoEm':p['coletadoEm'],'permutas':p,'totais':{},'formasPendentes':[],'diferencasPorDiaConta':[]}
    for key,code in [('totalEntradas','1'),('totalSaidas','2')]:
        out['totais'][key]={'dre':cs[code],'mubisys':p[key],'diferenca':(cents(p[key])-cents(cs[code]))/100}
    grouped={}
    for itens,lado in [(receber,'entrada'),(pagar,'saida')]:
        for t in itens:
            code,nome=E.codigo(t.get('plano_contas'))
            for pg in t.get('pagamentos') or [{'data_pagamento':t.get('data_pagamento'),'data_credito':t.get('data_credito'),'valor':t.get('valor_pagamento')}]:
                d=str(pg.get('data_pagamento') or pg.get('data_credito') or '')[:10]
                if not si<=d<=sf:continue
                v=cents(E.valor_na_janela({'pagamentos':[pg]},si,sf));f=forma(pg,t)
                if v and (not f or ('permuta' in normal(f) and normal(f)!='permuta')):
                    k=(lado,d,code,nome,f or 'Ausente')
                    a=grouped.setdefault(k,{'lado':lado,'data':d,'conta':code,'nomeConta':nome,'forma':f or 'Ausente','quantidade':0,'centavos':0})
                    a['quantidade']+=1;a['centavos']+=v
    for a in grouped.values():a['valor']=a.pop('centavos')/100;out['formasPendentes'].append(a)
    old=agrupados(r.get('eventos',[]));new=agrupados(E.eventos_financeiros(receber,'entrada',si,sf)+E.eventos_financeiros(pagar,'saida',si,sf))
    out['baseEventosConfere']={lado:sum(v for k,v in old.items() if k[0]==lado)==cents(cs[code]) for lado,code in [('entrada','1'),('saida','2')]}
    for k in sorted(set(old)|set(new)):
        if old[k]!=new[k]:out['diferencasPorDiaConta'].append({'lado':k[0],'data':k[1],'conta':k[2],'nomeConta':k[3],'dre':old[k]/100,'mubisys':new[k]/100,'diferenca':(new[k]-old[k])/100})
    return out

def main():
    rs=E.listar_meses();result=[]
    for r in sorted(rs,key=lambda r:r['label']):
        if r.get('origem')!='erp':continue
        p=r.get('permutas',{})
        if p.get('versao')==2 and p.get('conferido') is True:continue
        before=copy.deepcopy(r)
        m,y=r['label'].split('/');ini=datetime.date(int(y),E.PT.index(m)+1,1);fim=min((ini+datetime.timedelta(days=32)).replace(day=1)-datetime.timedelta(days=1),datetime.date.today())
        pagar=E.coletar('contas-pagar',ini,fim);receber=E.coletar('contas-receber',ini,fim)
        pagar=[t for t in pagar if str(t.get('compoe_dre','')).lower()=='sim'];receber=[t for t in receber if str(t.get('compoe_dre','')).lower()=='sim']
        result.append(analisar(r,pagar,receber,ini.isoformat(),fim.isoformat()))
        assert r==before
        print('Período conferido em leitura; dados preservados.',flush=True)
    with open('/tmp/audit.json','w') as f:json.dump(result,f,ensure_ascii=False)
    print('Conferência encerrada; relatório destinado exclusivamente ao arquivo criptografado.',flush=True)
if __name__=='__main__':main()
