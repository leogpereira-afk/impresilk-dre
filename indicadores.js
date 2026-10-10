import * as M from './indicadores-modelo.mjs?v=101';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const br=v=>v==null?'Não informado':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const data=s=>s?new Date(s.length===10?s+'T12:00:00':s).toLocaleString('pt-BR',s.length===10?{dateStyle:'short'}:{dateStyle:'short',timeStyle:'short'}):'Não registrada';
const pct=v=>v==null?'Indeterminada':v.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const config={
 Receita:{pergunta:'O que foi vendido, faturado e recebido?',fontes:[['recebimentos','Recebimentos'],['comercial','O.S. comerciais'],['fiscal','NF-e'],['competencia','Competência']]},
 Custos:{pergunta:'O que sabemos sobre o custo de cada trabalho?',fontes:[['custos','O.S. e custos'],['compras','Notas de compra']]},
 Despesas:{pergunta:'Onde se concentram os pagamentos?',fontes:[['pagamentos','Pagamentos por conta']]},
 Resultado:{pergunta:'Qual é o resultado e como ele se diferencia do caixa?',fontes:[['variacao','Movimento de caixa'],['competencia','DRE por competência']]},
 Margem:{pergunta:'Quanto sobra na base de custos informada?',fontes:[['margem','Margem parcial por O.S.'],['competencia','Margens da DRE']]},
 Rentabilidade:{pergunta:'Quais dados faltam para medir o retorno do capital?',fontes:[['rentabilidade','Capital e investimentos']]}
};
const ui={area:'Receita',fonte:'recebimentos',preset:'mes',rangeOpen:false,periodo:null,label:'',excecao:'todas',query:'',dimensao:'grupo',grupo:'',pagina:0,cache:new Map(),seq:0,modelo:null,busy:false,erro:'',container:null,ctx:null};
const bot=(text,attrs='',cls='')=>`<button type="button" class="${cls}" ${attrs}>${esc(text)}</button>`;
const metric=(label,value,desc,cls='')=>`<button type="button" class="ind-metric ${cls}" data-formula><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(desc)}</small></button>`;
function fonteLocal(){return ['recebimentos','pagamentos','variacao','competencia','rentabilidade'].includes(ui.fonte);}
function filtros(){return {query:ui.query,grupo:ui.grupo,dimensao:ui.dimensao,pagina:ui.pagina};}
function snapshot(){return {excecao:ui.excecao,area:ui.area,fonte:ui.fonte,periodo:{...ui.periodo},query:ui.query,grupo:ui.grupo,dimensao:ui.dimensao,pagina:ui.pagina};}
function chave(){return JSON.stringify(snapshot());}
function competencia(){
 const months=[];let d=new Date(ui.periodo.de+'T00:00:00Z');d.setUTCDate(1);while(d.toISOString().slice(0,10)<=ui.periodo.ate){const label=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getUTCMonth()]+'/'+d.getUTCFullYear();months.push({label,reg:ui.ctx.cfg?.demonstrativosCompetencia?.meses?.[label.replace('/','_')]});d.setUTCMonth(d.getUTCMonth()+1);}
 const completos=months.every(x=>x.reg),mesInteiro=ui.periodo.de.endsWith('-01')&&new Date(ui.periodo.ate+'T00:00:00Z').getUTCDate()===new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0)).getUTCDate();
 const escopos=new Set(months.filter(x=>x.reg).map(x=>String(x.reg.company||'').trim().toLowerCase()));
 const consolidado=escopos.size===1&&[...escopos][0]==='impresilk + universo';
 const values=completos&&mesInteiro&&consolidado?window.DREModelo.acumulado(months.map(x=>x.reg)):window.DREModelo.calcular({});
 const ids=ui.area==='Receita'?['bruta','deducoes','liquida']:['liquida','custos','bruto','operacional','financeiro','antesTributos','liquido','ebitda'];
 const rows=ids.map(id=>({id,numero:id,nome:window.DREModelo.linhas.find(l=>l.id===id)?.nome||id,grupo:'Rubrica da DRE',valor:values[id],origem:months.map(x=>x.reg?.fonte||'Sem preenchimento').join(' / ')}));
 return {disponivel:completos&&mesInteiro&&consolidado,qualidade:'Parcial',rows,total:rows.length,valor:null,grupos:[],evolucao:[],pagina:0,paginas:1,values,fontes:months.map(x=>({periodo:x.label,em:x.reg?.revisadoEm||null,conciliado:false})),avisos:[...(!completos?['Há meses sem apuração por competência.']:[]),...(!mesInteiro?['A competência exige meses inteiros; não distribui rubricas mensais por dia.']:[]),...(!consolidado?['A apuração precisa identificar o mesmo consolidado: Impresilk + Universo.']:[])],limite:M.DICIONARIO.competencia.limite};
}
function montarLocal(todos=false){
 if(ui.fonte==='rentabilidade')return {disponivel:false,qualidade:'Indisponível',total:0,rows:[],fontes:[],avisos:[],limite:M.DICIONARIO.rentabilidade.limite};
 if(ui.fonte==='competencia')return competencia();
 const a=M.caixa(ui.ctx.records,ui.periodo,'entrada'),b=M.caixa(ui.ctx.records,ui.periodo,'saida');let base=ui.fonte==='recebimentos'?a:b;
 if(ui.fonte==='variacao')base={...a,disponivel:a.disponivel&&b.disponivel,qualidade:a.qualidade==='Apurado'&&b.qualidade==='Apurado'?'Apurado':'Parcial',rows:[...a.rows.map(r=>({...r,grupo:'Recebimentos'})),...b.rows.map(r=>({...r,valor:r.valor==null?null:-r.valor,grupo:'Pagamentos'}))],avisos:[...new Set([...a.avisos,...b.avisos])],limite:M.DICIONARIO.variacao.limite};
 return {...base,...M.resumir(base.rows,{...filtros(),pagina:todos?0:ui.pagina,tamanho:todos?Math.max(1,base.rows.length):50}),allRows:base.rows};
}
async function consultarIndicadores(todos){
 const ex=ui.fonte==='margem'&&ui.excecao!=='todas';
 const r=await ui.ctx.api('indicadores',{fonte:ui.fonte,...ui.periodo,...filtros(),...(todos||ex?{pagina:0,exportar:true}:{})});
 if(!r.ok||!ex)return r;
 if(r.rows.length!==r.total)throw new Error('A lista de exceções exige todos os registros da fonte. Reduza o intervalo.');
 const rows=r.rows.filter(x=>ui.excecao==='custo-maior'?x.venda!=null&&x.custo!=null&&x.custo>x.venda:x.venda==null||x.custo==null||x.venda<=0);
 return {...r,...M.resumir(rows,{...filtros(),pagina:todos?0:ui.pagina,tamanho:todos?Math.max(1,rows.length):50})};
}
async function carregar(forcar=false){
 if(fonteLocal()){ui.modelo=montarLocal();ui.erro='';ui.busy=false;pintar();return;}
 const key=chave(),cached=ui.cache.get(key);if(!forcar&&cached&&Date.now()-cached.em<60000){ui.modelo=cached.valor;ui.erro='';ui.busy=false;pintar();return;}
 const seq=++ui.seq;ui.modelo=null;ui.busy=true;ui.erro='';pintar();
 try{const r=await consultarIndicadores(false);if(!r.ok)throw new Error(r.erro||'Consulta não confirmada.');if(seq!==ui.seq||key!==chave())return;ui.cache.set(key,{em:Date.now(),valor:r});if(ui.cache.size>30)ui.cache.delete(ui.cache.keys().next().value);ui.modelo=r;}
 catch(e){if(seq!==ui.seq||key!==chave())return;ui.modelo=cached?.valor||null;ui.erro=(/desconhecida/.test(e.message)?'O conector de indicadores ainda não foi publicado. As análises da DRE continuam disponíveis.':e.message)+(cached?' Mostrando a última leitura deste filtro.':' Nenhum zero foi assumido.');}
 finally{if(seq===ui.seq&&key===chave()){ui.busy=false;pintar();}}
}
function reset(){ui.excecao='todas';ui.query='';ui.grupo='';ui.pagina=0;ui.dimensao=['custos','margem'].includes(ui.fonte)?'cliente':'grupo';ui.seq++;ui.modelo=null;ui.erro='';}
function bars(items,interactive=true){const max=Math.max(1,...items.map(r=>Math.abs(r.valor)));return `<div class="ind-bars">${items.slice(0,8).map(r=>`<${interactive?'button':'div'} ${interactive?`type="button" data-group="${esc(r.nome)}"`:''} class="ind-bar"><span>${esc(r.nome)} <small>${r.quantidade} registro(s)</small></span><span class="ind-track"><i style="width:${Math.abs(r.valor)/max*100}%" class="${moneyTone(r.valor)==='tom-sai'?'negative':''}"></i></span><b class="${moneyTone(r.valor)}">${esc(br(r.valor))}${r.ausentes?' *':''}</b></${interactive?'button':'div'}>`).join('')}</div>`;}
function moneyTone(value){if(value==null||Number(value)===0)return '';const out=['pagamentos','custos','compras','margem'].includes(ui.fonte);return (value>0)!==out?'tom-entra':'tom-sai';}
function tabela(rows,detail=true){return `<div class="ind-table"><table><thead><tr><th>Registro</th><th>Nome / origem</th><th>Data</th><th>${ui.fonte==='margem'?'Venda / custo informado':'Valor'}</th>${detail?'<th><span class="sr-only">Detalhes</span></th>':''}</tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.numero||r.id)}</td><td><b>${esc(r.nome||'Não informado')}</b><small>${esc(r.grupo||r.origem)}</small></td><td>${esc(r.data?data(r.data):'Não atribuída')}</td><td class="num ${moneyTone(r.valor)}">${ui.fonte==='margem'?`${esc(br(r.venda))}<small>${esc(br(r.custo))} · ${esc(pct(M.margem(r.venda,r.custo)))}</small>`:esc(br(r.valor))}</td>${detail?`<td>${bot('Ver',`data-row="${i}" aria-label="Ver registro ${esc(r.numero||r.id)}"`,'ind-text')}</td>`:''}</tr>`).join('')}</tbody></table></div>`;}
function dependencias(){const items=ui.fonte==='rentabilidade'?[
 ['Resultado','Apuração por competência do período e fonte revisada.'],['Capital médio','Balanço de abertura e encerramento, PL, ativos e capital investido.'],['Investimentos','Aportes e fluxos incrementais, com datas e vínculo ao investimento.']]:[
 ['Materiais e estoque','Consumo por O.S., unidade original, conversão e custo histórico. Compra não comprova consumo.'],['Mão de obra e processos','Horas produtivas, encargos e capacidade normal. Apontamento zero não comprova execução.'],['Equipamentos e rateios','Depreciação, energia e manutenção identificadas; evitar repetir componentes incluídos na taxa por hora.']];
 return `<details class="ind-panel" ${''}><summary>${ui.fonte==='rentabilidade'?'Para calcular o retorno com segurança':'O que falta para apurar o custo realizado'}</summary><div class="ind-dependencies">${items.map(([t,d])=>`<div><b>${esc(t)}</b><p>${esc(d)}</p><span class="ind-tag">Pendente de validação</span></div>`).join('')}</div></details>`;}
const curto=v=>Number(v).toLocaleString('pt-BR',{notation:'compact',maximumFractionDigits:1});
const mesesGrafico=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function mesGrafico(p){
 const iso=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(p||'');
 if(iso)return mesesGrafico[Number(iso[2])-1]+'/'+iso[1];
 return /^(Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)\/\d{4}$/.test(p||'')?p:null;
}
function grafico(items,{unidade='R$',saida=false}={}){
 const validos=items.filter(x=>x.valor!=null&&Number.isFinite(x.valor));
 const mensal=items.length>0&&items.every(x=>mesGrafico(x.periodo));
 const slot=Math.max(76,...items.map(x=>(x.valor==null?1:curto(x.valor).length+(x.parcial?1:0))*7+16));
 const w=mensal?Math.max(560,items.length*slot+20):560,h=validos.length?166:92,left=10,right=10,top=25,bottom=32;
 const max=Math.max(0,...validos.map(x=>x.valor)),min=Math.min(0,...validos.map(x=>x.valor)),range=max-min||1;
 const y=v=>top+(max-v)/range*(h-top-bottom),zero=y(0),passo=(w-left-right)/Math.max(items.length,1),bar=Math.min(64,passo*.58);
 const fmt=v=>unidade==='R$'?br(v):unidade==='%'?pct(v):String(v);
 return `<div class="ind-plot ${mensal?'ind-plot-months':''} ${validos.length?'':'ind-plot-empty'}" ${mensal?`style="--plot-width:${w}px"`:''}><svg viewBox="0 0 ${w} ${h}" role="${mensal?'group':'img'}" aria-label="${esc(items.map(x=>x.nome+': '+(x.valor==null?'Não apurado':fmt(x.valor))).join('; '))}"><line x1="${left}" x2="${w-right}" y1="${zero}" y2="${zero}" class="ind-zero"/>${items.map((x,i)=>{
 const px=left+passo*(i+.5),known=x.valor!=null&&Number.isFinite(x.valor),yy=known?y(x.valor):zero;
 const tone=x.tom||(saida?(x.valor<0?'entrada':'saida'):(x.valor<0?'saida':'entrada'));
 const mes=mesGrafico(x.periodo),selected=mensal&&M.periodoRotulo(mes).de===ui.periodo.de&&M.periodoRotulo(mes).ate===ui.periodo.ate;
 return `<g ${mensal?`class="ind-month${selected?' selected':''}" data-ind-period="${esc(mes)}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="Ver ${esc(mes)} no painel · ${known?esc(fmt(x.valor)):'Não apurado'}"`:''}><title>${esc(x.periodo||x.nome)}: ${known?esc(fmt(x.valor)):'Não apurado'}${x.nota?' · '+esc(x.nota):''}</title>${mensal?`<rect x="${left+passo*i+2}" y="1" width="${passo-4}" height="${h-2}" rx="6" class="ind-month-hit"/>`:''}${known?`<rect x="${px-bar/2}" y="${Math.min(yy,zero)}" width="${bar}" height="${Math.max(1,Math.abs(yy-zero))}" rx="3" class="ind-fill-${tone}${x.parcial?' ind-partial':''}"/>`:''}<text x="${px}" y="${known?(x.valor<0?Math.min(h-bottom+15,yy+13):Math.max(13,yy-7)):zero-8}" text-anchor="middle" class="ind-value">${known?esc(curto(x.valor))+(unidade==='%'?'%':'')+(x.parcial?'*':''):'—'}</text><text x="${px}" y="${h-9}" text-anchor="middle" class="ind-axis">${esc(x.nome)}</text></g>`;
 }).join('')}</svg>${!validos.length?'<p class="ind-chart-empty">Sem base suficiente para traçar valores. Ausência não é zero.</p>':''}</div>`;
}
function painelGrafico(titulo,nota,items,op={}){
 const mensal=items.length>0&&items.every(x=>mesGrafico(x.periodo));
 return `<section class="ind-panel ind-chart${mensal?' ind-chart-months':''}"><div class="ind-chart-title"><h3>${esc(titulo)}</h3><span>${esc(op.unidade||'R$')}</span></div>${grafico(items,op)}${mensal?'<p class="ind-month-hint">Clique no mês para aplicar em todo o painel.</p>':''}<p class="ind-chart-caption">${esc(nota)}</p><details class="ind-chart-data"><summary>Ver valores e critérios</summary><table><thead><tr><th>Referência</th><th>Valor</th><th>Leitura</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.periodo||x.nome)}</td><td>${esc(x.valor==null?'Não apurado':op.unidade==='%'?pct(x.valor):op.unidade==='O.S.'?String(x.valor):br(x.valor))}</td><td>${esc(x.nota||'Registros do filtro atual')}</td></tr>`).join('')}</tbody></table></details></section>`;
}
function historicoCompetencia(){
 const d=new Date(ui.periodo.ate+'T00:00:00Z');
 return Array.from({length:12},(_,i)=>{
  const p=M.periodoRotulo(['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][new Date(Date.UTC(d.getUTCFullYear(),i,1)).getUTCMonth()]+'/'+new Date(Date.UTC(d.getUTCFullYear(),i,1)).getUTCFullYear());
  const dt=new Date(p.de+'T00:00:00Z'),label=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][dt.getUTCMonth()]+'/'+dt.getUTCFullYear(),r=ui.ctx.cfg?.demonstrativosCompetencia?.meses?.[label.replace('/','_')];
  const v=r?window.DREModelo.calcular(r.valores||{}):{};
  const key=ui.area==='Margem'?'margemLiquida':ui.area==='Receita'?'liquida':'liquido';
  return {nome:label.slice(0,3),periodo:label,valor:v[key]??null,nota:r?[r.company,r.fonte,'Competência informada; conferir apuração'].filter(Boolean).join(' · '):'Sem apuração para este mês'};
 });
}
function analises(m){
 const saida=['custos','compras','pagamentos'].includes(ui.fonte);let html='';
 if(['recebimentos','pagamentos','variacao'].includes(ui.fonte)){
  const serie=M.historicoCaixa(ui.ctx.records,ui.periodo,ui.fonte,filtros());
  html+=painelGrafico(ui.fonte==='variacao'?'Evolução da variação de caixa':'Comparativo mensal',`Janeiro a dezembro de ${ui.periodo.ate.slice(0,4)} · mesmos filtros. * Cobertura a conferir. Consulte a base de cada mês nos valores e critérios.`,serie,{saida});
  if(ui.fonte!=='variacao'&&!ui.query&&!ui.grupo){
   const cp=M.compararCaixa(ui.ctx.records,ui.periodo,saida?'saida':'entrada');
   if(cp.disponivel)html+=painelGrafico('Mês atual × anterior',`Mesmos ${cp.dias} dias · variação ${br(cp.delta)} (${pct(cp.percentual)}).`,[{nome:'Anterior',valor:cp.anterior},{nome:'Atual',valor:cp.atual}],{saida});else html=html.replace('</section>',`<p class="ind-comparison-limit"><b>Variação percentual indisponível.</b> ${esc(cp.motivo)}</p></section>`);
  }else if(ui.fonte==='variacao'){
   const rows=m.allRows||[],s=M.resumir(rows,{...filtros(),pagina:0,tamanho:Math.max(1,rows.length)}).rows;
   const soma=grupo=>{const r=s.filter(x=>x.grupo===grupo);return r.length?M.soma(r.map(x=>grupo==='Pagamentos'&&x.valor!=null?-x.valor:x.valor)):null;};
   html+=painelGrafico('Entradas × saídas do filtro','Movimento financeiro registrado. A diferença não representa lucro nem saldo bancário.',[{nome:'Entradas',valor:soma('Recebimentos'),tom:'entrada'},{nome:'Saídas',valor:soma('Pagamentos'),tom:'saida'}]);
  }
 }else if(['custos','margem'].includes(ui.fonte)){
  html+=painelGrafico('Venda × custo informado',`${m.pares||0} O.S. com os dois valores e venda positiva. Comparação da mesma população; não comprova custo realizado.`,M.comparativoPares(m));
  if(ui.fonte==='margem')html+=painelGrafico('Onde investigar a margem','Contagem de O.S. no filtro. Não há margem para venda ausente, nula ou negativa.',m.disponivel?[{nome:'Custo ≤ venda',valor:m.pares-m.negativas,tom:'entrada'},{nome:'Custo > venda',valor:m.negativas,tom:'saida'},{nome:'Sem par',valor:m.total-m.pares,tom:'aviso'}]:[],{unidade:'O.S.'});
  else html+=painelGrafico('Cobertura dos custos','Valores ausentes exigem conferência. Sem datas das O.S., não é possível traçar uma evolução mensal confiável.',m.disponivel?[{nome:'Com custo',valor:m.comValor,tom:'entrada'},{nome:'Sem custo',valor:m.total-m.comValor,tom:'aviso'}]:[],{unidade:'O.S.'});
 }else if(ui.fonte==='competencia'||ui.fonte==='rentabilidade'){
  const margem=ui.area==='Margem';
  html+=painelGrafico(margem?'Margem líquida por mês':ui.area==='Receita'?'Receita líquida por mês':'Resultado líquido por mês','Competência do consolidado. Meses sem apuração permanecem em branco; não há previsão automática.',historicoCompetencia(),{unidade:margem?'%':'R$'});
  if(ui.fonte==='rentabilidade')html+=`<section class="ind-panel ind-chart ind-return"><h3>Retorno sobre o capital</h3><div class="ind-return-row"><b>ROE</b><span>Lucro líquido ÷ patrimônio médio</span><strong>Não apurado</strong></div><div class="ind-return-row"><b>ROA</b><span>Lucro líquido ÷ ativos médios</span><strong>Não apurado</strong></div><div class="ind-return-row"><b>ROI</b><span>Resultado do investimento ÷ capital</span><strong>Não apurado</strong></div><p class="ind-chart-caption">Faltam bases de capital validadas. O gráfico ao lado mostra o resultado usado na análise, não uma taxa de retorno.</p></section>`;
  else html+=painelGrafico(margem?'Margens da DRE':'Composição do resultado',margem?'Mesma receita líquida como denominador. Indicadores dependem da apuração das rubricas.':'Subtotais da DRE, não somar as barras entre si.',margem?[{nome:'Bruta',valor:m.values?.margemBruta??null},{nome:'Operacional',valor:m.values?.margemOperacional??null},{nome:'Líquida',valor:m.values?.margemLiquida??null}]:m.rows.filter(x=>['liquida','custos','operacional','liquido'].includes(x.id)).map(x=>({nome:{liquida:'Rec. líquida',custos:'Custos',operacional:'Operacional',liquido:'Líquido'}[x.id],valor:x.valor,tom:x.id==='custos'?'saida':x.valor<0?'saida':'entrada'})),{unidade:margem?'%':'R$'});
 }else{
  const items=(m.evolucao||[]).filter(x=>x.nome!=='Sem data').map(x=>({...x,periodo:x.nome,nome:x.nome.slice(5)+'/'+x.nome.slice(2,4)}));
  html+=painelGrafico('Evolução no intervalo','Registros datados e filtrados desta fonte. Não inclui meses fora da importação.',items,{saida});
 }
 if(m.grupos?.length)html+=`<section class="ind-panel ind-chart ind-composition"><div class="ind-chart-title"><h3>${['custos','margem','compras'].includes(ui.fonte)?'Composição dos custos':ui.fonte==='pagamentos'?'Principais pagamentos':'Composição dos valores'}</h3><span>R$</span></div>${bars(m.grupos)}<p class="ind-chart-caption">Até 8 grupos por valor absoluto · clique para investigar. ${m.grupos.length>8?'Demais grupos disponíveis nos registros e na planilha.':''}</p></section>`;
 return `<div class="ind-analysis" aria-label="Gráficos da análise">${html}</div>`;
}

function resultado(m){
 if(!m)return ui.busy?'<p class="ind-empty" role="status">Consultando esta análise…</p>':'';
 if(!m.disponivel){
  const comp=ui.fonte==='competencia',capital=ui.fonte==='rentabilidade';
  const title=comp?'Competência ainda não preenchida':capital?'Rentabilidade depende da base de capital':'Sem importação para o intervalo selecionado';
  const history=(comp||capital)&&historicoCompetencia().some(x=>x.valor!=null);
  return `<section class="source-empty"><h3>${title}</h3><p>${comp?'A base de caixa está disponível. Para apurar lucro e margens, informe as rubricas reconhecidas no mês e a fonte da apuração.':capital?'O cálculo precisa do resultado por competência e dos saldos de capital compatíveis com o período.':m.recorte?'A fonte mais recente disponível cobre '+data(m.recorte.de)+' a '+data(m.recorte.ate)+'. Esses valores não pertencem ao período selecionado.':'Esta fonte ainda não tem uma importação concluída.'}</p><div class="actions">${m.recorte?bot('Ver dados de '+data(m.recorte.de)+' a '+data(m.recorte.ate),'data-recorte','primary'):''}${comp||capital?bot('Abrir apuração por competência','data-dre','primary'):''}</div><details><summary>Fontes e dados necessários</summary><p>${esc(m.limite||M.DICIONARIO[ui.fonte].limite)}</p>${(m.avisos||[]).map(a=>`<p>${esc(a)}</p>`).join('')}${(m.fontes||[]).map(f=>`<p>${esc(f.periodo)} · atualização ${data(f.em)}</p>`).join('')}</details></section>${history?analises(m):''}${capital?dependencias():''}`;
 }
 let metrics='';if(ui.fonte==='competencia'){metrics=metric('Receita líquida',br(m.values.liquida),'Competência informada')+metric('Lucro / prejuízo líquido',br(m.values.liquido),'Não é variação de caixa')+metric('Margem líquida',pct(m.values.margemLiquida),'Resultado ÷ receita líquida');}
 else if(ui.fonte==='margem')metrics=metric('Margem parcial',m.disponivel?pct(m.margem):'Indisponível',`${m.pares} O.S. com venda positiva e custo · mesma fonte e recorte`)+metric('Custo maior que venda',m.disponivel?String(m.negativas):'Indisponível','Investigar composição; não comprova prejuízo','warn')+metric('Sem par de valores',m.disponivel?String(m.total-m.pares):'Indisponível','Margem indeterminada');
 else metrics=metric(M.DICIONARIO[ui.fonte].nome,m.disponivel?br(m.valor):'Indisponível',m.somaCompleta===false?'Soma conhecida, há valores ausentes':M.DICIONARIO[ui.fonte].base)+metric('Registros no filtro',m.disponivel?String(m.total):'Indisponível','Recorte consultado, não universo do ERP')+metric('Com valor informado',m.disponivel?`${m.comValor} de ${m.total}`:'Indisponível','Cobertura dentro dos registros filtrados');
 const sources=`<details class="ind-panel ind-sources"><summary>Origem, atualização e memória de cálculo</summary><p>${esc(M.DICIONARIO[ui.fonte].formula)}</p><p>${esc(m.limite||M.DICIONARIO[ui.fonte].limite)}</p>${(m.fontes||[]).map(f=>`<p><b>${esc(f.periodo||'Fonte')}</b> · atualizado ${esc(data(f.em))} · corte ${esc(f.corte||'Não confirmado')}${['recebimentos','pagamentos'].includes(ui.fonte)?' · conciliação bancária '+(f.conciliado?'registrada':'não comprovada'):' · validar período e população da fonte'}</p>`).join('')}${bot('Como este valor foi calculado?','data-formula','ind-text')}</details>`;
 const table=m.rows.length?`<section class="ind-panel"><div class="ind-heading"><h3>Registros e origem</h3><span>${m.total} registros · página ${m.pagina+1}/${m.paginas}</span></div>${tabela(m.rows)}<div class="ind-pagination">${bot('Anterior',`data-page="${m.pagina-1}" ${m.pagina===0?'disabled':''}`)}${bot('Próxima',`data-page="${m.pagina+1}" ${m.pagina+1>=m.paginas?'disabled':''}`)}</div></section>`:`<p class="ind-empty">${m.disponivel?'Nenhum registro encontrado nesse filtro. Confira cobertura e período antes de concluir ausência de movimentação.':'Não há fonte suficiente para calcular neste intervalo.'}</p>`;
 return `<div class="ind-metrics" data-tone="${moneyTone(m.valor)}">${metrics}</div><div class="ind-note">${esc(m.limite||'')}${m.avisos?.length?`<details><summary>Critérios e cobertura da fonte</summary>${m.avisos.map(s=>`<p>${esc(s)}</p>`).join('')}</details>`:''}</div>${analises(m)}${table}${['custos','margem','compras'].includes(ui.fonte)?dependencias():''}${ui.fonte==='competencia'?bot('Abrir DRE mensal para conferir rubricas','data-dre'):''}${sources}`;
}
function pintar(){
 if(!ui.container?.isConnected)return;const m=ui.modelo,remote=!fonteLocal();
 ui.container.innerHTML=`<div class="indicadores" data-fonte="${esc(ui.fonte)}"><nav class="ind-nav" aria-label="Áreas dos indicadores">${M.AREAS.map(a=>bot(a,`data-area="${a}" aria-pressed="${a===ui.area}"`,a===ui.area?'selected':'')).join('')}</nav><div class="ind-heading"><div><h2>${ui.area}</h2><p>${config[ui.area].pergunta}</p></div><span class="ind-tag">${M.ESCOPO}</span></div><nav class="ind-subnav" aria-label="Base da análise">${config[ui.area].fontes.map(([f,l])=>bot(l,`data-source="${f}" aria-pressed="${f===ui.fonte}"`,f===ui.fonte?'selected':'')).join('')}</nav>
 <form class="ind-filters" id="indFilters"><details class="ind-range" ${ui.rangeOpen||ui.preset!=='mes'?'open':''}><summary>Intervalo personalizado</summary><div class="ind-range-fields"><label>Intervalo<select name="preset">${[['mes','Mês'],['trimestre','Trimestre'],['semestre','Semestre'],['ano','Ano'],['12meses','Últimos 12 meses'],['personalizado','Personalizado']].map(([v,t])=>`<option value="${v}" ${ui.preset===v?'selected':''}>${t}</option>`).join('')}</select></label><label>De<input type="date" name="de" required value="${ui.periodo.de}"></label><label>Até<input type="date" name="ate" required value="${ui.periodo.ate}"></label></div></details>${ui.fonte!=='competencia'&&ui.fonte!=='rentabilidade'?`<label class="ind-search">Buscar<input name="query" value="${esc(ui.query)}" placeholder="Registro, conta ou cliente"></label><label>Agrupar<select name="dimensao">${(remote?['grupo','cliente',...(ui.fonte==='comercial'?['vendedor']:[])]:['grupo']).map(k=>`<option value="${k}" ${ui.dimensao===k?'selected':''}>${{grupo:'Conta / grupo',cliente:'Cliente / fornecedor',vendedor:'Vendedor'}[k]}</option>`).join('')}</select></label>`:''}${ui.fonte==='margem'?`<label>Investigar<select name="excecao">${[['todas','Todas as O.S.'],['custo-maior','Custo maior que venda'],['sem-par','Sem margem calculável']].map(([v,t])=>`<option value="${v}" ${ui.excecao===v?'selected':''}>${t}</option>`).join('')}</select></label>`:''}<button type="submit" class="primary">Aplicar</button></form>
 <div class="ind-context"><span class="ind-tag ${m?.qualidade==='Parcial'?'warn':''}">${esc(m?.qualidade||'A consultar')}</span><span>${esc(M.DICIONARIO[ui.fonte].base)} · ${data(ui.periodo.de)} a ${data(ui.periodo.ate)}</span>${m?.fontes?.length?`<span>Atualização: ${esc(data(m.fontes.map(f=>f.em).filter(Boolean).sort()[0]))}</span><span>${['recebimentos','pagamentos'].includes(ui.fonte)?(m.fontes.every(f=>f.conciliado)?'Conciliação bancária registrada':'Conciliação bancária pendente'):'Base específica da fonte · conferir cobertura'}</span>`:''}${ui.grupo?bot(ui.grupo+' ×','data-clear','ind-tag'):''}<div>${bot('Atualizar leitura','data-refresh')}${bot('Planilha',`data-export ${!m?.disponivel||ui.busy?'disabled':''}`)}${bot('PDF',`data-pdf ${!m?.disponivel||ui.busy?'disabled':''}`)}</div></div>${ui.erro?`<p class="ind-error" role="alert">${esc(ui.erro)}</p>`:''}${resultado(m)}<p class="ind-foot">Fontes consultadas separadamente. Vendas, notas e recebimentos não são somados como receita.</p></div>`;
 ui.ctx.onIntervalo?.(ui.periodo);ligar();
}
function ligar(){const c=ui.container,all=(s,fn)=>c.querySelectorAll(s).forEach(fn);
 all('[data-ind-period]',b=>{const select=()=>{const label=b.dataset.indPeriod;if(!mesGrafico(label))return;ui.label=label;ui.periodo=M.periodoRotulo(label);ui.preset='mes';ui.rangeOpen=false;ui.pagina=0;ui.seq++;ui.modelo=null;ui.erro='';if(ui.ctx.onPeriodo)ui.ctx.onPeriodo(label);else carregar();ui.container.querySelector(`[data-ind-period="${label}"]`)?.focus({preventScroll:true});};b.onclick=select;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};});
 all('[data-area]',b=>b.onclick=()=>{ui.area=b.dataset.area;ui.fonte=config[ui.area].fontes[0][0];reset();carregar();});
 all('[data-source]',b=>b.onclick=()=>{ui.fonte=b.dataset.source;reset();carregar();});
 const range=c.querySelector('.ind-range');range.ontoggle=()=>{ui.rangeOpen=range.open;};
 const form=c.querySelector('#indFilters');form.elements.preset.onchange=e=>{if(e.target.value!=='personalizado'){const p=M.periodoPreset(ui.label,e.target.value);form.elements.de.value=p.de;form.elements.ate.value=p.ate;}};
 for(const k of ['de','ate'])form.elements[k].oninput=()=>form.elements.preset.value='personalizado';
 form.onsubmit=e=>{e.preventDefault();try{ui.periodo=M.validarPeriodo(form.elements.de.value,form.elements.ate.value);ui.preset=form.elements.preset.value;ui.excecao=form.elements.excecao?.value||'todas';ui.query=form.elements.query?.value.trim()||'';ui.dimensao=form.elements.dimensao?.value||'grupo';ui.grupo='';ui.pagina=0;ui.seq++;carregar();}catch(e){ui.erro=e.message;pintar();}};
 all('[data-group]',b=>b.onclick=()=>{ui.grupo=b.dataset.group;ui.pagina=0;carregar();});all('[data-clear]',b=>b.onclick=()=>{ui.grupo='';carregar();});all('[data-page]',b=>b.onclick=()=>{ui.pagina=Number(b.dataset.page);carregar();});
 all('[data-recorte]',b=>b.onclick=()=>{ui.periodo={...ui.modelo.recorte};ui.preset='personalizado';ui.pagina=0;ui.seq++;carregar();});
 all('[data-refresh]',b=>b.onclick=async()=>{if(fonteLocal()){b.disabled=true;await ui.ctx.refresh();}else carregar(true);});all('[data-formula]',b=>b.onclick=formula);all('[data-row]',b=>b.onclick=()=>detalhe(ui.modelo.rows[Number(b.dataset.row)]));
 all('[data-dre]',b=>b.onclick=()=>ui.ctx.onDRE(ui.periodo));all('[data-export]',b=>b.onclick=()=>exportar(false,b));all('[data-pdf]',b=>b.onclick=()=>exportar(true,b));
}
function formula(){const d=M.DICIONARIO[ui.fonte];ui.ctx.dialog('Como este valor foi calculado?',`<div class="indicadores"><h3>${esc(d.nome)}</h3><p><b>Base:</b> ${esc(d.base)} · ${M.ESCOPO}</p><p>${esc(d.formula)}</p><p><b>Fonte:</b> ${esc(d.fonte)}</p><p>${esc(d.limite)}</p><p>Período: ${data(ui.periodo.de)} a ${data(ui.periodo.ate)}. Busca: ${esc(ui.query||'Todas')}. Grupo: ${esc(ui.grupo||'Todos')}.</p><p>Valores monetários calculados em centavos. Ausência não vira zero. IDs de origem são preservados; notas e pagamentos não são somados a O.S.</p></div>`);}
function detalhe(r){ui.ctx.dialog('Registro '+(r.numero||r.id),`<div class="indicadores"><h3>${esc(r.nome)}</h3><p>${esc(r.origem)}</p><p>ID: ${esc(r.id)} · Data: ${esc(r.data||'Não atribuída ao registro')}</p><p>Valor: <b class="${moneyTone(r.valor)}">${esc(br(r.valor))}</b></p>${r.venda!=null?`<p>Venda: ${esc(br(r.venda))} · Custo informado: ${esc(br(r.custo))} · Margem parcial: ${esc(pct(M.margem(r.venda,r.custo)))}</p>`:''}${r.os?.length?`<p>Referências de O.S. na fonte: ${esc(r.os.join(', '))}. Em notas, são IDs internos.</p>`:''}${r.processos?`<h4>Processos registrados na origem</h4>${['previstos','realizados'].map(k=>`<details open><summary>${k==='previstos'?'Previstos':'Apontamentos registrados'}</summary><ul>${(r.processos[k]||[]).map(p=>`<li>${esc(p.nome)}: ${esc(p.tempo??'não informado')} (unidade da origem, não convertida em custo)</li>`).join('')||'<li>Não informado</li>'}</ul></details>`).join('')}<p>Tempo registrado não comprova tempo produtivo líquido. Componentes de materiais, mão de obra, equipamentos e rateios ainda não foram conciliados.</p>`:''}${r.itens?`<h4>Itens da nota</h4><ul>${r.itens.map(i=>`<li>${esc(i.descricao)} · ${esc(i.quantidade??'Não informado')} ${esc(i.unidade)} · ${br(i.total==null?null:i.total/100)}</li>`).join('')}</ul><p>Quantidade na unidade original, sem conversão automática.</p>`:''}<p>${esc(M.DICIONARIO[ui.fonte].limite)}</p></div>`);}
async function exportar(pdf,button){
 const key=chave();button.disabled=true;try{const m=fonteLocal()?montarLocal(true):await consultarIndicadores(true);if(key!==chave())throw new Error('O filtro mudou. Gere novamente.');if(!m.disponivel||m.rows.length!==m.total)throw new Error('Não foi possível obter todos os registros filtrados.');
 if(m.valor!==ui.modelo.valor||m.total!==ui.modelo.total||JSON.stringify(m.values)!==JSON.stringify(ui.modelo.values)||JSON.stringify(m.fontes)!==JSON.stringify(ui.modelo.fontes))throw new Error('A fonte mudou desde a leitura. Atualize a análise antes de exportar.');
 const context={titulo:ui.area+' / '+M.DICIONARIO[ui.fonte].nome,periodo:ui.periodo,fonte:M.DICIONARIO[ui.fonte].base,qualidade:m.qualidade,limite:[m.limite,M.DICIONARIO[ui.fonte].formula,`Busca: ${ui.query||'Todas'}; grupo: ${ui.grupo||'Todos'}; exceção: ${ui.excecao}`,...(m.avisos||[])].join(' '),rows:m.rows,valor:m.valor,fontes:m.fontes,indicadores:[...ui.container.querySelectorAll('.ind-metric')].map(e=>({nome:e.querySelector('span').textContent,valor:e.querySelector('strong').textContent,nota:e.querySelector('small').textContent}))};
 if(pdf){document.getElementById('indPrint')?.remove();const el=document.createElement('section');el.id='indPrint';el.innerHTML=`<img src="logo.png" alt="Impresilk"><h1>${esc(context.titulo)}</h1><p>${M.ESCOPO} · ${data(ui.periodo.de)} a ${data(ui.periodo.ate)}</p><p>${esc(context.fonte)} · ${esc(context.qualidade)} · Total conhecido: ${esc(br(context.valor))}</p><p>${esc(context.limite)}</p><dl>${context.indicadores.map(i=>`<dt>${esc(i.nome)}</dt><dd><b>${esc(i.valor)}</b> · ${esc(i.nota)}</dd>`).join('')}</dl>${analises(m)}${tabela(m.rows,false)}${(m.fontes||[]).map(f=>`<p>${esc(f.periodo)} · atualizado ${data(f.em)} · corte ${esc(f.corte||'não confirmado')}${['recebimentos','pagamentos'].includes(ui.fonte)?' · conciliação bancária '+(f.conciliado?'registrada':'não comprovada'):' · validar período e população da fonte'}</p>`).join('')}`;document.body.append(el);document.body.classList.add('ind-printing');window.addEventListener('afterprint',()=>{document.body.classList.remove('ind-printing');el.remove();},{once:true});window.print();}
 else{const blob=new Blob([M.exportarCSV(context)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`indicadores-${ui.fonte}-${ui.periodo.de}-${ui.periodo.ate}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }catch(e){ui.erro=e.message;pintar();}finally{button.disabled=false;}
}
window.DREIndicadores={periodo(label){ui.label=label;ui.periodo=M.periodoRotulo(label);ui.preset='mes';ui.rangeOpen=false;ui.pagina=0;ui.seq++;ui.modelo=null;ui.erro='';},mount(container,ctx){ui.container=container;ui.ctx=ctx;if(ui.label!==ctx.periodo){ui.label=ctx.periodo;ui.periodo=M.periodoRotulo(ctx.periodo);ui.preset='mes';reset();}if(!ui.periodo)return;carregar();},clear(){ui.seq++;ui.cache.clear();ui.modelo=null;ui.container=null;ui.ctx=null;}};
