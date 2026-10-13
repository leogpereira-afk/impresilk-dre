/* Catálogo de leitura: nenhuma conta ou classificação é criada na origem. */
const PlanoContas=(()=>{
 const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function catalogo(records,year,preferred){
  const map=new Map();
  const recs=records.filter(r=>r.label?.endsWith('/'+year));
  for(const r of [...recs.filter(r=>r.label!==preferred),...recs.filter(r=>r.label===preferred)])for(const c of r.cells||[]){
   const old=map.get(c.code);map.set(c.code,{code:c.code,name:c.name,names:[...new Set([...(old?.names||[]),c.name])],tipo:c.code.split('.')[0],nivel:c.code.split('.').length,reg:r});
  }
  // Código da mesma conta no Mubisys (o painel guarda a numeração antiga do plano).
  return [...map.values()].map(({reg,...x})=>({...x,mubisys:typeof CodigosMubisys!=='undefined'?CodigosMubisys.noMubisys(x.code,reg):null})).sort((a,b)=>a.code.localeCompare(b.code,'pt-BR',{numeric:true}));
 }
 function filtrar(rows,{query='',tipo='todos',grupo='todos',conta=''}={}){
  const q=normalize(query.trim()),terms=q==='agua'?['agua','copasa']:['energia','cemig'].includes(q)?['energia','cemig']:[q];
  return rows.filter(c=>(tipo==='todos'||c.tipo===tipo)&&(grupo==='todos'||c.code===grupo||c.code.startsWith(grupo+'.'))&&(!conta||c.code===conta||c.code.startsWith(conta+'.'))&&(!q||terms.some(t=>q==='agua'?normalize(c.names.join(' ')).split(/[^a-z0-9]+/).some(w=>w===t||w===t+'s'):normalize(c.code+' '+c.names.join(' ')+' '+(c.mubisys?.codigos||[]).join(' ')).includes(t))));
 }
 function comparacao(a,b,code){return F.compararConta(a,b,code);}
 function arvore(catalogo,rows){
  const visible=new Set(rows.map(c=>c.code));
  for(const c of rows)for(const p of catalogo)if(c.code.startsWith(p.code+'.'))visible.add(p.code);
  const nodes=catalogo.filter(c=>visible.has(c.code)).map(c=>({...c,children:[]})),map=new Map(nodes.map(c=>[c.code,c])),roots=[];
  for(const n of nodes){let parts=n.code.split('.');parts.pop();while(parts.length&&!map.has(parts.join('.')))parts.pop();const parent=map.get(parts.join('.'));if(parent)parent.children.push(n);else roots.push(n);}
  return roots;
 }
 return {catalogo,filtrar,comparacao,arvore};
})();
let planoContasPagina=0,planoContasScroll=0;
// " · Mubisys 2.3.2" ao lado do código do painel, quando os dois diferem.
const planoMubisys=c=>{const r=c?.mubisys;return !r||r.tipo==='igual'||!r.texto?'':' · '+esc(r.texto);};
const planoUI={aba:'dashboard',ramos:new Set(),lateral:null,iniciada:false,matriz:null};
/* Planilha em árvore (Fase 12.5): cada grupo abre e fecha sem redesenhar a tela; no começo
   aparecem os grupos de 1º e 2º nível. Com busca, filtro ou conta escolhida, tudo aberto.
   Depois dos 12 meses: o total do ano e o ano anterior nos mesmos meses (só os meses fechados
   nos dois anos), com a diferença na cor do sentido do dinheiro. */
