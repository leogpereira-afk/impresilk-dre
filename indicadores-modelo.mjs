// Contrato v1: valores em reais nesta camada; centavos nos cálculos.
// Nenhuma função grava dados, muda classificação ou converte caixa em competência.
export const ESCOPO = 'Impresilk + Universo';
export const AREAS = ['Receita','Custos','Despesas','Resultado','Margem','Rentabilidade'];
export const DICIONARIO = {
 recebimentos:{nome:'Recebimentos',base:'Caixa',formula:'Soma das baixas de entrada no intervalo.',fonte:'DRE / pagamentos do Mubisys',limite:'Não equivale a vendas, faturamento ou receita por competência.'},
 pagamentos:{nome:'Pagamentos',base:'Caixa',formula:'Soma das baixas de saída no intervalo.',fonte:'DRE / pagamentos do Mubisys',limite:'Inclui naturezas a revisar. Não equivale a despesa operacional por competência.'},
 variacao:{nome:'Variação de caixa',base:'Caixa',formula:'Recebimentos menos pagamentos.',fonte:'DRE / pagamentos do Mubisys',limite:'Não representa lucro nem saldo bancário.'},
 comercial:{nome:'Valor das O.S.',base:'Comercial',formula:'Soma dos valores confirmados das O.S. normais, não canceladas, pela data registrada no histórico.',fonte:'Painel / histórico de O.S.',limite:'Não somar a notas ou recebimentos. Cadastro de O.S. não comprova reconhecimento de receita.'},
 fiscal:{nome:'NF-e elegíveis',base:'Fiscal',formula:'Soma das NF-e normais de saída, autorizadas ou aprovadas, sem cancelamento, pela emissão.',fonte:'Painel / conferência fiscal',limite:'NFS-e não incluídas. Faturamento total da empresa permanece parcial.'},
 compras:{nome:'Notas recebidas',base:'Compras',formula:'Soma das notas recebidas não canceladas pela emissão.',fonte:'Painel / conferência fiscal',limite:'Compra não comprova consumo, pagamento nem custo vendido.'},
 custos:{nome:'Custo informado nas O.S.',base:'Custo informado',formula:'Soma dos custos presentes nas O.S. não canceladas do recorte importado.',fonte:'Painel / detalhes de O.S.',limite:'O custo informado não comprova realização. Não mistura compras, pagamentos ou rateios.'},
 margem:{nome:'Margem parcial das O.S.',base:'Custo informado',formula:'(Soma das vendas − soma dos custos) ÷ soma das vendas × 100, somente nas O.S. com os dois valores e receita positiva.',fonte:'Painel / detalhes de O.S.',limite:'Ponderada pela venda; não é ranking de lucro realizado. Sem custo, a margem é indeterminada.'},
 competencia:{nome:'Resultado por competência',base:'Competência',formula:'Reutiliza as rubricas e as fórmulas da DRE, sem nova incidência de tributos ou D&A.',fonte:'DRE / demonstrativo preenchido',limite:'Rubrica ausente permanece ausente. Preenchimento não comprova conciliação contábil.'},
 rentabilidade:{nome:'Retorno sobre capital',base:'Patrimonial',formula:'Resultado compatível dividido pela base de capital validada do mesmo período.',fonte:'Balanços e fluxos de investimentos',limite:'Sem base patrimonial validada, permanece indisponível. Não usa receita como retorno.'}
};
export const numero = v => v == null || v === '' || typeof v==='boolean' || !Number.isFinite(Number(v)) ? null : Number(v);
export const cent = v => numero(v) == null ? null : Math.round(Number(v)*100);
export const soma = xs => !xs.length ? 0 : xs.some(v=>cent(v)==null) ? null : xs.reduce((s,v)=>s+cent(v),0)/100;
export function margem(venda,custo){return numero(venda)>0 && numero(custo)!=null ? (cent(venda)-cent(custo))/cent(venda)*100 : null;}
export function dataValida(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'') && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;}
export function validarPeriodo(de,ate){if(!dataValida(de)||!dataValida(ate)||de>ate||Date.parse(ate)-Date.parse(de)>366*86400000)throw new Error('Escolha um intervalo válido de até 12 meses.');return {de,ate};}
export function periodoRotulo(label){const meses=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],[m,y]=String(label).split('/'),i=meses.indexOf(m);if(i<0||!/^\d{4}$/.test(y))return null;return {de:`${y}-${String(i+1).padStart(2,'0')}-01`,ate:new Date(Date.UTC(+y,i+1,0)).toISOString().slice(0,10)};}
export function periodoPreset(label,tipo){const p=periodoRotulo(label);if(!p)return null;let d=new Date(p.de+'T00:00:00Z'),a=new Date(p.ate+'T00:00:00Z');const m=d.getUTCMonth();if(tipo==='trimestre'){d.setUTCMonth(Math.floor(m/3)*3);a=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+3,0));}if(tipo==='semestre'){d.setUTCMonth(Math.floor(m/6)*6);a=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+6,0));}if(tipo==='ano'){d.setUTCMonth(0);a=new Date(Date.UTC(d.getUTCFullYear(),12,0));}if(tipo==='12meses')d.setUTCMonth(m-11);return {de:d.toISOString().slice(0,10),ate:a.toISOString().slice(0,10)};}
// Data ISO na tela em dd/mm/aaaa.
export const dataBRIso=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'';
const dentro=(d,p)=>dataValida(d)&&d>=p.de&&d<=p.ate;
const texto=v=>String(v??'');
export function agrupar(rows,key){const map=new Map();for(const r of rows){const k=texto(r[key]||'Não informado'),a=map.get(k)||{nome:k,valor:0,quantidade:0,ausentes:0};if(cent(r.valor)==null)a.ausentes++;else a.valor+=cent(r.valor);a.quantidade++;map.set(k,a);}return [...map.values()].map(a=>({...a,valor:a.ausentes===a.quantidade?null:a.valor/100})).sort((a,b)=>Math.abs(b.valor)-Math.abs(a.valor)||a.nome.localeCompare(b.nome));}
export function resumir(rows,{query='',dimensao='grupo',grupo='',pagina=0,tamanho=50}={}){
 const filtrados=rows.filter(r=>(!grupo||texto(r[dimensao]||'Não informado')===grupo)&&(!query||[r.numero,r.nome,r.grupo,r.cliente,r.vendedor,r.origem,r.id].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))));
 const validos=filtrados.filter(r=>numero(r.valor)!=null),pares=filtrados.filter(r=>numero(r.venda)>0&&numero(r.custo)!=null),venda=soma(pares.map(r=>r.venda)),custo=soma(pares.map(r=>r.custo));
 const pag=Math.min(Math.max(0,Number(pagina)||0),Math.max(0,Math.ceil(filtrados.length/tamanho)-1));
 return {total:filtrados.length,comValor:validos.length,valor:validos.length?soma(validos.map(r=>r.valor)):filtrados.length?null:0,somaCompleta:validos.length===filtrados.length,pares:pares.length,venda,custo,margem:margem(venda,custo),negativas:pares.filter(r=>cent(r.custo)>cent(r.venda)).length,grupos:agrupar(filtrados,dimensao),evolucao:agrupar(filtrados.map(r=>({...r,mes:r.data?.slice(0,7)||'Sem data'})),'mes').sort((a,b)=>a.nome.localeCompare(b.nome)),pagina:pag,paginas:Math.max(1,Math.ceil(filtrados.length/tamanho)),rows:filtrados.slice(pag*tamanho,(pag+1)*tamanho)};
}
// Mês sem trilha por pagamento (carga histórica): as contas do mês, cada uma com o valor
// PRÓPRIO (o valor menos as filhas mais próximas que existem no mês), para a composição, a
// busca e o agrupamento funcionarem também no histórico. A soma das contas dá o total do mês.
export function contasDoMes(r,rp,natureza){
 const raiz=natureza==='entrada'?'1':'2',codigo=c=>String(c?.code??'');
 const cells=(r.cells||[]).filter(c=>/^\d+(\.\d+)*$/.test(codigo(c))&&(codigo(c)===raiz||codigo(c).startsWith(raiz+'.'))&&cent(c.value)!=null);
 const valor=new Map(cells.map(c=>[codigo(c),cent(c.value)])),filhas=new Map();
 for(const c of cells){const p=codigo(c).split('.');for(let i=p.length-1;i>0;i--){const a=p.slice(0,i).join('.');if(valor.has(a)){filhas.set(a,(filhas.get(a)||0)+valor.get(codigo(c)));break;}}}
 return cells.map(c=>{const code=codigo(c),proprio=valor.get(code)-(filhas.get(code)||0);return proprio?{id:`mes:${r.id}:${code}`,numero:code,data:rp.de,nome:c.name||code,grupo:c.name||code,valor:proprio/100,conta:code,origem:`DRE / ${r.label} / conta ${code} · total do mês, sem trilha por pagamento`,agregado:true}:null;}).filter(Boolean);
}
// O mesmo intervalo levado ao ano dado (pelo ano do início). Fim de mês continua fim de mês (29/02 ↔ 28/02).
export function periodoNoAno(p,ano){
 const k=Number(ano)-Number(p.de.slice(0,4)),um=d=>{const [y,m,dd]=d.split('-').map(Number),ultimo=new Date(Date.UTC(y,m,0)).getUTCDate(),ultAlvo=new Date(Date.UTC(y+k,m,0)).getUTCDate();return `${y+k}-${String(m).padStart(2,'0')}-${String(dd===ultimo?ultAlvo:Math.min(dd,ultAlvo)).padStart(2,'0')}`;};
 return {de:um(p.de),ate:um(p.ate)};
}
// O mesmo intervalo um ano antes.
export function periodoAnterior(p){return periodoNoAno(p,Number(p.de.slice(0,4))-1);}
export function caixa(records,p,natureza){
 validarPeriodo(p.de,p.ate);const meses=[];let d=new Date(p.de+'T00:00:00Z');d.setUTCDate(1);while(d.toISOString().slice(0,10)<=p.ate){meses.push(d.toISOString().slice(0,7));d.setUTCMonth(d.getUTCMonth()+1);}
 const rows=[],fontes=[],vistos=new Set(),diferencas=[];let ausentes=0,semTrilha=0,semTrilhaCortado=0,duplicados=0,invalidos=0;
 for(const mes of meses){const r=records.find(x=>periodoRotulo(x.label)?.de.slice(0,7)===mes);if(!r){ausentes++;continue;}const rp=periodoRotulo(r.label),q=r.qualidade||{};fontes.push({periodo:r.label,em:q.coletadoEm||r.previaERP?.geradoEm||r.atualizadoEm||null,corte:q.ate||null,conciliado:q.conciliado===true,completo:q.ate>=rp.ate&&q.apiContratoValidado!==false,pendencias:r.pendencias?.length||0,chave:[r.company,r.basis,q.escopo,q.regra].join('|')});
  if(!Array.isArray(r.eventos)||!r.eventos.length){semTrilha++;if(p.de<=rp.de&&p.ate>=rp.ate)rows.push(...contasDoMes(r,rp,natureza));else semTrilhaCortado++;continue;}
  const inicioLinhas=rows.length;
  for(const e of r.eventos){if(e.natureza!==natureza)continue;if(!dataValida(e.data)){invalidos++;continue;}if(!dentro(e.data,p))continue;
   const id=[e.empresa,e.natureza,e.tituloId,e.pagamentoId??('pos:'+e.indiceNaColeta)].join(':');if(e.pagamentoId!=null&&vistos.has(id)){duplicados++;continue;}vistos.add(id);
   rows.push({id,numero:texto(e.tituloId),data:e.data,nome:e.nomeConta||'Conta não informada',grupo:e.nomeConta||'Sem classificação de origem',valor:numero(e.valor),origem:`Mubisys / ${e.empresa||'Empresa não informada'} / título ${e.tituloId} / pagamento ${e.pagamentoId??'sem ID'}`,os:e.ordensServico||[],conta:e.contaOrigem,pagamento:e.pagamentoId});
  }
  if(p.de<=rp.de&&p.ate>=rp.ate){const controle=numero(r.cells?.find(c=>c.code===(natureza==='entrada'?'1':'2'))?.value),trilha=soma(rows.slice(inicioLinhas).map(e=>e.valor));if(controle!=null&&trilha!=null&&cent(controle)!==cent(trilha))diferencas.push(`${r.label}: diferença entre trilha e total mensal de ${((cent(trilha)-cent(controle))/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`);}
 }
 const conhecido=fontes.length>0&&(rows.length>0||(!semTrilha&&!ausentes));
 return {rows,faltam:ausentes,semTrilha,semTrilhaCortado,disponivel:conhecido,qualidade:!conhecido?'Indisponível':ausentes||semTrilha||duplicados||invalidos||diferencas.length||rows.some(r=>r.valor==null)||fontes.some(f=>!f.completo)?'Parcial':'Apurado',fontes,avisos:[...diferencas,...(ausentes?[`${ausentes} mês(es) sem fonte no intervalo.`]:[]),...(semTrilha?[`${semTrilha} mês(es) sem trilha por pagamento: entram pelas contas da DRE do mês (total de cada conta), e só se o mês inteiro estiver selecionado.`]:[]),...(duplicados?[`${duplicados} pagamentos com ID repetido não foram somados novamente.`]:[]),...(invalidos?[`${invalidos} movimentos sem data válida ficaram fora do intervalo.`]:[])],limite:DICIONARIO[natureza==='entrada'?'recebimentos':'pagamentos'].limite};
}
export function normalizarComercial(itens){return itens.filter(r=>r.comercial?.cancelada===false&&String(r.comercial?.tipo||'').toLowerCase()==='normal').map(r=>({id:texto(r.id),numero:texto(r.numero),data:r.data,nome:r.cliente||'Cliente não informado',cliente:r.cliente||'Cliente não informado',vendedor:r.vendedor||'Não informado',grupo:r.vendedor||'Não informado',valor:r.comercial?.valorConfirmado===true?numero(r.valor):null,origem:`Painel / O.S. ID ${r.id} / tipo ${r.comercial?.tipo||'não informado'}`}));}
export function normalizarSnapshot(s,fonte,p){
 const exato=fonte==='custos'||fonte==='margem';const disponivel=!!s && s.completo===true && (exato?s.desde===p.de&&s.ate===p.ate:s.desde<=p.de&&s.ate>=p.ate);
 if(!disponivel)return {rows:[],disponivel:false,qualidade:'Indisponível',fontes:s?[{em:s.em,corte:s.ate,periodo:`${dataBRIso(s.desde)} a ${dataBRIso(s.ate)}`}]:[],avisos:[s?`Fonte disponível de ${dataBRIso(s.desde)} a ${dataBRIso(s.ate)}${exato?'; o recorte de O.S. precisa coincidir exatamente':''}.`:'Esta fonte ainda não foi importada.'],recorte:s?{de:s.desde,ate:s.ate}:null};
 let rows;
 if(exato)rows=s.itens.filter(r=>!r.cancelada).map(r=>({id:texto(r.id),numero:texto(r.numero),data:null,nome:r.cliente,cliente:r.cliente,grupo:r.tipo||'Tipo não informado',valor:numero(r.custo)==null?null:r.custo/100,venda:numero(r.venda)==null?null:r.venda/100,custo:numero(r.custo)==null?null:r.custo/100,origem:`Mubisys / O.S. ID ${r.id} / ${r.empresa||ESCOPO}`,processos:{previstos:r.previstos,realizados:r.realizados},tempoPositivo:(r.realizados||[]).some(x=>numero(x.tempo)>0)}));
 else rows=s.itens.filter(r=>dentro(r.em,p)&&!r.cancelada&&(fonte==='compras'||(r.normal===true&&r.saida===true&&/aprovad|autorizad/i.test(r.status)))).map(r=>({id:texto(r.id),numero:texto(r.numero),data:r.em,nome:fonte==='compras'?r.emitente:r.destinatario,cliente:fonte==='compras'?r.emitente:r.destinatario,grupo:r.status,valor:numero(r.valor)==null?null:r.valor/100,origem:`Mubisys / NF-e ID ${r.id}`,os:r.osIds,itens:r.itens}));
 return {rows,disponivel:true,qualidade:'Parcial',fontes:[{em:s.em,corte:s.ate,periodo:`${dataBRIso(s.desde)} a ${dataBRIso(s.ate)}`,conciliado:false}],avisos:[exato?'O.S. cadastradas no período e vinculadas às notas do período. Valores informados no retrato importado, sem prova de custo realizado.':'Recorte de documentos importados. Não comprova cobertura fiscal total.'],limite:DICIONARIO[fonte].limite};
}
export function csvCelula(v){let s=String(v??'');const num=/^-?\d+([.,]\d+)?$|^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s.trim());if(!num&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function exportarCSV({titulo,periodo,fonte,qualidade,limite,rows,valor,fontes=[],indicadores=[]}){
 const linhas=[['Impresilk + Universo',titulo],['Período',periodo.de,periodo.ate],['Base',fonte],['Qualidade',qualidade],['Limitação',limite],...fontes.map(f=>['Fonte',f.periodo,'Atualização',f.em,'Corte',f.corte,'Conferência da fonte',f.conciliado?'Registrada':'Pendente de validação']),...indicadores.map(i=>[i.nome,i.valor,i.nota]),['Total conhecido em R$',valor==null?'Indisponível':valor.toFixed(2).replace('.',',')],[],['ID','Número','Data','Nome','Grupo','Valor R$','Venda R$','Custo informado R$','Margem parcial %','Origem'],...rows.map(r=>[r.id,r.numero,r.data,r.nome,r.grupo,numero(r.valor)==null?'Não informado':r.valor.toFixed(2).replace('.',','),numero(r.venda)==null?'':r.venda.toFixed(2).replace('.',','),numero(r.custo)==null?'':r.custo.toFixed(2).replace('.',','),margem(r.venda,r.custo)==null?'':margem(r.venda,r.custo).toFixed(4).replace('.',','),r.origem])];return '\ufeff'+linhas.map(row=>row.map(csvCelula).join(';')).join('\r\n');
}

// Comparação mensal com a mesma quantidade de dias já cobertos nas duas fontes.
export function compararCaixa(records,p,natureza){
 const atual=records.find(r=>periodoRotulo(r.label)?.de===p.de),per=periodoRotulo(atual?.label);
 if(!per||p.ate!==per.ate)return {disponivel:false,motivo:'A comparação equivalente está disponível para um mês selecionado por inteiro.'};
 const ini=new Date(p.de+'T00:00:00Z'),antDe=new Date(Date.UTC(ini.getUTCFullYear(),ini.getUTCMonth()-1,1)).toISOString().slice(0,10),antFim=new Date(Date.UTC(ini.getUTCFullYear(),ini.getUTCMonth(),0)).toISOString().slice(0,10);
 const ant=records.find(r=>periodoRotulo(r.label)?.de===antDe);
 if(ant&&(atual.company!==ant.company||atual.basis!==ant.basis||atual.qualidade?.escopo!==ant.qualidade?.escopo||atual.qualidade?.regra!==ant.qualidade?.regra))return {disponivel:false,motivo:'Empresas ou critérios diferentes entre os meses. Os valores históricos continuam visíveis.'};
 if(!ant||!atual.qualidade?.ate||!ant.qualidade?.ate||atual.qualidade.ate<p.de||ant.qualidade.ate<antDe||atual.qualidade.apiContratoValidado===false||ant.qualidade.apiContratoValidado===false||!atual.eventos?.length||!ant.eventos?.length)return {disponivel:false,motivo:'Faltam trilhas datadas ou validação de cobertura para comparar intervalos equivalentes.'};
 const dias=Math.min(Number(per.ate.slice(-2)),Number(antFim.slice(-2)),Number((atual.qualidade.ate<per.ate?atual.qualidade.ate:per.ate).slice(-2)),Number((ant.qualidade.ate<antFim?ant.qualidade.ate:antFim).slice(-2)));
 const a={de:p.de,ate:p.de.slice(0,8)+String(dias).padStart(2,'0')},b={de:antDe,ate:antDe.slice(0,8)+String(dias).padStart(2,'0')};
 const x=caixa(records,a,natureza),y=caixa(records,b,natureza);if(!x.disponivel||!y.disponivel||x.avisos.length||y.avisos.length)return {disponivel:false,motivo:'A trilha apresenta lacunas ou repetições a conferir.'};
 const va=soma(x.rows.map(r=>r.valor)),vb=soma(y.rows.map(r=>r.valor));return {disponivel:va!=null&&vb!=null,atual:va,anterior:vb,delta:va==null||vb==null?null:(cent(va)-cent(vb))/100,percentual:vb>0&&va!=null?((cent(va)-cent(vb))/cent(vb))*100:null,a,b,dias};
}

// O mesmo intervalo um ano antes, com os mesmos filtros. Só compara quando os dois lados têm
// todos os meses e todos os valores: lado incompleto não vira queda nem alta.
function baseCaixa(records,p,fonte){
 const a=caixa(records,p,'entrada'),b=caixa(records,p,'saida');
 if(fonte==='recebimentos')return a;if(fonte==='pagamentos')return b;
 return {disponivel:a.disponivel&&b.disponivel,faltam:a.faltam,semTrilha:a.semTrilha,semTrilhaCortado:a.semTrilhaCortado,fontes:a.fontes,avisos:[...(a.avisos||[]),...(b.avisos||[])],qualidade:a.qualidade==='Apurado'&&b.qualidade==='Apurado'?'Apurado':'Parcial',rows:[...a.rows.map(x=>({...x,grupo:'Recebimentos'})),...b.rows.map(x=>({...x,grupo:'Pagamentos',valor:x.valor==null?null:-x.valor}))]};
}
const dataBR=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.split('-').reverse().join('/'):'data não registrada';
// Fonte coletada só até antes do fim do mês (ou do fim do intervalo): o mês está pela metade.
export function mesCortado(f,ate){const rp=periodoRotulo(f?.periodo);if(!rp)return false;const fim=ate&&ate<rp.ate?ate:rp.ate;return !f.corte||f.corte<fim;}
// Com {ano}: compara com o mesmo intervalo no ano dado (o ano escolhido em "Comparar com"); sem ele, um ano antes.
export function compararAno(records,p,fonte,filtros={},{ano}={}){
 const comFiltro=!!(filtros.query||filtros.grupo);
 const pa=ano!=null&&/^\d{4}$/.test(String(ano))?periodoNoAno(p,Number(ano)):periodoAnterior(p),tot=per=>{let base;try{base=baseCaixa(records,per,fonte);}catch{return {motivo:'intervalo inválido'};}
  if(base.semTrilhaCortado)return {motivo:`${base.semTrilhaCortado} mês(es) sem trilha cortado(s) pelo intervalo; escolha meses inteiros`};
  if(!base.disponivel)return {motivo:'sem fonte'};if(base.faltam)return {motivo:`${base.faltam} mês(es) sem fonte`};
  const cortado=(base.fontes||[]).find(f=>mesCortado(f,per.ate));if(cortado)return {motivo:`${cortado.periodo} tem lançamentos só até ${dataBR(cortado.corte)}; o comparativo espera o mês terminar`};
  const chaves=new Set((base.fontes||[]).map(f=>f.chave));if(chaves.size>1)return {motivo:'empresas ou critérios diferentes dentro do intervalo'};
  const s=resumir(base.rows,{...filtros,pagina:0,tamanho:Math.max(1,base.rows.length)});if(!s.somaCompleta)return {motivo:'valores ausentes'};
  if(comFiltro&&s.total===0)return {motivo:'nenhum registro no filtro'};
  const tipo=base.rows.every(r=>r.agregado)?'dre':base.rows.some(r=>r.agregado)?'misto':'trilha';
  // Meses completos sem trilha entram pelo total do mês: é ressalva de detalhe, não de cobertura.
  const soSemTrilha=!!base.semTrilha&&(base.fontes||[]).every(f=>f.completo)&&(base.avisos||[]).every(t=>/sem trilha por pagamento/.test(t));
  return {valor:s.valor,parcial:base.qualidade!=='Apurado'&&!soSemTrilha,semTrilha:soSemTrilha,chave:[...chaves][0],tipo};};
 const x=tot(p),y=tot(pa);
 if(x.valor==null||y.valor==null)return {disponivel:false,periodo:pa,motivo:x.valor==null?`O intervalo escolhido não compara (${x.motivo}).`:`O mesmo período de ${pa.de.slice(0,4)} não compara (${y.motivo}).`};
 if(x.chave!==y.chave)return {disponivel:false,periodo:pa,motivo:'Empresas ou critérios diferentes entre os anos. Os valores continuam visíveis.'};
 // A trilha do Mubisys usa os nomes das contas do ERP; os meses antigos, as contas da DRE: filtro não casa entre os dois.
 if(comFiltro&&(x.tipo!==y.tipo||x.tipo==='misto'))return {disponivel:false,periodo:pa,motivo:'Com busca ou grupo, só compara bases do mesmo tipo: os meses com trilha usam as contas do Mubisys e os meses antigos, as contas da DRE.'};
 return {disponivel:true,periodo:pa,atual:x.valor,anterior:y.valor,delta:(cent(x.valor)-cent(y.valor))/100,percentual:y.valor>0&&x.valor>=0?(cent(x.valor)-cent(y.valor))/cent(y.valor)*100:null,parcial:x.parcial||y.parcial,semTrilha:!x.parcial&&!y.parcial&&(x.semTrilha||y.semTrilha)};
}

// Exibir não é comparar: o ano civil preserva cada fonte, inclusive mudanças de base.
export function historicoCaixa(records,periodo,fonte,filtros={},hoje=new Date().toISOString().slice(0,10)){
 const fim=new Date(periodo.ate+'T00:00:00Z');
 const ref=records.find(r=>periodoRotulo(r.label)?.de.slice(0,7)===periodo.ate.slice(0,7));
 return Array.from({length:12},(_,i)=>{
  const d=new Date(Date.UTC(fim.getUTCFullYear(),i,1));
  const de=d.toISOString().slice(0,10),ate=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const r=records.find(x=>periodoRotulo(x.label)?.de===de);
  const ponto={nome:d.toLocaleDateString('pt-BR',{month:'short',timeZone:'UTC'}).replace('.',''),periodo:de.slice(0,7),valor:null,nota:de>hoje?'Mês ainda não chegou':'Sem fonte',parcial:true};
  if(!r)return ponto;
  const mesmaBase=!!ref?.company&&!!ref?.basis&&r.company===ref.company&&r.basis===ref.basis&&r.qualidade?.escopo===ref.qualidade?.escopo&&r.qualidade?.regra===ref.qualidade?.regra;
  const a=caixa(records,{de,ate},'entrada'),b=caixa(records,{de,ate},'saida');
  const base=fonte==='variacao'?{disponivel:a.disponivel&&b.disponivel,semTrilha:a.semTrilha,fontes:a.fontes,rows:[...a.rows.map(x=>({...x,grupo:'Recebimentos'})),...b.rows.map(x=>({...x,grupo:'Pagamentos',valor:x.valor==null?null:-x.valor}))],qualidade:a.qualidade==='Apurado'&&b.qualidade==='Apurado'?'Apurado':'Parcial'}:fonte==='recebimentos'?a:b;
  const s=resumir(base.rows,filtros),parcial=base.qualidade!=='Apurado'||!s.somaCompleta,fechado=!!r.qualidade?.ate&&r.qualidade.ate>=ate;
  // Mês sem trilha, fechado e com a fonte completa é o total do mês, não leitura a conferir.
  const semTrilha=!!base.semTrilha&&fechado,ressalva=parcial&&!(semTrilha&&s.somaCompleta&&(base.fontes||[]).every(f=>f.completo));
  // Marcas: "*" mês em andamento ou incompleto; "°" cobertura a conferir.
  return {...ponto,valor:base.disponivel&&s.comValor>0?s.valor:null,parcial,marca:!fechado||!s.somaCompleta?'*':ressalva?'°':'',semTrilha,empresa:r.company,mesmaBase,fechado,chave:[r.company,r.basis,r.qualidade?.escopo,r.qualidade?.regra].join('|'),nota:[r.company||'Empresa não informada',r.basis||'Base não informada',!mesmaBase?'Base diferente do mês selecionado; sem variação percentual':'',semTrilha?'Total do mês completo; sem trilha por pagamento':ressalva?'Leitura parcial; cobertura a conferir':'Mês completo'].filter(Boolean).join(' · ')};
 });
}

export function comparativoPares(modelo){
 if(!modelo.disponivel||!modelo.pares)return [];
 return [{nome:'Venda informada',valor:numero(modelo.venda),tom:'entrada'},{nome:'Custo informado',valor:numero(modelo.custo),tom:'saida'}];
}
