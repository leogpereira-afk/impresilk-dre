/* Gestão compartilhada: regras de leitura e planejamento, sem alterar lançamentos. */
let gestaoSaving=false,planoSujo=false,planoBase=null,rotaAtual='',rotaLida=false;
const gestaoUI={evolucao:'mensal',serie:'variacao',dre:'mes',pendTipo:'todos',pendBusca:'',pendPagina:0};
const mesmoEscopo=(a,b)=>!!a&&!!b&&[a.company,a.basis,a.qualidade?.escopo,a.qualidade?.regra].join('|')===[b.company,b.basis,b.qualidade?.escopo,b.qualidade?.regra].join('|');
function navContexto(){
 const groups={inicio:[['inicio','Resumo'],['cfo','O que mudou'],['detalhe','Contas e origem']],dre:[['dre','Demonstrativo'],['glossario','Entenda os conceitos']],caixa:[['caixa','Movimento e previsão'],['resultado','Composição']],indicadores:[['indicadores','Indicadores'],['cfo','Investigar variações'],['custos','Despesas e categorias'],['detalhe','Contas e origem']],conferencia:[['conferencia','Conferência'],['config','Configurações']]};
 if(['inicio','dre','detalhe','glossario','dfc','balanco','giro','recebiveis','precos','parametros'].includes(state.view))return '';
 const group=['cfo','custos'].includes(state.view)?'indicadores':state.view==='resultado'?'caixa':state.view==='glossario'?'dre':state.view==='config'?'conferencia':state.view;
 return `<nav class="context-nav" aria-label="Seções desta área">${(groups[group]||[]).filter(([v])=>v!==state.view&&!['inicio','detalhe','glossario'].includes(v)).map(([v,t])=>`<button data-go="${v}" aria-current="${v===state.view?'page':'false'}">${t}</button>`).join('')}</nav>`;
}
function restaurarRota(){
 if(typeof location==='undefined')return;const q=new URLSearchParams(location.hash.replace(/^#/,''));
 const views=typeof METADATA_TELAS!=='undefined'?Object.keys(METADATA_TELAS):['inicio','dre','caixa','indicadores','cfo','custos','detalhe','resultado','conferencia','config','ajuda','glossario'];
 if(views.includes(q.get('tela')))state.view=q.get('tela');if(F.periodo(q.get('mes')))state.periodo=q.get('mes');
 if(q.has('comparar'))state.comparar=q.get('comparar');
 if(['caixa','competencia'].includes(q.get('base')))dreUI.base=q.get('base');
 state.contaSelecionada=q.get('conta')||'';state.consulta=q.get('busca')||'';state.tipo=q.get('tipo')||'todos';state.grupo=q.get('grupo')||'todos';
 gestaoUI.dre=q.get('visao')==='ano'?'ano':'mes';rotaLida=true;rotaAtual=location.hash;
}
function gravarRota(){
 if(typeof location==='undefined'||!rotaLida)return;const p=new URLSearchParams({tela:state.view,mes:state.periodo,comparar:state.comparar,base:dreUI.base});
 if(state.view==='detalhe'){p.set('busca',state.consulta);p.set('tipo',state.tipo);p.set('grupo',state.grupo);if(state.contaSelecionada)p.set('conta',state.contaSelecionada);}
 if(state.view==='dre')p.set('visao',gestaoUI.dre);
 const hash='#'+p.toString();if(hash===rotaAtual)return;
 const anterior=new URLSearchParams(rotaAtual.slice(1)).get('tela');
 history[anterior&&anterior!==state.view?'pushState':'replaceState']({},'',hash);rotaAtual=hash;
}
if(typeof window!=='undefined')window.addEventListener('popstate',()=>{restaurarRota();render();});
function carregarGestao(){if(!planoSujo){planoBase=structuredClone(state.cfg?.gestao?.plano??null);plano=planoBase?structuredClone(planoBase):{saldo:'',reserva:0,inicio:new Date().toLocaleDateString('sv-SE'),cenario:1,movimentos:[]};}}
// Comparação que não depende da ordem das chaves: o jsonb do Postgres devolve
// as chaves em outra ordem (por tamanho), e isso não é mudança de ninguém.
// A ordem dos itens de uma lista continua contando.
const gestaoCanon=v=>Array.isArray(v)?v.map(gestaoCanon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,gestaoCanon(v[k])])):v;
const gestaoIgual=(a,b)=>JSON.stringify(gestaoCanon(a??null))===JSON.stringify(gestaoCanon(b??null));
async function salvarGestao(chave,valor,original=state.cfg?.gestao?.[chave]??null){
 if(!state.permissoes.admin)throw new Error('É necessário acesso administrativo para salvar planejamento e revisões.');
 if(gestaoSaving)throw new Error('Aguarde a gravação em andamento.');
 const sessao=STORE_KEY;gestaoSaving=true;
 try{
  const r=await api('getCfg');if(!r.ok)throw new Error('Não foi possível ler a versão compartilhada.');
  const atual=r.cfg?.gestao?.[chave]??null;if(!gestaoIgual(atual,original))throw new Error('Este planejamento mudou na nuvem. Sua edição continua aberta. Leia a base e confira antes de salvar.');
  const atualizadoEm=new Date().toISOString();const item={...valor,atualizadoEm};
  const cfg={...r.cfg,gestao:{...r.cfg?.gestao,[chave]:item,historico:[...(r.cfg?.gestao?.historico||[]),{chave,em:atualizadoEm,anterior:atual,novo:item}]}};
  const saved=await api('setCfg',{cfg,baseAtualizadoEm:r.atualizadoEm||null});if(!saved.ok)throw new Error(saved.conflito?'As configurações mudaram durante a gravação. Sua edição continua aberta.':'Gravação não confirmada: '+(saved.erro||'tente novamente.'));
  if(sessao!==STORE_KEY)throw new Error('O acesso mudou. Entre novamente para conferir a gravação.');
  state.cfg=cfg;state.cfgVersion=saved.atualizadoEm;return item;
 }finally{gestaoSaving=false;}
}
function alertasPeriodo(reg){
 const cfg=state.cfg.gestao?.alertas||{},q=F.qualidade(reg),a=[];const limite=cfg.horas??24;
 if(q.coletadoEm&&(Date.now()-Date.parse(q.coletadoEm))/36e5>limite)a.push('Coleta com mais de '+limite+'h');
 if(!q.coletadoEm)a.push('Coleta não registrada');if(q.parcial)a.push('Período parcial');
 if(reg?.pendencias?.length)a.push(reg.pendencias.length+' ocorrências para conferir');
 if(state.cacheOk===false)a.push('Sem cópia offline');return a;
}
function resumoGestao(reg){
 const anterior=state.records.find(r=>r.label===state.comparar),cmp=F.comparacao(reg,anterior);
 const rows=F.composicao(reg,'2').itens.filter(x=>!x.residuo).map(x=>({...x,cmp:F.compararConta(reg,anterior,x.code)})).filter(x=>x.cmp.permitida).sort((a,b)=>Math.abs(b.cmp.delta)-Math.abs(a.cmp.delta));
 const lim=state.cfg.gestao?.alertas?.variacao??0,mostradas=rows.filter(x=>Math.abs(x.cmp.delta)>=lim).slice(0,5),resto=rows.filter(x=>!mostradas.includes(x));
 const anoAnt=state.records.find(r=>monthSortKey(r.label)===monthSortKey(state.periodo)-12),yoy=F.comparacao(reg,anoAnt);
 const actions=Object.entries(state.cfg.gestao||{}).filter(([k,v])=>k.startsWith('acao:'+safeId(state.periodo)+':')&&v.situacao!=='Resolvida').slice(0,3);
 return `<section class="management-panel"><div class="section-row"><h2>O que mudou</h2><button id="gestaoPlanejamento">Orçamento e alertas</button></div>${cmp.permitida?`<p class="hint">${esc(state.comparar)} → ${esc(state.periodo)} · variações das categorias de saídas. ${cmp.ressalva?'Cobertura a conferir.':''}</p><div class="table-scroll"><table><thead><tr><th>Categoria</th><th class="num">Anterior</th><th class="num">Atual</th><th class="num">Diferença</th></tr></thead><tbody>${mostradas.map(x=>`<tr><td>${botaoConta(x.code,x.name)}</td><td class="num ${tomDoValor('saidas',x.cmp.anterior)}">${money(x.cmp.anterior)}</td><td class="num ${tomDoValor('saidas',x.value)}">${money(x.value)}</td><td class="num">${money(x.cmp.delta)}</td></tr>`).join('')}${resto.length?`<tr><td>Demais ${resto.length} categorias comparáveis</td><td colspan="3" class="num">${money(resto.reduce((s,x)=>s+Math.round(x.cmp.delta*100),0)/100)}</td></tr>`:''}</tbody></table></div><small>Somente grupos comparáveis. Novos códigos, mudanças de nome e resíduos permanecem em Contas e origem. A variação não comprova sua causa.</small>`:`<p>${esc(cmp.motivo||'Escolha um período de comparação no topo.')}</p>`}<div class="management-chips">${alertasPeriodo(reg).map(t=>`<button class="chip-warn" data-go="conferencia">${esc(t)}</button>`).join('')}<button data-go="detalhe">Investigar contas</button></div><details><summary>Mesmo mês do ano anterior e orçamento</summary><p>${yoy.permitida?'Variação do caixa versus '+esc(anoAnt.label)+': '+money(yoy.delta):'Ano anterior: '+esc(yoy.motivo)}</p>${tabelaOrcamento(reg)}</details>${actions.length?`<div class="management-actions">${actions.map(([k,v])=>`<button data-acao-key="${esc(k)}">${esc(v.titulo)} · ${esc(v.responsavel||'Sem responsável')} · ${esc(v.prazo||'Sem prazo')}</button>`).join('')}</div>`:''}</section>`;
}
function tabelaOrcamento(reg){const b=state.cfg.gestao?.['orcamento:'+safeId(state.periodo)],r=F.resumo(reg);return !b?'<p>Orçamento mensal ainda não informado. Não há referência inventada.</p>':`<div class="table-scroll"><table><thead><tr><th>Caixa gerencial</th><th class="num">Orçamento</th><th class="num">Realizado</th><th class="num">Desvio R$</th></tr></thead><tbody>${[['entradas','Entradas'],['saidas','Saídas'],['variacao','Entradas menos saídas']].map(([k,t])=>`<tr><td>${t}</td><td class="num ${tomDoValor(k,b[k])}">${money(b[k])}</td><td class="num ${tomDoValor(k,r[k])}">${money(r[k])}</td><td class="num">${b[k]==null||r[k]==null?'Não apurado':money(r[k]-b[k])}</td></tr>`).join('')}</tbody></table></div><p>Fonte: ${esc(b.fonte)} · versão de ${esc(dataBR(b.atualizadoEm))}. Não é orçamento por competência.</p>`;}
function evolucaoCompacta(){
 const series={entradas:['1','Entradas'],saidas:['2','Saídas'],variacao:['variacao','Entradas menos saídas']},[code,nome]=series[gestaoUI.serie];
 const alvo=regAtual(),acum=gestaoUI.evolucao==='acumulado',data=acum?acumularAno(code):F.serieAnual(state.records,state.periodo,code);
 const pts=data.map(x=>({...x,valor:acum?x.acumulado:code==='variacao'?F.resumo(x.reg).variacao:x.value}));
 return painelGrafico('Evolução do caixa',`${esc(nome)} · ${esc(state.periodo.split('/')[1])} · ${acum?'acumulado até '+esc(state.periodo):'janeiro a dezembro'}`,`<div class="management-chips"><select id="evolucaoModo" aria-label="Tipo de evolução"><option value="mensal" ${!acum?'selected':''}>Mensal</option><option value="acumulado" ${acum?'selected':''}>Acumulado</option></select><select id="evolucaoSerie" aria-label="Indicador de evolução">${Object.entries(series).map(([k,[,t]])=>`<option value="${k}" ${gestaoUI.serie===k?'selected':''}>${t}</option>`).join('')}</select><button data-metas>Metas do ano</button></div>${graficoBarras(pts,[{chave:'valor',nome,cor:code==='2'?'var(--chart-out)':code==='variacao'?'var(--chart-net)':'var(--chart-in)'}],nome)}<p class="hint">Histórico mensal preservado por fonte. Mudanças de empresa ou critério impedem a comparação direta. O acumulado exige continuidade e a mesma base desde janeiro.</p><details><summary>Metas e referências anuais</summary>${graficoRitmoAno()}</details>`);
}
function tabelaDRECompacta(d){
 const controls=`<div class="management-chips"><button data-dre-visao="mes" aria-pressed="${gestaoUI.dre==='mes'}">Mês e comparação</button><button data-dre-visao="ano" aria-pressed="${gestaoUI.dre==='ano'}">Matriz do ano</button></div>`;
 if(gestaoUI.dre==='ano')return controls+tabelaDRE(d);
 const i=d.ate-1,j=d.cols.findIndex(x=>x.label===state.comparar),a=d.valores[i]||{},b=d.valores[j]||{};
 const same=d.competencia?!!d.cols[i]?.comp&&!!d.cols[j]?.comp&&d.cols[i].comp.company.trim().toLowerCase()===d.cols[j].comp.company.trim().toLowerCase():F.comparavelComRessalva(d.cols[i]?.reg,d.cols[j]?.reg).pode;
 return controls+`<div class="table-scroll"><table class="dre-compact"><caption>${d.competencia?'Competência':'Caixa gerencial'} · ${esc(state.periodo)} · valores em R$ · AV sobre ${d.competencia?'receita líquida':'entradas ou saídas'}</caption><thead><tr><th>Rubrica</th><th class="num">${esc(state.periodo)}</th><th class="num">AV %</th><th class="num">${esc(state.comparar||'Comparação')}</th><th class="num">Δ R$ / p.p.</th><th class="num">Acumulado até ${esc(state.periodo)}</th></tr></thead><tbody>${d.linhas.map(r=>{const v=a[r.id],old=b[r.id],base=baseDoPeso(d,i,r),av=r.tipo==='ratio'||r.tipo==='total'||['entradas','saidas','variacao','bruta','liquida'].includes(r.id)||v==null||!base?null:v/base*100;return `<tr class="dre-row-${r.tipo}"><th>${esc(r.nome)}</th><td class="num ${tomDoValor(r.id,v)}"><button data-cfo-rubrica="${r.id}" data-cfo-period="${esc(state.periodo)}" data-cfo-base="${dreUI.base}">${valorDRE(v,r.tipo==='ratio')}</button></td><td class="num">${av==null?'—':av.toFixed(1).replace('.',',')+'%'}</td><td class="num ${tomDoValor(r.id,old)}">${valorDRE(old,r.tipo==='ratio')}</td><td class="num">${same&&v!=null&&old!=null?(r.tipo==='ratio'?(v-old).toLocaleString('pt-BR',{maximumFractionDigits:1})+' p.p.':valorDRE(v-old)):'—'}</td><td class="num ${tomDoValor(r.id,d.soma[r.id])}">${valorDRE(d.soma[r.id],r.tipo==='ratio')}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">Comparações exigem mesmo escopo; caixa parcial não se compara a mês completo. Ausências permanecem não apuradas. Percentuais e margens preservam o sinal.</p>`;
}
function chavePendencia(reg,p){return 'acao:'+safeId(reg.label)+':'+encodeURIComponent([p.tipo,p.conta,p.texto,p.tituloId,p.pagamentoId].join('|'));}
function painelPendencias(reg){
 const todas=reg?.pendencias||[],tipos=[...new Set(todas.map(p=>p.tipo||'Sem tipo'))];
 const rows=todas.filter(p=>(gestaoUI.pendTipo==='todos'||(p.tipo||'Sem tipo')===gestaoUI.pendTipo)&&normalizarBusca([p.texto,p.conta,p.tipo].join(' ')).includes(normalizarBusca(gestaoUI.pendBusca)));
 const pagina=Math.min(gestaoUI.pendPagina,Math.max(0,Math.ceil(rows.length/20)-1));
 return card('Fila de conferência',`<div class="filterbar"><input id="pendBusca" aria-label="Buscar pendência" placeholder="Texto ou conta" value="${esc(gestaoUI.pendBusca)}"><select id="pendTipo" aria-label="Tipo de pendência"><option value="todos">Todos os tipos</option>${tipos.map(t=>`<option ${gestaoUI.pendTipo===t?'selected':''}>${esc(t)}</option>`).join('')}</select><button id="novaAcao">+ Ação de revisão</button></div><p class="hint">${rows.length} ocorrências. A mesma movimentação pode aparecer em mais de um alerta; os valores não são somados como perda. Resolver uma ação não reclassifica o ERP.</p>${rows.slice(pagina*20,pagina*20+20).map(p=>{const key=chavePendencia(reg,p),v=state.cfg.gestao?.[key];return `<div class="review-row"><div><b>${esc(p.texto||p.tipo)}</b><small>${esc(p.conta||'')} · ${esc(v?.situacao||'A conferir')}${v?.responsavel?' · '+esc(v.responsavel):''}${v?.prazo?' · '+esc(v.prazo):''}</small></div><b>${money(p.valor)}</b><button data-pend-key="${esc(key)}" data-pend-title="${esc(p.texto||p.tipo)}">Revisar</button></div>`;}).join('')||'<p>Nenhuma ocorrência neste filtro. Isso não comprova conciliação.</p>'}<div class="management-chips"><button data-pend-page="${pagina-1}" ${pagina===0?'disabled':''}>Anterior</button><span>${pagina+1} / ${Math.max(1,Math.ceil(rows.length/20))}</span><button data-pend-page="${pagina+1}" ${(pagina+1)*20>=rows.length?'disabled':''}>Próxima</button></div><details><summary>Ações e decisões registradas</summary>${Object.entries(state.cfg.gestao||{}).filter(([k])=>k.startsWith('acao:'+safeId(state.periodo)+':')).map(([k,v])=>`<button class="action-line" data-acao-key="${esc(k)}">${esc(v.titulo)} · ${esc(v.situacao)} · ${esc(v.responsavel||'Sem responsável')} · ${esc(v.prazo||'Sem prazo')}</button>`).join('')||'<p>Nenhuma ação registrada.</p>'}</details>`);
}
function abrirAcao(key='acao:'+safeId(state.periodo)+':'+crypto.randomUUID(),titulo=''){
 const orig=structuredClone(state.cfg.gestao?.[key]??null),v=orig||{titulo,situacao:'A conferir'};
 dialog('Revisão do período',`<form id="acaoForm"><label>Ação / evidência<input name="titulo" required maxlength="250" value="${esc(v.titulo)}"></label><div class="form-grid"><label>Responsável<input name="responsavel" maxlength="120" value="${esc(v.responsavel||'')}"></label><label>Prazo<input type="date" name="prazo" value="${esc(v.prazo||'')}"></label><label>Situação<select name="situacao">${['A conferir','Em análise','Aguardando terceiro','Resolvida'].map(t=>`<option ${v.situacao===t?'selected':''}>${t}</option>`).join('')}</select></label><label>Recorrência<select name="recorrencia">${['Não classificada','Recorrente','Não recorrente'].map(t=>`<option ${v.recorrencia===t?'selected':''}>${t}</option>`).join('')}</select></label></div><label>Observações e evidências<textarea name="notas" maxlength="4000">${esc(v.notas||'')}</textarea></label><p class="hint">Anotação de gestão. Não altera valores, classificação, conciliação ou situação da fonte.</p><p id="acaoErro" role="alert"></p><button class="primary" ${state.permissoes.admin?'':'disabled'}>Salvar revisão</button></form><details><summary>Histórico</summary>${(state.cfg.gestao?.historico||[]).filter(h=>h.chave===key).slice().reverse().map(h=>`<p>${esc(dataBR(h.em))} · ${esc(h.novo.situacao)} · ${esc(h.novo.notas||'Sem observação')}</p>`).join('')||'<p>Sem alteração anterior.</p>'}</details>`);
 $$('acaoForm').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));await salvarGestao(key,{...data,concluidoEm:data.situacao==='Resolvida'?(v.concluidoEm||new Date().toISOString()):null},orig);$$('detailDialog').close();render();toast('Revisão confirmada na nuvem.');}catch(err){$$('acaoErro').textContent=err.message;}finally{btn.disabled=false;}};
}
function abrirPlanejamento(){
 const chave='orcamento:'+safeId(state.periodo),orig=structuredClone(state.cfg.gestao?.[chave]??null),b=orig||{},a=state.cfg.gestao?.alertas||{};
 dialog('Orçamento e alertas · '+state.periodo,`<form id="orcamentoForm"><p>Orçamento gerencial de caixa do mês. Campo vazio permanece sem referência.</p><div class="form-grid">${[['entradas','Entradas previstas'],['saidas','Limite de saídas']].map(([k,t])=>`<label>${t} (R$)<input type="number" min="0" step="0.01" name="${k}" value="${b[k]??''}"></label>`).join('')}</div><label>Fonte / premissa<input name="fonte" maxlength="400" required value="${esc(b.fonte||'')}"></label><p id="orcamentoErro" role="alert"></p><button class="primary" ${state.permissoes.admin?'':'disabled'}>Salvar orçamento</button></form><form id="alertasForm"><h3>Alertas dentro do painel</h3><div class="form-grid"><label>Avisar coleta após (horas)<input name="horas" type="number" min="1" max="720" value="${a.horas??24}" required></label><label>Variação mínima em destaque (R$)<input name="variacao" type="number" min="0" step="0.01" value="${a.variacao??0}" required></label></div><p class="hint">Sem mensagens ou envios automáticos.</p><button ${state.permissoes.admin?'':'disabled'}>Salvar alertas</button><p id="alertasErro" role="alert"></p></form><details><summary>Versões do orçamento</summary>${(state.cfg.gestao?.historico||[]).filter(h=>h.chave===chave).slice().reverse().map(h=>`<p>${esc(dataBR(h.em))} · entradas ${money(h.novo.entradas)} · saídas ${money(h.novo.saidas)} · ${esc(h.novo.fonte)}</p>`).join('')||'<p>Ainda sem versão salva.</p>'}</details>`);
 $$('orcamentoForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),n=k=>f.get(k)===''?null:Number(f.get(k));try{await salvarGestao(chave,{entradas:n('entradas'),saidas:n('saidas'),variacao:n('entradas')==null||n('saidas')==null?null:Math.round((n('entradas')-n('saidas'))*100)/100,fonte:f.get('fonte')},orig);$$('detailDialog').close();render();toast('Orçamento confirmado na nuvem.');}catch(err){$$('orcamentoErro').textContent=err.message;}};
 const origAlerta=structuredClone(state.cfg.gestao?.alertas??null);$$('alertasForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await salvarGestao('alertas',{horas:Number(f.get('horas')),variacao:Number(f.get('variacao'))},origAlerta);$$('detailDialog').close();render();toast('Alertas salvos.');}catch(err){$$('alertasErro').textContent=err.message;}};
}
function wireGestao(){
 if($$('cfoCenario')){const salvo=state.cfg.gestao?.['cenario:'+safeId(state.periodo)];if(salvo)for(const [k,v] of Object.entries(salvo.premissas||{})){const el=$$('cfoCenario').elements.namedItem(k);if(el)el.value=v;}}
 document.querySelectorAll('[data-metas]').forEach(b=>b.onclick=formularioMetas);
 document.querySelectorAll('[data-contas-pagina]').forEach(b=>b.onclick=()=>{state.contasPagina=Number(b.dataset.contasPagina);render();});
 document.querySelectorAll('[data-dre-visao]').forEach(b=>b.onclick=()=>{gestaoUI.dre=b.dataset.dreVisao;render();});
 document.querySelectorAll('[data-pend-page]').forEach(b=>b.onclick=()=>{gestaoUI.pendPagina=Number(b.dataset.pendPage);render();});
 document.querySelectorAll('[data-pend-key]').forEach(b=>b.onclick=()=>abrirAcao(b.dataset.pendKey,b.dataset.pendTitle));
 document.querySelectorAll('[data-acao-key]').forEach(b=>b.onclick=()=>abrirAcao(b.dataset.acaoKey));
 if($$('novaAcao'))$$('novaAcao').onclick=()=>abrirAcao();
 if($$('gestaoPlanejamento'))$$('gestaoPlanejamento').onclick=abrirPlanejamento;
 for(const [id,key] of [['evolucaoModo','evolucao'],['evolucaoSerie','serie'],['pendTipo','pendTipo'],['pendBusca','pendBusca']])if($$(id))$$(id).onchange=e=>{gestaoUI[key]=e.target.value;gestaoUI.pendPagina=0;render();};
 if($$('planSaldo')){
  ['planSaldo','planReserva','planData','planCenario'].forEach(id=>$$(id).addEventListener('input',()=>{planoSujo=true;$$('planEstado').textContent='Alterações não salvas';}));
  $$('planAdicionar').addEventListener('click',()=>{planoSujo=true;});
  $$('planSalvar').onclick=async()=>{const b=$$('planSalvar');b.disabled=true;try{plano=await salvarGestao('plano',structuredClone(plano),planoBase);planoBase=structuredClone(plano);planoSujo=false;$$('planEstado').textContent='Confirmado na nuvem: '+dataBR(plano.atualizadoEm);}catch(err){$$('planEstado').textContent=err.message;}finally{b.disabled=false;}};
 }
}

/* ── SEIS CONTROLES · FASE 1 (esqueleto, sem cálculo) ─────────────────────
   Cada tela já segue a ordem do padrão visual: faixa de cards, gráficos e a
   tabela detalhada fechada. Nada é calculado: todo número aparece como "Não
   apurado" e diz o que falta para existir e de onde virá. A origem segue o
   diagnóstico da Fase 0: (a) já existe nos meses; (b) falta mapear contas;
   (c*) o Painel já coleta, falta integrar; (d) cadastro revisado. */
const ORIGEM_CONTROLE={a:'Dado já existe nos meses coletados',b:'Falta mapear contas do plano',c:'O Painel já coleta; falta integrar',d:'Cadastro manual revisado',e:'Calculado a partir dos outros'};
// Destino do link de cada card: onde a pessoa resolve o que falta. Cadastro
// vai a Parâmetros; mapeamento de contas, ao Plano de contas; Painel e cálculo
// não têm o que fazer agora, então não ganham link. Cadastro que Parâmetros
// ainda não tem (destino null, como o patrimônio da Fase 8) também não ganha.
const DESTINO_ORIGEM={d:['parametros','Cadastrar em Parâmetros →'],b:['detalhe','Ver as contas no Plano de contas →']};
const CONTROLES={
 dfc:{fase:'Fase 4',cards:[
   ['Caixa da operação (FCO)','Separar fornecedores, folha e as guias mensais do DAS (2.4.1.2 e 2.4.1.3) no plano de contas. O parcelamento (2.4.1.1) vai para financiamento.','b'],
   ['Investimentos (FCI)','O dado já existe (2.16 e parcelas de ativos); o cálculo entra na Fase 4.','a'],
   ['Financiamentos (FCF)','O dado já existe (empréstimos, dívidas, sócios e transferências); o cálculo entra na Fase 4.','a'],
   ['Saldo final','Saldo inicial mais a geração do mês. Hoje: saldos bancários do Painel (foto do dia); para meses passados, saldo inicial informado em Parâmetros.','c','parametros']],
  graficos:[['Para onde foi o caixa em cada mês?','Barras empilhadas de operação, investimento e financiamento, com a linha do saldo acumulado.'],
   ['A operação se paga sozinha?','Linha do caixa da operação nos últimos 12 meses, com o mês selecionado marcado.']],
  tabela:['DFC mês a mês',['Linha','Mês selecionado','Acumulado no ano'],['Caixa da operação','Investimentos','Financiamentos','Geração de caixa','Saldo inicial','Saldo final'],[1,2]],
  vazio:['O mapeamento das saídas em operação, investimento e financiamento, a marca das guias do DAS e o saldo inicial do mês.','Plano de contas do Mubisys, já coletado, e saldos bancários do Painel ou informados em Parâmetros.','Fase 4: mapear as contas e ler os saldos do Painel; o saldo inicial informado em Parâmetros será usado quando esta tela ganhar cálculo.']},
 balanco:{fase:'Fase 8',cards:[
   ['Ativo total','Caixa e contas a receber (Painel), estoque e imobilizado (cadastro).','c'],
   ['Passivo total','Fornecedores (Painel); empréstimos, tributos a recolher (DAS e DIFAL), parcelamento do DAS e salários a pagar (cadastro).','c'],
   ['Patrimônio líquido','Capital e lucros acumulados em cadastro revisado.','d',null],
   ['Diferença do fechamento','Ativo menos passivo e patrimônio. Aparece quando os três estiverem apurados e nunca é forçada a zero.','e']],
  graficos:[['Do que é feito o ativo?','Barras horizontais por grupo patrimonial, em ordem de valor.'],
   ['O balanço fecha?','Ativo contra passivo mais patrimônio, com a diferença destacada.']],
  tabela:['Balanço por conta',['Conta','Saldo','Revisado em'],['Caixa e bancos','Contas a receber','Estoques','Imobilizado','Fornecedores','Empréstimos','Parcelamento do DAS','Tributos a recolher (DAS e DIFAL)','Patrimônio líquido'],[1]],
  vazio:['Saldos patrimoniais do fim do mês: hoje o sistema guarda só o movimento de caixa.','Títulos a receber e a pagar e saldos bancários do Painel; estoque, imobilizado, empréstimos e patrimônio por cadastro revisado.','Fase 8: ler os saldos do Painel, cadastrar os demais e validar Ativo = Passivo + Patrimônio líquido.']},
 giro:{fase:'Fase 6',cards:[
   ['Necessidade de giro (NCG)','Contas a receber e fornecedores (Painel) e estoque (cadastro).','c'],
   ['Prazo de recebimento','Títulos a receber e o histórico de prazo que o Painel já calcula.','c'],
   ['Prazo de pagamento','Títulos a pagar e compras do Painel.','c'],
   ['Ciclo financeiro','Estoque, recebimento e pagamento: o prazo de estoque depende de cadastro.','d']],
  graficos:[['Quantos dias o dinheiro fica preso?','Linha do tempo com prazo de estoque, de recebimento e de pagamento, e o ciclo resultante destacado.'],
   ['A necessidade de giro está crescendo?','Linha com área dos últimos 12 meses, com o mês selecionado marcado.']],
  tabela:['Prazos e saldos por mês',['Mês','Estoque (dias)','Recebimento (dias)','Pagamento (dias)','Ciclo','NCG'],['Mês selecionado'],[1,2,3,4,5]],
  vazio:['Contas a receber, fornecedores e estoque do fim de cada mês.','O Painel já guarda os títulos a receber e a pagar; o estoque entra por cadastro revisado.','Fase 6: integrar os títulos do Painel; o estoque informado em Parâmetros será usado quando esta tela ganhar cálculo.']},
 recebiveis:{fase:'Fase 5',cards:[
   ['A receber','Títulos em aberto do Painel, com cliente e vencimento.','c'],
   ['Vencido','Mesma base: soma dos títulos com vencimento passado.','c'],
   ['Acima de 90 dias','Títulos do Painel vencidos há mais de 90 dias. A provisão (PDD) segue a política de Parâmetros.','c','parametros'],
   ['Maior cliente devedor','Concentração por cliente nos títulos vencidos.','c']],
  graficos:[['Quanto do que vou receber já está atrasado?','Barra 100% empilhada: a vencer, 1 a 15, 16 a 30, 31 a 90 e acima de 90 dias.'],
   ['Quem concentra os atrasos?','Barras dos dez maiores títulos vencidos, por cliente.'],
   ['E o que eu devo, vence quando?','A mesma régua de faixas para as contas a pagar.']],
  tabela:['Títulos em aberto',['Tipo','Cliente','Vencimento','Dias','Faixa','Valor'],['A receber','A pagar'],[3,5]],
  vazio:['Títulos a receber em aberto, com cliente e vencimento: a coleta do DRE só traz títulos pagos.','O Painel já guarda os títulos a receber e a pagar; esta tela vai ler essa base e mostrar a data do corte.','Fase 5: integrar os títulos do Painel; a provisão acima de 90 dias informada em Parâmetros será usada quando esta tela ganhar cálculo.']},
 precos:{fase:'Fase 7',cards:[
   ['Margem de contribuição','Classificar as contas fixas e variáveis e informar a alíquota efetiva do Simples e os tributos pagos fora do DAS, como o DIFAL.','b','parametros'],
   ['Ponto de equilíbrio','Custos fixos divididos pelo índice de margem de contribuição.','b'],
   ['Distância do equilíbrio','Faturamento do mês comparado ao ponto de equilíbrio, em reais.','b'],
   ['Custos fixos do mês','Classificação fixo ou variável das contas do plano.','b']],
  graficos:[['Quanto falta vender para empatar?','Cruzamento da receita com o custo total, com o mês atual marcado e a distância em reais.'],
   ['Qual preço sustenta a margem?','Simulador: preço, margem, índice e faturamento necessário para empatar.']],
  tabela:['Margem por produto',['Produto','Preço médio','Custo variável','Tributos (Simples e DIFAL)','Comissão','Margem','Índice'],['Produtos','Serviços'],[1,2,3,4,5,6]],
  vazio:['Separação entre custo fixo e variável, a alíquota efetiva do Simples, o DIFAL pago fora do DAS e, para margem por produto, preço e custo por O.S.','Plano de contas (já coletado), Parâmetros e as O.S. que o Painel já guarda.','Fase 7: classificar as contas fixas e variáveis; a alíquota efetiva de Parâmetros será usada quando esta tela ganhar cálculo.']},
 parametros:{fase:'Fase 2',cards:[
   ['Anexo do Simples','Informar por empresa: Impresilk e Universo, as duas no Simples.','d'],
   ['RBT12','Receita bruta dos 12 meses anteriores, por empresa. O histórico do sistema começa em Dez/2025.','d'],
   ['Alíquota efetiva do mês','Calculada da faixa e do RBT12. Para conferir: a guia mensal de cada empresa (2.4.1.2 e 2.4.1.3), paga no mês seguinte ao da competência; o parcelamento (2.4.1.1) fica de fora.','d'],
   ['Fator R','Folha de 12 meses sobre o RBT12. Retiradas dos sócios não entram: não há pró-labore.','d']],
  graficos:[['A alíquota efetiva está subindo?','Linha da alíquota mês a mês, por empresa.'],
   ['Quanto falta para a próxima faixa?','Barra de meta com o RBT12 contra o limite da faixa atual.']],
  tabela:['Histórico por mês e empresa',['Empresa','Mês','Anexo','RBT12','Alíquota efetiva','Revisado em'],['Impresilk','Universo'],[3,4]],
  vazio:['Anexo, RBT12 e alíquota efetiva de cada empresa, mês a mês; prazos contratados, estoque, metas e política de provisão.','Cadastro revisado por administrador, com histórico por mês. A alíquota efetiva muda todo mês.','Cadastro com gravação versionada, disponível na Fase 2.']}
};
function renderControle(id){
 const d=CONTROLES[id];if(!d)return '';const cadastro=id!=='parametros';
 const link=(origem,destino)=>{const [go,rotulo]=destino===null?[]:destino==='parametros'?DESTINO_ORIGEM.d:DESTINO_ORIGEM[origem]||[];return go&&go!==id?`<button type="button" class="link-cadastro" data-go="${go}">${esc(rotulo)}</button>`:'';};
 const cards=d.cards.map(([rotulo,falta,origem,destino])=>`<div class="metric metric-vazio"><span class="label">${esc(rotulo)}</span><strong>Não apurado</strong><small>${esc(falta)}</small><span class="origem-dado origem-${origem}">${esc(ORIGEM_CONTROLE[origem])}</span>${link(origem,destino)}</div>`).join('');
 const vazio=`<section class="estado-vazio" aria-label="O que falta nesta tela"><div><h2>Esta tela ainda não tem números</h2><dl><dt>O que falta</dt><dd>${esc(d.vazio[0])}</dd><dt>De onde virá</dt><dd>${esc(d.vazio[1])}</dd><dt>Próximo passo</dt><dd>${esc(d.vazio[2])} <span class="fase-chip">${esc(d.fase)}</span></dd></dl></div>${cadastro?'<button type="button" data-go="parametros">Cadastrar em Parâmetros</button>':'<button type="button" disabled>Cadastro disponível na Fase 2</button>'}</section>`;
 const graficos=`<div class="graficos-controle">${d.graficos.map(([pergunta,desenho])=>painelGrafico(pergunta,desenho,`<div class="grafico-reservado" role="img" aria-label="${esc('Gráfico ainda sem dados: '+pergunta)}"><span>Sem dado</span><small>O desenho entra quando a fonte existir. Mês sem dado nunca aparece como zero.</small></div>`)).join('')}</div>`;
 const [titulo,cols,linhas,numericas=[]]=d.tabela;
 const tabela=card(titulo,`<div class="table-scroll"><table class="tabela-controle"><thead><tr>${cols.map((c,i)=>`<th scope="col"${numericas.includes(i)?' class="num"':''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.map(l=>`<tr><th scope="row">${esc(l)}</th>${cols.slice(1).map((_,j)=>`<td class="${numericas.includes(j+1)?'num ':''}nao-apurado">Não apurado</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="hint">A mesma informação dos gráficos, para quem quiser o detalhe. ${esc(d.fase)}.</p>`,false);
 return `<div class="cards cards-controle">${cards}</div>${vazio}${graficos}${tabela}`;
}

/* ── MENU LATERAL EM GRUPOS ────────────────────────────────────────────────
   O grupo da tela ativa fica sempre aberto; os outros lembram o último estado
   neste aparelho. Setas percorrem o menu; no celular e no tablet (até 900px)
   o menu vira um painel que empurra o conteúdo, sem cobri-lo. */
const MENU_KEY='dre_menu_grupos';
function lerGruposMenu(){try{return JSON.parse(localStorage.getItem(MENU_KEY))||{};}catch(_){return {};}}
function sincronizarMenu(){
 if(typeof document==='undefined'||typeof document.querySelector!=='function')return;
 const ativo=document.querySelector(`#viewTabs [data-view="${state.view}"]`);const grupo=ativo?.closest?.('details.nav-grupo');if(grupo&&!grupo.open)grupo.open=true;
}
// foco: 'titulo' depois de escolher uma tela, 'botao' ao fechar com Esc. Só no
// modo celular/tablet (botão Menu visível): no computador o menu nunca some.
function abrirMenuCelular(abrir,foco=''){
 const lateral=document.querySelector('.sidebar'),botao=document.getElementById('menuToggle');if(!lateral||!botao)return;
 const modoCelular=botao.offsetParent!==null;
 lateral.classList.toggle('menu-aberto',abrir);botao.setAttribute('aria-expanded',abrir?'true':'false');
 if(abrir||!foco||!modoCelular)return;
 requestAnimationFrame(()=>{const ativo=document.activeElement;if(ativo&&ativo!==document.body&&!ativo.closest?.('.menu-lateral'))return;
  const titulo=document.getElementById('pageTitle');(foco==='titulo'&&titulo?titulo:botao).focus({preventScroll:false});});
}
function wireMenuLateral(){
 const nav=document.getElementById('viewTabs');if(!nav)return;const salvo=lerGruposMenu();
 nav.querySelectorAll('details.nav-grupo').forEach(d=>{
  if(salvo[d.dataset.grupo]===false)d.open=false;
  d.addEventListener('toggle',()=>{const atual=lerGruposMenu();atual[d.dataset.grupo]=d.open;try{localStorage.setItem(MENU_KEY,JSON.stringify(atual));}catch(_){}});
 });
 sincronizarMenu();
 nav.addEventListener('keydown',e=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  const itens=[...nav.querySelectorAll('summary, details[open] > button')].filter(el=>el.offsetParent!==null);const i=itens.indexOf(document.activeElement);if(i<0)return;
  e.preventDefault();const alvo=e.key==='Home'?0:e.key==='End'?itens.length-1:Math.min(itens.length-1,Math.max(0,i+(e.key==='ArrowDown'?1:-1)));itens[alvo].focus();
 });
 const botao=document.getElementById('menuToggle');document.getElementById('pageTitle')?.setAttribute('tabindex','-1');
 if(botao)botao.addEventListener('click',()=>abrirMenuCelular(botao.getAttribute('aria-expanded')!=='true'));
 document.querySelector('.sidebar')?.addEventListener('click',e=>{const alvo=e.target.closest?.('[data-view], #settingsBtn, #helpBtn');if(alvo)abrirMenuCelular(false,'titulo');});
 document.addEventListener('keydown',e=>{if(e.key!=='Escape'||!botao||botao.getAttribute('aria-expanded')!=='true')return;abrirMenuCelular(false,'botao');});
}
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',wireMenuLateral);