const planoMatrizAbertos=()=>planoUI.matriz||(planoUI.matriz=new Set(['1','2']));
// Índice código → conta de cada registro: a planilha consulta ~500 contas × 12 meses × 2 anos.
const planoIndice=new WeakMap();
function planoCelula(reg,code){if(!reg)return undefined;let m=planoIndice.get(reg);if(!m){m=new Map((reg.cells||[]).map(c=>[c.code,c]));planoIndice.set(reg,m);}return m.get(code);}
const planoNome=(reg,code)=>planoCelula(reg,code)?.name;
const planoRenomeavel=code=>String(code).split('.').some(p=>Number(p)>=51);
const planoFiltrando=x=>!!(state.consulta||state.tipo!=='todos'||state.grupo!=='todos'||x.selected);
function planoAncestrais(code,codigos){const p=String(code).split('.'),out=[];for(let i=1;i<p.length;i++){const a=p.slice(0,i).join('.');if(codigos.has(a))out.push(a);}return out;}
function planoMesesComparaveis(ctx){
 const hoje=typeof dfcHoje==='function'?dfcHoje():new Date().toISOString().slice(0,10),ant=String(Number(ctx.year)-1);
 const fechado=r=>{const per=r&&F.periodo(r.label);return !!per&&per.ate<hoje&&!F.qualidade(r).parcial;};
 // Mês com mais de 10% das saídas sem plano de contas (2.99) não compara conta a conta: o dinheiro está em 2.99.
 const comPlano=r=>{const a=typeof DRESimples!=='undefined'?DRESimples.apurar(r):null;return !(a&&a.pctSemConta!=null&&a.pctSemConta>10);};
 return ctx.months.map((m,i)=>({m,prev:state.records.find(r=>r.label===PT_MON[i]+'/'+ant)})).filter(x=>fechado(x.m.reg)&&fechado(x.prev)&&F.comparavelComRessalva(x.m.reg,x.prev).pode&&comPlano(x.m.reg)&&comPlano(x.prev));
}
function planoAno(ctx,code,comp,parcialMes){
 const cent=v=>Math.round(Number(v)*100),vals=ctx.months.map(m=>planoValor(m.reg,code)),tem=vals.some(v=>v!=null);
 const total=tem?vals.reduce((t,v)=>t+(v==null?0:cent(v)),0)/100:null,parcial=ctx.months.some((m,i)=>vals[i]!=null&&(parcialMes?parcialMes[i]:m.reg&&F.qualidade(m.reg).parcial));
 // Código 51+ é reaproveitado pelo robô para contas diferentes: nomes diferentes no ano não somam.
 const nomesAno=new Set(ctx.months.map(m=>planoNome(m.reg,code)).filter(Boolean)),misturado=planoRenomeavel(code)&&nomesAno.size>1;
 const sem={total:misturado?null:total,parcial,cur:null,prev:null,delta:null,pct:null,misturado};
 if(!comp.length)return {...sem,motivo:'sem meses fechados nos dois anos'};
 const prof=String(code).split('.').length>2;
 const pares=comp.filter(x=>!prof||(x.m.reg.origem||'planilha')===(x.prev.origem||'planilha'));
 if(!pares.length)return {...sem,motivo:'origens diferentes entre os anos'};
 if(pares.some(x=>{const a=planoNome(x.m.reg,code),b=planoNome(x.prev,code);return a&&b&&planoRenomeavel(code)&&a!==b;}))return {...sem,motivo:'conta renomeada entre os anos'};
 // Conta ausente num mês com registro é zero de movimento; ausente em TODOS os meses de um lado, não existia.
 const temCur=pares.some(x=>planoCelula(x.m.reg,code)),temPrev=pares.some(x=>planoCelula(x.prev,code));
 if(!temCur||!temPrev)return {...sem,motivo:!temPrev?'a conta não existia no ano anterior':'a conta não aparece nesses meses'};
 const c1=pares.reduce((t,x)=>t+(planoValor(x.m.reg,code)==null?0:cent(planoValor(x.m.reg,code))),0),c0=pares.reduce((t,x)=>t+(planoValor(x.prev,code)==null?0:cent(planoValor(x.prev,code))),0);
 return {total:sem.total,parcial,misturado,cur:c1/100,prev:c0/100,delta:(c1-c0)/100,pct:c0?(c1-c0)/Math.abs(c0)*100:null,pares};
}
function planoLateralAberta(){
 if(planoUI.lateral!=null)return planoUI.lateral;
 try{const saved=localStorage.getItem('dre_plano_lateral');if(saved!=null)return planoUI.lateral=saved==='aberta';}catch{}
 return planoUI.lateral=typeof matchMedia==='undefined'||!matchMedia('(max-width:600px)').matches;
}
function planoSelecionar(code){
 state.contaSelecionada=code;state.consulta='';state.tipo='todos';state.grupo='todos';planoContasPagina=0;
 for(const c of contextoPlano().catalogo)if(code.startsWith(c.code+'.'))planoUI.ramos.add(c.code);
 render();
}
function arvorePlano(x){
 const branch=n=>`<div class="plano-node"><div class="plano-node-row">${n.children.length?`<button class="plano-toggle" data-plano-toggle="${esc(n.code)}" aria-expanded="${planoUI.ramos.has(n.code)||!!state.consulta}" aria-label="Abrir ou recolher ${esc(n.name)}">${planoUI.ramos.has(n.code)||state.consulta?'▾':'▸'}</button>`:'<span class="plano-leaf"></span>'}<button class="plano-account ${n.tipo==='1'?'entrada':'saida'} nivel-${Math.min(n.nivel,3)}" data-plano-select="${esc(n.code)}" aria-pressed="${x.selected===n.code}"${n.mubisys?.texto&&n.mubisys.tipo!=='igual'?` title="${esc(n.code+' · '+n.mubisys.texto)}"`:''}><span>${esc(n.name)}</span><small>${esc(n.code)}</small></button></div>${n.children.length?`<div class="plano-children" ${planoUI.ramos.has(n.code)||state.consulta?'':'hidden'}>${n.children.map(branch).join('')}</div>`:''}</div>`;
 return PlanoContas.arvore(x.catalogo,x.contas).map(branch).join('')||'<p>Nenhuma conta encontrada.</p>';
}
function atalhosPlano(x){
 const shortcuts=[['💰','Entradas',/^receitas$|^entradas$/],['💳','Saídas',/^despesas$|^saidas$/],['👥','Salários',/^salario$/],['⚡','Energia',/cemig/],['💧','Água',/copasa|^agua$/],['🏠','Aluguel',/aluguel/],['🧾','Impostos',/impostos/],['📦','Materiais',/materiais.*insumos/],['🚗','Veículos',/despesas.*veiculos/],['🏦','Bancárias',/despesas.*bancarias/]];
 const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return shortcuts.map(([emoji,label,pattern])=>{const matches=x.catalogo.filter(c=>pattern.test(norm(c.name))&&(label==='Entradas'?c.tipo==='1':c.tipo==='2')).sort((a,b)=>a.nivel-b.nivel||Number(planoValor(regAtual(),b.code)!=null)-Number(planoValor(regAtual(),a.code)!=null)||Math.abs(planoValor(regAtual(),b.code)||0)-Math.abs(planoValor(regAtual(),a.code)||0));const c=matches[0];return c?`<button data-plano-quick="${esc(c.code)}" aria-pressed="${x.selected===c.code}"><span aria-hidden="true">${emoji}</span> ${label}</button>`:'';}).join('');
}
function dashboardPlano(x){
 const selected=x.catalogo.find(c=>c.code===x.selected),roots=PlanoContas.arvore(x.contas,x.contas);
 const c=selected||(roots.length===1?roots[0]:(!state.consulta&&state.grupo==='todos'?x.catalogo.find(c=>c.code===(state.tipo==='1'?'1':'2')):null));
 if(!c)return '<div class="plano-insight">Escolha uma conta na lista ou nos atalhos para comparar os meses. A aba Planilha mostra todos os resultados da busca.</div>';
 const atual=x.months.find(m=>m.label===state.periodo)?.reg,idx=PT_MON.indexOf(state.periodo.split('/')[0]);
 const anteriorLabel=state.comparar||(idx?PT_MON[idx-1]+'/'+x.year:'Dez/'+(Number(x.year)-1)),anterior=state.records.find(r=>r.label===anteriorLabel);
 const cp=PlanoContas.comparacao(atual,anterior,c.code),v=planoValor(atual,c.code),old=planoValor(anterior,c.code),serie=F.serieAnual(state.records,state.periodo,c.code);
 if(typeof anoAtivo==='function'&&anoAtivo()){
  const comp=planoMesesComparaveis(x),a=planoAno(x,c.code,comp),ant=Number(x.year)-1,txt=comp.length?(comp.length===12?'ano inteiro':`${comp[0].m.label.split('/')[0]} a ${comp.at(-1).m.label.split('/')[0]}`):'';
  const leitura=!comp.length?`Sem meses fechados, da mesma base e com plano de contas em ${x.year} e ${ant} para comparar.`:a.delta==null?`Não comparável: ${a.motivo}.`:a.delta===0?'O valor ficou estável.':`${a.delta>0?'Aumentou':'Diminuiu'} ${money(Math.abs(a.delta))}${a.pct==null?'':` (${(a.pct>0?'+':'−')+Math.abs(Math.round(a.pct*10)/10).toLocaleString('pt-BR')}%)`} contra ${ant} nos mesmos meses (${txt}).`;
  return `<section class="plano-dashboard" aria-label="Dashboard comparativo"><div class="section-row"><h2>📊 ${esc(c.name)} <small>· ${esc(c.code)}${planoMubisys(c)}</small></h2><span class="plano-compare">Ano ${esc(x.year)} contra ${ant}</span></div><div class="plano-stats"><div><small>${esc(x.year)} · ${esc(txt||'meses com registro')}</small><strong class="${planoTom(c.code,a.cur??a.total)}">${(a.cur??a.total)==null?'Não informado':money(a.cur??a.total)}</strong></div><div><small>${ant} · mesmos meses</small><strong class="${planoTom(c.code,a.prev)}">${a.prev==null?'Não informado':money(a.prev)}</strong></div><div><small>Diferença</small><strong class="${a.delta?planoTom(c.code,a.delta):''}">${a.delta==null?'Não comparável':money(a.delta)}</strong><small>${a.pct==null?'Sem base percentual':esc((a.pct>0?'+':a.pct<0?'−':'')+Math.abs(Math.round(a.pct*10)/10).toLocaleString('pt-BR')+'%')}</small></div></div><p class="plano-insight">${esc(leitura)} Total de ${esc(x.year)} com todos os meses registrados: ${a.total==null?'não informado':esc(money(a.total))}${a.parcial?' (inclui mês em andamento ou pela metade)':''}.</p>${graficoBarras(serie,[{chave:'value',nome:c.name,cor:c.tipo==='1'?'var(--chart-in)':'var(--chart-out)'}],'Evolução mensal de '+c.name)}<p class="hint">Clique num mês na barra de cima para voltar à comparação mês a mês.</p></section>`;
 }
 for(const r of serie)r.name=[r.name,r.reg?.company].filter(Boolean).join(' · ');
 const last=serie.filter(r=>r.value!=null).at(-1),percent=cp.percentual==null?'Sem base percentual':cp.percentual.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
 const reason=v==null?`Sem valor informado em ${state.periodo}. Isso não significa zero.`:cp.permitida?(cp.delta===0?'O valor registrado ficou estável.':`O valor registrado ${cp.delta>0?'aumentou':'diminuiu'} ${money(Math.abs(cp.delta))} em relação a ${anteriorLabel}.`):'Comparação indisponível: '+(cp.motivo||'Confira a base dos meses.');
 const aliases=x.catalogo.filter(k=>k.code!==c.code&&k.name===c.name);
 const comp=F.composicao(atual,c.code),children=comp.itens.filter(v=>!v.residuo).sort((a,b)=>Math.abs(b.value??0)-Math.abs(a.value??0));
 return `<section class="plano-dashboard" aria-label="Dashboard comparativo"><div class="section-row"><h2>📊 ${esc(c.name)} <small>· ${esc(c.code)}${planoMubisys(c)}</small></h2><label class="plano-compare">Comparar com <select id="planoCompare" aria-label="Mês de comparação">${[...new Set([anteriorLabel,...state.records.map(r=>r.label)])].filter(m=>m!==state.periodo).sort((a,b)=>monthSortKey(b)-monthSortKey(a)).map(m=>`<option ${m===anteriorLabel?'selected':''}>${esc(m)}</option>`).join('')}</select></label></div>${aliases.length?`<p class="hint">Mesmo nome em outras contas: ${aliases.map(k=>`<button class="plano-alias" data-plano-select="${esc(k.code)}">${esc(k.name+' · '+k.code)}</button>`).join(' ')}. Valores mantidos separados.</p>`:''}<div class="plano-stats"><div><small>${esc(state.periodo)}</small><strong class="${planoTom(c.code,v)}">${v==null?'Não informado':money(v)}</strong></div><div><small>${esc(anteriorLabel)}</small><strong class="${planoTom(c.code,old)}">${old==null?'Não informado':money(old)}</strong></div><div><small>Diferença entre os meses</small><strong>${cp.permitida?money(cp.delta):'Não comparável'}</strong><small>${cp.permitida?esc(percent):'Critérios abaixo'}</small></div></div><p class="plano-insight">${esc(reason)} ${cp.ressalva?'Cobertura ainda a conferir.':''}${v==null&&last&&last.label!==state.periodo?` <button data-period="${esc(last.label)}">Abrir último registro: ${esc(last.label)}</button>`:''}</p>${graficoBarras(serie,[{chave:'value',nome:c.name,cor:c.tipo==='1'?'var(--chart-in)':'var(--chart-out)'}],'Evolução mensal de '+c.name)}<p class="hint">Meses com * exigem conferência. Cada barra usa o nome e o escopo registrados no mês; as variações só são calculadas entre bases compatíveis.</p>${children.length?`<details class="plano-breakdown"><summary>Composição do mês · ${children.length} subcontas</summary><div class="table-scroll"><table><thead><tr><th>Subconta</th><th class="num">${esc(state.periodo)}</th><th class="num">Diferença para ${esc(anteriorLabel)}</th></tr></thead><tbody>${children.map(k=>{const cp=PlanoContas.comparacao(atual,anterior,k.code);return `<tr><td><button data-plano-select="${esc(k.code)}">${esc(k.name)}</button></td><td class="num ${planoTom(k.code,k.value)}">${k.value==null?'Não informado':money(k.value)}</td><td class="num">${cp.permitida?money(cp.delta):'Não comparável'}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">Subcontas diretas, sem somar níveis diferentes. ${comp.itens.some(k=>k.residuo)?'Há diferença entre o total e o detalhamento. Consulte a origem para conferir.':''}</p></details>`:''}</section>`;
}
function contextoPlano(){
 const year=state.periodo.split('/')[1],catalogo=PlanoContas.catalogo(state.records,year,state.periodo),filtros={query:state.consulta,tipo:state.tipo,grupo:state.grupo};
 const contas=PlanoContas.filtrar(catalogo,filtros),selected=state.contaSelecionada||'';
 const rows=PlanoContas.filtrar(catalogo,{...filtros,conta:selected});
 const months=PT_MON.map(m=>({label:m+'/'+year,reg:state.records.find(r=>r.label===m+'/'+year)}));
 return {year,catalogo,contas,selected,rows,months};
}
function planoValor(reg,code){const c=planoCelula(reg,code);return c?.value==null?null:c.value;}
function planoTom(code,v){return tomDoValor(code.startsWith('1')?'entradas':code.startsWith('2')?'saidas':'',v);}
function tabelaPlano(ctx,rows=ctx.rows){
 const codigos=new Set(rows.map(c=>c.code)),comTudo=planoFiltrando(ctx),abertos=planoMatrizAbertos(),comp=planoMesesComparaveis(ctx),ant=Number(ctx.year)-1,parcialMes=ctx.months.map(m=>!!m.reg&&F.qualidade(m.reg).parcial);
 const filhos=new Set(rows.map(c=>planoAncestrais(c.code,codigos).at(-1)).filter(Boolean));
 const compTxt=comp.length?(comp.length===12?'ano inteiro':comp.length===1?comp[0].m.label.split('/')[0]:`${comp[0].m.label.split('/')[0]} a ${comp.at(-1).m.label.split('/')[0]}`):'';
 const pct=v=>v==null?'·':(v>0?'+':v<0?'−':'')+Math.abs(Math.round(v*10)/10).toLocaleString('pt-BR')+'%';
 const corpo=rows.map(c=>{
  const anc=planoAncestrais(c.code,codigos),fechado=!comTudo&&anc.some(a=>!abertos.has(a)),temFilhos=!comTudo&&filhos.has(c.code),aberto=abertos.has(c.code),a=planoAno(ctx,c.code,comp,parcialMes);
  const titulo=`${c.code}${c.mubisys?.texto&&c.mubisys.tipo!=='igual'?' · '+c.mubisys.texto:''} · ${c.tipo==='1'?'entrada':c.tipo==='2'?'saída':'outro'} · nível ${c.nivel}`;
  return `<tr class="plano-linha nivel-${Math.min(c.nivel,4)} ${c.tipo==='1'?'entrada':'saida'}" data-plano-linha="${esc(c.code)}" data-ancestrais="${esc(anc.join(' '))}"${fechado?' hidden':''}><th scope="row" style="--recuo:${(c.nivel-1)*14}px" title="${esc(titulo)}"><span class="plano-linha-nome">${temFilhos?`<button type="button" class="plano-ramo" data-plano-ramo="${esc(c.code)}" aria-expanded="${aberto}" aria-label="${aberto?'Recolher':'Abrir'} ${esc(c.name)}">${aberto?'▾':'▸'}</button>`:'<span class="plano-ramo-vazio"></span>'}<button data-plano-select="${esc(c.code)}">${esc(c.name)}</button></span><small>${esc(c.code)}${planoMubisys(c)}</small></th>${ctx.months.map(m=>{const v=planoValor(m.reg,c.code),name=planoNome(m.reg,c.code);return `<td class="num ${planoTom(c.code,v)} ${m.label===state.periodo?'selected-month':''}">${v==null?'<span title="Valor não informado nesta base">—</span>':`<button class="plano-value" data-plano-origin="${esc(c.code)}" data-plano-month="${esc(m.label)}" aria-label="${esc(c.name+' em '+m.label+': '+money(v))}">${money(v).replace('R$','').trim()}</button>`}${name&&name!==c.name?`<small class="old-account-name">${esc(name)}</small>`:''}</td>`;}).join('')}<td class="num plano-ano ${planoTom(c.code,a.total)}"${a.misturado?' title="O robô usou este código para contas com nomes diferentes no ano: não soma"':''}>${a.misturado?'·':a.total==null?'—':money(a.total).replace('R$','').trim()+(a.parcial?' *':'')}</td><td class="num plano-ano"${a.motivo?` title="${esc(a.motivo)}"`:''}>${a.prev==null?'·':money(a.prev).replace('R$','').trim()}</td><td class="num plano-ano ${a.delta?planoTom(c.code,a.delta):''}" title="${esc(a.delta==null?(a.motivo||'Sem comparação'):`${money(a.cur)} contra ${money(a.prev)} (${compTxt})`)}">${a.delta===0?'0%':pct(a.pct)}</td></tr>`;
 }).join('');
 const acoes=comTudo?'<div class="plano-matriz-acoes"><span class="hint">Com busca, filtro ou conta escolhida, a planilha mostra tudo aberto. Limpe para abrir e recolher os grupos.</span></div>':`<div class="plano-matriz-acoes" role="group" aria-label="Abrir e recolher grupos"><button type="button" data-plano-matriz="tudo">Expandir tudo</button><button type="button" data-plano-matriz="3">Até o nível 3</button><button type="button" data-plano-matriz="nada">Recolher tudo</button></div>`;
 return acoes+`<div class="table-scroll plano-matrix" tabindex="0" role="region" aria-label="Planilha mês a mês, com rolagem horizontal"><table><caption>${esc(ctx.year)} · valores em R$ · clique no valor para ver a origem · — = não informado · ${comp.length?`comparação com ${ant} em ${esc(compTxt)} (meses fechados nos dois anos)`:`sem meses fechados em ${ctx.year} e ${ant} para comparar`}</caption><thead><tr><th scope="col">Conta</th>${ctx.months.map(m=>`<th scope="col" class="num ${m.label===state.periodo?'selected-month':''}">${esc(m.label.split('/')[0])}${m.reg&&!F.qualidade(m.reg).comparavel?' *':''}</th>`).join('')}<th scope="col" class="num plano-ano">Total ${esc(ctx.year)}</th><th scope="col" class="num plano-ano">${ant}${comp.length&&comp.length<12?`<small>${esc(compTxt)}</small>`:''}</th><th scope="col" class="num plano-ano">Δ ${esc(ctx.year)} × ${ant}</th></tr></thead><tbody>${corpo||'<tr><td colspan="16">Nenhuma conta corresponde à seleção. Limpe a seleção ou os filtros.</td></tr>'}</tbody></table></div>`;
}
// Abre ou fecha um grupo na planilha sem redesenhar: esconde as linhas que têm um ancestral fechado.
function planoAplicarMatriz(){
 const abertos=planoMatrizAbertos();
 for(const tr of document.querySelectorAll('.plano-matrix tr[data-plano-linha]')){const anc=(tr.dataset.ancestrais||'').split(' ').filter(Boolean);tr.hidden=anc.some(a=>!abertos.has(a));}
 for(const b of document.querySelectorAll('[data-plano-ramo]')){const ab=abertos.has(b.dataset.planoRamo);b.setAttribute('aria-expanded',String(ab));b.textContent=ab?'▾':'▸';b.setAttribute('aria-label',(ab?'Recolher ':'Abrir ')+(b.nextElementSibling?.textContent||''));}
}
function comparativosConta(ctx){
 const c=ctx.catalogo.find(c=>c.code===ctx.selected);if(!c)return '';
 return `<section class="plano-comparisons"><h2>${esc(c.name)} · comparação mensal</h2><div class="table-scroll"><table><thead><tr><th>Mês</th><th>Nome registrado / empresa</th><th class="num">Valor</th><th class="num">Δ mês anterior</th><th class="num">Δ %</th><th>Leitura</th></tr></thead><tbody>${ctx.months.map((m,i)=>{const prev=i?ctx.months[i-1].reg:state.records.find(r=>r.label==='Dez/'+(Number(ctx.year)-1));const cp=PlanoContas.comparacao(m.reg,prev,c.code),v=planoValor(m.reg,c.code);return `<tr><td>${esc(m.label)}</td><td>${esc(nomeConta(m.reg,c.code)||'Não consta neste mês')}<small>${esc(m.reg?.company||'Sem base')}</small></td><td class="num ${planoTom(c.code,v)}">${v==null?'—':money(v)}</td><td class="num">${cp.permitida?money(cp.delta):'—'}</td><td class="num">${cp.percentual==null?'—':cp.percentual.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</td><td><small>${esc(cp.permitida?(cp.ressalva?'Comparação calculada; cobertura a conferir':'Base comparável'):(cp.motivo||'Sem base comparável'))}</small></td></tr>`;}).join('')}</tbody></table></div><p class="hint">Δ é a diferença para o mês anterior. A situação da coleta, a empresa e a classificação precisam ser compatíveis. Uma base anterior igual a zero não gera percentual.</p></section>`;
}
function renderPlanoContas(){
 const x=contextoPlano(),pag=Math.min(planoContasPagina,Math.max(0,Math.ceil(x.rows.length/40)-1)),selected=x.catalogo.find(c=>c.code===x.selected);
 const grupos=x.catalogo.filter(c=>c.nivel===2),tipos=[...new Set(x.catalogo.map(c=>c.tipo))];
 return `<section class="plano-shell"><div class="plano-toolbar"><label class="plano-search"><span class="sr-only">Buscar conta ou produto</span><input id="searchAccounts" type="search" aria-label="Buscar conta ou produto" value="${esc(state.consulta)}" placeholder="Buscar Cemig, água, produtos…"></label><select id="accountType" aria-label="Tipo de movimento"><option value="todos">Todos os tipos</option>${tipos.map(t=>`<option value="${esc(t)}" ${state.tipo===t?'selected':''}>${t==='1'?'Entradas':t==='2'?'Saídas':'Tipo '+esc(t)}</option>`).join('')}</select><select id="accountGroup" aria-label="Categoria"><option value="todos">Todas as categorias</option>${grupos.map(c=>`<option value="${esc(c.code)}" ${state.grupo===c.code?'selected':''}>${esc(c.name)}</option>`).join('')}</select><button data-plano-clear>Limpar filtros</button></div><div class="plano-quick">${atalhosPlano(x)}<span>${x.contas.length} contas no ano</span></div><div class="plano-viewbar"><button id="planoSidebarToggle" aria-expanded="${planoLateralAberta()}" aria-controls="planoSidebar">${planoLateralAberta()?'◂ Recolher contas':'☰ Mostrar contas'}</button><div role="group" aria-label="Modo de visualização"><button data-plano-tab="dashboard" aria-pressed="${planoUI.aba==='dashboard'}">📊 Dashboard</button><button data-plano-tab="planilha" aria-pressed="${planoUI.aba==='planilha'}">📋 Planilha e comparativos</button></div><button id="exportAccounts">↓ Planilha da seleção</button></div><div class="plano-layout ${planoLateralAberta()?'':'sidebar-closed'}"><aside id="planoSidebar" class="plano-sidebar" ${planoLateralAberta()?'':'hidden'} aria-label="Lista de contas"><div class="plano-tree-actions"><button class="plano-all" data-plano-select="" aria-pressed="${!x.selected}">Todas as contas</button><button id="planoCollapse" title="Recolher todos os grupos" aria-label="Recolher todos os grupos">⊟</button></div><div class="plano-list" tabindex="0" role="region" aria-label="Contas disponíveis, lista com rolagem">${arvorePlano(x)}</div></aside><div class="plano-content"><div class="section-row plano-selection" ${planoUI.aba==='dashboard'?'hidden':''}><div><h2>${esc(selected?.name||'Todas as contas')} <small>· ${x.year}</small></h2><p class="hint">${x.rows.length} contas na seleção${selected?' · conta e subcontas':''}</p></div>${selected?'<button data-plano-select="">Ver todas</button>':''}</div><div ${planoUI.aba==='dashboard'?'':'hidden'}>${dashboardPlano(x)}</div><div ${planoUI.aba==='planilha'?'':'hidden'}>${planoUI.aba==='planilha'?tabelaPlano(x,x.rows)+comparativosConta(x):''}</div><details class="plano-rules"><summary>Como ler esta planilha</summary><p>Os valores são os registros originais de cada mês. Totais e subcontas pertencem à mesma árvore: não some níveis entre si. Use ▸ e ▾ para abrir e recolher cada grupo. O total do ano soma os meses com registro (* quando inclui mês em andamento ou pela metade); a comparação com o ano anterior usa só os meses fechados nos dois anos. Ausência de conta ou de mês não significa valor zero. Meses marcados com * exigem conferência de cobertura. Mudanças de nome aparecem junto ao valor. Não se calcula acumulado entre escopos diferentes.</p><p>O catálogo reúne as contas registradas no ano selecionado, inclusive as que não aparecem no mês atual. Filtros e seleção também se aplicam à planilha e ao PDF.</p></details></div></div></section>`;
}
function linhasCSVPlano(x){
 const lines=[['Plano de contas',x.year],['Busca',state.consulta||'Todas'],['Tipo',state.tipo],['Categoria',state.grupo],['Conta selecionada',x.selected||'Todas'],['Critério','Valores originais por mês. Não somar totais e subcontas. Não informado não é zero.'],['Código','Código no Mubisys','Nome de referência','Tipo','Nível',...x.months.map(m=>m.label)]];
 for(const c of x.rows)lines.push([c.code,c.mubisys?.tipo==='igual'?c.code:(c.mubisys?.texto||'').replace(/^Mubisys /,''),c.name,c.tipo==='1'?'Entrada':c.tipo==='2'?'Saída':'Outro',c.nivel,...x.months.map(m=>{const v=planoValor(m.reg,c.code);return v==null?'Não informado':v.toFixed(2).replace('.',',');})]);
 lines.push([],['Histórico de nomes, cobertura e comparação com o mês anterior'],['Código','Mês','Nome registrado','Empresa','Cobertura','Valor','Diferença R$','Diferença %','Critério']);
 for(const c of x.rows)for(const [i,m] of x.months.entries()){const cp=PlanoContas.comparacao(m.reg,i?x.months[i-1].reg:state.records.find(r=>r.label==='Dez/'+(Number(x.year)-1)),c.code);const v=planoValor(m.reg,c.code),num=v=>v==null?'Não informado':v.toFixed(2).replace('.',',');lines.push([c.code,m.label,nomeConta(m.reg,c.code)||'Não consta',m.reg?.company||'Sem base',F.qualidade(m.reg).rotulo,num(v),cp.permitida?num(cp.delta):'Não comparável',num(cp.percentual),cp.motivo||'Base comparável']);}
 return lines;
}
function baixarCSVPlano(){download('plano-de-contas-'+contextoPlano().year+'.csv','\ufeff'+linhasCSVPlano(contextoPlano()).map(row=>row.map(celulaCSV).join(';')).join('\n'),'text/csv;charset=utf-8');}
async function baixarPDFPlano(button){
 const old=button.textContent;button.disabled=true;button.textContent='Preparando…';try{
  const x=contextoPlano(),JsPDF=await PDFCFO.carregar(),doc=new JsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  doc.setFontSize(18);doc.setTextColor(35,62,143);doc.text('IMPRESILK | PLANO DE CONTAS',12,15);doc.setFontSize(9);doc.setTextColor(50);doc.text(pdfTexto(x.year+' · '+(x.selected?contaConhecida(x.selected):'Todas as contas')+' · Busca: '+(state.consulta||'Todas')+' · Tipo: '+state.tipo+' · Grupo: '+state.grupo),12,23);doc.text('Valores originais em R$. Nao somar totais e subcontas. Ausencia nao significa zero.',12,29);
  doc.autoTable({startY:34,head:[['Conta',...x.months.map(m=>m.label)]],body:x.rows.map(c=>[pdfTexto(c.code+' '+c.name),...x.months.map(m=>{const v=planoValor(m.reg,c.code);return v==null?'-':money(v).replace('R$','').trim();})]),styles:{fontSize:7,cellPadding:2},columnStyles:{0:{cellWidth:55}},headStyles:{fillColor:[35,62,143]},margin:{left:12,right:12},didParseCell:d=>{if(d.section==='body'&&d.column.index>0){const c=x.rows[d.row.index],v=planoValor(x.months[d.column.index-1].reg,c.code),tom=planoTom(c.code,v);d.cell.styles.textColor=tom==='tom-entra'?[47,78,191]:tom==='tom-sai'?[170,51,62]:[75,75,75];}}});
  // The original name, scope, coverage and permitted deltas travel with the matrix.
  let auditY=doc.lastAutoTable.finalY+12;if(auditY>150){doc.addPage();auditY=18;}doc.setFontSize(14);doc.text('Critérios e comparativos mensais',12,auditY);const audit=linhasCSVPlano(x).slice(x.rows.length+10);
  doc.autoTable({startY:auditY+6,head:[['Código','Mes','Nome registrado','Empresa','Cobertura','Valor','Diferenca R$','Diferenca %','Criterio']],body:audit.map(r=>r.map(pdfTexto)),styles:{fontSize:7,cellPadding:2},headStyles:{fillColor:[35,62,143]},margin:{left:12,right:12}});
  for(let i=1;i<=doc.getNumberOfPages();i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(90);doc.text(pdfTexto('Emitido em '+new Date().toLocaleString('pt-BR')+' · Uso gerencial · '+i+'/'+doc.getNumberOfPages()),12,204);}
  doc.save('plano-de-contas-'+x.year+'.pdf');
 }catch(e){toast(e.message||'Não foi possível gerar o PDF.','err');}finally{button.disabled=false;button.textContent=old;}
}
function baixarPlanilhaTela(){
 if(state.view==='detalhe')return baixarCSVPlano();
 if(state.view==='glossario'){const rows=GlossarioFinanceiro.buscar(glossarioUI.busca,glossarioUI.grupo);return download('glossario-financeiro.csv','\ufeff'+[['Termo','Assunto','Definição','Fórmula','Exemplo ilustrativo'],...rows.map(t=>[t.nome,GlossarioFinanceiro.grupos[t.grupo],t.definicao,t.formula||'',t.exemplo])].map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv;charset=utf-8');}
 if(state.view==='custos')return $$('exportCosts')?.click();
 if(state.view==='conferencia'){const reg=regAtual(),rows=(reg?.pendencias||[]).filter(p=>(gestaoUI.pendTipo==='todos'||(p.tipo||'Sem tipo')===gestaoUI.pendTipo)&&normalizarBusca([p.texto,p.conta,p.tipo].join(' ')).includes(normalizarBusca(gestaoUI.pendBusca)));return download('conferencia-'+safeId(state.periodo)+'.csv','\ufeff'+[['Período',state.periodo],['Tipo',gestaoUI.pendTipo],['Busca',gestaoUI.pendBusca],['Nota','Alertas podem se sobrepor; não somar como perda.'],['Tipo','Conta','Ocorrência','Valor','Situação','Responsável','Prazo'],...rows.map(p=>{const v=state.cfg.gestao?.[chavePendencia(reg,p)]||{};return [p.tipo,p.conta,p.texto,p.valor==null?'Não informado':Number(p.valor).toFixed(2).replace('.',','),v.situacao||'A conferir',v.responsavel||'',v.prazo||''];})].map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv;charset=utf-8');}
 const rows=[['Tela',$$('pageTitle').textContent],['Período',state.periodo],['Comparar com',state.comparar||'Sem comparação'],['Base','Caixa gerencial, valores não conciliados não representam fechamento']];
 const tables=[...$$('pageContent').querySelectorAll('table')];
 for(const table of tables){rows.push([],['Tabela',table.caption?.textContent||table.closest('section,details')?.querySelector('h2,summary')?.textContent||'Detalhamento']);for(const row of table.rows)rows.push([...row.cells].map(c=>c.textContent.replace(/\s+/g,' ').trim()));}
 if(!tables.length){for(const e of $$('pageContent').querySelectorAll('.metric,.line,.review-row'))rows.push([e.innerText.replace(/\s+/g,' ').trim()]);}
 download('dre-'+state.view+'-'+safeId(state.periodo)+'.csv','\ufeff'+rows.map(row=>row.map(celulaCSV).join(';')).join('\n'),'text/csv;charset=utf-8');
}
function wirePlanoContas(){
 if($$('pageSheet'))$$('pageSheet').onclick=baixarPlanilhaTela;
 if(state.view!=='detalhe')return;
 if(!planoUI.iniciada&&state.contaSelecionada)for(const c of contextoPlano().catalogo)if(state.contaSelecionada.startsWith(c.code+'.')){planoUI.ramos.add(c.code);const b=document.querySelector(`[data-plano-toggle="${c.code}"]`);if(b){b.setAttribute('aria-expanded','true');b.textContent='▾';b.closest('.plano-node').querySelector('.plano-children').hidden=false;}}
 planoUI.iniciada=true;
 // O mês escolhido fica logo depois da coluna fixa da conta (nenhum número cortado pela metade).
 const matrix=document.querySelector('.plano-matrix'),month=matrix?.querySelector('thead .selected-month'),fixa=matrix?.querySelector('thead th:first-child');if(matrix&&fixa)matrix.style.scrollPaddingLeft=fixa.getBoundingClientRect().width+'px';
 if(matrix&&month&&fixa&&month.getBoundingClientRect().width){matrix.scrollLeft=0;matrix.scrollLeft=Math.max(0,month.getBoundingClientRect().left-fixa.getBoundingClientRect().right);}
 for(const b of document.querySelectorAll('[data-plano-ramo]'))b.onclick=()=>{const k=b.dataset.planoRamo,ab=planoMatrizAbertos();if(ab.has(k))ab.delete(k);else ab.add(k);planoAplicarMatriz();};
 for(const b of document.querySelectorAll('[data-plano-matriz]'))b.onclick=()=>{const modo=b.dataset.planoMatriz,ab=planoMatrizAbertos();ab.clear();if(modo!=='nada')for(const tr of document.querySelectorAll('.plano-matrix tr[data-plano-linha]')){const code=tr.dataset.planoLinha;if(modo==='tudo'||code.split('.').length<Number(modo))ab.add(code);}planoAplicarMatriz();};
 const list=document.querySelector('.plano-list');if(list){list.scrollTop=planoContasScroll;list.onscroll=()=>planoContasScroll=list.scrollTop;}
 for(const b of document.querySelectorAll('[data-plano-toggle]'))b.onclick=()=>{const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));b.textContent=open?'▾':'▸';b.closest('.plano-node').querySelector('.plano-children').hidden=!open;if(open)planoUI.ramos.add(b.dataset.planoToggle);else planoUI.ramos.delete(b.dataset.planoToggle);};
 $$('planoCollapse').onclick=()=>{planoUI.ramos.clear();for(const b of document.querySelectorAll('[data-plano-toggle]')){b.setAttribute('aria-expanded','false');b.textContent='▸';b.closest('.plano-node').querySelector('.plano-children').hidden=true;}};
 $$('planoSidebarToggle').onclick=()=>{planoUI.lateral=!planoLateralAberta();try{localStorage.setItem('dre_plano_lateral',planoUI.lateral?'aberta':'fechada');}catch{}render();};
 for(const b of document.querySelectorAll('[data-plano-tab]'))b.onclick=()=>{planoUI.aba=b.dataset.planoTab;render();};
 for(const b of document.querySelectorAll('[data-plano-quick]'))b.onclick=()=>{state.consulta='';state.tipo='todos';state.grupo='todos';planoUI.aba='dashboard';planoSelecionar(b.dataset.planoQuick);};
 if($$('planoCompare'))$$('planoCompare').onchange=e=>{state.comparar=e.target.value;render();};
 const reset=()=>{planoContasPagina=0;state.contaSelecionada='';planoContasScroll=0;};
 for(const b of document.querySelectorAll('[data-plano-select]'))b.onclick=()=>{planoSelecionar(b.dataset.planoSelect);};
 for(const b of document.querySelectorAll('[data-plano-page]'))b.onclick=()=>{planoContasPagina=Number(b.dataset.planoPage);render();};
 for(const b of document.querySelectorAll('[data-plano-origin]'))b.onclick=()=>{cfoVoltas=[];abrirAnaliseConta(b.dataset.planoOrigin,b.dataset.planoMonth);};
 for(const b of document.querySelectorAll('[data-plano-search]'))b.onclick=()=>{reset();state.consulta=b.dataset.planoSearch;state.tipo='todos';state.grupo='todos';render();};
 document.querySelector('[data-plano-clear]').onclick=()=>{reset();state.consulta='';state.tipo='todos';state.grupo='todos';render();};
 $$('searchAccounts').oninput=e=>{const pos=e.target.selectionStart;reset();state.consulta=e.target.value;render();$$('searchAccounts').focus();$$('searchAccounts').setSelectionRange(pos,pos);};
 $$('accountType').onchange=e=>{reset();state.tipo=e.target.value;state.grupo='todos';render();};
 $$('accountGroup').onchange=e=>{reset();state.grupo=e.target.value;render();};
 $$('exportAccounts').onclick=baixarCSVPlano;$$('cfoPDF').onclick=()=>baixarPDFPlano($$('cfoPDF'));
}
