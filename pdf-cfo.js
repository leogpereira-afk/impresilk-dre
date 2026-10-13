const pdfTexto=s=>String(s??'').replace(/[−–—]/g,'-').replace(/→/g,' > ').replace(/↗/g,'');
/* PDF preparado em memória no aparelho. Não envia dados a serviços externos. */
// Cor do dinheiro no PDF, igual a --blue e --red do tema claro: entrou em azul, saiu em vermelho.
const PDF_COR={entra:[40,74,199],sai:[162,53,58]};
// Classe de tom da tela (tom-entra, delta-bom...) para a chave de PDF_COR.
const pdfTom=c=>c==='tom-entra'||c==='delta-bom'?'entra':c==='tom-sai'||c==='delta-ruim'?'sai':'';
const pdfTomConta=(code,v)=>{const c=String(code??'');return typeof tomDoValor==='function'?pdfTom(tomDoValor(c.startsWith('1')?'entradas':c.startsWith('2')?'saidas':c,v)):'';};
const pdfTomLinha=(id,v)=>typeof tomDoValor==='function'?pdfTom(tomDoValor(id,v)):'';
const pdfTomSimples=(l,v)=>typeof dreTomSimples==='function'?pdfTom(dreTomSimples(l,v)):'';
const pdfTomDelta=(dir,d)=>typeof tomDelta==='function'?pdfTom(tomDelta(dir,d)):'';
const pdfDirConta=code=>typeof dirConta==='function'?dirConta(code):0;
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
    for(const x of bloco.barras){texto(x.nome+' · '+cfoValor(x.valor),9);doc.setFillColor(...(x.cor||(x.valor<0?PDF_COR.sai:PDF_COR.entra)));doc.rect(16,y,Math.abs(x.valor||0)/max*170,3,'F');y+=8;}y+=7;
   }
   if(bloco.linhas){doc.autoTable({startY:y,head:[bloco.colunas.map(pdfTexto)],body:bloco.linhas.map(row=>row.map(pdfTexto)),margin:{left:16,right:16,top:18,bottom:18},styles:{font:'helvetica',fontSize:9,cellPadding:2.7,overflow:'linebreak',textColor:[40,52,76]},headStyles:{fillColor:[35,62,143],textColor:[255,255,255],fontSize:9},alternateRowStyles:{fillColor:[245,247,251]},rowPageBreak:'avoid',showHead:'everyPage',didDrawPage:()=>{},didParseCell:d=>{const t=d.section==='body'&&bloco.tons?.[d.row.index]?.[d.column.index];if(t&&PDF_COR[t])d.cell.styles.textColor=PDF_COR[t];}});y=doc.lastAutoTable.finalY+10;}
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
 const table=(titulo,colunas,linhas,texto,tons)=>r.blocos.push({titulo,colunas,linhas,texto,...(tons?{tons}:{})});
 if(op.tipo==='cenario'){
  r.titulo='Simulação de ponto de equilíbrio';r.base='Cenário informado';r.notas=['Premissas locais informadas pelo usuário, sem gravação na base. Não é previsão nem apuração contábil.','Mantém mix, preços e proporção variável; não inclui automaticamente financeiro, tributos sobre lucro ou expansão de capacidade.'];
  table('Premissas',['Premissa','Valor'],Object.entries(op.premissas).map(([k,v])=>[{receita:'Receita líquida',custoVariavel:'Gastos variáveis',fixos:'Gastos fixos',meta:'Meta operacional'}[k],cfoValor(v)]));
  table('Resultado do cenário',['Indicador','Valor'],[['Margem de contribuição',cfoValor(op.cenario.mc*100,true)],['Receita de equilíbrio',cfoValor(op.cenario.equilibrio)],['Receita para a meta',cfoValor(op.cenario.vendaMeta)]],'(Gastos fixos + meta) / margem de contribuição.');return r;
 }
 if(op.tipo==='rubrica'){
  const c=DRECompetencia.obter(state.cfg,safeId(label)),v=DREModelo.calcular(c?.valores||{});r.titulo=cfoNome(op.id);r.subtitulo=label+' · '+(c?.company||'Escopo não informado');r.notas=[statusCompetencia(c),'Fonte: '+(c?.fonte||'Não informada')+' · revisão '+dataBR(c?.revisadoEm),'Competência mensal informada. Os documentos individuais não estão vinculados nesta base.'];
  const m=DRECFO.margens[op.id],parts=m?[[m,1],['liquida',1]]:DRECFO.competencia[op.id]||[[op.id,1]];
  table('Composição',['Rubrica','Operação','Valor'],parts.map(([k,s])=>[cfoNome(k),m?'Numerador / denominador':s<0?'Subtrair':'Adicionar',cfoValor(v[k])]),m?'Razão entre as rubricas x 100; receita líquida deve ser positiva.':'Campos ausentes impedem subtotais.',parts.map(([k])=>['','',pdfTomLinha(k,v[k])]));table('Total',['Indicador','Valor'],[[cfoNome(op.id),cfoValor(v[op.id],!!m)]],'',[['',m?'':pdfTomLinha(op.id,v[op.id])]]);return r;
 }
 if(op.tipo==='origem'){
  r.titulo='Movimentos de origem da coleta';const es=DRECFO.origem(reg,op.code).eventos;
  table('Movimentos · '+es.length,['Data','Empresa / título','Conta original / O.S.','Valor'],es.map(e=>[e.data,e.empresa+' / '+e.tituloId,e.contaOrigem+' '+e.nomeConta+' / '+(e.ordensServico||[]).join(', '),cfoValor(e.valor)]),'Todos os movimentos desta seleção, sem limite de página da tela.',es.map(e=>['','','',pdfTomLinha(e.natureza==='entrada'?'entradas':'saidas',e.valor)]));return r;
 }
 if(op.tipo==='conta'){
  const d=DRECFO.decompor(reg,op.code),comp=F.composicao(reg,op.code);r.titulo=reg?.cells?.find(x=>x.code===op.code)?.name||cfoNome(op.code);
  table('Valor e critério',['Item','Valor'],[['Valor no período',cfoValor(d.value)]],DRECFO.pergunta(r.titulo),[['',pdfTomConta(op.code,d.value)]]);
  if(DRECFO.caixa[op.code])table('Fórmula da regra gerencial',['Conta','Operação','Valor'],d.partes.map(x=>[x.code+' '+x.name,x.sinal<0?'Subtrair':'Adicionar',cfoValor(x.value)]),'Contas ausentes impedem subtotais dependentes. Zero deve estar informado explicitamente.',d.partes.map(x=>['','',pdfTomConta(x.code,x.value)]));
  if(comp.itens.length)table('Composição',['Conta','Descrição','Valor'],comp.itens.map(x=>[x.code,x.name,cfoValor(x.value)]),'',comp.itens.map(x=>['','',pdfTomConta(x.code,x.value)]));
  const hist=state.records.slice().sort((a,b)=>monthSortKey(a.label)-monthSortKey(b.label)).map(x=>({x,v:DRECFO.decompor(x,op.code).value}));
  table('Histórico da conta',['Mês','Nome no mês','Valor','Cobertura'],hist.map(({x,v})=>[x.label,x.cells?.find(c=>c.code===op.code)?.name||r.titulo,cfoValor(v),F.qualidade(x).rotulo]),'',hist.map(({v})=>['','',pdfTomConta(op.code,v),'']));r.notas.push(DRECFO.origem(reg,op.code).nota);return r;
 }
 if(op.tipo==='mensal'){
  const d=dadosDRE(),i=d.ate-1,j=d.cols.findIndex(x=>x.label===state.comparar),at=d.valores[i]||{},prev=d.valores[j]||{};
  const ok=d.competencia?!!d.cols[i]?.comp&&!!d.cols[j]?.comp&&d.cols[i].comp.company.trim().toLowerCase()===d.cols[j].comp.company.trim().toLowerCase():F.comparavelComRessalva(d.cols[i]?.reg,d.cols[j]?.reg).pode;
  r.titulo=d.competencia?'DRE por competência · '+label:'Caixa gerencial · '+label;
  r.notas=d.competencia?['Fonte: '+(d.cols[i]?.comp?.fonte||'Não informada'),'Competência informada. Ausências impedem subtotais; preenchimento não equivale a fechamento.']:r.notas;
  if(!d.competencia){
   // Caixa: as linhas da DRE Simples, as mesmas da tela (Fase 11: sem as rubricas antigas).
   const S=dreSimplesValores(d.cols.map(x=>x.label),i),dif=(a,b)=>Math.round((a-b)*100)/100;
   const dirS=id=>typeof DIRECAO_SIMPLES!=='undefined'?DIRECAO_SIMPLES[id]??0:0,par=x=>{const a=S.valor(i,x.id),b=j>=0?S.valor(j,x.id):null;return {a,b,d:ok&&a!=null&&b!=null?dif(a,b):null};};
   table('Mês e comparação · DRE Simples',['Linha',label,state.comparar||'Sem comparação','Variação'],S.linhas.map(x=>{const {a,b,d}=par(x);return [x.nome,cfoValor(a),cfoValor(b),d!=null?cfoValor(d):'Não comparável'];}),'Base de caixa: cada conta na linha da regra do plano; a DRE inteira fecha com entradas menos saídas do ERP.',S.linhas.map(x=>{const {a,b,d}=par(x);return ['',pdfTomSimples(x,a),pdfTomSimples(x,b),pdfTomDelta(dirS(x.id),d)];}));
   table('Acumulado até '+label,['Linha','Valor'],S.linhas.map(x=>[x.nome,cfoValor(S.acumulado?.[x.id]??null)]),'Mês sem dados no caminho deixa o acumulado sem valor. Meses parciais permanecem parciais.',S.linhas.map(x=>['',pdfTomSimples(x,S.acumulado?.[x.id]??null)]));return r;
  }
  // Competência: dinheiro pelo sentido da rubrica; margem (ratio) sem tom; variação pela direção da linha.
  const tomC=(x,v)=>x.tipo==='ratio'?'':pdfTomLinha(x.id,v),dirC=id=>typeof DIRECAO_DA_LINHA!=='undefined'?DIRECAO_DA_LINHA[id]??0:0;
  table('Mês e comparação',['Rubrica',label,state.comparar||'Sem comparação','Variação'],d.linhas.map(x=>[x.nome,cfoValor(at[x.id],x.tipo==='ratio'),cfoValor(prev[x.id],x.tipo==='ratio'),ok&&at[x.id]!=null&&prev[x.id]!=null?cfoValor(at[x.id]-prev[x.id],x.tipo==='ratio'):'Não comparável']),'Diferenças percentuais de margens são pontos percentuais.',d.linhas.map(x=>['',tomC(x,at[x.id]),tomC(x,prev[x.id]),ok&&at[x.id]!=null&&prev[x.id]!=null?pdfTomDelta(dirC(x.id),at[x.id]-prev[x.id]):'']));
  table('Acumulado até '+label,['Rubrica','Valor'],d.linhas.map(x=>[x.nome,cfoValor(d.soma[x.id],x.tipo==='ratio')]),'Ausência ou escopo diferente interrompe o acumulado.',d.linhas.map(x=>['',tomC(x,d.soma[x.id])]));return r;
 }
 if(op.tipo==='anual'){
  const d=dadosDRE();r.titulo=d.competencia?'DRE por competência, mês a mês':'Demonstrativo mensal de caixa';r.subtitulo=label.split('/')[1]+' · referência '+label;
  r.notas=d.competencia?['Competência mensal informada; cada trimestre identifica as fontes e empresas. Campos ausentes não viram zero.','EBITDA soma a depreciação/amortização já incluída. Preenchimento não equivale a fechamento contábil.']:r.notas;
  if(!d.competencia){
   const S=dreSimplesValores(d.cols.map(x=>x.label),d.ate-1);
   for(let start=0;start<12;start+=3){const cols=d.cols.slice(start,start+3);r.blocos.push({titulo:(start/3+1)+'º trimestre',pagina:start>0,colunas:['Linha',...cols.map(x=>x.label)],linhas:[['Cobertura',...cols.map(x=>F.qualidade(x.reg).rotulo)],['Empresas',...cols.map(x=>x.reg?.company||'Não informado')],['Fonte',...cols.map(x=>x.reg?.origem||'Não informada')],...S.linhas.map(x=>[x.nome,...cols.map((_,k)=>cfoValor(S.valor(start+k,x.id)))])],tons:[[],[],[],...S.linhas.map(x=>['',...cols.map((_,k)=>pdfTomSimples(x,S.valor(start+k,x.id)))])]});}
   table('Acumulado de janeiro até '+label,['Linha','Acumulado'],S.linhas.map(x=>[x.nome,cfoValor(S.acumulado?.[x.id]??null)]),'Sem valor quando falta mês. Meses parciais permanecem parciais.',S.linhas.map(x=>['',pdfTomSimples(x,S.acumulado?.[x.id]??null)]));return r;
  }
  const rows=DREModelo.linhas;
  for(let start=0;start<12;start+=3){const cols=d.cols.slice(start,start+3);r.blocos.push({titulo:(start/3+1)+'º trimestre',pagina:start>0,colunas:['Rubrica',...cols.map(x=>x.label)],linhas:[['Cobertura',...cols.map(x=>d.competencia?statusCompetencia(x.comp):F.qualidade(x.reg).rotulo)],['Empresas',...cols.map(x=>(d.competencia?x.comp:x.reg)?.company||'Não informado')],['Fonte',...cols.map(x=>d.competencia?x.comp?.fonte||'Não informada':x.reg?.origem||'Não informada')],...rows.map(x=>[x.nome,...d.valores.slice(start,start+3).map(v=>cfoValor(v[x.id],x.tipo==='ratio'))])],tons:[[],[],[],...rows.map(x=>['',...d.valores.slice(start,start+3).map(v=>x.tipo==='ratio'?'':pdfTomLinha(x.id,v[x.id]))])]});}
  table('Acumulado de janeiro até '+label,['Rubrica','Acumulado'],rows.map(x=>[x.nome,cfoValor(d.soma[x.id],x.tipo==='ratio')]),'Sem valor quando falta mês ou há escopos diferentes. Meses parciais permanecem parciais.',rows.map(x=>['',x.tipo==='ratio'?'':pdfTomLinha(x.id,d.soma[x.id])]));return r;
 }
 if(op.tipo==='contas'){
  r.titulo='Contas detalhadas · '+label;
  const cells=filtrarContas(reg),anterior=state.records.find(x=>x.label===state.comparar);
  r.notas.push('Filtros: busca '+(state.consulta||'todas')+' · movimento '+({todos:'entradas e saídas','1':'entradas','2':'saídas'}[state.tipo]||state.tipo)+' · grupo '+(state.grupo==='todos'?'todos':state.grupo)+'.');
  table('Contas da seleção · '+cells.length,['Código','Descrição',label,...(state.comparar?[state.comparar,'Diferença']:[])],cells.map(c=>{const cmp=F.compararConta(reg,anterior,c.code);return [c.code,c.name,cfoValor(F.valorConta(reg,c.code)),...(state.comparar?[cfoValor(cmp.anterior),cmp.permitida?cfoValor(cmp.delta):'Não comparável']:[])];}),'Totais e subcontas são níveis da mesma árvore: não devem ser somados entre si. Comparações exigem a mesma cobertura e classificação.',cells.map(c=>{const cmp=F.compararConta(reg,anterior,c.code);return ['','',pdfTomConta(c.code,F.valorConta(reg,c.code)),...(state.comparar?[pdfTomConta(c.code,cmp.anterior),cmp.permitida?pdfTomDelta(pdfDirConta(c.code),cmp.delta):'']:[])];}));return r;
 }
 table('Retrato do período',['Indicador','Registrado'],[['Entradas',cfoValor(a.entradas)],['Saídas',cfoValor(a.saidas)],['Variação',cfoValor(a.variacao)]],'',[['',pdfTomLinha('entradas',a.entradas)],['',pdfTomLinha('saidas',a.saidas)],['',pdfTomLinha('variacao',a.variacao)]]);
 r.blocos.push({titulo:'Composição visual',barras:[{nome:'Entradas',valor:a.entradas,cor:PDF_COR.entra},{nome:'Saídas',valor:a.saidas,cor:PDF_COR.sai},{nome:'Variação',valor:a.variacao,cor:a.variacao<0?PDF_COR.sai:PDF_COR.entra}].filter(x=>x.valor!=null)});
 table('Onde investigar',['Grupo','Valor','Peso','Pergunta para conferência'],a.ranking.map(x=>[x.name,cfoValor(x.value),x.peso==null?'—':x.peso.toFixed(1)+'%',x.pergunta]),'',a.ranking.map(x=>['',pdfTomConta(x.code,x.value)]));
 if(state.comparar)table('Comparação com '+state.comparar,['Conta','Anterior','Atual','Diferença'],a.variacoes.map(x=>[x.name,cfoValor(x.anterior),cfoValor(x.atual),cfoValor(x.delta)]),a.comparavel?(a.comp?.ressalva?'Variações mensuradas. Cobertura da coleta ainda não validada nos dois meses — confira a origem antes de decidir.':'Variações mensuradas; as causas precisam de conferência.'):(a.comp?.motivo||'Comparação suspensa por cobertura ou critérios incompatíveis.'),a.variacoes.map(x=>['',pdfTomConta(x.code,x.anterior),pdfTomConta(x.code,x.atual),pdfTomDelta(pdfDirConta(x.code),x.delta)]));
 if(op.tipo==='custos'){
  const cols=F.serieAnual(state.records,label,'2'),rows=linhasCustos();r.titulo='Despesas por mês · seleção de custos';
  for(let i=0;i<12;i+=3)table('Despesas · '+(i/3+1)+'º trimestre',['Conta',...cols.slice(i,i+3).map(x=>x.label)],rows.map(c=>[c.name,...cols.slice(i,i+3).map(x=>cfoValor(F.valorConta(x.reg,c.code)))]),'Seleção: '+(custoUI.busca||contaConhecida(custoUI.grupo))+'. Cada valor preserva a classificação e cobertura do seu mês.',rows.map(c=>['',...cols.slice(i,i+3).map(x=>pdfTomConta(c.code,F.valorConta(x.reg,c.code)))]));
 } else {
  const ds=reg?DRESimples.apurar(reg):null;
  table('DRE Simples, linha por linha',['Linha','Valor'],DRESimples.LINHAS.map(x=>[x.nome,cfoValor(ds?ds.linhas[x.id]:null)]),'As mesmas linhas da tela da DRE (base de caixa).',DRESimples.LINHAS.map(x=>['',pdfTomSimples(x,ds?ds.linhas[x.id]:null)]));
  table('Conferências pendentes',['Ocorrência','Valor'],(reg?.pendencias||[]).map(x=>[x.texto||x.tipo,cfoValor(x.valor)]),'Ausência de pendência cadastrada não comprova conciliação.',(reg?.pendencias||[]).map(x=>['',pdfTomConta(x.conta,x.valor)]));
 }
 return r;
}
const normalPDF=s=>String(s||'').toLocaleLowerCase('pt-BR');
async function exportarCFO(op,button){
 const label=button?.textContent;try{const report=structuredClone(relatorioCFO(op));if(button){button.disabled=true;button.textContent='Preparando PDF…';}const Constructor=await PDFCFO.carregar();const doc=PDFCFO.montar(Constructor,report);doc.save('impresilk-'+(op.tipo||'analise')+'-'+safeId(report.periodo)+'.pdf');toast('PDF preparado com período, critérios e os dados da análise.');}catch(e){toast(e.message||'Não foi possível preparar o PDF.','err');}finally{if(button){button.disabled=false;button.textContent=label;}}
}
