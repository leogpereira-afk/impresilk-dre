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
 return `<div class="comparison-strip"><span>Diferença para <b>${esc(state.comparar)}</b></span><span>Entradas <b>${valorTexto(F.compararConta(reg,other,'1').delta)}</b></span><span>Saídas <b>${valorTexto(F.compararConta(reg,other,'2').delta)}</b></span><span>Variação <b>${money(cmp.delta)}</b></span></div>`;
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
 return painelGrafico('Do recebimento à variação do caixa',reg.label+' · cada saída reduz o movimento líquido',`<div class="waterfall-scroll" tabindex="0" role="region" aria-label="Gráfico em cascata. Valores disponíveis na tabela abaixo."><svg viewBox="0 0 ${w} 310" role="img" aria-label="Entradas, grupos de saídas e variação do período"><line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" class="svg-zero"/>${steps.map((x,i)=>{const xx=i*120+12;return `<g><title>${esc(x.name)}: ${money(x.value)}</title><rect x="${xx}" y="${Math.min(y(x.from),y(x.to))}" width="88" height="${Math.max(2,Math.abs(y(x.from)-y(x.to)))}" rx="5" class="water-${x.kind}"/>${i<steps.length-1?`<line x1="${xx+88}" x2="${xx+120}" y1="${y(x.to)}" y2="${y(x.to)}" class="svg-connector"/>`:''}<text x="${xx+44}" y="${Math.min(y(x.from),y(x.to))-8}" text-anchor="middle" class="svg-value">${esc(compacto(x.value))}</text><foreignObject x="${xx-5}" y="251" width="99" height="58"><div xmlns="http://www.w3.org/1999/xhtml" class="water-label">${esc(x.name)}</div></foreignObject></g>`;}).join('')}</svg></div><details class="chart-data"><summary>Ver os valores do gráfico</summary>${steps.map(x=>linha(x.name,x.value,x.kind==='net')).join('')}</details><p class="hint">Valores em R$. A cascata reconcilia os totais desta base. Não representa lucro por competência.</p>`);
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
 return `<div class="cost-table-wrap"><table class="cost-table"><caption>Despesas por mês · ${esc(state.periodo.split('/')[1])} · período selecionado à esquerda. — = conta ausente. * = cobertura a conferir.</caption><thead><tr><th scope="col">Despesa</th>${cols.map(c=>`<th scope="col" class="num ${c.label===state.periodo?'selected-month':''}">${esc(c.label)}${!c.qualidade.comparavel?' *':''}</th>`).join('')}${other?`<th scope="col" class="num">Variação<br><small>${esc(state.periodo)} / ${esc(other.label)}</small></th>`:''}</tr></thead><tbody>${rows.map(c=>`<tr class="${custoUI.conta===c.code?'selected-cost':''}"><th scope="row"><button data-cost="${esc(c.code)}">${esc(c.name)}</button><small>${esc(c.code)}</small></th>${cols.map(x=>{const name=nomeConta(x.reg,c.code),changed=name&&name!==c.name,v=F.valorConta(x.reg,c.code);return `<td class="num ${x.label===state.periodo?'selected-month':''}">${v==null?'<span class="muted" title="Esta conta não consta na base deste mês">—</span>':money(v)}${changed?`<small class="old-account-name">Nome neste mês: ${esc(name)}</small>`:''}</td>`;}).join('')}${other?`<td class="num">${(()=>{const cmp=F.compararConta(reg,other,c.code);return cmp.permitida?`${money(cmp.delta)}<small>${cmp.percentual==null?'Sem base percentual':(cmp.percentual>0?'+':'')+cmp.percentual.toFixed(1).replace('.',',')+'%'}</small>`:'<small>A conferir</small>';})()}</td>`:''}</tr>`).join('')||`<tr><td colspan="${cols.length+2}">Nenhuma despesa encontrada. Tente outro nome ou categoria.</td></tr>`}</tbody></table></div>`;
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
