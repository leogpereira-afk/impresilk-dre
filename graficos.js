/* Gráficos e exploração por conta. Somente leitura dos registros mensais. */
const custoUI={grupo:'2.5',conta:'2.5.3',busca:''};
const valorTexto=v=>v==null?'Não informado':money(v);
const compacto=v=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v);
const nomeConta=(reg,code)=>reg?.cells?.find(c=>c.code===code)?.name;
function contaConhecida(code){return nomeConta(regAtual(),code)||[...state.records].reverse().map(r=>nomeConta(r,code)).find(Boolean)||code;}
function movimentosDoAno(){
 return F.serieAnual(state.records,state.periodo,'1').map(x=>({...x,entradas:x.value,saidas:F.valorConta(x.reg,'2')}));
}
function painelGrafico(titulo,descricao,html,extra=''){
 return `<section class="chart-card"><div class="chart-heading"><div><h2>${esc(titulo)}</h2><p>${esc(descricao)}</p></div>${extra}</div>${html}</section>`;
}
function legendaGrafico(series){return `<div class="chart-legend">${series.map(s=>`<span><i style="--serie:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}<span><i class="incomplete-key"></i>Cobertura a conferir</span></div>`;}
function graficoBarras(rows,series,label){
 const vals=rows.flatMap(r=>series.map(s=>r[s.chave])).filter(v=>v!=null&&Number.isFinite(v));
 const max=Math.max(0,...vals),min=Math.min(0,...vals),amplitude=max-min||1;
 const bruto=amplitude/4,ordem=10**Math.floor(Math.log10(bruto));
 const passo=([1,2,2.5,5,10].find(n=>n*ordem>=bruto)||10)*ordem;
 const alto=max?Math.ceil(max/passo)*passo:min?0:1,baixo=min?Math.floor(min/passo)*passo:0,faixa=alto-baixo||1;
 const y=v=>(alto-v)/faixa*216,zero=y(0);
 const ticks=Array.from({length:Math.round(faixa/passo)+1},(_,i)=>alto-i*passo);
 return `${legendaGrafico(series)}<div class="chart-scroll" tabindex="0" role="region" aria-label="${esc(label)}. Role horizontalmente em telas pequenas."><div class="bar-chart"><div class="chart-y" aria-hidden="true">${ticks.map(v=>`<span style="top:${y(v)}px">${esc(compacto(v))}</span>`).join('')}</div><div class="chart-plot"><div class="chart-grid" aria-hidden="true">${ticks.map(v=>`<i style="top:${y(v)}px"></i>`).join('')}<i class="zero-line" style="top:${zero}px"></i></div><div class="chart-columns">${rows.map(r=>{
 const text=series.map(s=>s.nome+': '+valorTexto(r[s.chave])).join(' · ');
 const status=r.qualidade.rotulo,known=series.some(s=>r[s.chave]!=null);
 return `<button class="chart-column ${r.label===state.periodo?'chosen':''} ${r.qualidade.comparavel?'':'unverified'}" data-period="${esc(r.label)}" ${!r.reg?'disabled':''} aria-label="${esc(r.label+' · '+text+' · '+status)}"><span class="column-bars" aria-hidden="true">${series.map(s=>{const v=r[s.chave];return v==null?'<span class="missing-bar">—</span>':`<i style="--serie:${s.cor};top:${Math.min(y(v),zero)}px;height:${v===0?2:Math.max(1,Math.abs(zero-y(v)))}px"></i>`;}).join('')}</span><span class="chart-month">${esc(r.label.split('/')[0])}${known&&!r.qualidade.comparavel?'<b aria-hidden="true">*</b>':''}</span><span class="chart-tooltip"><b>${esc(r.label)}</b>${series.map(s=>`<span>${esc(s.nome)} <strong>${valorTexto(r[s.chave])}</strong></span>`).join('')}<small>${esc(r.name||status)}</small></span></button>`;
 }).join('')}</div></div></div></div><p class="chart-foot">Valores em R$ · Passe sobre uma barra ou use Tab para ver os valores. Clique no mês para abrir. — significa ausência de dados.</p>`;
}
function graficoEvolucao(){
 const rows=movimentosDoAno(),year=state.periodo.split('/')[1];
 return painelGrafico('Entradas e saídas ao longo do ano',year+' · valores registrados em cada mês',graficoBarras(rows,[{chave:'entradas',nome:'Entradas',cor:'var(--chart-in)'},{chave:'saidas',nome:'Saídas',cor:'var(--chart-out)'}],'Histórico de entradas e saídas')+`<p class="hint">* Meses parciais ou com cobertura não validada. Os valores continuam visíveis; não indicam crescimento ou economia por si só.</p>`);
}
function rankingCustos(reg,code='2',limite=6){
 if(!reg)return '<div class="empty compact-empty"><span class="empty-icon">📂</span><p>Selecione um mês com dados para ver a composição.</p></div>';
 const c=F.composicao(reg,code),items=c.itens.filter(x=>x.value!=null&&x.value!==0).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
 if(!items.length)return '<p class="empty">Nenhum valor detalhado nesta categoria.</p>';
 const mostrados=items.slice(0,limite),resto=items.slice(limite);
 if(resto.length)mostrados.push({code,name:`Demais categorias (${resto.length})`,value:resto.reduce((n,x)=>n+Math.round(x.value*100),0)/100});
 const max=Math.max(...mostrados.map(x=>Math.abs(x.value)),1);
 return `<div class="expense-ranking">${mostrados.map((x,i)=>`<button class="expense-row" ${x.residuo?'data-go="detalhe"':`data-cost="${esc(x.code)}"`}><span class="expense-name"><i style="--serie:var(--cost-${i%5})"></i>${esc(x.name)}</span><b class="${x.value<0?'neg':''}">${money(x.value)}</b><span class="expense-track" aria-hidden="true"><i style="width:${Math.abs(x.value)/max*100}%;--serie:var(--cost-${i%5})"></i></span></button>`).join('')}</div>${c.incompleta?'<p class="hint">Há contas sem valor válido; composição incompleta.</p>':''}`;
}
function atalhosCustos(){
 const atalhos=[['⚡','Energia','2.5.3'],['💧','Água','2.5.1'],['📡','Telefone e internet','2.5.4'],['🏠','Aluguel','2.5.2']];
 return `<div class="cost-shortcuts">${atalhos.map(([icon,nome,code])=>`<button data-cost="${code}" class="cost-shortcut ${state.view==='custos'&&custoUI.conta===code?'active':''}"><span class="cost-emoji">${icon}</span><span><span class="label">${nome}</span><strong>${valorTexto(F.valorConta(regAtual(),code))}</strong><small>${esc(contaConhecida(code))}</small></span><span class="shortcut-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>`;
}
function resumoMovimento(reg){
 const entrada=F.valorConta(reg,'1'),saida=F.valorConta(reg,'2'),delta=entrada!=null&&saida!=null?Math.round((entrada-saida)*100)/100:null;
 return `<div class="cards finance-kpis">${metric('O que entrou',entrada,'Recebimentos registrados no período','1')}${metric('O que saiu',saida,'Pagamentos registrados no período','2')}${metric('Entradas menos saídas',delta,'Variação do mês · não é lucro nem saldo bancário','variacao')}</div>`;
}
function comparativoMovimento(reg){
 if(!state.comparar)return '';
 const other=state.records.find(r=>r.label===state.comparar),cmp=F.comparacao(reg,other);
 if(!cmp.permitida)return `<div class="comparison-strip"><span>Comparação com <b>${esc(state.comparar)}</b>: diferenças automáticas aguardam conferência da cobertura e dos critérios.</span><button data-go="conferencia">Conferir →</button></div>`;
 // Número sem direção não é leitura: a seta mostra para onde foi e a cor diz
 // se aquilo é boa notícia (entrada subindo é bom; saída subindo, não).
 const seta=(v,subirEhBom)=>{
  if(v==null)return '<b>Não informado</b>';
  const dir=v>0?'▲':v<0?'▼':'■',bom=v===0?'neutro':(v>0)===subirEhBom?'bom':'ruim';
  return `<b class="delta-${bom}">${dir} ${esc(money(v))}</b>`;
 };
 return `<div class="comparison-strip"><span>Diferença para <b>${esc(state.comparar)}</b></span><span>Entradas ${seta(F.compararConta(reg,other,'1').delta,true)}</span><span>Saídas ${seta(F.compararConta(reg,other,'2').delta,false)}</span><span>Variação ${seta(cmp.delta,true)}</span></div>`;
}
function graficoPonte(reg){
 const e=F.valorConta(reg,'1'),s=F.valorConta(reg,'2');
 if(e==null||s==null)return painelGrafico('Do recebimento à variação do caixa','Movimento do período','<p class="empty">Selecione um período com entradas e saídas registradas.</p>');
 const comp=F.composicao(reg,'2');
 if(comp.incompleta)return painelGrafico('Do recebimento à variação do caixa','Movimento do período','<p class="empty">Há contas com valor inválido. Confira o detalhamento.</p>');
 const items=comp.itens.filter(x=>x.value!==0&&x.value!=null).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
 const visible=items.slice(0,5),rest=items.slice(5);
 if(rest.length)visible.push({code:'2',name:'Demais saídas',value:rest.reduce((n,c)=>n+Math.round(c.value*100),0)/100});
 let cursor=Math.round(e*100);
 const steps=[{name:'Entradas',value:e,from:0,to:e,kind:'in',code:'1'}];
 for(const c of visible){const next=cursor-Math.round(c.value*100);steps.push({...c,value:-c.value,from:cursor/100,to:next/100,kind:c.value>=0?'out':'in'});cursor=next;}
 steps.push({name:'Variação',value:cursor/100,from:0,to:cursor/100,kind:'net',code:'variacao'});
 const hi=Math.max(0,...steps.flatMap(x=>[x.from,x.to])),lo=Math.min(0,...steps.flatMap(x=>[x.from,x.to])),span=hi-lo||1;
 const y=v=>30+(hi-v)/span*205,w=steps.length*120;
 return painelGrafico('Do recebimento à variação do caixa',reg.label+' · cada saída reduz o movimento líquido',`<div class="waterfall-scroll" tabindex="0" role="region" aria-label="Gráfico em cascata. Valores disponíveis na tabela abaixo."><svg viewBox="0 0 ${w} 310" role="img" aria-label="Entradas, grupos de saídas e variação do período"><line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" class="svg-zero"/>${steps.map((x,i)=>{const xx=i*120+12;return `<g><title>${esc(x.name)}: ${money(x.value)}</title><rect x="${xx}" y="${Math.min(y(x.from),y(x.to))}" width="88" height="${Math.max(2,Math.abs(y(x.from)-y(x.to)))}" rx="5" class="water-${x.kind}"/>${i<steps.length-1?`<line x1="${xx+88}" x2="${xx+120}" y1="${y(x.to)}" y2="${y(x.to)}" class="svg-connector"/>`:''}<text x="${xx+44}" y="${Math.min(y(x.from),y(x.to))-8}" text-anchor="middle" class="svg-value">${esc(compacto(x.value))}</text><foreignObject x="${xx-5}" y="251" width="99" height="58"><div xmlns="http://www.w3.org/1999/xhtml" class="water-label">${esc(x.name)}</div></foreignObject></g>`;}).join('')}</svg></div><details class="chart-data"><summary>Ver os valores do gráfico</summary>${steps.map(x=>linha(x.name,x.value,x.kind==='net',x.code?.includes('~')?'':x.code)).join('')}</details><p class="hint">Valores em R$. A cascata reconcilia os totais desta base. Não representa lucro por competência.</p>`);
}
function catalogoCustos(){
 const cat=new Map();
 for(const r of [...state.records.filter(r=>r.label!==state.periodo),regAtual()].filter(Boolean))for(const c of r.cells||[])if(c.code.startsWith('2.'))cat.set(c.code,{code:c.code,name:c.name});
 return [...cat.values()].sort((a,b)=>a.code.localeCompare(b.code,'pt-BR',{numeric:true}));
}
function linhasCustos(){
 const cat=catalogoCustos(),normal=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),q=normal(custoUI.busca);
 if(q){const hits=cat.filter(c=>normal(c.name+' '+c.code).includes(q));return hits.filter(c=>!hits.some(p=>c.code.startsWith(p.code+'.')));}
 const descendants=cat.filter(c=>c.code.startsWith(custoUI.grupo+'.'));
 return descendants.filter(c=>!descendants.some(p=>c.code.startsWith(p.code+'.')));
}
function tabelaCustos(){
 const cols=F.serieAnual(state.records,state.periodo,'2').filter(r=>r.reg||r.label===state.periodo).sort((a,b)=>a.label===state.periodo?-1:b.label===state.periodo?1:monthSortKey(b.label)-monthSortKey(a.label)),rows=linhasCustos(),reg=regAtual(),other=state.records.find(r=>r.label===state.comparar);
 return `<div class="cost-table-wrap"><table class="cost-table"><caption>Despesas por mês · ${esc(state.periodo.split('/')[1])} · período selecionado à esquerda. — = conta ausente. * = cobertura a conferir.</caption><thead><tr><th scope="col">Despesa</th>${cols.map(c=>`<th scope="col" class="num ${c.label===state.periodo?'selected-month':''}">${esc(c.label)}${!c.qualidade.comparavel?' *':''}</th>`).join('')}${other?`<th scope="col" class="num">Variação<br><small>${esc(state.periodo)} / ${esc(other.label)}</small></th>`:''}</tr></thead><tbody>${rows.map(c=>`<tr class="${custoUI.conta===c.code?'selected-cost':''}"><th scope="row"><button data-cost="${esc(c.code)}">${esc(c.name)}</button><small>${esc(c.code)}</small></th>${cols.map(x=>{const name=nomeConta(x.reg,c.code),changed=name&&name!==c.name,v=F.valorConta(x.reg,c.code);return `<td class="num ${x.label===state.periodo?'selected-month':''}">${v==null?'<span class="muted" title="Esta conta não consta na base deste mês">—</span>':botaoConta(c.code,money(v),x.label)}${changed?`<small class="old-account-name">Nome neste mês: ${esc(name)}</small>`:''}</td>`;}).join('')}${other?`<td class="num">${(()=>{const cmp=F.compararConta(reg,other,c.code);return cmp.permitida?`${money(cmp.delta)}<small>${cmp.percentual==null?'Sem base percentual':(cmp.percentual>0?'+':'')+cmp.percentual.toFixed(1).replace('.',',')+'%'}</small>`:'<small>A conferir</small>';})()}</td>`:''}</tr>`).join('')||`<tr><td colspan="${cols.length+2}">Nenhuma despesa encontrada. Tente outro nome ou categoria.</td></tr>`}</tbody></table></div>`;
}
function renderCustos(reg){
 const grupos=catalogoCustos().filter(c=>c.code.split('.').length===2);
 return atalhosCustos()+painelGrafico('Todas as despesas, mês a mês','Compare os valores registrados e abra qualquer conta para aprofundar.',`<div class="cost-controls"><label>Categoria<select id="costGroup"><option value="2">Todas as categorias</option>${grupos.map(c=>`<option value="${esc(c.code)}" ${custoUI.grupo===c.code?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Buscar despesa<input id="costSearch" type="search" value="${esc(custoUI.busca)}" placeholder="Copasa, Cemig, materiais, pessoal…"></label><button id="exportCosts">↓ Baixar comparação</button></div>${tabelaCustos()}<p class="hint">As linhas mostram um nível por vez para evitar duplicidade. Nomes antigos são exibidos quando mudam. Variações automáticas exigem meses e classificações compatíveis.</p>`)+renderCustoSelecionado(reg)+painelGrafico('Onde estão concentradas as saídas',state.periodo+' · categorias da base',rankingCustos(reg,'2',12));
}
function renderCustoSelecionado(reg){
 const code=custoUI.conta,name=contaConhecida(code),rows=F.serieAnual(state.records,state.periodo,code);
 const other=state.records.find(r=>r.label===state.comparar),cmp=F.compararConta(reg,other,code);
 const comp=F.composicao(reg,code);
 return painelGrafico(name+' · histórico',code+' · valores de cada período, com a nomenclatura original',`<div class="cost-selected-header"><div><span class="label">${esc(state.periodo)}</span><strong>${valorTexto(F.valorConta(reg,code))}</strong></div><div class="cost-comparison">${cmp.permitida?`<span>Diferença para ${esc(other.label)}</span><b>${money(cmp.delta)}</b><small>${cmp.percentual==null?'Sem base percentual':cmp.percentual.toFixed(1).replace('.',',')+'%'}</small>`:`<span>${other?'Variação automática a conferir':'Selecione “Comparar com” para analisar a diferença'}</span>`}</div></div>${graficoBarras(rows,[{chave:'value',nome:name,cor:'var(--chart-cost)'}],'Histórico da despesa '+name)}<p class="hint">Valores históricos são mostrados como foram registrados. Contas com nomes diferentes precisam de conferência antes de comparar.</p>${comp.itens.filter(x=>!x.residuo).length?`<details class="chart-data"><summary>Composição de ${esc(name)} no mês</summary>${comp.itens.map(c=>`<div class="line"><span>${esc(c.name)}</span><b>${valorTexto(c.value)}</b></div>`).join('')}</details>`:''}`,`<button data-account="${esc(code)}">Ver detalhes ↗</button>`).replace('<section class="chart-card">','<section id="costHistory" class="chart-card" tabindex="-1">');
}
function wireGraficos(){
 document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.periodo=b.dataset.period;if(state.comparar===state.periodo)state.comparar='';render();});
 document.querySelectorAll('[data-cost]').forEach(b=>b.onclick=()=>{custoUI.conta=b.dataset.cost;custoUI.grupo=custoUI.conta==='2'?'2':custoUI.conta.split('.').slice(0,2).join('.');custoUI.busca='';state.view='custos';render();$$('costHistory')?.focus({preventScroll:true});$$('costHistory')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
 if($$('costGroup')){$$('costGroup').value=custoUI.grupo;$$('costGroup').onchange=e=>{custoUI.grupo=e.target.value;custoUI.conta=custoUI.grupo;custoUI.busca='';render();};}
 if($$('costSearch'))$$('costSearch').oninput=e=>{custoUI.busca=e.target.value;const pos=e.target.selectionStart;render();$$('costSearch').focus();$$('costSearch').setSelectionRange(pos,pos);};
 if($$('exportCosts'))$$('exportCosts').onclick=()=>{
  const cols=F.serieAnual(state.records,state.periodo,'2').filter(x=>x.reg||x.label===state.periodo);
  const csvCell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
  const out=[['Conta','Despesa',...cols.map(c=>c.label)],['','Cobertura',...cols.map(c=>c.qualidade.rotulo)],...linhasCustos().flatMap(c=>[[c.code,c.name,...cols.map(x=>{const v=F.valorConta(x.reg,c.code);return v==null?'Não informado':v.toFixed(2).replace('.',',');})],[c.code,'Nome original',...cols.map(x=>nomeConta(x.reg,c.code)||'Não informado')]])];
  download('despesas-'+state.periodo.split('/')[1]+'.csv','\ufeff'+out.map(row=>row.map(csvCell).join(';')).join('\n'),'text/csv');
 };
}

/* ── RITMO DO ANO ────────────────────────────────────────────────────────
   Três painéis no modelo pedido pelo Leonardo: a curva ACUMULADA do ano
   contra uma linha de referência, e a cor dizendo de que lado da linha o
   acumulado está. Responde "vou bater a meta / vou estourar o limite" —
   pergunta que o valor mensal isolado não responde.

   Honestidade do acumulado: mês sem dado NÃO vira zero. A curva PARA no
   último mês conhecido; os meses seguintes ficam vazios. Somar o que não foi
   coletado inventaria economia que não existe.

   As metas ficam no aparelho (localStorage), como a projeção de 13 semanas:
   gravar na nuvem exige permissão de administração, que nem todo acesso tem.  */
const METAS_KEY='dre_metas_ano';
function metasAno(ano){
 let todas={};try{todas=JSON.parse(localStorage.getItem(METAS_KEY))||{};}catch(_){}
 return {receita:null,custos:null,caixa:0,...(todas[ano]||{})};
}
function salvarMetas(ano,metas){
 let todas={};try{todas=JSON.parse(localStorage.getItem(METAS_KEY))||{};}catch(_){}
 todas[ano]={...todas[ano],...metas};
 try{localStorage.setItem(METAS_KEY,JSON.stringify(todas));}catch(_){}
}
// Acumulado mês a mês. Para no primeiro mês ausente e devolve até onde foi.
function acumularAno(code){
 const serie=F.serieAnual(state.records,state.periodo,code);
 let soma=0,parou=false;
 return serie.map(x=>{
  const v=code==='variacao'?(F.valorConta(x.reg,'1')!=null&&F.valorConta(x.reg,'2')!=null?F.valorConta(x.reg,'1')-F.valorConta(x.reg,'2'):null):x.value;
  if(parou||v==null){parou=true;return {...x,mes:v,acumulado:null};}
  soma=Math.round((soma+v)*100)/100;
  return {...x,mes:v,acumulado:soma};
 });
}
/* A cor NÃO compara o acumulado com a meta do ano inteiro: em agosto ninguém
   bateu a meta de dezembro, e pintar a receita de vermelho por isso seria
   mentira. A comparação é com o RITMO — a fatia da meta que já deveria ter
   sido cumprida até aquele mês. A linha tracejada clara marca o destino do
   ano; a pontilhada fraca, o ritmo necessário. */
function painelRitmo({titulo,tipo,pontos,referencia,rotuloRef,bomAcima}){
 const W=300,H=210,PL=46,PR=12,PT=16,PB=34;
 const vals=pontos.map(p=>p.acumulado).filter(v=>v!=null);
 if(!vals.length)return `<div class="ritmo-painel ${tipo}"><h3>${esc(titulo)}</h3><p class="ritmo-vazio">Sem dado coletado neste ano.</p></div>`;
 const cand=[...vals,referencia,0].filter(v=>v!=null&&Number.isFinite(v));
 let alto=Math.max(...cand),baixo=Math.min(...cand);
 if(alto===baixo){alto+=1;baixo-=1;}
 const folga=(alto-baixo)*.12;alto+=folga;baixo-=folga;
 const x=i=>PL+i*(W-PL-PR)/11, y=v=>PT+(alto-v)/(alto-baixo)*(H-PT-PB);
 // 4 marcas de eixo, arredondadas para número legível
 const passoBruto=(alto-baixo)/4,ordem=10**Math.floor(Math.log10(Math.abs(passoBruto)||1));
 const passo=([1,2,2.5,5,10].find(n=>n*ordem>=passoBruto)||10)*ordem;
 const marcas=[];for(let v=Math.ceil(baixo/passo)*passo;v<=alto;v+=passo)marcas.push(v);
 const ritmoDe=i=>referencia==null?null:referencia*(i+1)/12;
 const ladoBom=(v,i)=>{const alvo=ritmoDe(i);return alvo==null?true:(bomAcima?v>=alvo:v<=alvo);};
 const segs=[];
 for(let i=1;i<pontos.length;i++){
  const a=pontos[i-1],b=pontos[i];
  if(a.acumulado==null||b.acumulado==null)continue;
  segs.push(`<line x1="${x(i-1)}" y1="${y(a.acumulado)}" x2="${x(i)}" y2="${y(b.acumulado)}" class="ritmo-linha ${ladoBom(b.acumulado,i)?'bom':'ruim'}"/>`);
 }
 const ult=pontos.filter(p=>p.acumulado!=null).pop();
 return `<div class="ritmo-painel ${tipo}">
  <h3>${esc(titulo)}</h3>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}: acumulado do ano até ${esc(ult.label)}, ${money(ult.acumulado)}${referencia!=null?', referência '+money(referencia):''}">
   ${marcas.map(v=>`<line x1="${PL}" y1="${y(v)}" x2="${W-PR}" y2="${y(v)}" class="ritmo-grade"/><text x="${PL-6}" y="${y(v)+3}" class="ritmo-eixo">${esc(compacto(v))}</text>`).join('')}
   ${referencia!=null?`<line x1="${x(0)}" y1="${y(ritmoDe(0))}" x2="${x(11)}" y2="${y(referencia)}" class="ritmo-ritmo"/>`:''}
   ${referencia!=null?`<line x1="${PL}" y1="${y(referencia)}" x2="${W-PR}" y2="${y(referencia)}" class="ritmo-ref"/>`:''}
   ${segs.join('')}
   ${pontos.map((p,i)=>p.acumulado==null?'':`<circle cx="${x(i)}" cy="${y(p.acumulado)}" r="${p.label===state.periodo?4:2.6}" class="ritmo-ponto ${ladoBom(p.acumulado,i)?'bom':'ruim'} ${p.qualidade.comparavel?'':'aconferir'}"><title>${esc(p.label)} · acumulado ${money(p.acumulado)}${p.qualidade.comparavel?'':' · cobertura a conferir'}</title></circle>`).join('')}
   ${pontos.map((p,i)=>i%2?'':`<text x="${x(i)}" y="${H-14}" class="ritmo-mes">${esc(p.label.split('/')[0])}</text>`).join('')}
  </svg>
  <div class="ritmo-rodape">
   <span><b>${money(ult.acumulado)}</b> acumulado até ${esc(ult.label)}</span>
   ${(()=>{const i=pontos.findIndex(p=>p===ult),alvo=ritmoDe(i);
     if(alvo==null)return '<span class="ritmo-legenda">Defina a referência para acompanhar o ritmo</span>';
     const ok=bomAcima?ult.acumulado>=alvo:ult.acumulado<=alvo;
     return `<span class="ritmo-situacao ${ok?'bom':'ruim'}">${ok?'No ritmo':'Fora do ritmo'} · esperado ${money(alvo)} até aqui</span>`;})()}
   <span class="ritmo-legenda"><i class="ref"></i>${esc(rotuloRef)} do ano${referencia!=null?' · '+money(referencia):' não definida'}</span>
  </div>
 </div>`;
}
function graficoRitmoAno(){
 const ano=state.periodo.split('/')[1],metas=metasAno(ano);
 const rec=acumularAno('1'),des=acumularAno('2'),cx=acumularAno('variacao');
 const painel=(t,tp,p,ref,rot,bom)=>painelRitmo({titulo:t,tipo:tp,pontos:p,referencia:ref,rotuloRef:rot,bomAcima:bom});
 const definiu=metas.receita!=null||metas.custos!=null;
 return painelGrafico('Ritmo do ano',`${ano} · acumulado mês a mês contra a referência`,
  `<div class="ritmo-grid">
    ${painel('RECEITA','receita',rec,metas.receita,'Meta',true)}
    ${painel('CUSTOS','custos',des,metas.custos,'Limite',false)}
    ${painel('CAIXA','caixa',cx,metas.caixa,'Projeção',true)}
   </div>
   <p class="chart-foot">A curva soma os meses já coletados. <b>Mês sem dado interrompe a linha</b> — não é tratado como zero. Ponto vazado indica cobertura a conferir.</p>
   ${definiu?'':'<p class="hint">Defina a meta de receita e o limite de custos para as linhas tracejadas aparecerem. Sem elas, os painéis mostram só o acumulado.</p>'}`,
  `<button id="ritmoMetas">${definiu?'Ajustar metas':'Definir metas do ano'}</button>`);
}
function formularioMetas(){
 const ano=state.periodo.split('/')[1],m=metasAno(ano);
 dialog('Metas de '+ano,`<form id="metasForm"><p>Valores do ano inteiro. Ficam guardados <b>neste aparelho</b>, como a projeção de 13 semanas — não vão para a nuvem nem alteram o Mubisys.</p>
  <label>Meta de receita no ano (R$)<input name="receita" type="number" step="0.01" min="0" value="${m.receita??''}" placeholder="Ex.: 5000000"></label>
  <label>Limite de custos no ano (R$)<input name="custos" type="number" step="0.01" min="0" value="${m.custos??''}" placeholder="Ex.: 4500000"></label>
  <label>Caixa acumulado desejado (R$)<input name="caixa" type="number" step="0.01" value="${m.caixa??0}"></label>
  <p class="hint">Deixe em branco para não mostrar a linha tracejada daquele painel.</p>
  <button class="primary" type="submit">Salvar metas</button></form>`);
 $$('metasForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);
  const num=k=>{const v=f.get(k);return v===''||v==null?null:Number(v);};
  salvarMetas(ano,{receita:num('receita'),custos:num('custos'),caixa:num('caixa')});
  $$('detailDialog').close();render();toast('Metas de '+ano+' salvas neste aparelho.');};
}

/* ── PEÇAS DE RELATÓRIO ──────────────────────────────────────────────────
   Primitivas usadas pelos relatórios do DRE. Todas em SVG escrito à mão:
   a CSP do site bloqueia CDN, então não há biblioteca de gráfico.         */

/* Mini-gráfico de 12 meses para caber DENTRO da linha da tabela. Mês ausente
   não vira zero: o traço interrompe e volta quando o dado volta. */
function miniSerie(valores,opts={}){
 const W=opts.w||96,H=opts.h||24,vals=valores.filter(v=>v!=null&&Number.isFinite(v));
 if(vals.length<2)return `<span class="mini-vazio" aria-hidden="true">—</span>`;
 const alto=Math.max(...vals,0),baixo=Math.min(...vals,0),faixa=(alto-baixo)||1;
 const x=i=>i*(W-2)/(valores.length-1)+1, y=v=>H-2-((v-baixo)/faixa)*(H-4);
 let d='',aberto=false;
 valores.forEach((v,i)=>{
  if(v==null){aberto=false;return;}
  d+=(aberto?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)+' ';aberto=true;
 });
 const ult=valores.map((v,i)=>[v,i]).filter(([v])=>v!=null).pop();
 const zero=baixo<0&&alto>0?`<line x1="1" y1="${y(0).toFixed(1)}" x2="${W-1}" y2="${y(0).toFixed(1)}" class="mini-zero"/>`:'';
 return `<svg class="mini-serie ${opts.tom||''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${zero}<path d="${d.trim()}"/><circle cx="${x(ult[1]).toFixed(1)}" cy="${y(ult[0]).toFixed(1)}" r="1.9"/></svg>`;
}

/* Barras empilhadas 100%: responde "a ESTRUTURA do gasto mudou?", que o valor
   absoluto não responde — num mês de faturamento maior tudo sobe junto. */
function graficoEstrutura(meses,grupos,label){
 const cores=['var(--cost-0)','var(--cost-1)','var(--cost-2)','var(--cost-3)','var(--cost-4)','var(--muted)'];
 const legenda=`<div class="chart-legend">${grupos.map((g,i)=>`<span><i style="--serie:${cores[i%cores.length]}"></i>${esc(g.nome)}</span>`).join('')}</div>`;
 return `${legenda}<div class="chart-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><div class="estrutura-chart">${meses.map(m=>{
  const total=grupos.reduce((n,g)=>n+(m.valores[g.id]||0),0);
  if(!total)return `<div class="estrutura-col vazia"><span class="estrutura-barra"><i class="sem-dado">—</i></span><span class="chart-month">${esc(m.label.split('/')[0])}</span></div>`;
  return `<div class="estrutura-col ${m.label===state.periodo?'chosen':''}"><span class="estrutura-barra">${grupos.map((g,i)=>{
   const v=m.valores[g.id]||0,pct=v/total*100;
   return pct<0.6?'':`<i style="--serie:${cores[i%cores.length]};height:${pct.toFixed(2)}%" title="${esc(m.label+' · '+g.nome+': '+pct.toFixed(1)+'% · '+money(v))}"></i>`;
  }).join('')}</span><span class="chart-month">${esc(m.label.split('/')[0])}</span></div>`;
 }).join('')}</div></div><p class="chart-foot">Cada coluna soma 100% das saídas daquele mês. Fatia menor que 0,6% não é desenhada. — significa mês sem dado.</p>`;
}

/* Linhas sobrepostas para percentuais (margem, peso de grupo no tempo). */
function graficoLinhas(meses,series,label,sufixo='%'){
 const W=760,H=230,PL=44,PR=14,PT=14,PB=30;
 const vals=meses.flatMap(m=>series.map(s=>m.valores[s.id])).filter(v=>v!=null&&Number.isFinite(v));
 if(!vals.length)return '<p class="empty">Sem dado suficiente para a série.</p>';
 let alto=Math.max(...vals),baixo=Math.min(...vals,0);
 const folga=(alto-baixo)*.1||1;alto+=folga;baixo-=folga;
 const x=i=>PL+i*(W-PL-PR)/Math.max(1,meses.length-1), y=v=>PT+(alto-v)/(alto-baixo)*(H-PT-PB);
 const passoBruto=(alto-baixo)/4,ordem=10**Math.floor(Math.log10(Math.abs(passoBruto)||1));
 const passo=([1,2,2.5,5,10].find(n=>n*ordem>=passoBruto)||10)*ordem;
 const marcas=[];for(let v=Math.ceil(baixo/passo)*passo;v<=alto;v+=passo)marcas.push(v);
 const caminho=s=>{let d='',ab=false;meses.forEach((m,i)=>{const v=m.valores[s.id];if(v==null){ab=false;return;}d+=(ab?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)+' ';ab=true;});return d.trim();};
 return `<div class="chart-legend">${series.map(s=>`<span><i style="--serie:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>
  <div class="chart-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><svg class="linhas-chart" viewBox="0 0 ${W} ${H}">
   ${marcas.map(v=>`<line x1="${PL}" y1="${y(v)}" x2="${W-PR}" y2="${y(v)}" class="linhas-grade"/><text x="${PL-6}" y="${y(v)+3}" class="linhas-eixo">${esc(v.toLocaleString('pt-BR',{maximumFractionDigits:1})+sufixo)}</text>`).join('')}
   ${series.map(s=>`<path d="${caminho(s)}" class="linhas-path" style="--serie:${s.cor}"/>`).join('')}
   ${series.map(s=>meses.map((m,i)=>m.valores[s.id]==null?'':`<circle cx="${x(i)}" cy="${y(m.valores[s.id])}" r="${m.label===state.periodo?4:2.4}" style="--serie:${s.cor}" class="linhas-ponto"><title>${esc(m.label+' · '+s.nome+': '+m.valores[s.id].toLocaleString('pt-BR',{maximumFractionDigits:1})+sufixo)}</title></circle>`).join('')).join('')}
   ${meses.map((m,i)=>`<text x="${x(i)}" y="${H-10}" class="linhas-mes">${esc(m.label.split('/')[0])}</text>`).join('')}
  </svg></div><p class="chart-foot">Mês sem dado interrompe a linha — não é tratado como zero.</p>`;
}

/* ── RELATÓRIOS DO DRE ───────────────────────────────────────────────────
   Três leituras que a matriz de 12 colunas não dá:
   1. a ESTRUTURA do gasto mudou? (empilhado 100%)
   2. cada grupo pesa mais ou menos que antes? (linhas em %)
   3. como este mês se compara com os meses já fechados? (régua)

   Ano contra ano NÃO entra: a base começa em Dez/2025, então só dezembro
   teria par. Mostrar uma coluna de "vs ano anterior" cheia de "—" seria pior
   que não mostrar. Volta sozinho quando houver 12 meses de histórico.       */
function gruposDeSaida(reg,limite=5){
 const comp=F.composicao(reg,'2');
 const itens=comp.itens.filter(x=>x.value!=null&&x.value>0).sort((a,b)=>b.value-a.value);
 const topo=itens.slice(0,limite).map(x=>({id:x.code,nome:x.name}));
 return {topo,temResto:itens.length>limite};
}
function relatorioEstrutura(){
 const ano=state.periodo.split('/')[1];
 const base=state.records.find(r=>r.label===state.periodo)||[...state.records].reverse()[0];
 if(!base)return '';
 const {topo,temResto}=gruposDeSaida(base);
 const grupos=[...topo,...(temResto?[{id:'~outros',nome:'Demais grupos'}]:[])];
 const meses=F.serieAnual(state.records,state.periodo,'2').map(m=>{
  const valores={};
  if(m.reg){
   const total=F.valorConta(m.reg,'2')||0;let somados=0;
   for(const g of topo){const v=F.valorConta(m.reg,g.id);if(v!=null&&v>0){valores[g.id]=v;somados+=v;}}
   if(temResto&&total>somados)valores['~outros']=total-somados;
  }
  return {label:m.label,valores};
 });
 return painelGrafico('A estrutura do gasto mudou?',`${ano} · cada mês em 100% — proporção de cada grupo nas saídas`,
  graficoEstrutura(meses,grupos,'Estrutura das saídas por mês')+
  `<p class="hint">Em mês de faturamento maior tudo sobe junto; aqui só muda o que mudou de <b>proporção</b>. Os grupos são os cinco maiores de ${esc(base.label)}.</p>`);
}
function relatorioPeso(){
 const ano=state.periodo.split('/')[1];
 const base=state.records.find(r=>r.label===state.periodo)||[...state.records].reverse()[0];
 if(!base)return '';
 const {topo}=gruposDeSaida(base,4);
 const cores=['var(--cost-0)','var(--cost-1)','var(--cost-2)','var(--cost-3)'];
 const series=topo.map((g,i)=>({id:g.id,nome:g.nome,cor:cores[i%cores.length]}));
 const meses=F.serieAnual(state.records,state.periodo,'2').map(m=>{
  const valores={},total=m.reg?F.valorConta(m.reg,'2'):null;
  for(const g of topo){const v=m.reg?F.valorConta(m.reg,g.id):null;valores[g.id]=(v!=null&&total)?v/total*100:null;}
  return {label:m.label,valores};
 });
 return painelGrafico('Quanto cada grupo pesa nas saídas',`${ano} · percentual sobre o total de saídas de cada mês`,
  graficoLinhas(meses,series,'Peso de cada grupo nas saídas','%')+
  `<p class="hint">Linha subindo = o grupo passou a consumir uma fatia maior do que sai, mesmo que o valor em reais tenha caído.</p>`);
}
function relatorioRegua(){
 const atual=state.records.find(r=>r.label===state.periodo);
 if(!atual)return '';
 // Referência = mês coletado até o último dia e não expirado. NÃO exige o
 // contrato da API validado: o coletor grava false em todo mês, e exigir isso
 // deixava a régua com zero meses para sempre.
 const fechados=F.mesesDeReferencia(state.records).filter(r=>r.label!==state.periodo);
 const semValidacao=fechados.some(r=>!F.qualidade(r).comparavel);
 if(fechados.length<3)return painelGrafico('Este mês contra os meses fechados','Referência interna',
  `<p class="empty">São necessários pelo menos 3 meses coletados até o último dia para formar a referência. Hoje há ${fechados.length}.</p>`);
 const linha=(rot,code,custo)=>{
  const v=F.valorConta(atual,code);
  const hist=fechados.map(r=>F.valorConta(r,code)).filter(x=>x!=null);
  if(v==null||!hist.length)return '';
  const media=hist.reduce((a,b)=>a+b,0)/hist.length;
  const min=Math.min(...hist),max=Math.max(...hist),faixa=(max-min)||1;
  const pos=Math.max(0,Math.min(100,(v-min)/faixa*100));
  const posMedia=Math.max(0,Math.min(100,(media-min)/faixa*100));
  const dif=v-media,acima=dif>0;
  const tom=dif===0?'':(acima!==custo?'delta-bom':'delta-ruim');
  return `<div class="regua-linha"><div class="regua-topo"><span>${esc(rot)}</span><b class="${tom}">${acima?'▲':'▼'} ${esc(money(Math.abs(dif)))} ${acima?'acima':'abaixo'} da média</b></div>
   <div class="regua-trilho"><i class="regua-media" style="left:${posMedia.toFixed(1)}%"></i><i class="regua-ponto ${tom}" style="left:${pos.toFixed(1)}%"></i></div>
   <div class="regua-pes"><span>mín ${esc(money(min))}</span><span>média ${esc(money(media))}</span><span>máx ${esc(money(max))}</span></div></div>`;
 };
 return painelGrafico('Este mês contra os meses já fechados',`${esc(state.periodo)} · referência dos ${fechados.length} meses coletados até o último dia`,
  linha('Recebimentos','1',false)+linha('Pagamentos','2',true)+
  `<p class="hint">Entram os meses coletados até o último dia. Substitui o comparativo com o ano anterior, que ainda não existe: a base começa em ${esc([...state.records].sort((a,b)=>monthSortKey(a.label)-monthSortKey(b.label))[0]?.label||'—')}.</p>`+
  (semValidacao?`<p class="hint marca-aviso">* A cobertura da coleta ainda não foi validada nestes meses. Os valores estão na tela e a referência é útil, mas confira antes de decidir.</p>`:''));
}
function relatoriosDRE(){
 const reg=state.records.find(r=>r.label===state.periodo)||null;
 return `<div class="section-heading"><div><p class="eyebrow">RELATÓRIOS</p><h2>Comparativos do ano</h2></div></div>`+
  faixaCobertura()+cascataRubricas(reg)+blocosDoCaixa()+relatorioRegua()+relatorioEstrutura()+relatorioPeso();
}

/* ── 1. FAIXA DE COBERTURA ───────────────────────────────────────────────
   Antes de qualquer comparativo, a pergunta é "dá para confiar nisto?".
   Doze quadradinhos dizem de relance quais meses foram coletados até o fim,
   quais ainda estão correndo e quais faltam. Mês ausente fica vazado: nunca
   vira quadradinho cinza com cara de "ok". */
function faixaCobertura(){
 const ano=state.periodo.split('/')[1];
 const meses=PT_MON.map((m,i)=>{
  const label=m+'/'+ano,reg=state.records.find(r=>monthSortKey(r.label)===Number(ano)*12+i)||null;
  const q=F.qualidade(reg),per=F.periodo(label);
  const ateOFim=!!reg&&!!q.corte&&!!per&&q.corte>=per.ate;
  let classe='ausente';
  if(reg){
   if(q.estado==='parcial')classe='parcial';
   else if(q.estado==='desatualizado')classe='atrasado';
   else classe=ateOFim?(q.comparavel?'validado':'coletado'):'parcial';
  }
  return {label,m,reg,q,classe,ateOFim};
 });
 const completos=meses.filter(x=>x.ateOFim).length;
 const validados=meses.filter(x=>x.classe==='validado').length;
 const escopos=new Set(meses.filter(x=>x.reg).map(x=>JSON.stringify([x.reg.company,x.reg.basis,x.reg.qualidade?.escopo,x.reg.qualidade?.regra])));
 return `<section class="cobertura-card">
  <div class="cobertura-topo"><div><h3>Dá para confiar nestes comparativos?</h3>
   <p>${esc(ano)} · como está a coleta de cada um dos doze meses</p></div>
   <div class="cobertura-conta"><b>${completos} de 12</b><span>meses coletados até o último dia</span></div></div>
  <div class="cobertura-faixa">${meses.map(x=>`<button class="cob ${x.classe}" data-period="${esc(x.label)}" ${x.reg?'':'disabled'}
    title="${esc(x.label+' · '+x.q.rotulo+' — '+x.q.mensagem)}"><i></i><span>${esc(x.m[0])}</span></button>`).join('')}</div>
  <div class="cobertura-legenda">
   <span><i class="cob validado"></i>coletado e validado</span>
   <span><i class="cob coletado"></i>coletado, cobertura a conferir</span>
   <span><i class="cob parcial"></i>mês ainda correndo</span>
   <span><i class="cob ausente"></i>sem coleta</span></div>
  ${validados===0&&completos>0?`<p class="hint marca-aviso">Nenhum mês teve a cobertura da coleta validada ainda. Os valores estão na tela e os comparativos funcionam, marcados com <b>*</b> — confira antes de decidir.</p>`:''}
  ${escopos.size>1?`<p class="hint marca-aviso">Há empresas ou critérios diferentes neste ano; os meses não formam uma série única.</p>`:''}
 </section>`;
}

/* ── 2. CASCATA DO MÊS, NAS RUBRICAS DO PRÓPRIO DRE ──────────────────────
   Nove degraus com os MESMOS nomes das linhas da tabela acima. Fecha por
   construção: entradas − as sete saídas = variação (identidade garantida
   por F.resumo, que define pagamentosOperacionais como o que sobra).
   O cursor acumula em CENTAVOS para o último degrau bater no centavo.     */
function cascataRubricas(reg){
 const tit='Entrou, saiu, sobrou — por onde passou',sub=`${esc(state.periodo)} · os mesmos degraus da coluna deste mês na tabela acima`;
 if(!reg||F.valorConta(reg,'1')==null||F.valorConta(reg,'2')==null)
  return painelGrafico(tit,sub,`<p class="empty">${esc(state.periodo)} ainda não foi coletado — a cascata precisa do total de entradas e do total de saídas do mês.</p>`);
 const r=F.resumo(reg);
 // Pessoas e impostos saem do bolo "Pagamentos da operação": eram os dois
 // maiores compromissos fixos escondidos num degrau só de R$ 358 mil. Só saem
 // se a conta EXISTIR no mês — conta ausente não vira zero, fica dentro do
 // resto, senão a cascata deixaria de fechar.
 const pessoas=F.valorConta(reg,'2.1'),impostos=F.valorConta(reg,'2.4');
 const resto=r.pagamentosOperacionais-(pessoas||0)-(impostos||0);
 const passos=[
  {id:'entradas',nome:'(+) Recebimentos considerados',curto:'Recebeu',v:r.entradas,tipo:'in'},
  ...(pessoas!=null?[{id:'2.1',nome:'(−) Pessoas · '+(contaConhecida('2.1')||'Despesas Funcionários'),curto:'Pessoas',v:-pessoas,tipo:'out'}]:[]),
  ...(impostos!=null?[{id:'2.4',nome:'(−) Impostos · '+(contaConhecida('2.4')||'Despesas Impostos'),curto:'Impostos',v:-impostos,tipo:'out'}]:[]),
  {id:'pagamentosOperacionais',nome:(pessoas!=null||impostos!=null)?'(−) Demais pagamentos da operação':'(−) Pagamentos da operação',curto:(pessoas!=null||impostos!=null)?'Resto oper.':'Operação',v:-resto,tipo:'out'},
  {id:'socios',nome:'(−) Sócios e arrendamento',curto:'Sócios',v:-r.socios,tipo:'out'},
  {id:'parcelasAtivos',nome:'(−) Parcelas de ativos',curto:'Parcelas',v:-r.parcelasAtivos,tipo:'out'},
  {id:'dividas',nome:'(−) Dívidas classificadas',curto:'Dívidas',v:-r.dividas,tipo:'out'},
  {id:'transferencias',nome:'(−) Transferências entre empresas',curto:'Transfer.',v:-r.transferencias,tipo:'out'},
  {id:'investimentos',nome:'(−) Investimentos classificados',curto:'Máquinas',v:-r.investimentos,tipo:'out'},
  {id:'pendentes',nome:'(−) Saídas sem detalhamento',curto:'Sem detalhe',v:-r.pendentes,tipo:'out'},
 ];
 const W=980,H=300,PL=58,PR=14,PT=18,PB=76;
 let cur=0;const barras=[];
 for(const p of passos){const de=cur;cur=Math.round(cur*100+Math.round(p.v*100))/100;barras.push({...p,de,ate:cur});}
 barras.push({id:'variacao',nome:'(=) Variação do caixa',curto:'Sobrou',v:cur,tipo:'net',de:0,ate:cur});
 const todos=barras.flatMap(b=>[b.de,b.ate]).concat(0);
 let alto=Math.max(...todos),baixo=Math.min(...todos);
 const folga=(alto-baixo)*.1||1;alto+=folga;baixo-=folga;
 const n=barras.length,larg=(W-PL-PR)/n*0.62,passoX=(W-PL-PR)/n;
 const x=i=>PL+i*passoX+(passoX-larg)/2, y=v=>PT+(alto-v)/(alto-baixo)*(H-PT-PB);
 const bruto=(alto-baixo)/4,ordem=10**Math.floor(Math.log10(Math.abs(bruto)||1));
 const pe=([1,2,2.5,5,10].find(k=>k*ordem>=bruto)||10)*ordem;
 const marcas=[];for(let v=Math.ceil(baixo/pe)*pe;v<=alto;v+=pe)marcas.push(v);
 return painelGrafico(tit,sub,`<div class="painel-escuro"><div class="chart-scroll" tabindex="0" role="region" aria-label="Cascata do mês">
  <svg class="cascata-svg" viewBox="0 0 ${W} ${H}">
   ${marcas.map(v=>`<line x1="${PL}" y1="${y(v)}" x2="${W-PR}" y2="${y(v)}" class="casc-grade"/><text x="${PL-7}" y="${y(v)+3}" class="casc-eixo">${esc(compacto(v))}</text>`).join('')}
   <line x1="${PL}" y1="${y(0)}" x2="${W-PR}" y2="${y(0)}" class="casc-zero"/>
   ${barras.map((b,i)=>{
     const topo=Math.max(b.de,b.ate),base=Math.min(b.de,b.ate);
     const altura=Math.max(2,Math.abs(y(base)-y(topo)));
     const lig=i>0&&i<barras.length-1?`<line x1="${(x(i-1)+larg).toFixed(1)}" y1="${y(barras[i-1].ate).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(b.de).toFixed(1)}" class="casc-lig"/>`:'';
     return `${lig}<g class="casc-barra ${b.tipo}"><rect x="${x(i).toFixed(1)}" y="${y(topo).toFixed(1)}" width="${larg.toFixed(1)}" height="${altura.toFixed(1)}" rx="2"><title>${esc(b.nome+': '+money(b.v))}</title></rect>
      <text x="${(x(i)+larg/2).toFixed(1)}" y="${(y(topo)-6).toFixed(1)}" class="casc-valor">${esc(Math.abs(b.v)<0.5?'0':compacto(b.v))}</text></g>`;
   }).join('')}
   ${barras.map((b,i)=>`<text x="${(x(i)+larg/2).toFixed(1)}" y="${H-PB+18}" class="casc-rot ${b.tipo}">${esc(b.curto)}</text>`).join('')}
  </svg></div>
  <div class="casc-rodape"><b class="${cur<0?'ruim':'bom'}">${esc(money(cur))}</b><span>é a VARIAÇÃO do caixa do mês — não é lucro e não é saldo em banco</span></div></div>
  <details class="chart-data"><summary>Ver os valores do gráfico</summary><div class="table-scroll"><table><tbody>${barras.map(b=>`<tr><td>${esc(b.nome)}</td><td class="num">${esc(money(b.v))}</td></tr>`).join('')}</tbody></table></div></details>
  ${r.emprestimos>0?`<p class="hint">Entraram <b>${esc(money(r.emprestimos))}</b> de empréstimo neste mês: dinheiro de banco também entra no primeiro degrau.</p>`:''}`);
}

/* ── 3. OS TRÊS BLOCOS QUE MEXERAM O CAIXA ───────────────────────────────
   Barras COM SINAL: o que a operação sobrou acima do zero, o que sócio e
   dívida levaram abaixo. Responde "o mês foi salvo pela operação ou por
   empréstimo?", que o total de entradas não responde.                      */
function blocosDoCaixa(){
 const ano=state.periodo.split('/')[1];
 const meses=PT_MON.map((m,i)=>{
  const label=m+'/'+ano,reg=state.records.find(r=>monthSortKey(r.label)===Number(ano)*12+i)||null;
  if(!reg||F.valorConta(reg,'1')==null||F.valorConta(reg,'2')==null)return {label,m,vazio:true};
  const r=F.resumo(reg);
  return {label,m,vazio:false,
   operacao:r.saldoOperacional,
   socios:-(r.socios+r.parcelasAtivos+r.investimentos),
   divida:r.emprestimos+r.rendimentos+r.naoIdentificadas+r.outrasEntradas-(r.dividas+r.transferencias+r.pendentes),
   variacao:r.variacao};
 });
 const W=980,H=300,PL=58,PR=14,PT=18,PB=40;
 const series=[{id:'operacao',nome:'Sobra da operação',cor:'#3ddc97'},{id:'socios',nome:'Sócios, ativos e investimento',cor:'#c2a6e7'},{id:'divida',nome:'Empréstimo e outros',cor:'#f3ae7f'}];
 const comDado=meses.filter(x=>!x.vazio);
 if(!comDado.length)return painelGrafico('O que mexeu o caixa em cada mês',ano,'<p class="empty">Nenhum mês coletado neste ano.</p>');
 const somaPos=x=>series.reduce((n,s)=>n+Math.max(0,x[s.id]||0),0),somaNeg=x=>series.reduce((n,s)=>n+Math.min(0,x[s.id]||0),0);
 let alto=Math.max(0,...comDado.map(somaPos)),baixo=Math.min(0,...comDado.map(somaNeg));
 const folga=(alto-baixo)*.08||1;alto+=folga;baixo-=folga;
 const passoX=(W-PL-PR)/12,larg=passoX*0.6;
 const x=i=>PL+i*passoX+(passoX-larg)/2, y=v=>PT+(alto-v)/(alto-baixo)*(H-PT-PB);
 const bruto=(alto-baixo)/4,ordem=10**Math.floor(Math.log10(Math.abs(bruto)||1));
 const pe=([1,2,2.5,5,10].find(k=>k*ordem>=bruto)||10)*ordem;
 const marcas=[];for(let v=Math.ceil(baixo/pe)*pe;v<=alto;v+=pe)marcas.push(v);
 return painelGrafico('O que mexeu o caixa em cada mês',`${ano} · a operação sobrou acima do zero; sócio e dívida puxam abaixo`,
  `<div class="painel-escuro"><div class="chart-legend escuro">${series.map(s=>`<span><i style="--serie:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}<span><i class="pt-var"></i>Variação do mês</span></div>
  <div class="chart-scroll" tabindex="0" role="region" aria-label="Blocos que mexeram o caixa"><svg class="blocos-svg" viewBox="0 0 ${W} ${H}">
   ${marcas.map(v=>`<line x1="${PL}" y1="${y(v)}" x2="${W-PR}" y2="${y(v)}" class="casc-grade"/><text x="${PL-7}" y="${y(v)+3}" class="casc-eixo">${esc(compacto(v))}</text>`).join('')}
   <line x1="${PL}" y1="${y(0)}" x2="${W-PR}" y2="${y(0)}" class="casc-zero"/>
   ${meses.map((m,i)=>{
     if(m.vazio)return `<text x="${(x(i)+larg/2).toFixed(1)}" y="${y(0)-6}" class="casc-vazio">—</text>`;
     let cimaAcc=0,baixoAcc=0,out='';
     for(const s of series){
      const v=m[s.id]||0;if(!v)continue;
      const de=v>0?cimaAcc:baixoAcc,ate=de+v;
      if(v>0)cimaAcc=ate;else baixoAcc=ate;
      const topo=Math.max(de,ate);
      out+=`<rect x="${x(i).toFixed(1)}" y="${y(topo).toFixed(1)}" width="${larg.toFixed(1)}" height="${Math.max(1.5,Math.abs(y(de)-y(ate))).toFixed(1)}" fill="${s.cor}" rx="1.5"><title>${esc(m.label+' · '+s.nome+': '+money(v))}</title></rect>`;
     }
     return out+`<circle cx="${(x(i)+larg/2).toFixed(1)}" cy="${y(m.variacao).toFixed(1)}" r="3.4" class="pt-variacao"><title>${esc(m.label+' · variação do mês: '+money(m.variacao))}</title></circle>`;
   }).join('')}
   ${meses.map((m,i)=>`<text x="${(x(i)+larg/2).toFixed(1)}" y="${H-14}" class="casc-rot ${m.label===state.periodo?'atual':''}">${esc(m.m)}</text>`).join('')}
  </svg></div></div>
  <p class="chart-foot">O ponto branco é a variação do mês: quando ele fica acima do zero e as barras verdes são pequenas, quem segurou o caixa foi empréstimo, não a operação. — significa mês sem coleta.</p>`);
}
