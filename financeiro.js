/* Regras de apresentação de caixa. Não convertem baixas financeiras em lucro contábil. */
var DREFinancas = (() => {
  const meses=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const cents=n=>Math.round(Number(n||0)*100), reais=n=>n/100;
  const iso=d=>d.toISOString().slice(0,10);
  function periodo(label){const m=String(label||'').match(/^([A-Za-zç]{3})\w*\/(\d{4})$/);if(!m)return null;const i=meses.findIndex(x=>x.toLowerCase()===m[1].toLowerCase());if(i<0)return null;return {de:iso(new Date(Date.UTC(+m[2],i,1))),ate:iso(new Date(Date.UTC(+m[2],i+1,0)))};}
  function qualidade(reg,agora=new Date()){
    if(!reg)return {estado:'sem-dados',rotulo:'Sem dados',comparavel:false,coletadoEm:null,mensagem:'Este período ainda não foi coletado.'};
    const per=periodo(reg.label),q=reg.qualidade||{},ts=q.coletadoEm||reg.previaERP?.geradoEm||reg.atualizadoEm;
    const corte=q.ate||String(ts||'').slice(0,10);
    const parcial=reg.origem==='erp' && per && corte<per.ate;
    const expirada=per && per.ate>=iso(agora) && (!ts||agora-new Date(ts)>24*3600000);
    let estado=parcial?'parcial':q.estado||'cobertura-nao-validada';
    if(expirada)estado='desatualizado';
    const rotulos={'parcial':'Período parcial','desatualizado':'Atualização atrasada','cobertura-nao-validada':'Cobertura a conferir','aguardando-conferencia':'Aguardando conferência','conciliado':'Conciliado','fechado':'Fechado','reaberto':'Reaberto'};
    const comparavel=q.apiContratoValidado!==false && !!per && !!q.ate && q.ate>=per.ate && ['aguardando-conferencia','conciliado','fechado'].includes(estado);
    return {estado,rotulo:rotulos[estado]||'A conferir',comparavel,coletadoEm:ts||null,corte:q.ate||null,
      mensagem:q.apiContratoValidado===false?'Coleta registrada. Limites e filtros da API ainda precisam de validação; comparações automáticas permanecem suspensas.':parcial?'O mês não foi coletado até o final. Comparações automáticas estão suspensas.':expirada?'A última coleta do ERP está atrasada. Ler a nuvem não atualiza o Mubisys.':comparavel?'Cobertura registrada. Consulte pendências e conciliação antes do fechamento.':'O histórico está preservado; falta validar sua cobertura e conciliação.'};
  }
  function resumo(reg){
    const m=new Map((reg?.cells||[]).map(c=>[c.code,cents(c.value)]));const v=c=>m.get(c)||0;
    const entradas=v('1'),saidas=v('2'),emprestimos=v('1.4'),rendimentos=v('1.3'),naoIdentificadas=v('1.7');
    const operacionais=v('1.1')+v('1.2')+v('1.5')+v('1.6');
    const socios=v('2.14')-v('2.14.3');
    // Mantém a decomposição gerencial histórica. Parcelas de ativos são identificadas,
    // sem afirmar aquisição ou amortização de principal antes da revisão contratual.
    const parcelasAtivos=v('2.13.7.1.1')+v('2.13.7.1.2')+v('2.14.3.4');
    const dividas=v('2.13.6')+v('2.17')+(v('2.14.3')-v('2.14.3.4'))+v('2.13.7.1.3');
    const transferencias=v('2.18'),investimentos=v('2.16'),pendentes=v('2.99'),pagamentosOperacionais=saidas-socios-parcelasAtivos-dividas-transferencias-investimentos-pendentes;
    return Object.fromEntries(Object.entries({entradas,saidas,variacao:entradas-saidas,operacionais,emprestimos,rendimentos,naoIdentificadas,outrasEntradas:entradas-operacionais-emprestimos-rendimentos-naoIdentificadas,socios,parcelasAtivos,dividas,transferencias,investimentos,pendentes,pagamentosOperacionais,saldoOperacional:operacionais-pagamentosOperacionais}).map(([k,n])=>[k,reais(n)]));
  }
  function comparacao(a,b,agora=new Date()){
    const qa=qualidade(a,agora),qb=qualidade(b,agora);const escopoIgual=!!a&&!!b&&a.company===b.company&&a.basis===b.basis&&a.qualidade?.escopo===b.qualidade?.escopo&&a.qualidade?.regra===b.qualidade?.regra;const permitida=qa.comparavel&&qb.comparavel&&escopoIgual;
    return {permitida,motivo:permitida?'Mesmo escopo; conferir mudanças de classificação.':'Comparação suspensa: valide cobertura, empresas e critérios dos dois períodos.',delta:permitida?reais(cents(resumo(a).variacao)-cents(resumo(b).variacao)):null};
  }
  function residuos(reg){const cells=reg?.cells||[];return cells.flatMap(c=>{const filhos=cells.filter(x=>x.code.substring(0,x.code.lastIndexOf('.'))===c.code&&x.code!==c.code);if(!filhos.length)return[];const v=cents(c.value)-filhos.reduce((n,x)=>n+cents(x.value),0);return v?[{code:c.code,name:c.name,value:reais(v)}]:[];});}
  function margemAcumulada(itens){const rec=itens.reduce((n,x)=>n+cents(x.receita),0),res=itens.reduce((n,x)=>n+cents(x.resultado),0);return rec?res/rec:null;}
  function projecao({saldo,movimentos,inicio,semanas=13,fatorRecebimento=1,reserva=0}){
    if(saldo==null||saldo===''||!Number.isFinite(Number(saldo)))return {disponivel:false};
    const start=new Date(inicio+'T00:00:00Z');if(!Number.isFinite(+start))throw new Error('Data inválida');
    const limite=new Date(start);limite.setUTCDate(limite.getUTCDate()+7*semanas);
    let atual=cents(saldo),minimo=atual,primeiroAperto=atual<cents(reserva)?inicio:null;
    const filas=Array.from({length:semanas},(_,i)=>({semana:i+1,entradas:0,saidas:0,saldo:0}));
    const eventos=(movimentos||[]).filter(m=>m.data&&m.data<iso(limite)).map(m=>({...m,data:m.data<inicio?inicio:m.data})).sort((a,b)=>a.data.localeCompare(b.data));
    // Consolidar o dia evita depender da ordem de parcelas com a mesma data.
    const dias=new Map();for(const m of eventos){const v=cents(m.valor)*(m.tipo==='entrada'?fatorRecebimento:-1);const d=dias.get(m.data)||{entradas:0,saidas:0};if(v>=0)d.entradas+=Math.round(v);else d.saidas-=Math.round(v);dias.set(m.data,d);}
    for(const [data,d] of dias){atual+=d.entradas-d.saidas;if(atual<minimo)minimo=atual;if(atual<cents(reserva)&&!primeiroAperto)primeiroAperto=data;const i=Math.floor((new Date(data+'T00:00:00Z')-start)/86400000/7);if(filas[i]){filas[i].entradas+=d.entradas;filas[i].saidas+=d.saidas;}}
    let total=cents(saldo);for(const f of filas){total+=f.entradas-f.saidas;f.saldo=reais(total);f.entradas=reais(f.entradas);f.saidas=reais(f.saidas);}
    return {disponivel:true,semanas:filas,minimo:reais(minimo),final:reais(atual),primeiroAperto};
  }
  function valorConta(reg,code){
    const c=reg?.cells?.find(c=>c.code===code);
    return !c || c.value==null || c.value==='' || !Number.isFinite(Number(c.value)) ? null : reais(cents(c.value));
  }
  // Partição da árvore: só o descendente mais próximo entra em cada nível.
  // Diferenças permanecem explícitas, inclusive negativas; não se distribuem valores.
  function composicao(reg,code='2'){
    const cells=(reg?.cells||[]).filter(c=>c.code.startsWith(code+'.'));
    const codes=new Set(cells.map(c=>c.code));
    const itens=cells.filter(c=>{
      let p=c.code.slice(0,c.code.lastIndexOf('.'));
      while(p!==code && p.includes('.')){if(codes.has(p))return false;p=p.slice(0,p.lastIndexOf('.'));}
      return true;
    }).map(c=>({code:c.code,name:c.name,value:valorConta(reg,c.code)}));
    const total=valorConta(reg,code),incompleta=itens.some(c=>c.value==null);
    if(total!=null && !incompleta){
      const diff=cents(total)-itens.reduce((n,c)=>n+cents(c.value),0);
      if(diff)itens.push({code:code+'~residuo',name:'Sem detalhamento / diferença',value:reais(diff),residuo:true});
    }
    return {total,itens,incompleta};
  }
  function serieAnual(records,label,code){
    const year=String(label).split('/')[1];
    return meses.map(m=>{
      const label=m+'/'+year,reg=records.find(r=>r.label.toLowerCase()===label.toLowerCase())||null;
      const name=reg?.cells?.find(c=>c.code===code)?.name||null;
      return {label,reg,name,value:valorConta(reg,code),qualidade:qualidade(reg)};
    });
  }
  function compararConta(a,b,code){
    const atual=valorConta(a,code),anterior=valorConta(b,code),ca=a?.cells?.find(c=>c.code===code),cb=b?.cells?.find(c=>c.code===code);
    const mesmaOrigem=(a?.origem||'planilha')===(b?.origem||'planilha');
    const permitida=comparacao(a,b).permitida && atual!=null && anterior!=null && ca.name===cb.name && (mesmaOrigem||code.split('.').length<=2);
    const delta=permitida?reais(cents(atual)-cents(anterior)):null;
    return {permitida,atual,anterior,delta,percentual:permitida&&anterior>0?delta/anterior*100:null};
  }
  return {periodo,qualidade,resumo,comparacao,residuos,margemAcumulada,projecao,valorConta,composicao,serieAnual,compararConta};
})();
