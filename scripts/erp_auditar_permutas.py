"""Conferência agregada: não guarda clientes, IDs, descrições ou pagamentos."""
import datetime,copy,uuid,json,unicodedata
import erp_previa as E
from erp_permutas import forma

def resumo(titulos,si,sf,termos=()):
    out={'eleitoralIdentificado':0,'eleitoralDre':0,'eleitoralFormaTitulo':0,'eleitoralFormaBaixa':0,'todosFormaTitulo':0,'todosFormaBaixa':0,'todosFormaContemPermuta':0,'quantidadeEleitoral':0}
    campos=set();variantes={};out['identificadosNoCliente']=0;out['contextoEleitoral']=0
    for t in titulos:
        # Identificação usada somente em memória e não devolvida nem registrada.
        norm=unicodedata.normalize('NFD',json.dumps(t,ensure_ascii=False)).encode('ascii','ignore').decode().lower()
        match=bool(termos) and all(termo in norm for termo in termos)
        vd=round(E.valor_na_janela(t,si,sf)*100);naDre=str(t.get('compoe_dre','')).lower()=='sim'
        ft=forma({},t)
        if match:
            cliente=unicodedata.normalize('NFD',json.dumps(t.get('cliente',''),ensure_ascii=False)).encode('ascii','ignore').decode().lower()
            if all(termo in cliente for termo in termos):out['identificadosNoCliente']+=1
            if 'eleic' in norm or 'politic' in norm:out['contextoEleitoral']+=1
            out['quantidadeEleitoral']+=1;out['eleitoralIdentificado']+=vd
            if naDre:out['eleitoralDre']+=vd
        if ft and ft.casefold()=='permuta':
            if naDre:out['todosFormaTitulo']+=vd
            if match and naDre:out['eleitoralFormaTitulo']+=vd
        pgs=t.get('pagamentos') or [{'data_pagamento':t.get('data_pagamento'),'valor':t.get('valor_pagamento')}]
        for pg in pgs:
            campos.update(k for k in pg if 'forma' in k or 'tipo' in k)
            d=str(pg.get('data_pagamento') or pg.get('data_credito') or '')[:10]
            if not si<=d<=sf:continue
            v=round(E.valor_na_janela({'pagamentos':[pg]},si,sf)*100);f=forma(pg,t)
            if f and f.casefold()=='permuta':
                if naDre:out['todosFormaBaixa']+=v
                if match and naDre:out['eleitoralFormaBaixa']+=v
            if f and 'permuta' in f.casefold() and naDre:
                out['todosFormaContemPermuta']+=v
                if f.casefold()!='permuta':variantes[f]=variantes.get(f,0)+v
    for k in out:
        if k not in ['quantidadeEleitoral','identificadosNoCliente','contextoEleitoral']:out[k]/=100
    out['camposFormaPagamento']=sorted(campos)
    out['variantesFormaPagamento']={k:v/100 for k,v in variantes.items()}
    return out

def main():
    rs=E.listar_meses()
    cfg=E.call('dre-sync',{'action':'getCfg'})
    termos=cfg.get('cfg',{}).get('regras',{}).get('permutas',{}).get('termosAuditoria',[])
    if not termos:raise RuntimeError('Critério privado não configurado')
    for r in sorted(rs,key=lambda r:r['id']):
        if r['label'] not in ['Set/2026','Out/2026']:continue
        m,y=r['label'].split('/');ini=datetime.date(int(y),E.PT.index(m)+1,1);fim=min((ini+datetime.timedelta(days=32)).replace(day=1)-datetime.timedelta(days=1),datetime.date.today())
        p=resumo(E.coletar('contas-receber',ini,fim),ini.isoformat(),fim.isoformat(),termos)
        new=copy.deepcopy(r);new['conferenciaPermutasAgregada']=p
        ans=E.call('dre-sync',{'action':'upsert','registro':new,'baseAtualizadoEm':r.get('atualizadoEm'),'operacaoId':'conferencia-permutas:'+str(uuid.uuid4())})
        if ans.get('ok') is not True:raise RuntimeError('Gravação não confirmada')
        print(r['label']+': conferência agregada disponível na DRE; totais preservados.',flush=True)
if __name__=='__main__':main()
