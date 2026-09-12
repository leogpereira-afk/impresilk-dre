const pdfTexto=s=>String(s??'').replace(/[−–—]/g,'-').replace(/→/g,' > ').replace(/↗/g,'');
/* PDF preparado em memória no aparelho. Não envia dados a serviços externos. */
var PDFCFO = (()=>{
 let carregando;
 function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{s.remove();reject(new Error('Não foi possível carregar o gerador de PDF. Confira a conexão e tente novamente.'));};document.head.append(s);});}
 async function carregar(){if(!carregando)carregando=(async()=>{if(!window.jspdf)await script('vendor/jspdf.umd.min.js');if(!window.jspdf.jsPDF.API.autoTable)await script('vendor/jspdf.plugin.autotable.min.js');return window.jspdf.jsPDF;})().catch(e=>{carregando=null;throw e;});return carregando;}
 function montar(JsPDF,r){
  const doc=new JsPDF({orientation:'portrait',unit:'mm',format:'a4'}),w=210;
  let y=19;
  const texto=(s,size=10,cor=[50,62,83])=>{doc.setFontSize(size);doc.setTextColor(...cor);const ls=doc.splitTextToSize(pdfTexto(s),178);for(const l of ls){if(y>275){doc.addPage();y=20;}doc.text(l,16,y);y+=size*.48;}y+=3;};
  const titulo=t=>{if(y>250){doc.addPage();y=20;}doc.setFont('helvetica','bold');texto(t,13,[35,62,143]);doc.setFont('helvetica','normal');};
  doc.setFillColor(35,62,143);doc.rect(0,0,w,5,'F');doc.setFont('helvetica','bold');texto('IMPRESILK | FINANCEIRO',11,[35,62,143]);texto(r.titulo,20,[30,44,68]);doc.setFont('helvetica','normal');
  texto(r.subtitulo,10);texto('Emitido em '+new Date().toLocaleString('pt-BR')+' | Uso gerencial e reservado',8);
  for(const n of r.notas||[])texto(n,9,[90,98,111]);
  for(const bloco of r.blocos){
   if(bloco.pagina){doc.addPage();y=20;}
   titulo(bloco.titulo);
   if(bloco.texto)texto(bloco.texto);
   if(bloco.barras?.length){
    if(y>210){doc.addPage();y=20;}
    const max=Math.max(1,...bloco.barras.map(x=>Math.abs(x.valor||0)));
    for(const x of bloco.barras){texto(x.nome+' · '+cfoValor(x.valor),9);doc.setFillColor(...(x.cor||(x.valor<0?[172,65,76]:[48,125,114])));doc.rect(16,y,Math.abs(x.valor||0)/max*170,3,'F');y+=8;}y+=7;
   }
   if(bloco.linhas){doc.autoTable({startY:y,head:[bloco.colunas.map(pdfTexto)],body:bloco.linhas.map(row=>row.map(pdfTexto)),margin:{left:16,right:16,top:18,bottom:18},styles:{font:'helvetica',fontSize:9,cellPadding:2.7,overflow:'linebreak',textColor:[40,52,76]},headStyles:{fillColor:[35,62,143],textColor:[255,255,255],fontSize:9},alternateRowStyles:{fillColor:[245,247,251]},rowPageBreak:'avoid',showHead:'everyPage',didDrawPage:()=>{}});y=doc.lastAutoTable.finalY+10;}
  }
  for(let i=1;i<=doc.getNumberOfPages();i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(100);doc.text('Impresilk · '+r.periodo+' · '+r.base,16,289);doc.text(i+' / '+doc.getNumberOfPages(),194,289,{align:'right'});}
  doc.setProperties({title:r.titulo,subject:r.subtitulo,author:'Impresilk'});return doc;
 }
 return {carregar,montar};
})();
function relatorioCFO(op={}){
 const label=op.periodo||state.periodo,reg=state.records.find(r=>r.label===label),a=DRECFO.analise(reg,state.records.find(r=>r.label===state.comparar)),base=op.base==='competencia'?'Competência':'Caixa gerencial';
 const r={titulo:'Análise financeira para decisão',subtitulo:label+' · '+(reg?.company||'Escopo não informado'),periodo:label,base,notas:[a.q.rotulo+' · '+a.q.mensagem,'Coleta/registro: '+dataBR(a.q.coletadoEm)+'. Leitura da nuvem: '+dataBR(state.updated)+'.','Os valores de caixa não são lucro contábil nem saldo bancário disponível.'],blocos:[]};
 if(a.incompleta)r.notas.push('Composição incompleta: pesos suspensos por valores inválidos.');
 const table=(titulo,colunas,linhas,texto)=>r.blocos.push({titulo,colunas,linhas,texto});
 if(op.tipo==='cenario'){
  r.titulo='Simulação de ponto de equilíbrio';r.base='Cenário informado';r.notas=['Premissas locais informadas pelo usuário, sem gravação na base. Não é previsão nem apuração contábil.','Mantém mix, preços e proporção variável; não inclui automaticamente financeiro, tributos sobre lucro ou expansão de capacidade.'];
  table('Premissas',['Premissa','Valor'],Object.entries(op.premissas).map(([k,v])=>[{receita:'Receita líquida',custoVariavel:'Gastos variáveis',fixos:'Gastos fixos',meta:'Meta operacional'}[k],cfoValor(v)]));
  table('Resultado do cenário',['Indicador','Valor'],[['Margem de contribuição',cfoValor(op.cenario.mc*100,true)],['Receita de equilíbrio',cfoValor(op.cenario.equilibrio)],['Receita para a meta',cfoValor(op.cenario.vendaMeta)]],'(Gastos fixos + meta) / margem de contribuição.');return r;
 }
 if(op.tipo==='rubrica'){
  const c=DRECompetencia.obter(state.cfg,safeId(label)),v=DREModelo.calcular(c?.valores||{});r.titulo=cfoNome(op.id);r.subtitulo=label+' · '+(c?.company||'Escopo não informado');r.notas=[statusCompetencia(c),'Fonte: '+(c?.fonte||'Não informada')+' · revisão '+dataBR(c?.revisadoEm),'Competência mensal informada. Os documentos individuais não estão vinculados nesta base.'];
  const m=DRECFO.margens[op.id],parts=m?[[m,1],['liquida',1]]:DRECFO.competencia[op.id]||[[op.id,1]];
  table('Composição',['Rubrica','Operação','Valor'],parts.map(([k,s])=>[cfoNome(k),m?'Numerador / denominador':s<0?'Subtrair':'Adicionar',cfoValor(v[k])]),m?'Razão entre as rubricas x 100; receita líquida deve ser positiva.':'Campos ausentes impedem subtotais.');table('Total',['Indicador','Valor'],[[cfoNome(op.id),cfoValor(v[op.id],!!m)]]);return r;
 }
 if(op.tipo==='origem'){
  r.titulo='Movimentos de origem da coleta';const es=DRECFO.origem(reg,op.code).eventos;
  table('Movimentos · '+es.length,['Data','Empresa / título','Conta original / O.S.','Valor'],es.map(e=>[e.data,e.empresa+' / '+e.tituloId,e.contaOrigem+' '+e.nomeConta+' / '+(e.ordensServico||[]).join(', '),cfoValor(e.valor)]),'Todos os movimentos desta seleção, sem limite de página da tela.');return r;
 }
 if(op.tipo==='conta'){
  const d=DRECFO.decompor(reg,op.code),comp=F.composicao(reg,op.code);r.titulo=reg?.cells?.find(x=>x.code===op.code)?.name||cfoNome(op.code);
  table('Valor e critério',['Item','Valor'],[['Valor no período',cfoValor(d.value)]],DRECFO.pergunta(r.titulo));
  if(DRECFO.caixa[op.code])table('Fórmula da regra gerencial',['Conta','Operação','Valor'],d.partes.map(x=>[x.code+' '+x.name,x.sinal<0?'Subtrair':'Adicionar',cfoValor(x.value)]),'Contas ausentes são zero na regra histórica, mas não comprovam ausência de movimentação.');
  if(comp.itens.length)table('Composição',['Conta','Descrição','Valor'],comp.itens.map(x=>[x.code,x.name,cfoValor(x.value)]));
  table('Histórico da conta',['Mês','Nome no mês','Valor','Cobertura'],state.records.slice().sort((a,b)=>monthSortKey(a.label)-monthSortKey(b.label)).map(x=>[x.label,x.cells?.find(c=>c.code===op.code)?.name||r.titulo,cfoValor(DRECFO.decompor(x,op.code).value),F.qualidade(x).rotulo]));r.notas.push(DRECFO.origem(reg,op.code).nota);return r;
 }
 if(op.tipo==='anual'){
  const d=dadosDRE();r.titulo=d.competencia?'DRE mensal por competência':'Demonstrativo mensal de caixa';r.subtitulo=label.split('/')[1]+' · referência '+label;
  r.notas=d.competencia?['Competência mensal informada; cada trimestre identifica as fontes e empresas. Campos ausentes não viram zero.','EBITDA soma a depreciação/amortização já incluída. Preenchimento não equivale a fechamento contábil.']:r.notas;
  const rows=d.competencia?DREModelo.linhas:linhasCaixa;
  for(let start=0;start<12;start+=3){const cols=d.cols.slice(start,start+3);r.blocos.push({titulo:(start/3+1)+'º trimestre',pagina:start>0,colunas:['Rubrica',...cols.map(x=>x.label)],linhas:[['Cobertura',...cols.map(x=>d.competencia?statusCompetencia(x.comp):F.qualidade(x.reg).rotulo)],['Empresas',...cols.map(x=>(d.competencia?x.comp:x.reg)?.company||'Não informado')],['Fonte',...cols.map(x=>d.competencia?x.comp?.fonte||'Não informada':x.reg?.origem||'Não informada')],...rows.map(x=>[x.nome,...d.valores.slice(start,start+3).map(v=>cfoValor(v[x.id],x.tipo==='ratio'))])]});}
  table('Acumulado de janeiro até '+label,['Rubrica','Acumulado'],rows.map(x=>[x.nome,cfoValor(d.soma[x.id],x.tipo==='ratio')]),'Sem valor quando falta mês ou há escopos diferentes. Meses parciais permanecem parciais.');return r;
 }
 table('Retrato do período',['Indicador','Registrado'],[['Entradas',cfoValor(a.entradas)],['Saídas',cfoValor(a.saidas)],['Variação',cfoValor(a.variacao)]]);
 r.blocos.push({titulo:'Composição visual',barras:[{nome:'Entradas',valor:a.entradas,cor:[48,125,114]},{nome:'Saídas',valor:a.saidas,cor:[185,107,67]},{nome:'Variação',valor:a.variacao,cor:[53,79,165]}].filter(x=>x.valor!=null)});
 table('Onde investigar',['Grupo','Valor','Peso','Pergunta para conferência'],a.ranking.map(x=>[x.name,cfoValor(x.value),x.peso==null?'—':x.peso.toFixed(1)+'%',x.pergunta]));
 if(state.comparar)table('Comparação com '+state.comparar,['Conta','Anterior','Atual','Diferença'],a.variacoes.map(x=>[x.name,cfoValor(x.anterior),cfoValor(x.atual),cfoValor(x.delta)]),a.comparavel?'Variações mensuradas; as causas precisam de conferência.':'Comparação suspensa por cobertura ou critérios incompatíveis.');
 if(op.tipo==='custos'){
  const cols=F.serieAnual(state.records,label,'2'),rows=linhasCustos();r.titulo='Despesas por mês · seleção de custos';
  for(let i=0;i<12;i+=3)table('Despesas · '+(i/3+1)+'º trimestre',['Conta',...cols.slice(i,i+3).map(x=>x.label)],rows.map(c=>[c.name,...cols.slice(i,i+3).map(x=>cfoValor(F.valorConta(x.reg,c.code)))]),'Seleção: '+(custoUI.busca||contaConhecida(custoUI.grupo))+'. Cada valor preserva a classificação e cobertura do seu mês.');
 } else if(op.tipo==='contas'){
  r.titulo='Contas detalhadas · '+label;
  const cells=(reg?.cells||[]).filter(c=>(state.tipo==='todos'||c.code.startsWith(state.tipo))&&(state.grupo==='todos'||c.code===state.grupo||c.code.startsWith(state.grupo+'.'))&&(!state.consulta||normalPDF(c.name+' '+c.code).includes(normalPDF(state.consulta))));
  table('Contas da seleção · '+cells.length,['Código','Descrição','Valor'],cells.map(c=>[c.code,c.name,cfoValor(F.valorConta(reg,c.code))]),'Totais e subcontas são níveis da mesma árvore: não devem ser somados entre si. Busca: '+(state.consulta||'todas')+'.');
 } else {
  table('Regra gerencial, linha por linha',['Rubrica','Valor'],linhasCaixa.map(x=>[x.nome,cfoValor(reg&&a.entradas!=null&&a.saidas!=null?F.resumo(reg)[x.id]:null)]));
  table('Conferências pendentes',['Ocorrência','Valor'],(reg?.pendencias||[]).map(x=>[x.texto||x.tipo,cfoValor(x.valor)]),'Ausência de pendência cadastrada não comprova conciliação.');
 }
 return r;
}
const normalPDF=s=>String(s||'').toLocaleLowerCase('pt-BR');
async function exportarCFO(op,button){
 const label=button?.textContent;try{const report=structuredClone(relatorioCFO(op));if(button){button.disabled=true;button.textContent='Preparando PDF…';}const Constructor=await PDFCFO.carregar();const doc=PDFCFO.montar(Constructor,report);doc.save('impresilk-'+(op.tipo||'analise')+'-'+safeId(report.periodo)+'.pdf');toast('PDF preparado com período, critérios e os dados da análise.');}catch(e){toast(e.message||'Não foi possível preparar o PDF.','err');}finally{if(button){button.disabled=false;button.textContent=label;}}
}
