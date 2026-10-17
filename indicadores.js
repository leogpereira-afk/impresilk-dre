import * as M from './indicadores-modelo.mjs?v=137';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Sinal de menos tipográfico (−) e sem "-0" em toda a tela.
const br=v=>v==null?'Não informado':(Math.abs(Number(v))<.005?0:Number(v)).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace('-','−');
const data=s=>s?new Date(s.length===10?s+'T12:00:00':s).toLocaleString('pt-BR',s.length===10?{dateStyle:'short'}:{dateStyle:'short',timeStyle:'short'}):'Não registrada';
const pct=v=>v==null?'Indeterminada':(Math.round(v*10)/10+0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}).replace('-','−')+'%';
// Datas ISO soltas em textos da fonte (período, avisos do conector) aparecem como dd/mm/aaaa.
const dataTxt=t=>String(t??'').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,'$3/$2/$1');
const MES3=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const config={
 Receita:{pergunta:'O que foi vendido, faturado e recebido?',fontes:[['recebimentos','Recebimentos'],['comercial','O.S. comerciais'],['fiscal','NF-e'],['competencia','Competência']]},
 Custos:{pergunta:'O que sabemos sobre o custo de cada trabalho?',fontes:[['custos','O.S. e custos'],['compras','Notas de compra']]},
 Despesas:{pergunta:'Onde se concentram os pagamentos?',fontes:[['pagamentos','Pagamentos por conta']]},
 Resultado:{pergunta:'Qual é o resultado e como ele se diferencia do caixa?',fontes:[['variacao','Movimento de caixa'],['competencia','DRE por competência']]},
 Margem:{pergunta:'Quanto sobra na base de custos informada?',fontes:[['margem','Margem parcial por O.S.'],['competencia','Margens da DRE']]},
 Rentabilidade:{pergunta:'Quais dados faltam para medir o retorno do capital?',fontes:[['rentabilidade','Capital e investimentos']]}
};
// Cor de cada área, a mesma do app: entrada azul, saída vermelha, resultado neutro.
const FAMILIA={Receita:'entrada',Custos:'saida',Despesas:'saida',Resultado:'resultado',Margem:'resultado',Rentabilidade:'resultado'};
const PRESET_TXT={mes:'Mês',trimestre:'Trimestre',semestre:'Semestre',ano:'Ano','12meses':'Últimos 12 meses',personalizado:'Personalizado'};
const mesesNoPeriodo=p=>{const a=new Date(p.de+'T00:00:00Z'),b=new Date(p.ate+'T00:00:00Z');return (b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+1;};
const inteiro=p=>p.de.endsWith('-01')&&new Date(Date.parse(p.ate+'T00:00:00Z')+86400000).getUTCDate()===1;
const ui={area:'Receita',fonte:'recebimentos',preset:'mes',rangeOpen:false,periodo:null,label:'',excecao:'todas',query:'',dimensao:'grupo',grupo:'',pagina:0,cache:new Map(),seq:0,modelo:null,busy:false,erro:'',container:null,ctx:null};
const bot=(text,attrs='',cls='')=>`<button type="button" class="${cls}" ${attrs}>${esc(text)}</button>`;
// descHtml: a descrição já vem montada (com a variação colorida); o resto do texto passa por esc antes.
// Ausência ("Não apurado", "Sem comparação"…) sai como vazio, sem o peso de um número.
const metric=(label,value,desc,cls='',tom='',descHtml=false)=>{const vazio=/^(Sem comparação|Não apurado|Indisponível|Indeterminada)$/.test(String(value));return `<button type="button" class="ind-metric ${cls}" data-formula${tom?` data-tom="${tom}"`:''}><span>${esc(label)}</span><strong${vazio?' class="ind-vazio"':tom==='entra'?' class="tom-entra"':tom==='sai'?' class="tom-sai"':''}>${esc(value)}</strong><small>${descHtml?desc:esc(desc)}</small></button>`;};
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
 const rows=ids.map(id=>{const nome=window.DREModelo.linhas.find(l=>l.id===id)?.nome||id;return {id,numero:nome,nome,grupo:'Rubrica da DRE',valor:values[id],origem:months.map(x=>x.reg?.fonte||'Sem preenchimento').join(' / ')};});
 return {disponivel:completos&&mesInteiro&&consolidado,qualidade:'Parcial',rows,total:rows.length,valor:null,grupos:[],evolucao:[],pagina:0,paginas:1,values,fontes:months.map(x=>({periodo:x.label,em:x.reg?.revisadoEm||null,conciliado:false})),avisos:[...(!completos?['Há meses sem apuração por competência.']:[]),...(!mesInteiro?['A competência exige meses inteiros; não distribui rubricas mensais por dia.']:[]),...(!consolidado?['A apuração precisa identificar o mesmo consolidado: Impresilk + Universo.']:[])],limite:M.DICIONARIO.competencia.limite};
}
// Rentabilidade (Fase 9.2): retorno sobre o capital do Balanço gerencial (gestao.js,
// balRentabilidade). O histórico de posições vem da mesma leitura do capital de giro.
function rentabilidade(){
 const base={total:0,rows:[],fontes:[],valor:null,limite:M.DICIONARIO.rentabilidade.limite};
 if(typeof balRentabilidade!=='function')return {...base,disponivel:false,qualidade:'Indisponível',avisos:['O cálculo da rentabilidade não foi carregado nesta versão.']};
 if(typeof carregarGiro==='function')carregarGiro();
 const g=typeof giroUI!=='undefined'?giroUI:null,lendo=!!g?.busy&&!g?.dados;
 // Sem o histórico de posições lido, a causa é a leitura (nunca "sem a posição do mês").
 if(!g?.dados){const motivo=g?.erro?`não foi possível ler o histórico de posições do Balanço (${g.erro}); nenhum zero foi assumido`:'lendo o histórico de posições do Balanço…';const r0={disponivel:false,motivos:[motivo],marcas:[],meses:[]};return {...base,disponivel:false,qualidade:'Indisponível',rent:r0,avisos:[motivo]};}
 const r=balRentabilidade(ui.periodo,g?.dados?.historico?.meses||[],typeof dfcSaldos==='function'?dfcSaldos():new Map());
 return {...base,disponivel:r.disponivel,qualidade:r.disponivel?(r.parcial?'Parcial':'Apurado'):'Indisponível',rent:r,limite:r.disponivel?'Taxas do período, sem anualizar, sobre o Balanço gerencial do início e do fim. Não usa receita como retorno.':base.limite,avisos:[...(lendo?['Lendo o histórico de posições do Balanço…']:[]),...(r.motivos||[]),...(r.marcas||[])],
  fontes:r.ini?[{periodo:`Balanço gerencial de ${r.ini.label} e ${r.fim.label}`,em:g?.dados?.historico?.meses?.at(-1)?.gravadoEm||null,corte:r.meses.at(-1),conciliado:false}]:[]};
}
// Resultado de um mês para o gráfico: competência apurada; senão, o de caixa (gerencial).
function resultadoDoMes(label){
 const comp=ui.ctx.cfg?.demonstrativosCompetencia?.meses?.[label.replace('/','_')];
 if(comp&&String(comp.company||'').trim().toLowerCase()==='impresilk + universo'){const v=window.DREModelo.calcular(comp.valores||{});if(v.liquido!=null)return {valor:v.liquido,nota:'Lucro líquido por competência'};}
 const reg=ui.ctx.records.find(r=>r.label===label),a=reg&&typeof DRESimples!=='undefined'?DRESimples.apurar(reg):null,q=reg&&typeof F!=='undefined'?F.qualidade(reg):null;
 return a?{valor:a.linhas.resultado,parcial:!!q?.parcial,nota:'Resultado de caixa (gerencial)'+(q?.parcial?' · mês parcial':'')}:{valor:null,nota:'Sem dados do mês'};
}
function montarLocal(todos=false){
 if(ui.fonte==='rentabilidade')return rentabilidade();
 if(ui.fonte==='competencia')return competencia();
 const a=M.caixa(ui.ctx.records,ui.periodo,'entrada'),b=M.caixa(ui.ctx.records,ui.periodo,'saida');let base=ui.fonte==='recebimentos'?a:b;
 if(ui.fonte==='variacao')base={...a,disponivel:a.disponivel&&b.disponivel,qualidade:a.qualidade==='Apurado'&&b.qualidade==='Apurado'?'Apurado':'Parcial',rows:[...a.rows.map(r=>({...r,grupo:'Recebimentos'})),...b.rows.map(r=>({...r,valor:r.valor==null?null:-r.valor,grupo:'Pagamentos'}))],avisos:[...new Set([...a.avisos,...b.avisos])],limite:M.DICIONARIO.variacao.limite};
 return {...base,...M.resumir(base.rows,{...filtros(),pagina:todos?0:ui.pagina,tamanho:todos?Math.max(1,base.rows.length):50}),allRows:base.rows,anoAnterior:comparacao()};
}
// Ano do chip com o contrato do app (ctx.anoComparado): o ano escolhido em "Comparar com" (null = sem comparação).
// Fora do Ano, ou app sem o contrato, o ano anterior.
const anoComparadoTela=()=>ui.anoApp&&ui.ctx&&ui.ctx.anoComparado!==undefined?ui.ctx.anoComparado:Number(ui.periodo.de.slice(0,4))-1;
// No Ano, só os meses completos e da mesma base nos dois anos (ctx.mesesComparaveis), seguidos desde janeiro.
function comparacao(){
 const f={query:ui.query,grupo:ui.grupo,dimensao:ui.dimensao};
 if(!ui.anoApp||ui.ctx.anoComparado===undefined)return M.compararAno(ui.ctx.records,ui.periodo,ui.fonte,f);
 const anoComp=ui.ctx.anoComparado;if(anoComp==null)return {disponivel:false,semAno:true,motivo:'Escolha um ano em “Comparar com”, no topo.'};
 const ano=Number(ui.periodo.de.slice(0,4)),ult=Number(ui.periodo.ate.slice(5,7)),meses=new Set((ui.ctx.mesesComparaveis||[]).map(Number));let k=0;while(k<ult&&meses.has(k))k++;
 if(!k)return {disponivel:false,anoComp,motivo:`Sem meses completos, da mesma base, desde janeiro em ${ano} e ${anoComp}.`};
 const pc={de:ui.periodo.de,ate:new Date(Date.UTC(ano,k,0)).toISOString().slice(0,10)};
 return {...M.compararAno(ui.ctx.records,pc,ui.fonte,f,{ano:anoComp}),anoComp,rotulo:pc.ate===ui.periodo.ate?'':k===1?'Jan':`Jan a ${MES3[k-1]}`};
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
// Agrupamentos de cada fonte. Nas O.S. comerciais o "grupo" é o vendedor; nas notas, a situação da nota.
function dimensoes(remote){return (ui.fonte==='comercial'?['cliente','vendedor']:remote?['grupo','cliente']:['grupo']).map(k=>[k,{grupo:['fiscal','compras'].includes(ui.fonte)?'Situação da nota':'Conta / grupo',cliente:'Cliente / fornecedor',vendedor:'Vendedor'}[k]]);}
function reset(){ui.excecao='todas';ui.query='';ui.grupo='';ui.pagina=0;ui.dimensao=['custos','margem','fiscal','compras'].includes(ui.fonte)?'cliente':ui.fonte==='comercial'?'vendedor':'grupo';ui.seq++;ui.modelo=null;ui.erro='';}
function bars(items,interactive=true){const max=Math.max(1,...items.map(r=>Math.abs(r.valor)));return `<div class="ind-bars">${items.slice(0,8).map(r=>`<${interactive?'button':'div'} ${interactive?`type="button" data-group="${esc(r.nome)}"`:''} class="ind-bar"><span>${esc(r.nome)} <small>${r.quantidade} registro(s)</small></span><span class="ind-track"><i style="width:${Math.abs(r.valor)/max*100}%" class="${moneyTone(r.valor)==='tom-sai'?'negative':''}"></i></span><b class="${moneyTone(r.valor)}">${esc(br(r.valor))}${r.ausentes?' *':''}</b></${interactive?'button':'div'}>`).join('')}</div>`;}
function moneyTone(value){if(value==null||Number(value)===0)return '';const out=['pagamentos','custos','compras','margem'].includes(ui.fonte);return (value>0)!==out?'tom-entra':'tom-sai';}
// Fonte sem data em nenhum registro (O.S. de custos e margem) não ganha coluna Data vazia.
function tabela(rows,detail=true){const reg=ui.fonte!=='competencia',comData=rows.some(r=>r.data);return `<div class="ind-table"><table><thead><tr>${reg?'<th>Registro</th>':''}<th>Nome / origem</th>${comData?'<th>Data</th>':''}<th>${ui.fonte==='margem'?'Venda / custo informado':'Valor'}</th>${detail?'<th><span class="sr-only">Detalhes</span></th>':''}</tr></thead><tbody>${rows.map((r,i)=>`<tr>${reg?`<td>${esc(r.numero||r.id)}</td>`:''}<td><b>${esc(r.nome||'Não informado')}</b><small>${esc(r.grupo||r.origem)}</small></td>${comData?`<td>${esc(r.data?data(r.data):'Não atribuída')}</td>`:''}<td class="num ${ui.fonte==='margem'?'':ui.fonte==='competencia'?(typeof window.tomDoValor==='function'&&window.tomDoValor(r.id,r.valor))||moneyTone(r.valor):moneyTone(r.valor)}">${ui.fonte==='margem'?`<span class="${Number(r.venda)?'tom-entra':''}">${esc(br(r.venda))}</span><small><span class="${Number(r.custo)?'tom-sai':''}">${esc(br(r.custo))}</span> · ${esc(pct(M.margem(r.venda,r.custo)))}</small>`:esc(br(r.valor))}</td>${detail?`<td>${bot('Ver',`data-row="${i}" aria-label="Ver registro ${esc(r.numero||r.id)}"`,'ind-text')}</td>`:''}</tr>`).join('')}</tbody></table></div>`;}
function dependencias(){const items=ui.fonte==='rentabilidade'?[
 ['Resultado','Competência apurada em todos os meses ou, sem ela, o resultado de caixa da DRE Simples (gerencial, marcado).'],['Capital médio','Balanço gerencial no fim do mês anterior ao início e no fim do período: caixa, carteira do Mubisys e saldos de Parâmetros.'],['Investimentos','Aportes e fluxos incrementais, com datas e vínculo ao investimento.']]:[
 ['Materiais e estoque','Consumo por O.S., unidade original, conversão e custo histórico. Compra não comprova consumo.'],['Mão de obra e processos','Horas produtivas, encargos e capacidade normal. Apontamento zero não comprova execução.'],['Equipamentos e rateios','Depreciação, energia e manutenção identificadas; evitar repetir componentes incluídos na taxa por hora.']];
 return `<details class="ind-panel" ${''}><summary>${ui.fonte==='rentabilidade'?'Para calcular o retorno com segurança':'O que falta para apurar o custo realizado'}</summary><div class="ind-dependencies">${items.map(([t,d])=>`<div><b>${esc(t)}</b><p>${esc(d)}</p><span class="ind-tag warn">Pendente de validação</span></div>`).join('')}</div></details>`;}
const curto=v=>(Number(v)+0).toLocaleString('pt-BR',{notation:'compact',maximumFractionDigits:1}).replace('-','−');
const mesesGrafico=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function mesGrafico(p){
 const iso=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(p||'');
 if(iso)return mesesGrafico[Number(iso[2])-1]+'/'+iso[1];
 return /^(Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)\/\d{4}$/.test(p||'')?p:null;
}
function grafico(items,{unidade='R$',saida=false,anterior='',atual=''}={}){
 const validos=items.filter(x=>x.valor!=null&&Number.isFinite(x.valor));
 const mensal=items.length>0&&items.every(x=>mesGrafico(x.periodo));
 const slot=Math.max(76,...items.map(x=>(x.valor==null?1:curto(x.valor).length+(x.parcial?1:0))*7+16));
 const w=mensal?Math.max(560,items.length*slot+20):560,h=validos.length?166:92,left=10,right=10,top=25,bottom=32;
 const max=Math.max(0,...validos.map(x=>x.valor)),min=Math.min(0,...validos.map(x=>x.valor)),range=max-min||1;
 const comAnt=!!anterior&&items.some(x=>x.anterior!=null&&Number.isFinite(x.anterior));
 const max2=comAnt?Math.max(max,...items.map(x=>Number.isFinite(x.anterior)?x.anterior:0)):max,min2=comAnt?Math.min(min,...items.map(x=>Number.isFinite(x.anterior)?x.anterior:0)):min,range2=max2-min2||1;
 const y=v=>top+(max2-v)/range2*(h-top-bottom),zero=y(0),passo=(w-left-right)/Math.max(items.length,1),bar=Math.min(64,passo*.58);
 const fmt=v=>unidade==='R$'?br(v):unidade==='%'?pct(v):String(v);
 const legenda=comAnt?`<p class="ind-legenda"><span><i class="ind-chave ind-chave-atual"></i>${esc(atual)}</span><span><i class="ind-chave ind-chave-anterior"></i>${esc(anterior)}</span></p>`:'';
 return legenda+`<div class="ind-plot ${mensal?'ind-plot-months':''} ${validos.length?'':'ind-plot-empty'}" ${mensal?`style="--plot-width:${w}px"`:''}><svg viewBox="0 0 ${w} ${h}" role="${mensal?'group':'img'}" aria-label="${esc(items.map(x=>x.nome+': '+(x.valor==null?'Não apurado':fmt(x.valor))).join('; '))}"><line x1="${left}" x2="${w-right}" y1="${zero}" y2="${zero}" class="ind-zero"/>${items.map((x,i)=>{
 const px=left+passo*(i+.5),known=x.valor!=null&&Number.isFinite(x.valor),yy=known?y(x.valor):zero;
 const tone=x.tom||(saida?(x.valor<0?'entrada':'saida'):(x.valor<0?'saida':'entrada'));
 const mes=mesGrafico(x.periodo),selected=mensal&&M.periodoRotulo(mes).de===ui.periodo.de&&M.periodoRotulo(mes).ate===ui.periodo.ate;
 return `<g ${mensal?`class="ind-month${selected?' selected':''}" data-ind-period="${esc(mes)}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="Ver ${esc(mes)} no painel · ${known?esc(fmt(x.valor)):'Não apurado'}"`:''}><title>${esc(x.periodo||x.nome)}: ${known?esc(fmt(x.valor)):'Não apurado'}${x.nota?' · '+esc(x.nota):''}</title>${mensal?`<rect x="${left+passo*i+2}" y="1" width="${passo-4}" height="${h-2}" rx="6" class="ind-month-hit"/>`:''}${comAnt&&x.anterior!=null&&Number.isFinite(x.anterior)?`<rect x="${px-bar/2}" y="${Math.min(y(x.anterior),zero)}" width="${bar*.44}" height="${Math.max(1,Math.abs(y(x.anterior)-zero))}" rx="2" class="ind-fill-anterior"><title>${esc(anterior)}: ${esc(fmt(x.anterior))}</title></rect>`:''}${known?`<rect x="${comAnt?px-bar/2+bar*.5:px-bar/2}" y="${Math.min(yy,zero)}" width="${comAnt?bar*.5:bar}" height="${Math.max(1,Math.abs(yy-zero))}" rx="3" class="ind-fill-${tone}${x.parcial?' ind-partial':''}"/>`:''}<text x="${comAnt?px+bar/4:px}" y="${known?(x.valor<0?Math.min(h-bottom+15,(comAnt&&Number.isFinite(x.anterior)?Math.max(yy,y(x.anterior)):yy)+13):Math.max(13,(comAnt&&Number.isFinite(x.anterior)?Math.min(yy,y(x.anterior)):yy)-7)):zero-8}" text-anchor="middle" class="ind-value">${known?esc(curto(x.valor))+(unidade==='%'?'%':'')+(x.marca??(x.parcial?'*':'')):'—'}</text><text x="${px}" y="${h-4}" text-anchor="middle" class="ind-axis">${esc(x.nome)}</text></g>`;
 }).join('')}</svg>${!validos.length?'<p class="ind-chart-empty">Sem base suficiente para traçar valores. Ausência não é zero.</p>':''}</div>`;
}
function painelGrafico(titulo,nota,items,op={}){
 const mensal=items.length>0&&items.every(x=>mesGrafico(x.periodo));
 const ant=!!op.anterior&&items.some(x=>x.anterior!=null);
 // Tom do valor igual ao da barra: o sentido da fonte (saída em vermelho; estorno inverte) ou o tom do item. Contagem de O.S. fica neutra.
 const tom=(v,t)=>{if(op.unidade==='O.S.'||v==null||!Number.isFinite(v)||v===0)return '';const x=t||(op.saida?(v<0?'entrada':'saida'):(v<0?'saida':'entrada'));return x==='entrada'?'tom-entra':x==='saida'?'tom-sai':'';};
 // Variação boa ou ruim pela direção da fonte: nas saídas, subir é ruim; recebimentos e variação do caixa, subir é bom.
 const dir=op.saida?-1:1,tomVar=v=>typeof tomDelta==='function'?tomDelta(dir,v):'';
 // Leitura: a nota que se repete nos meses com valor vai uma vez para a legenda; por linha, só a exceção.
 const maisComum=(xs,com)=>{const n=new Map();xs.forEach((t,i)=>t&&com[i]&&n.set(t,(n.get(t)||0)+1));const [t,q]=[...n].sort((a,b)=>b[1]-a[1])[0]||[];return q>1?t:'';};
 const notas=items.map(x=>x.nota||'Registros do filtro atual'),comum=maisComum(notas,items.map(x=>x.valor!=null)),comumAnt=ant?maisComum(items.map(x=>x.notaAnterior),items.map(x=>x.anterior!=null)):'';
 const leitura=items.map((x,i)=>[notas[i]!==comum?notas[i]:'',ant&&x.notaAnterior&&x.notaAnterior!==comumAnt?`${op.anterior}: ${x.notaAnterior}`:''].filter(Boolean).join(' · ')),comLeitura=leitura.some(Boolean);
 const legenda=comum||comumAnt?`<p class="ind-chart-legenda">${esc([comum&&`Leitura: ${comum}`,comumAnt&&`${op.anterior}: ${comumAnt}`].filter(Boolean).join(' · '))}${comLeitura?esc('. Na tabela, só o que foge disso.'):''}</p>`:'';
 const valor=v=>v==null?'Não apurado':op.unidade==='%'?pct(v):op.unidade==='O.S.'?String(v):br(v);
 return `<section class="ind-panel ind-chart${mensal?' ind-chart-months':''}"><div class="ind-chart-title"><h3>${esc(titulo)}</h3><span>${esc(op.unidade||'R$')}</span></div>${grafico(items,op)}${mensal?'<p class="ind-month-hint">Clique no mês para aplicar em todo o painel.</p>':''}<p class="ind-chart-caption">${esc(nota)}</p><details class="ind-chart-data"><summary>Ver valores e critérios</summary>${legenda}<table><thead><tr><th>Referência</th><th>${ant?esc(op.atual||'Valor'):'Valor'}</th>${ant?`<th>${esc(op.anterior)}</th><th>Variação</th>`:''}${comLeitura?'<th>Leitura</th>':''}</tr></thead><tbody>${items.map((x,i)=>`<tr><td>${esc(mesGrafico(x.periodo)||x.periodo||x.nome)}</td><td class="${tom(x.valor,x.tom)}">${esc(valor(x.valor))}</td>${ant?`<td class="${tom(x.anterior)}">${esc(x.anterior==null?'Não apurado':br(x.anterior))}</td><td class="${x.variacao!=null?tomVar(x.variacao):''}">${esc(x.variacao!=null?`${x.variacao>0?'▲ ':x.variacao<0?'▼ ':''}${pct(Math.abs(x.variacao))}`:x.semVariacao?`· (${x.semVariacao})`:'·')}</td>`:''}${comLeitura?`<td>${esc(leitura[i])}</td>`:''}</tr>`).join('')}</tbody></table></details></section>`;
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
  const serie=M.historicoCaixa(ui.ctx.records,ui.periodo,ui.fonte,filtros()),anoComp=anoComparadoTela(),ant=anoComp==null?[]:M.historicoCaixa(ui.ctx.records,M.periodoNoAno(ui.periodo,anoComp),ui.fonte,filtros()),ano=ui.periodo.ate.slice(0,4);
  // No Ano, a variação mês a mês fica só nos meses que o app compara (completos e da mesma base).
  const doAno=ui.anoApp&&anoComp!=null&&Array.isArray(ui.ctx.mesesComparaveis)?new Set(ui.ctx.mesesComparaveis.map(Number)):null;
  const comAnt=serie.map((x,i)=>{const a=ant[i]||{},motivo=x.valor==null||a.valor==null?'':!x.fechado||!a.fechado?'mês pela metade':x.chave!==a.chave?'base diferente':doAno&&!doAno.has(i)?'fora dos meses comparáveis':a.valor<=0||x.valor<0?'sem base percentual':'';return {...x,anterior:a.valor??null,notaAnterior:a.nota,variacao:motivo||x.valor==null||a.valor==null?null:Math.round((x.valor-a.valor)/Math.abs(a.valor)*1000)/10,semVariacao:motivo};});
  html+=painelGrafico(ui.fonte==='variacao'?'Evolução da variação de caixa':'Comparativo mensal',`Janeiro a dezembro de ${ano}${anoComp==null?'':`, com ${anoComp} ao lado (barra cinza)`} · mesmos filtros. * Mês em andamento ou incompleto · ° Cobertura a conferir.`,comAnt,{saida,anterior:anoComp==null?'':`${anoComp}`,atual:ano});
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
  else html+=painelGrafico('Cobertura dos custos','Valores ausentes exigem conferência. Sem datas das O.S., não é possível traçar uma evolução mensal confiável.',m.disponivel?[{nome:'Com custo',valor:m.comValor,tom:'ok'},{nome:'Sem custo',valor:m.total-m.comValor,tom:'aviso'}]:[],{unidade:'O.S.'});
 }else if(ui.fonte==='competencia'||ui.fonte==='rentabilidade'){
  const margem=ui.area==='Margem';
  html+=painelGrafico(margem?'Margem líquida por mês':ui.area==='Receita'?'Receita líquida por mês':'Resultado líquido por mês','Competência do consolidado. Meses sem apuração permanecem em branco; não há previsão automática.',historicoCompetencia(),{unidade:margem?'%':'R$'});
  if(ui.fonte==='rentabilidade'){
   const r=m.rent,taxa=v=>v==null?'Não apurado':pct(v),base=r?.base==='competencia'?'Lucro líquido por competência':'Resultado de caixa (gerencial)';
   html=painelGrafico('Resultado por mês',`${base} em ${ui.periodo.ate.slice(0,4)}: competência quando o mês está apurado; senão, caixa (gerencial). * = mês parcial. Mês sem dados fica em branco.`,(()=>{const y=ui.periodo.ate.slice(0,4);return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map(x=>{const l=x+'/'+y,v=resultadoDoMes(l);return {nome:x,periodo:l,valor:v.valor,parcial:v.parcial,nota:v.nota};});})());
   if(r?.ini)html+=painelGrafico('Capital no início e no fim',`Balanço gerencial no fim de ${r.ini.label} e de ${r.fim.label}: patrimônio líquido e ativo. A média dos dois é a base das taxas.`,[{nome:'Patrimônio '+r.ini.label,valor:r.ini.pl,tom:r.ini.pl<0?'saida':'entrada',nota:'Início · balanço no fim de '+r.ini.label+(r.ini.marca?' · '+r.ini.marca:''),parcial:r.ini.parcial},{nome:'Patrimônio '+r.fim.label,valor:r.fim.pl,tom:r.fim.pl<0?'saida':'entrada',nota:'Fim · balanço no fim de '+r.fim.label+(r.fim.marca?' · '+r.fim.marca:''),parcial:r.fim.parcial},{nome:'Ativo '+r.ini.label,valor:r.ini.ativo,tom:'entrada',nota:'Início · balanço no fim de '+r.ini.label,parcial:r.ini.parcial},{nome:'Ativo '+r.fim.label,valor:r.fim.ativo,tom:'entrada',nota:'Fim · balanço no fim de '+r.fim.label,parcial:r.fim.parcial}]);
   html+=`<section class="ind-panel ind-chart ind-return" id="secao-ind-retorno"><h3>Retorno sobre o capital</h3><div class="ind-return-row"><b>ROE</b><span>${esc(base)} ÷ patrimônio médio <button type="button" class="term-help" data-term="ROE (retorno sobre o patrimônio)" aria-label="Entender ROE">?</button></span><strong>${esc(taxa(r?.roe))}</strong></div><div class="ind-return-row"><b>ROA</b><span>${esc(base)} ÷ ativo médio <button type="button" class="term-help" data-term="ROA (retorno sobre o ativo)" aria-label="Entender ROA">?</button></span><strong>${esc(taxa(r?.roa))}</strong></div><div class="ind-return-row"><b>ROI</b><span>Resultado do investimento ÷ capital investido</span><strong>Não apurado</strong></div><p class="ind-chart-caption">${esc(r?.meses?.length?`Taxas no período (${r.meses.length>1?`${r.meses[0]} a ${r.meses[r.meses.length-1]}`:r.meses[0]}), sem anualizar. O ROI depende do investimento de cada projeto e não é estimado.`:'Faltam bases para as taxas; veja o que falta acima.')}</p></section>`;
  }
  else html+=painelGrafico(margem?'Margens da DRE':'Composição do resultado',margem?'Mesma receita líquida como denominador. Indicadores dependem da apuração das rubricas.':'Subtotais da DRE, não somar as barras entre si.',margem?[{nome:'Bruta',valor:m.values?.margemBruta??null},{nome:'Operacional',valor:m.values?.margemOperacional??null},{nome:'Líquida',valor:m.values?.margemLiquida??null}]:m.rows.filter(x=>['liquida','custos','operacional','liquido'].includes(x.id)).map(x=>({nome:{liquida:'Rec. líquida',custos:'Custos',operacional:'Operacional',liquido:'Líquido'}[x.id],valor:x.valor,tom:x.id==='custos'?'saida':x.valor<0?'saida':'entrada'})),{unidade:margem?'%':'R$'});
 }else{
  const items=(m.evolucao||[]).filter(x=>x.nome!=='Sem data').map(x=>({...x,periodo:MES3[+x.nome.slice(5,7)-1]+'/'+x.nome.slice(0,4),nome:MES3[+x.nome.slice(5,7)-1]+'/'+x.nome.slice(2,4)}));
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
  // Rentabilidade sem base: os gráficos continuam (resultado por mês) e o quadro diz "Não apurado".
  const history=comp?historicoCompetencia().some(x=>x.valor!=null):capital;
  return `<section class="source-empty"><h3>${title}</h3><p>${comp?'A base de caixa está disponível. Para apurar lucro e margens, informe as rubricas reconhecidas no mês e a fonte da apuração.':capital?(m.rent?.motivos?.length?'Falta: '+m.rent.motivos.join('; ')+'.':'O cálculo precisa do resultado e do Balanço gerencial no início e no fim do período.'):m.recorte?'A fonte mais recente disponível cobre '+data(m.recorte.de)+' a '+data(m.recorte.ate)+'. Esses valores não pertencem ao período selecionado.':'Esta fonte ainda não tem uma importação concluída.'}</p><div class="actions">${m.recorte?bot('Ver dados de '+data(m.recorte.de)+' a '+data(m.recorte.ate),'data-recorte','primary'):''}${comp||capital?bot('Abrir apuração por competência','data-dre','primary'):''}</div><details><summary>Fontes e dados necessários</summary><p>${esc(m.limite||M.DICIONARIO[ui.fonte].limite)}</p>${(m.avisos||[]).map(a=>`<p>${esc(dataTxt(a))}</p>`).join('')}${(m.fontes||[]).map(f=>`<p>${esc(dataTxt(f.periodo))} · atualização ${data(f.em)}</p>`).join('')}</details></section>${history?analises(m):''}${capital?dependencias():''}`;
 }
 // Resultado, margem e retorno: azul positivo, vermelho negativo.
 const sinal=v=>v>0?'entra':v<0?'sai':'';
 let metrics='';if(ui.fonte==='competencia'){metrics=metric('Receita líquida',br(m.values.liquida),'Competência informada','',sinal(m.values.liquida))+metric('Lucro / prejuízo líquido',br(m.values.liquido),'Não é variação de caixa','',sinal(m.values.liquido))+metric('Margem líquida',pct(m.values.margemLiquida),'Resultado ÷ receita líquida','',sinal(m.values.margemLiquida));}
 else if(ui.fonte==='rentabilidade'){const r=m.rent,base=r.base==='competencia',quando=r.meses.length>1?`de ${r.meses[0]} a ${r.meses[r.meses.length-1]}`:`em ${r.meses[0]}`;metrics=metric('Retorno sobre o patrimônio (ROE)',r.roe==null?'Não apurado':pct(r.roe),r.roe==null?'Patrimônio médio zero ou negativo: sem taxa':`${base?'Lucro líquido':'Resultado de caixa'} ÷ patrimônio médio, ${quando}, sem anualizar`,'',sinal(r.roe))+metric('Retorno sobre o ativo (ROA)',r.roa==null?'Não apurado':pct(r.roa),'Resultado ÷ ativo médio no mesmo período','',sinal(r.roa))+metric(base?'Lucro líquido (competência)':'Resultado de caixa (gerencial)',br(r.resultado),base?'DRE por competência apurada em todos os meses':'Caixa não é lucro: a competência entra quando todos os meses estiverem apurados','',sinal(r.resultado))+metric('Patrimônio líquido médio',br(r.plMedio),`Balanço gerencial no fim de ${r.ini.label} e de ${r.fim.label}${[r.ini,r.fim].filter(b=>b.marca).map(b=>` · ${b.label}: ${b.marca}`).join('')}`);}
 else if(ui.fonte==='margem')metrics=metric('Margem parcial',m.disponivel?pct(m.margem):'Indisponível',`${m.pares} O.S. com venda positiva e custo · mesma fonte e recorte`,'',m.disponivel?sinal(m.margem):'')+metric('Custo maior que venda',m.disponivel?String(m.negativas):'Indisponível','Investigar composição; não comprova prejuízo','warn')+metric('Sem par de valores',m.disponivel?String(m.total-m.pares):'Indisponível','Margem indeterminada');
 else if(['recebimentos','pagamentos','variacao'].includes(ui.fonte)){
  // Subir é bom nos recebimentos e na variação do caixa; nos pagamentos, subir é sair mais.
  const ca=m.anoAnterior,dir=ui.fonte==='pagamentos'?-1:1,n=mesesNoPeriodo(ui.periodo);
  const tomTotal=m.valor==null||m.valor===0?'':ui.fonte==='pagamentos'?'sai':m.valor>0?'entra':'sai';
  const dv=ca?.disponivel&&typeof tomDelta==='function'?tomDelta(dir,ca.delta):'',tomVar=dv==='delta-bom'?'entra':dv==='delta-ruim'?'sai':'';
  // O cartão do ano anterior tem a cor do sentido do valor; bom ou ruim fica só na variação.
  const tomAnterior=!ca?.disponivel||!ca.anterior?'':ui.fonte==='pagamentos'?'sai':ca.anterior>0?'entra':'sai';
  const varTxt=ca?.disponivel?`<b class="ind-var${tomVar?' tom-'+tomVar:''}">${esc(`${ca.percentual==null?'':`${Math.round(ca.percentual*10)>0?'+':Math.round(ca.percentual*10)<0?'−':''}${pct(Math.abs(ca.percentual))} · `}${ca.delta>0?'+':ca.delta<0?'−':''}${br(Math.abs(ca.delta))}`)}</b> ${esc(`contra ${data(ca.periodo.de)} a ${data(ca.periodo.ate)}${ca.percentual==null&&ca.delta?' · sem base percentual':''}${ca.rotulo?` · nos mesmos meses (${ca.rotulo})`:''}${ca.parcial?' · cobertura a conferir':ca.semTrilha?' · total do mês, sem trilha por pagamento':''}`)}`:esc(ca?.motivo||'Sem comparação.');
  // Média só com todos os meses presentes e fechados: mês sem fonte não vira zero, mês pela metade não vale inteiro.
  const pelaMetade=(m.fontes||[]).filter(f=>M.mesCortado(f,ui.periodo.ate)).map(f=>f.periodo),mediaOk=m.disponivel&&m.valor!=null&&inteiro(ui.periodo)&&!m.faltam&&!pelaMetade.length;
  metrics=metric(M.DICIONARIO[ui.fonte].nome,m.disponivel?br(m.valor):'Indisponível',m.somaCompleta===false?'Soma conhecida, há valores ausentes':`${M.DICIONARIO[ui.fonte].base} · ${data(ui.periodo.de)} a ${data(ui.periodo.ate)}`,'',tomTotal)
   +metric(ca?.semAno?'Comparação':ca?.rotulo?`${ca.rotulo} de ${ca.anoComp}`:`Mesmo período de ${ca?.anoComp??(ca?.periodo?.de?.slice(0,4)||Number(ui.periodo.de.slice(0,4))-1)}`,ca?.disponivel?br(ca.anterior):'Sem comparação',varTxt,'',tomAnterior,true)
   +metric('Média por mês',mediaOk?br(Math.round(m.valor/n*100)/100):'Não apurado',!inteiro(ui.periodo)?'Só para meses inteiros':m.faltam?`${m.faltam} ${m.faltam===1?'mês':'meses'} sem fonte no intervalo`:pelaMetade.length?`${pelaMetade.join(', ')} ainda pela metade`:`${n} ${n===1?'mês':'meses'} · ${m.comValor} de ${m.total} registros com valor${m.semTrilha?` · ${m.semTrilha} ${m.semTrilha===1?'mês':'meses'} pelas contas da DRE`:''}`,'',mediaOk?tomTotal:'');
 }
 else metrics=metric(M.DICIONARIO[ui.fonte].nome,m.disponivel?br(m.valor):'Indisponível',m.somaCompleta===false?'Soma conhecida, há valores ausentes':M.DICIONARIO[ui.fonte].base)+metric('Registros no filtro',m.disponivel?String(m.total):'Indisponível','Recorte consultado, não universo do ERP')+metric('Com valor informado',m.disponivel?`${m.comValor} de ${m.total}`:'Indisponível','Cobertura dentro dos registros filtrados');
 const sources=`<details class="ind-panel ind-sources"><summary>Origem, atualização e memória de cálculo</summary><p>${esc(M.DICIONARIO[ui.fonte].formula)}</p><p>${esc(m.limite||M.DICIONARIO[ui.fonte].limite)}</p>${(m.fontes||[]).map(f=>`<p><b>${esc(dataTxt(f.periodo)||'Fonte')}</b> · atualizado ${esc(data(f.em))} · corte ${esc(f.corte?dataTxt(f.corte):'Não confirmado')}${['recebimentos','pagamentos'].includes(ui.fonte)?' · conciliação bancária '+(f.conciliado?'registrada':'não comprovada'):' · validar período e população da fonte'}</p>`).join('')}${bot('Como este valor foi calculado?','data-formula','ind-text')}</details>`;
 const table=ui.fonte==='rentabilidade'?'':m.rows.length?`<section class="ind-panel"><div class="ind-heading"><h3>Registros e origem</h3><span>${m.total} registros · página ${m.pagina+1}/${m.paginas}</span></div>${tabela(m.rows)}<div class="ind-pagination">${bot('Anterior',`data-page="${m.pagina-1}" ${m.pagina===0?'disabled':''}`)}${bot('Próxima',`data-page="${m.pagina+1}" ${m.pagina+1>=m.paginas?'disabled':''}`)}</div></section>`:`<p class="ind-empty">${m.disponivel?'Nenhum registro encontrado nesse filtro. Confira cobertura e período antes de concluir ausência de movimentação.':'Não há fonte suficiente para calcular neste intervalo.'}</p>`;
 return `<div class="ind-metrics" data-tone="${ui.fonte==='margem'?(m.margem>0?'tom-entra':m.margem<0?'tom-sai':''):moneyTone(m.valor)}">${metrics}</div><div class="ind-note">${esc(m.limite||'')}${m.avisos?.length?`<details><summary>Critérios e cobertura da fonte</summary>${m.avisos.map(s=>`<p>${esc(dataTxt(s))}</p>`).join('')}</details>`:''}</div>${analises(m)}${table}${['custos','margem','compras'].includes(ui.fonte)?dependencias():''}${ui.fonte==='competencia'?bot('Abrir a DRE para conferir rubricas','data-dre'):''}${sources}`;
}
// Controles que sobrevivem à repintura: o foco volta ao mesmo controle (teclado e leitor de tela).
const FOCO_ATTRS=['data-area','data-source','data-ind-period','data-group','data-refresh'];
function focoAtual(){const a=document.activeElement;if(!a||a===ui.container||!ui.container.contains(a))return '';const k=FOCO_ATTRS.find(x=>a.hasAttribute?.(x));return k?`[${k}="${String(a.getAttribute(k)).replace(/["\\]/g,'\\$&')}"]`:'';}
function pintar(){
 if(!ui.container?.isConnected)return;const m=ui.modelo,remote=!fonteLocal(),foco=focoAtual();
 const qual=m?.qualidade||(ui.busy?'Consultando':'A consultar'),qcls={Apurado:'ok',Parcial:'warn','Indisponível':'off'}[qual]||'';
 const ativos=[ui.query?`busca "${ui.query}"`:'',ui.grupo?`grupo ${ui.grupo}`:'',ui.fonte==='margem'&&ui.excecao!=='todas'?'exceções':''].filter(Boolean);
 // Intervalo com várias coletas: a mais recente ou a faixa, nunca só a mais antiga.
 const coletas=(m?.fontes||[]).map(f=>f.em).filter(Boolean).sort(),dia=x=>new Date(x.length===10?x+'T12:00:00':x).toLocaleDateString('pt-BR');
 const atualizado=!coletas.length?'':coletas.length===1||dia(coletas[0])===dia(coletas.at(-1))?`atualizado ${data(coletas.at(-1))}`:`coletas de ${dia(coletas[0])} a ${dia(coletas.at(-1))}`;
 const conc=m?.fontes?.length?(['recebimentos','pagamentos'].includes(ui.fonte)?(m.fontes.every(f=>f.conciliado)?'conciliação bancária registrada':'conciliação bancária pendente'):'base específica da fonte'):'';
 ui.container.innerHTML=`<div class="indicadores" data-fonte="${esc(ui.fonte)}" data-familia="${FAMILIA[ui.area]}"><nav class="ind-nav" aria-label="Áreas dos indicadores">${M.AREAS.map(a=>bot(a,`data-area="${a}" data-familia="${FAMILIA[a]}" aria-pressed="${a===ui.area}"`,a===ui.area?'selected':'')).join('')}</nav>
 <div class="ind-cabeca"><div class="ind-titulo"><h2>${ui.area}</h2><p>${config[ui.area].pergunta}</p></div>${config[ui.area].fontes.length>1?`<nav class="ind-subnav" aria-label="Base da análise">${config[ui.area].fontes.map(([f,l])=>bot(l,`data-source="${f}" aria-pressed="${f===ui.fonte}"`,f===ui.fonte?'selected':'')).join('')}</nav>`:''}</div>
 <div class="ind-barra"><span class="ind-pill ind-pill-periodo"><b>${esc(PRESET_TXT[ui.preset]||'Intervalo')}</b> ${data(ui.periodo.de)} a ${data(ui.periodo.ate)}</span><span class="ind-pill ind-q ind-q-${qcls}">${esc(qual)}</span><span class="ind-barra-info">${esc(M.DICIONARIO[ui.fonte].base)} · ${M.ESCOPO}${atualizado?` · ${esc(atualizado)}`:''}${conc?` · ${esc(conc)}`:''}</span><div class="ind-acoes">${bot('Atualizar','data-refresh')}${bot('Planilha',`data-export ${!m?.disponivel||ui.busy?'disabled':''}`)}${bot('PDF',`data-pdf ${!m?.disponivel||ui.busy?'disabled':''}`)}</div></div>
 <form class="ind-filters" id="indFilters"><details class="ind-range" ${ui.rangeOpen?'open':''}><summary>Filtrar e mudar o intervalo${ativos.length?` <span class="ind-ativos">· ${esc(ativos.join(' · '))}</span>`:''}</summary><div class="ind-range-fields"><label>Intervalo<select name="preset">${[['mes','Mês'],['trimestre','Trimestre'],['semestre','Semestre'],['ano','Ano'],['12meses','Últimos 12 meses'],['personalizado','Personalizado']].map(([v,t])=>`<option value="${v}" ${ui.preset===v?'selected':''}>${t}</option>`).join('')}</select></label><label>De<input type="date" name="de" required value="${ui.periodo.de}"></label><label>Até<input type="date" name="ate" required value="${ui.periodo.ate}"></label>${ui.fonte!=='competencia'&&ui.fonte!=='rentabilidade'?`<label class="ind-search">Buscar<input name="query" value="${esc(ui.query)}" placeholder="Registro, conta ou cliente"></label><label>Agrupar<select name="dimensao">${dimensoes(remote).map(([k,t])=>`<option value="${k}" ${ui.dimensao===k?'selected':''}>${t}</option>`).join('')}</select></label>`:''}${ui.fonte==='margem'?`<label>Investigar<select name="excecao">${[['todas','Todas as O.S.'],['custo-maior','Custo maior que venda'],['sem-par','Sem margem calculável']].map(([v,t])=>`<option value="${v}" ${ui.excecao===v?'selected':''}>${t}</option>`).join('')}</select></label>`:''}<button type="submit" class="primary">Aplicar</button></div></details>${ui.grupo?bot(ui.grupo+' ×','data-clear','ind-tag'):''}</form>
 ${ui.erro?`<p class="ind-error" role="alert">${esc(ui.erro)}</p>`:''}${resultado(m)}<p class="ind-foot">Fontes consultadas separadamente. Vendas, notas e recebimentos não são somados como receita.</p></div>`;
 ui.ctx.onIntervalo?.(ui.periodo);ligar();window.wireGlossario?.();
 if(foco)ui.container.querySelector(foco)?.focus({preventScroll:true});
}
// Intervalo escolhido aqui: o app diz se é o ano dele (onIntervalo liga ou desliga o chip Ano e redesenha o topo);
// no Ano, a comparação segue o "Comparar com" do topo. Sem o app, só o mesmo intervalo mantém o vínculo.
const vincularAno=antes=>{const r=ui.ctx?.onIntervalo?.(ui.periodo);ui.anoApp=typeof r==='boolean'?r:!!ui.anoApp&&antes?.de===ui.periodo.de&&antes?.ate===ui.periodo.ate;};
function ligar(){const c=ui.container,all=(s,fn)=>c.querySelectorAll(s).forEach(fn);
 all('[data-ind-period]',b=>{const select=()=>{const label=b.dataset.indPeriod;if(!mesGrafico(label))return;ui.label=label;ui.periodo=M.periodoRotulo(label);ui.preset='mes';ui.rangeOpen=false;ui.pagina=0;ui.seq++;ui.modelo=null;ui.erro='';if(ui.ctx.onPeriodo)ui.ctx.onPeriodo(label);else carregar();ui.container.querySelector(`[data-ind-period="${label}"]`)?.focus({preventScroll:true});};b.onclick=select;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};});
 all('[data-area]',b=>b.onclick=()=>{ui.area=b.dataset.area;ui.fonte=config[ui.area].fontes[0][0];reset();window.gravarRota?.();carregar();});
 all('[data-source]',b=>b.onclick=()=>{ui.fonte=b.dataset.source;reset();window.gravarRota?.();carregar();});
 const range=c.querySelector('.ind-range');range.ontoggle=()=>{ui.rangeOpen=range.open;};
 const form=c.querySelector('#indFilters');form.elements.preset.onchange=e=>{if(e.target.value!=='personalizado'){const p=M.periodoPreset(ui.label,e.target.value);form.elements.de.value=p.de;form.elements.ate.value=p.ate;}};
 for(const k of ['de','ate'])form.elements[k].oninput=()=>form.elements.preset.value='personalizado';
 form.onsubmit=e=>{e.preventDefault();try{const antes=ui.periodo;ui.periodo=M.validarPeriodo(form.elements.de.value,form.elements.ate.value);ui.preset=form.elements.preset.value;vincularAno(antes);ui.excecao=form.elements.excecao?.value||'todas';ui.query=form.elements.query?.value.trim()||'';ui.dimensao=form.elements.dimensao?.value||'grupo';ui.grupo='';ui.pagina=0;ui.seq++;carregar();}catch(e){ui.erro=e.message;pintar();}};
 all('[data-group]',b=>b.onclick=()=>{ui.grupo=b.dataset.group;ui.pagina=0;carregar();});all('[data-clear]',b=>b.onclick=()=>{ui.grupo='';carregar();});all('[data-page]',b=>b.onclick=()=>{ui.pagina=Number(b.dataset.page);carregar();});
 all('[data-recorte]',b=>b.onclick=()=>{ui.periodo={...ui.modelo.recorte};ui.preset='personalizado';vincularAno(null);ui.pagina=0;ui.seq++;carregar();});
 all('[data-refresh]',b=>b.onclick=async()=>{if(fonteLocal()){b.disabled=true;if(ui.fonte==='rentabilidade'&&typeof carregarGiro==='function')carregarGiro(true);await ui.ctx.refresh();}else carregar(true);});all('[data-formula]',b=>b.onclick=formula);all('[data-row]',b=>b.onclick=()=>detalhe(ui.modelo.rows[Number(b.dataset.row)]));
 all('[data-dre]',b=>b.onclick=()=>ui.ctx.onDRE(ui.periodo));all('[data-export]',b=>b.onclick=()=>exportar(false,b));all('[data-pdf]',b=>b.onclick=()=>exportar(true,b));
}
function formula(){const d=M.DICIONARIO[ui.fonte];ui.ctx.dialog('Como este valor foi calculado?',`<div class="indicadores"><h3>${esc(d.nome)}</h3><p><b>Base:</b> ${esc(d.base)} · ${M.ESCOPO}</p><p>${esc(d.formula)}</p><p><b>Fonte:</b> ${esc(d.fonte)}</p><p>${esc(d.limite)}</p><p>Período: ${data(ui.periodo.de)} a ${data(ui.periodo.ate)}. Busca: ${esc(ui.query||'Todas')}. Grupo: ${esc(ui.grupo||'Todos')}.</p><p>Valores monetários calculados em centavos. Ausência não vira zero. IDs de origem são preservados; notas e pagamentos não são somados a O.S.</p></div>`);}
function detalhe(r){ui.ctx.dialog('Registro '+(r.numero||r.id),`<div class="indicadores"><h3>${esc(r.nome)}</h3><p>${esc(r.origem)}</p><p>ID: ${esc(r.id)} · Data: ${esc(r.data||'Não atribuída ao registro')}</p><p>Valor: <b class="${(ui.fonte==='competencia'&&typeof window.tomDoValor==='function'&&window.tomDoValor(r.id,r.valor))||moneyTone(r.valor)}">${esc(br(r.valor))}</b></p>${r.venda!=null?`<p>Venda: <span class="${Number(r.venda)?'tom-entra':''}">${esc(br(r.venda))}</span> · Custo informado: <span class="${Number(r.custo)?'tom-sai':''}">${esc(br(r.custo))}</span> · Margem parcial: ${esc(pct(M.margem(r.venda,r.custo)))}</p>`:''}${r.os?.length?`<p>Referências de O.S. na fonte: ${esc(r.os.join(', '))}. Em notas, são IDs internos.</p>`:''}${r.processos?`<h4>Processos registrados na origem</h4>${['previstos','realizados'].map(k=>`<details open><summary>${k==='previstos'?'Previstos':'Apontamentos registrados'}</summary><ul>${(r.processos[k]||[]).map(p=>`<li>${esc(p.nome)}: ${esc(p.tempo??'não informado')} (unidade da origem, não convertida em custo)</li>`).join('')||'<li>Não informado</li>'}</ul></details>`).join('')}<p>Tempo registrado não comprova tempo produtivo líquido. Componentes de materiais, mão de obra, equipamentos e rateios ainda não foram conciliados.</p>`:''}${r.itens?`<h4>Itens da nota</h4><ul>${r.itens.map(i=>`<li>${esc(i.descricao)} · ${esc(i.quantidade??'Não informado')} ${esc(i.unidade)} · ${br(i.total==null?null:i.total/100)}</li>`).join('')}</ul><p>Quantidade na unidade original, sem conversão automática.</p>`:''}<p>${esc(M.DICIONARIO[ui.fonte].limite)}</p></div>`);}
async function exportar(pdf,button){
 const key=chave();button.disabled=true;try{const m=fonteLocal()?montarLocal(true):await consultarIndicadores(true);if(key!==chave())throw new Error('O filtro mudou. Gere novamente.');if(!m.disponivel||m.rows.length!==m.total)throw new Error('Não foi possível obter todos os registros filtrados.');
 if(m.valor!==ui.modelo.valor||m.total!==ui.modelo.total||JSON.stringify(m.values)!==JSON.stringify(ui.modelo.values)||JSON.stringify(m.fontes)!==JSON.stringify(ui.modelo.fontes))throw new Error('A fonte mudou desde a leitura. Atualize a análise antes de exportar.');
 const context={titulo:ui.area+' / '+M.DICIONARIO[ui.fonte].nome,periodo:ui.periodo,fonte:M.DICIONARIO[ui.fonte].base,qualidade:m.qualidade,limite:[m.limite,M.DICIONARIO[ui.fonte].formula,`Busca: ${ui.query||'Todas'}; grupo: ${ui.grupo||'Todos'}; exceção: ${ui.excecao}`,...(m.avisos||[])].join(' '),rows:m.rows,valor:m.valor,fontes:m.fontes,indicadores:[...ui.container.querySelectorAll('.ind-metric')].map(e=>({nome:e.querySelector('span').textContent,valor:e.querySelector('strong').textContent,nota:e.querySelector('small').textContent,tom:(/\btom-(entra|sai)\b/.exec(e.querySelector('strong').className)||[])[1]||''}))};
 if(pdf){document.getElementById('indPrint')?.remove();const el=document.createElement('section');el.id='indPrint';el.innerHTML=`<img src="logo.webp" alt="Impresilk"><h1>${esc(context.titulo)}</h1><p>${M.ESCOPO} · ${data(ui.periodo.de)} a ${data(ui.periodo.ate)}</p><p>${esc(context.fonte)} · ${esc(context.qualidade)} · Total conhecido: ${esc(br(context.valor))}</p><p>${esc(context.limite)}</p><dl>${context.indicadores.map(i=>`<dt>${esc(i.nome)}</dt><dd><b class="${i.tom?'tom-'+i.tom:''}">${esc(i.valor)}</b> · ${esc(i.nota)}</dd>`).join('')}</dl>${analises(m)}${tabela(m.rows,false)}${(m.fontes||[]).map(f=>`<p>${esc(dataTxt(f.periodo))} · atualizado ${data(f.em)} · corte ${esc(f.corte?dataTxt(f.corte):'não confirmado')}${['recebimentos','pagamentos'].includes(ui.fonte)?' · conciliação bancária '+(f.conciliado?'registrada':'não comprovada'):' · validar período e população da fonte'}</p>`).join('')}`;document.body.append(el);document.body.classList.add('ind-printing');window.addEventListener('afterprint',()=>{document.body.classList.remove('ind-printing');el.remove();},{once:true});window.print();}
 else{const blob=new Blob([M.exportarCSV(context)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`indicadores-${ui.fonte}-${ui.periodo.de}-${ui.periodo.ate}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }catch(e){ui.erro=e.message;pintar();}finally{button.disabled=false;}
}
// Chip "Ano" do app (Fase 9.1): de janeiro ao fim do último mês com dados (o mês que o
// app escolheu), sem meses futuros. anoApp separa o ano do chip do intervalo escolhido
// aqui: só o do chip é desfeito quando o app volta a um mês.
const anoDoRotulo=label=>{const p=M.periodoRotulo(label);if(!p)return;ui.label=label;ui.periodo={de:p.de.slice(0,4)+'-01-01',ate:p.ate};ui.preset='ano';ui.anoApp=true;ui.rangeOpen=false;ui.pagina=0;ui.seq++;ui.modelo=null;ui.erro='';};
const fonteDaArea=(a,f)=>config[a].fontes.some(([x])=>x===f)?f:config[a].fontes[0][0];
window.DREIndicadores={area(a,f){if(!config[a])return;ui.area=a;ui.fonte=fonteDaArea(a,f);reset();},rota(){return {area:ui.area,fonte:ui.fonte};},periodo(label){ui.label=label;ui.periodo=M.periodoRotulo(label);ui.preset='mes';ui.anoApp=false;ui.rangeOpen=false;ui.pagina=0;ui.seq++;ui.modelo=null;ui.erro='';},ano(label){anoDoRotulo(label);},mount(container,ctx){ui.container=container;ui.ctx=ctx;if(ctx.ano){
  // O intervalo já é o ano do app (até o último mês com dados ou o ano civil)? Mantém busca e filtros.
  const p=M.periodoRotulo(ctx.periodo),y=p?.de.slice(0,4),ehAno=!!p&&ui.periodo?.de===y+'-01-01'&&(ui.periodo?.ate===p.ate||ui.periodo?.ate===y+'-12-31');
  if(ehAno){ui.label=ctx.periodo;ui.anoApp=true;}else{anoDoRotulo(ctx.periodo);reset();}}else if(ui.label!==ctx.periodo||ui.anoApp){ui.label=ctx.periodo;ui.periodo=M.periodoRotulo(ctx.periodo);ui.preset='mes';ui.anoApp=false;reset();}
  // Rota lida do link (recarga, Voltar): reabre a área e a fonte; igual à atual, mantém os filtros.
  const r=ctx.rota;if(r?.area&&config[r.area]&&(r.area!==ui.area||fonteDaArea(r.area,r.fonte)!==ui.fonte))window.DREIndicadores.area(r.area,r.fonte);
  if(!ui.periodo)return;carregar();},clear(){ui.seq++;ui.cache.clear();ui.modelo=null;ui.container=null;ui.ctx=null;}};
