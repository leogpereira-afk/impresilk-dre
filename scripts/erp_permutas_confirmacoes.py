"""Aplica confirmações privadas somente a uma baixa inequívoca; não muda valores."""
import copy

def aplicar(pagar,receber,ini,fim,regras):
    import erp_previa as E
    from erp_permutas import forma,normal
    p,r=copy.deepcopy(pagar),copy.deepcopy(receber);aplicadas=[]
    for regra in regras or []:
        data=str(regra.get('data',''));lado=regra.get('lado');candidatos=[]
        if not ini<=data<=fim or lado not in ['entrada','saida']:continue
        for t in r if lado=='entrada' else p:
            code,_=E.codigo(t.get('plano_contas'))
            if code!=regra.get('conta',''):continue
            pgs=t.get('pagamentos')
            if not pgs:
                pgs=[{'data_pagamento':t.get('data_pagamento'),'data_credito':t.get('data_credito'),'valor':t.get('valor_pagamento')}];t['pagamentos']=pgs
            for pg in pgs:
                d=str(pg.get('data_pagamento') or pg.get('data_credito') or '')[:10]
                if d!=data or round(E.valor_na_janela({'pagamentos':[pg]},ini,fim)*100)!=round(float(regra.get('valor',0))*100):continue
                original=forma(pg,t) or 'Ausente'
                if normal(original)!=normal(regra.get('formaOriginal')):continue
                if regra.get('contraparte'):
                    from erp_permutas_detalhes import contraparte
                    if normal(contraparte(t,lado))!=normal(regra['contraparte']):continue
                candidatos.append((pg,original))
        if len(candidatos)==1:
            pg,original=candidatos[0];pg['_forma_confirmada']='Dinheiro'
            aplicadas.append({'data':data,'lado':lado,'valor':regra['valor'],'conta':regra.get('conta',''),'formaOriginal':original,'formaConfirmada':'Dinheiro','confirmadoEm':regra.get('confirmadoEm'),'fonte':'Confirmação do responsável'})
    return p,r,aplicadas
