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


/* ── RECEBÍVEIS E AGING · FASE 5 ──────────────────────────────────────────
   Posição da carteira a receber que o Painel atualiza a cada 20 minutos, lida pelo
   dre-sync (indicadores, fonte 'recebiveis') e agregada lá com a régua da tela
   Contas Atrasadas do Painel: vencido a partir de 1 dia; dívida vencida antes do
   corte do Painel fica fora dos números e aparece à parte. É uma foto: não muda
   com o mês escolhido. A provisão (PDD) é estimativa gerencial: o % de Parâmetros
   do mês da posição sobre o vencido há mais de 90 dias; não entra no caixa nem na
   DRE. Nada ausente vira zero. */
const recUI={dados:null,erro:'',busy:false,em:0,seq:0,aberto:false,foco:false};
function carregarRecebiveis(forcar=false){
 // Uma leitura por minuto, com ou sem erro: a tela redesenha ao chegar e não pode pedir de novo em laço.
 if(recUI.busy||(!forcar&&Date.now()-recUI.em<60000))return;
 const seq=++recUI.seq;recUI.busy=true;recUI.erro='';recUI.em=Date.now();
 Promise.resolve().then(()=>api('indicadores',{fonte:'recebiveis'})).then(r=>{if(seq!==recUI.seq)return;if(!r?.ok)throw new Error(r?.erro||'A leitura não foi confirmada pelo servidor.');if(r.fonte!=='recebiveis')throw new Error('Fonte inválida.');recUI.dados=r;})
  .catch(e=>{if(seq!==recUI.seq)return;const m=String(e?.message||e||'');// O servidor anterior à Fase 5 responde à fonte nova com o erro de período (validarPeriodo vem antes).
  recUI.erro=/desconhecida|Fonte inválida|intervalo válido/i.test(m)?'O servidor ainda não tem a leitura dos recebíveis: ela é publicada sozinha pelo Painel, que roda de hora em hora mas costuma atrasar algumas horas. Tente de novo mais tarde.':/abort/i.test(m)?'O servidor demorou a responder.':m;})
  .finally(()=>{if(seq!==recUI.seq)return;recUI.busy=false;recUI.em=Date.now();if(state.view==='recebiveis'&&typeof render==='function'){render();recFocar();}});
}
// "Ler de novo" redesenha a tela: o foco volta ao botão para quem usa teclado.
function recFocar(){if(!recUI.foco||typeof document==='undefined'||typeof document.querySelector!=='function')return;document.querySelector('[data-rec-recarregar]')?.focus?.();if(!recUI.busy)recUI.foco=false;}
const recMes=base=>/^\d{4}-\d{2}/.test(base||'')?PT_MON[Number(base.slice(5,7))-1]+'/'+base.slice(0,4):null;
const recData=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||'')?`${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`:'';
const recHora=em=>{const t=Date.parse(em||'');return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'data não registrada';};
const recPct=(a,b)=>b>0&&a!=null?(Math.round(a/b*1000)/10).toLocaleString('pt-BR')+'%':'—';
const recDias=v=>v==null?'Não apurado':`${Number(v).toLocaleString('pt-BR')} dia${Math.abs(v)===1?'':'s'}`;
function recCartao(rotulo,valor,nota,tom=''){return `<div class="metric metric-param"><span class="label">${esc(rotulo)}</span><strong class="${tom}">${esc(valor)}</strong><small>${esc(nota)}</small></div>`;}
function recPainel(titulo,descricao,html,largo=true){return `<section class="chart-card dre-grafico${largo?' dre-grafico-largo':''}"><div class="chart-heading"><div><h2>${esc(titulo)}</h2><p>${esc(descricao)}</p></div></div>${html}</section>`;}
// Provisão estimada: % de Parâmetros do mês da posição sobre a faixa acima de 90 dias.
function recProvisao(d){
 const mes=recMes(d.posicao?.base),p=mes&&typeof paramOperacao==='function'?paramOperacao(mes)?.pdd90:null,pct=p==null||p===''||!Number.isFinite(Number(p))?null:Number(p);
 const d91=d.faixas?.find(f=>f.id==='d91')?.valor??null;
 return {mes,pct,base:d91,valor:pct==null||d91==null?null:Math.round(d91*pct)/100};
}
// Série diária do Painel reduzida ao último ponto de cada semana (no máximo 13).
function recSemanas(serie){
 const porSemana=new Map();for(const p of serie||[]){const t=Date.parse(p.dia+'T00:00:00Z');if(!Number.isFinite(t))continue;porSemana.set(Math.floor((t/86400000+3)/7),p);}
 return [...porSemana.values()].slice(-13).map(p=>({rotulo:`${p.dia.slice(8,10)}/${p.dia.slice(5,7)}`,valor:p.dso}));
}
function renderRecebiveis(){
 carregarRecebiveis();
 const d=recUI.dados,ok=!!d?.disponivel,perm={admin:!!state.permissoes?.admin};
 const acoes=`<div class="actions"><button type="button" data-rec-recarregar aria-disabled="${recUI.busy}">Ler de novo</button>${ok?'<button type="button" data-rec-csv>Baixar títulos vencidos (CSV)</button>':''}<span class="hint" role="status">${recUI.busy?'Lendo o Painel…':''}</span></div>`;
 const erro=recUI.erro?`<p class="param-avisos">${esc(recUI.erro)} ${d?'Mostrando a última leitura.':'Nenhum zero foi assumido.'}</p>`:'';
 if(!ok){
  const motivo=d?.avisos?.[0]||(recUI.busy||!recUI.erro?'Lendo a posição dos recebíveis no Painel…':'Sem leitura dos recebíveis.');
  const nao=['A receber','Vencido','Provisão estimada (PDD)','Maior devedor'].map(t=>recCartao(t,'Não apurado','Depende da posição do Painel.')).join('');
  return `<div class="cards cards-controle">${nao}</div>${erro}<section class="estado-vazio rec-sem-dados"><div><h2>${d?'Os recebíveis do Painel não estão disponíveis':'Recebíveis do Painel'}</h2><p>${esc(motivo)}</p></div></section>${acoes}`;
 }
 const t=d.totais,pdd=recProvisao(d),top=d.clientes?.itens?.[0],posicao=recHora(d.posicao?.em),irParam=`data-go="parametros"${pdd.mes?` data-rec-mes="${esc(pdd.mes)}"`:''}`;
 const cards=`<div class="cards cards-controle">${recCartao('A receber',money(t.aberto),`${t.titulos} título${t.titulos===1?'':'s'} de ${t.clientes} cliente${t.clientes===1?'':'s'}: vencidos e a vencer em até 90 dias`)}${recCartao('Vencido',money(t.vencido),`${recPct(t.vencido,t.aberto)} do que há a receber · ${t.vencidos} título${t.vencidos===1?'':'s'}`,t.vencido>0?'tom-sai':'')}${pdd.valor!=null?recCartao('Provisão estimada (PDD)',money(pdd.valor),`Estimativa: ${pdd.pct.toLocaleString('pt-BR')}% de ${pdd.mes} (Parâmetros) sobre ${money(pdd.base)} vencidos há mais de 90 dias; não entra no caixa nem na DRE`,pdd.valor>0?'tom-sai':''):recCartao('Provisão estimada (PDD)','Não informado',`Falta o % de provisão acima de 90 dias de ${pdd.mes||'o mês da posição'} em Parâmetros; vencido há mais de 90 dias: ${pdd.base==null?'não apurado':money(pdd.base)}`)}${top?recCartao('Maior devedor',money(top.vencido),`${top.nome} · ${recPct(top.vencido,t.vencido)} do vencido · atraso de até ${recDias(top.maiorAtraso)}`,top.vencido>0?'tom-sai':''):recCartao('Maior devedor',money(0),'Nenhum título vencido na posição')}</div>`;
 const antigas=d.antigas?.quantidade?` Vencidos antes de ${recData(d.corte?.data)} (${d.antigas.quantidade} título${d.antigas.quantidade===1?'':'s'}, ${money(d.antigas.valor)}) ficam fora dos números, como na tela Contas Atrasadas do Painel.`:'';
 const linhaPosicao=`<p class="hint rec-posicao">Posição do Painel de ${esc(posicao)} (a carga roda a cada 20 minutos); dias de atraso contados até hoje, como no Painel. Esta tela é uma foto da carteira: não muda com o mês escolhido.${esc(antigas)}</p>`;
 // Avisos do servidor que a tela já diz em outro lugar: a janela de 90 dias (card A receber) e as antigas (linha da posição).
 const jaDito=a=>/^"A vencer" cobre/.test(a)||(!!d.antigas?.quantidade&&a.startsWith(`${d.antigas.quantidade} título(s) vencido(s) antes de`));
 const restantes=(d.avisos||[]).filter(a=>!jaDito(a)),avisos=restantes.length?`<ul class="param-avisos rec-avisos">${restantes.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`:'';
 const semPdd=pdd.valor==null?`<section class="estado-vazio rec-sem-pdd"><div><h2>Falta a política de provisão</h2><p>${esc(perm.admin?`Informe em Parâmetros o % de provisão para vencidos há mais de 90 dias de ${pdd.mes||'o mês da posição'}; a provisão estimada sai daí.`:`Peça a um administrador para informar em Parâmetros o % de provisão para vencidos há mais de 90 dias de ${pdd.mes||'o mês da posição'}.`)}</p></div><button type="button" ${irParam}>${perm.admin?'Informar em Parâmetros':'Ver Parâmetros'}</button></section>`:'';
 const g1=recPainel('Quanto do que vou receber já está atrasado?',`O que há a receber (${money(t.aberto)}) por faixa de atraso na data da posição.`,gCemPorCento(d.faixas.map(f=>({rotulo:f.rotulo,valor:f.valor})),{titulo:'Recebíveis por faixa de atraso'}));
 const demais=d.clientes?.demais?.quantidade?` Os demais ${d.clientes.demais.quantidade} devedores somam ${money(d.clientes.demais.vencido)}.`:'';
 const g2=t.vencidos?recPainel('Quem concentra os atrasos?',`Vencido por cliente, os dez maiores; os cinco primeiros somam ${d.clientes?.top5Pct==null?'—':d.clientes.top5Pct.toLocaleString('pt-BR')+'%'} do vencido.${demais}`,gBarrasOrdenadas((d.clientes?.itens||[]).map(c=>({rotulo:c.nome,valor:c.vencido})),{limite:10,cor:'saida',titulo:'Maiores devedores'}),false)
  :recPainel('Quem concentra os atrasos?','Vencido por cliente, os dez maiores.','<p class="hint rec-sem-vencido">Nenhum título vencido na posição.</p>',false);
 const g3=recPainel('A carteira está envelhecendo?','Idade média dos títulos em aberto (dias desde a emissão, ponderada pelo saldo), gravada pelo Painel uma vez por dia; um ponto por semana.',gLinhaArea(recSemanas(d.prazo?.serie),{titulo:'Idade média da carteira',rotulo:'Dias',cor:'marca',formato:recDias,selecionado:recSemanas(d.prazo?.serie).length-1}),false);
 const parametro=pdd.mes&&typeof paramOperacao==='function'?paramOperacao(pdd.mes)?.prazoRecebimento:null;
 const prazo=`<p class="note rec-prazo">Prazo concedido médio da carteira: <b>${esc(recDias(d.prazo?.concedido?.dias))}</b> (vencimento − emissão, ponderado pelo saldo; ${d.prazo?.concedido?.com??0} de ${d.prazo?.concedido?.total??0} títulos com emissão). Em Parâmetros (${esc(pdd.mes||'mês da posição')}): <b>${esc(parametro==null||parametro===''?'não informado':recDias(Number(parametro)))}</b>. Idade média da carteira: <b>${esc(recDias(d.prazo?.idade?.dias))}</b>, a mesma conta do DSO da tela Contas Atrasadas do Painel. O prazo realizado (pagamento − emissão) ainda não é apurado: a carga do Painel não traz os títulos pagos com a data de emissão.</p>`;
 const faixas=`<div class="table-scroll"><table class="tabela-controle rec-faixas"><caption>Por faixa de atraso · posição de ${esc(recData(d.posicao?.base))}</caption><thead><tr><th scope="col">Faixa</th><th scope="col" class="num">Títulos</th><th scope="col" class="num">Valor</th><th scope="col" class="num">% do que há a receber</th></tr></thead><tbody>${d.faixas.map(f=>`<tr><th scope="row">${esc(f.rotulo)}</th><td class="num">${f.quantidade}</td><td class="num">${esc(money(f.valor))}</td><td class="num">${esc(recPct(f.valor,t.aberto))}</td></tr>`).join('')}</tbody></table></div>`;
 const titulos=`<div class="table-scroll"><table class="tabela-controle rec-titulos"><caption>Títulos vencidos, do maior para o menor${d.truncado?` · os ${d.titulosVencidos.length} maiores de ${t.vencidos}`:''}</caption><thead><tr><th scope="col">Cliente</th><th scope="col">NF</th><th scope="col">O.S.</th><th scope="col">Vencimento</th><th scope="col" class="num">Dias</th><th scope="col" class="num">Valor</th></tr></thead><tbody>${d.titulosVencidos.map(x=>`<tr><th scope="row">${esc(x.cliente)}</th><td>${esc(x.nf||'—')}</td><td>${esc(x.os||'—')}</td><td>${esc(recData(x.vencimento))}</td><td class="num">${x.dias}</td><td class="num">${esc(money(x.valor))}</td></tr>`).join('')||'<tr><td colspan="6">Nenhum título vencido na posição.</td></tr>'}</tbody></table></div>`;
 return cards+linhaPosicao+acoes+erro+avisos+semPdd+`<div class="graficos-controle">${g1}${g2}${g3}</div>`+prazo+`<details class="card rec-detalhe"${recUI.aberto?' open':''}><summary>Faixas e títulos vencidos · ${t.vencidos}</summary><div class="card-body">${faixas}${titulos}</div></details>`;
}
// Planilha dos títulos vencidos da posição (os mesmos da tabela).
function recCSV(){
 const d=recUI.dados;if(!d?.disponivel)return null;
 const rows=[['Recebíveis vencidos · posição do Painel',recHora(d.posicao?.em)],['Corte de dívida antiga',recData(d.corte?.data),d.corte?.origem==='painel'?'configuração do Painel':'padrão'],[],['Cliente','NF','O.S.','Vencimento','Dias de atraso','Faixa','Valor (R$)'],
  ...d.titulosVencidos.map(x=>[x.cliente,x.nf,x.os,recData(x.vencimento),String(x.dias),d.faixas.find(f=>f.id===x.faixa)?.rotulo||x.faixa,x.valor.toFixed(2).replace('.',',')]),...(d.truncado?[[`Lista com os ${d.titulosVencidos.length} maiores de ${d.totais.vencidos} títulos vencidos.`]]:[])];
 download('recebiveis-vencidos-'+(d.posicao?.base||'posicao')+'.csv','﻿'+rows.map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv');
 return rows;
}
function wireRecebiveis(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-rec-csv],[data-rec-recarregar]');if(!b)return;if(b.hasAttribute('data-rec-csv'))recCSV();else if(!recUI.busy){recUI.foco=true;carregarRecebiveis(true);if(typeof render==='function')render();recFocar();}});
 // A provisão é do mês da posição: Parâmetros abre nesse mês (antes do onclick que troca de tela).
 document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-rec-mes]');if(b&&b.dataset.recMes)state.periodo=b.dataset.recMes;},true);
 document.addEventListener('toggle',e=>{if(e.target?.classList?.contains('rec-detalhe'))recUI.aberto=e.target.open;},true);
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wireRecebiveis);

/* ── CAPITAL DE GIRO · FASE 6.1 (posição de hoje) ─────────────────────────
   A receber (régua da Fase 5) e contas a pagar classificadas pelo número do
   centro de custo do Mubisys, lidos do Painel pelo dre-sync (fonte 'capitalGiro').
   Necessidade de capital de giro = a receber + estoque (Parâmetros do mês de hoje)
   − a pagar operacional (fornecedores 1.xx e 2.xx, impostos 3.02, prédio 3.03).
   Sócios, empréstimos e projeções (despesa fixa, cartão, folha) ficam à parte.
   Sem estoque informado, a necessidade sai "sem estoque", rotulada; nunca com zero.
   O histórico mês a mês depende da reconstrução dos títulos no Mubisys (6.2). */
const giroUI={dados:null,erro:'',busy:false,em:0,seq:0,aberto:false,foco:false};
function carregarGiro(forcar=false){
 if(giroUI.busy||(!forcar&&Date.now()-giroUI.em<60000))return;
 const seq=++giroUI.seq;giroUI.busy=true;giroUI.erro='';giroUI.em=Date.now();
 Promise.resolve().then(()=>api('indicadores',{fonte:'capitalGiro'})).then(r=>{if(seq!==giroUI.seq)return;if(!r?.ok)throw new Error(r?.erro||'A leitura não foi confirmada pelo servidor.');if(r.fonte!=='capitalGiro')throw new Error('Fonte inválida.');giroUI.dados=r;})
  .catch(e=>{if(seq!==giroUI.seq)return;const m=String(e?.message||e||'');
  // Servidor anterior a esta fase responde com o erro de período (validarPeriodo vem antes da fonte).
  giroUI.erro=/desconhecida|Fonte inválida|intervalo válido/i.test(m)?'O servidor ainda não tem a leitura do capital de giro: ela é publicada sozinha pelo Painel, que roda de hora em hora mas costuma atrasar algumas horas. Tente de novo mais tarde.':/abort/i.test(m)?'O servidor demorou a responder.':m;})
  .finally(()=>{if(seq!==giroUI.seq)return;giroUI.busy=false;giroUI.em=Date.now();if(state.view==='giro'&&typeof render==='function'){render();giroFocar();}});
}
function giroFocar(){if(!giroUI.foco||typeof document==='undefined'||typeof document.querySelector!=='function')return;document.querySelector('[data-giro-recarregar]')?.focus?.();if(!giroUI.busy)giroUI.foco=false;}
function giroEstoque(base){
 const mes=recMes(base),v=mes&&typeof paramOperacao==='function'?paramOperacao(mes)?.estoque:null;
 return {mes,valor:v==null||v===''||!Number.isFinite(Number(v))?null:Number(v)};
}
/* Histórico do capital de giro (Fase 6.3): fechamentos remontados pelo robô
   erp_posicoes.py. Prazos médios em dias de 90 (três meses até o fechamento):
   recebimento = a receber ÷ emitido a receber × 90; pagamento = a pagar
   operacional ÷ emitido a pagar operacional × 90; estoque = estoque de Parâmetros
   do mês ÷ compras de produção (1.xx) × 90, aproximação marcada. Ciclo = estoque +
   recebimento − pagamento. Sem estoque, o prazo de estoque e o ciclo ficam sem valor. */
function giroHistorico(d){
 const n=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v),dias=(saldo,fluxo)=>n(saldo)!=null&&n(fluxo)>0?Math.round(n(saldo)/n(fluxo)*90):null;
 return (d?.historico?.meses||[]).map(m=>{
  const est=typeof paramOperacao==='function'?n(paramOperacao(m.mes)?.estoque):null,f3=m.fluxos3m;
  // Prazos sobre a carteira inteira (com o que vence depois de 60 dias): o emitido dos três meses também é inteiro.
  const pmr=dias(m.receber?.totalSemHorizonte??m.receber?.total,f3?.receber?.emitido),pmp=dias(m.pagar?.operacionalSemHorizonte??m.pagar?.operacional,f3?.pagar?.emitidoOperacional),pme=est!=null?dias(est,f3?.pagar?.emitidoProducao):null;
  return {...m,estoque:est,pmr,pmp,pme,ciclo:pmr!=null&&pmp!=null&&pme!=null?pme+pmr-pmp:null,ncg:est!=null&&n(m.ncgSemEstoque)!=null?Math.round((m.ncgSemEstoque+est)*100)/100:null};
 });
}
function giroSecaoHistorico(d,perm){
 const h=giroHistorico(d);
 if(!h.length&&d?.historico?.erro)return `<section class="estado-vazio giro-sem-historico"><div><h2>Histórico indisponível agora</h2><p>Não foi possível ler o histórico de posições no servidor. Os fechamentos gravados não foram perdidos; tente de novo mais tarde.</p></div></section>`;
 if(!h.length&&d?.historico?.invalidos)return `<section class="estado-vazio giro-sem-historico"><div><h2>Histórico em formato antigo</h2><p>${esc(`${d.historico.invalidos} fechamento(s) gravado(s) num formato que esta versão não lê. ${perm.admin?'Rode de novo a remontagem no GitHub do DRE (Actions, "Histórico de posições (Mubisys)").':'Peça a um administrador para rodar de novo a remontagem.'}`)}</p></div></section>`;
 if(!h.length)return `<section class="estado-vazio giro-sem-historico"><div><h2>O histórico ainda não foi remontado</h2><p>${esc(perm.admin?'No GitHub do DRE, em Actions, rode "Histórico de posições (Mubisys)": primeiro sem marcar "Gravar" (simulação, só contagens no log) e depois marcando. Ele remonta cada fechamento desde 30/11/2025 com os títulos do Mubisys.':'Peça a um administrador para rodar a remontagem do histórico de posições no GitHub do DRE.')}</p></div></section>`;
 const curto=m=>m.mes.replace(/\/20(\d\d)$/,'/$1'),ult=h[h.length-1];
 const g1=recPainel('A necessidade de giro está crescendo?','A receber menos o a pagar operacional no fim de cada mês, sem o estoque, para os meses serem comparáveis; vencimentos até 60 dias de cada fechamento.',gLinhaArea(h.map(m=>({rotulo:curto(m),valor:m.ncgSemEstoque})),{selecionado:h.length-1,titulo:'Necessidade de giro sem estoque',rotulo:'Sem estoque',cor:'marca'}),false);
 const g2=recPainel(`Quantos dias o dinheiro fica preso? · ${ult.mes}`,'Estoque mais recebimento, menos pagamento a fornecedores, em dias, nos três meses até o fechamento. O prazo de estoque usa as compras de produção como aproximação do custo.',gCiclo({pme:ult.pme,pmr:ult.pmr,pmpf:ult.pmp}),false);
 const dia=v=>v==null||!Number.isFinite(Number(v))?'—':esc(String(Math.round(Number(v)))),cel=v=>`<td class="num">${v==null?'<span class="muted" title="Não apurado">—</span>':esc(money(v))}</td>`;
 const linhas=h.map(m=>`<tr${m.parcial?' class="giro-parcial"':''}><th scope="row">${esc(m.mes)}${m.parcial?' *':''}</th>${cel(m.receber?.total)}${cel(m.pagar?.operacional)}${cel(m.estoque)}${m.ncg!=null?cel(m.ncg):`<td class="num">${esc(money(m.ncgSemEstoque))} <small>sem estoque</small></td>`}<td class="num">${dia(m.pmr)}</td><td class="num">${dia(m.pmp)}</td><td class="num">${dia(m.pme)}</td><td class="num">${dia(m.ciclo)}</td><td class="num">${dia(m.fluxos?.receber?.prazoReal)}</td><td class="num">${dia(m.fluxos?.pagar?.prazoReal)}</td></tr>`).join('');
 const tabela=`<div class="table-scroll"><table class="tabela-controle giro-historico"><caption>Prazos e saldos no fim de cada mês · dias de recebimento, pagamento e estoque sobre os três meses até o fechamento</caption><thead><tr><th scope="col">Mês</th><th scope="col" class="num">A receber</th><th scope="col" class="num">A pagar operacional</th><th scope="col" class="num">Estoque</th><th scope="col" class="num">Necessidade de giro</th><th scope="col" class="num">Recebimento (dias)</th><th scope="col" class="num">Pagamento (dias)</th><th scope="col" class="num">Estoque (dias)</th><th scope="col" class="num">Ciclo (dias)</th><th scope="col" class="num">Recebimento real (dias)</th><th scope="col" class="num">Pagamento real (dias)</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
 const cortes=[...new Set(h.map(m=>m.corte).filter(Boolean))],corteAtual=d.historico?.corteAtual,difCorte=corteAtual&&cortes.some(c=>c!==corteAtual)?` O histórico usou o corte de dívida antiga ${cortes.map(recData).join(', ')}; o Painel hoje usa ${recData(corteAtual)}.`:'';
 const parciais=h.filter(m=>m.parcial),avisoParcial=parciais.length?`<div class="param-avisos giro-hist-parcial"><b>Fechamentos parciais (*).</b><ul>${parciais.map(m=>`<li>${esc(m.mes)}: ${esc((m.motivos||[]).join('; '))}.</li>`).join('')}</ul></div>`:'';
 const nota=`<p class="hint giro-historico-nota">${esc(`Histórico remontado em ${recHora(ult.gravadoEm||ult.geradoEm)} com os títulos do Mubisys de hoje: título cancelado, apagado ou renegociado depois do fechamento não aparece. Prazos de recebimento e de pagamento sobre a carteira inteira; a necessidade de giro, só até 60 dias de cada fechamento, como a de hoje. Prazo real = data do pagamento − emissão, das parcelas pagas no mês.${difCorte}`)}</p>`;
 return `<div class="graficos-controle">${g1}${g2}</div>${nota}${avisoParcial}<details class="card giro-hist-detalhe"><summary>Prazos e saldos por mês · ${h.length} fechamento${h.length===1?'':'s'}</summary><div class="card-body">${tabela}</div></details>`;
}
function renderGiro(){
 carregarGiro();
 const d=giroUI.dados,ok=!!d?.disponivel,perm={admin:!!state.permissoes?.admin},p=d?.pagar,r=d?.receber;
 const acoes=`<div class="actions"><button type="button" data-giro-recarregar aria-disabled="${giroUI.busy}">Ler de novo</button>${p?.disponivel?'<button type="button" data-giro-csv>Baixar contas a pagar (CSV)</button>':''}<span class="hint" role="status">${giroUI.busy?'Lendo o Painel…':''}</span></div>`;
 const erro=giroUI.erro?`<p class="param-avisos">${esc(giroUI.erro)} ${d?'Mostrando a última leitura.':'Nenhum zero foi assumido.'}</p>`:'';
 if(!ok){
  const motivo=p?.avisos?.[0]||r?.avisos?.[0]||(giroUI.busy||!giroUI.erro?'Lendo as contas a receber e a pagar no Painel…':'Sem leitura do capital de giro.');
  const nao=['Necessidade de capital de giro','A receber','A pagar operacional','Estoque'].map(t=>recCartao(t,'Não apurado','Depende da posição do Painel.')).join('');
  return `<div class="cards cards-controle">${nao}</div>${erro}<section class="estado-vazio giro-sem-dados"><div><h2>${d?'As contas do Painel não estão disponíveis':'Capital de giro'}</h2><p>${esc(motivo)}</p></div></section>${acoes}`;
 }
 const base=p?.posicao?.base||r?.posicao?.base,est=giroEstoque(base),irParam=`data-go="parametros"${est.mes?` data-rec-mes="${esc(est.mes)}"`:''}`;
 const R=d.ncg.receber,P=d.ncg.pagarOperacional,semEst=d.ncg.semEstoque,ncg=semEst!=null&&est.valor!=null?Math.round((semEst+est.valor)*100)/100:null;
 const cardNcg=ncg!=null?recCartao('Necessidade de capital de giro',money(ncg),`A receber ${money(R)} + estoque ${money(est.valor)} − a pagar operacional ${money(P)}`)
  :semEst!=null?recCartao('Necessidade de giro sem estoque',money(semEst),`A receber ${money(R)} − a pagar operacional ${money(P)}; falta o estoque de ${est.mes||'o mês'} em Parâmetros`)
  :recCartao('Necessidade de capital de giro','Não apurado',r?.disponivel?'Faltam as contas a pagar do Painel.':'Faltam os recebíveis do Painel.');
 const ate=recData(d.horizonte?.ate);
 const cards=`<div class="cards cards-controle">${cardNcg}${recCartao('A receber',R==null?'Não apurado':money(R),r?.disponivel?`Vencidos e a vencer até ${ate} (60 dias da carga, o mesmo horizonte das contas a pagar); vencidos antes de ${recData(r.corte?.data)} ficam fora`:'Recebíveis do Painel indisponíveis')}${recCartao('A pagar operacional',P==null?'Não apurado':money(P),p?.disponivel?`Fornecedores (1.xx e 2.xx), impostos e prédio, vencidas e a vencer até ${ate} · ${money(p.totais.vencidoOperacional)} já vencido`:'Contas a pagar do Painel indisponíveis')}${recCartao('Estoque',est.valor==null?'Não informado':money(est.valor),est.valor==null?`Informe o estoque no fim de ${est.mes||'o mês'} em Parâmetros`:`Parâmetros, ${est.mes}`)}</div>`;
 const hR=r?.disponivel?recHora(r.posicao?.em):null,hP=p?.disponivel?recHora(p.posicao?.em):null,horas=hR&&hP&&hR!==hP?`a receber de ${hR}, a pagar de ${hP}`:hP||hR;
 const fora=d.horizonte?.receberFora?.quantidade?` ${d.horizonte.receberFora.quantidade} título(s) a receber que vencem depois de ${ate} (${money(d.horizonte.receberFora.valor)}) ficam fora da necessidade de giro e estão na tela Recebíveis.`:'';
 const posicao=`<p class="hint giro-posicao">Posição do Painel: ${esc(horas)} (a carga roda a cada 20 minutos); dias contados até hoje. Esta tela é uma foto: não muda com o mês escolhido.${esc(fora)}</p>`;
 const lista=[...(d.avisos||[]),...(r?.disponivel?[]:(r?.avisos||[]).slice(0,1).map(a=>'A receber: '+a)),...(p?.disponivel?[]:(p?.avisos||[]).slice(0,1).map(a=>'A pagar: '+a))];
 const avisos=lista.length?`<div class="param-avisos giro-avisos">${d.qualidade!=='Apurado'?'<b>Leitura parcial.</b> ':''}<ul>${lista.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></div>`:'';
 const semEstoque=est.valor==null?`<section class="estado-vazio giro-sem-estoque"><div><h2>Falta o estoque</h2><p>${esc(perm.admin?`Informe em Parâmetros o estoque no fim de ${est.mes||'o mês'}; sem ele, a necessidade de capital de giro sai sem o estoque, marcada.`:`Peça a um administrador para informar em Parâmetros o estoque no fim de ${est.mes||'o mês'}.`)}</p></div><button type="button" ${irParam}>${perm.admin?'Informar em Parâmetros':'Ver Parâmetros'}</button></section>`:'';
 const passos=[{rotulo:'A receber',curto:'Receber',valor:R,total:true},...(est.valor!=null?[{rotulo:'Estoque',curto:'Estoque',valor:est.valor}]:[]),{rotulo:'A pagar operacional',curto:'Pagar',valor:P==null?null:-P},{rotulo:est.valor!=null?'Necessidade de giro':'Sem estoque',curto:'NCG',valor:est.valor!=null?ncg:semEst,total:true}];
 const g1=recPainel('Quanto dinheiro fica preso no giro?',est.valor!=null?'O que há a receber, mais o estoque, menos o que se deve a fornecedores, impostos e prédio.':'O que há a receber menos o que se deve a fornecedores, impostos e prédio; o estoque entra quando for informado em Parâmetros.',gCascata(passos,{base:0,titulo:'Necessidade de capital de giro'}));
 const classes=(p?.grupos||[]).filter(g=>g.quantidade);
 const g2=recPainel('O que eu devo, por classe?','Contas a pagar em aberto por classe do centro de custo do Mubisys; sócios, empréstimos e sem classificação não entram na necessidade de giro.',!p?.disponivel?'<p class="hint">Não apurado: faltam as contas a pagar do Painel.</p>':classes.length?gBarrasOrdenadas(classes.map(g=>({rotulo:g.rotulo,valor:g.valor})),{limite:7,cor:'saida',titulo:'A pagar por classe'}):'<p class="hint">Nenhuma conta a pagar em aberto.</p>',false);
 const g3=recPainel('E o que eu devo vence quando?','A pagar operacional por faixa de vencimento na data da posição.',!p?.disponivel?'<p class="hint">Não apurado: faltam as contas a pagar do Painel.</p>':p.totais.operacional>0?gCemPorCento(p.faixas.map(f=>({rotulo:f.rotulo,valor:f.valor})),{titulo:'A pagar operacional por vencimento'}):'<p class="hint">Nenhuma conta operacional em aberto.</p>',false);
 const prazos=(()=>{const mes=est.mes,op=mes&&typeof paramOperacao==='function'?paramOperacao(mes):null,v=k=>op?.[k]==null||op?.[k]===''?'não informado':recDias(Number(op[k]));
  return `<p class="note giro-prazos">Prazos em Parâmetros (${esc(mes||'mês de hoje')}): recebimento <b>${esc(v('prazoRecebimento'))}</b>, pagamento <b>${esc(v('prazoPagamento'))}</b>. Na carteira a receber de hoje: prazo concedido médio <b>${esc(recDias(r?.prazo?.concedido?.dias))}</b> e idade média <b>${esc(recDias(r?.prazo?.idade?.dias))}</b>. O ciclo financeiro (estoque + recebimento − pagamento, em dias) de cada fechamento está no histórico abaixo.</p>`;})();
 const linhaGrupo=g=>`<tr class="${g.ncg?'':'giro-fora'}"><th scope="row">${esc(g.rotulo)}</th><td>${g.ncg?'Sim':'Não'}</td><td class="num">${g.quantidade}</td><td class="num">${esc(money(g.vencido))}</td><td class="num">${esc(money(g.aVencer))}</td><td class="num">${esc(money(g.valor))}</td></tr>${g.categorias.map(k=>`<tr class="giro-categoria"><td>${esc(k.rotulo)}</td><td></td><td class="num">${k.quantidade}</td><td></td><td></td><td class="num">${esc(money(k.valor))}</td></tr>`).join('')}`;
 const extras=p?.disponivel?`${p.antigas?.quantidade?`<tr class="giro-fora"><th scope="row">Vencidas antes de ${esc(recData(p.corte?.data))}</th><td>Não</td><td class="num">${p.antigas.quantidade}</td><td class="num">${esc(money(p.antigas.valor))}</td><td></td><td class="num">${esc(money(p.antigas.valor))}</td></tr>`:''}${p.projetado?.quantidade?`<tr class="giro-fora"><th scope="row">Projetado no Mubisys (ainda não é título)</th><td>Não</td><td class="num">${p.projetado.quantidade}</td><td></td><td></td><td class="num">${esc(money(p.projetado.valor))}</td></tr>${p.projetado.categorias.map(k=>`<tr class="giro-categoria"><td>${esc(k.rotulo)}</td><td></td><td class="num">${k.quantidade}</td><td></td><td></td><td class="num">${esc(money(k.valor))}</td></tr>`).join('')}`:''}`:'';
 const tabelaClasses=p?.disponivel?`<div class="table-scroll"><table class="tabela-controle giro-classes"><caption>Contas a pagar em aberto por classe · posição de ${esc(recData(p.posicao?.base))}</caption><thead><tr><th scope="col">Classe e centro de custo</th><th scope="col">Entra na necessidade de giro?</th><th scope="col" class="num">Contas</th><th scope="col" class="num">Vencido</th><th scope="col" class="num">A vencer</th><th scope="col" class="num">Total</th></tr></thead><tbody>${(p.grupos||[]).filter(g=>g.quantidade).map(linhaGrupo).join('')}${extras}</tbody></table></div>`:'';
 const titulos=p?.disponivel?`<div class="table-scroll"><table class="tabela-controle giro-titulos"><caption>Contas a pagar em aberto, da maior para a menor${p.truncado?` · as ${p.titulos.length} maiores de ${p.totais.quantidade}`:''}</caption><thead><tr><th scope="col">Credor</th><th scope="col">Descrição</th><th scope="col">Centro de custo</th><th scope="col">Vencimento</th><th scope="col" class="num">Atraso</th><th scope="col" class="num">Valor</th></tr></thead><tbody>${p.titulos.map(x=>`<tr><th scope="row">${esc(x.fornecedor)}</th><td>${esc(x.descricao||'—')}</td><td>${esc(x.categoria)}</td><td>${esc(recData(x.vencimento))}</td><td class="num">${esc(x.dias>0?recDias(x.dias):x.dias===0?'vence hoje':'vence em '+recDias(-x.dias))}</td><td class="num">${esc(money(x.valor))}</td></tr>`).join('')||'<tr><td colspan="6">Nenhuma conta a pagar em aberto.</td></tr>'}</tbody></table></div>`:'';
 return cards+posicao+acoes+erro+avisos+semEstoque+`<div class="graficos-controle">${g1}${g2}${g3}</div>`+prazos+giroSecaoHistorico(d,perm)+(p?.disponivel?`<details class="card giro-detalhe"${giroUI.aberto?' open':''}><summary>Contas a pagar por classe · ${p.totais.quantidade}</summary><div class="card-body">${tabelaClasses}${titulos}</div></details>`:'');
}
function giroCSV(){
 const p=giroUI.dados?.pagar;if(!p?.disponivel)return null;
 const nomeGrupo=id=>p.grupos.find(g=>g.id===id)?.rotulo||id;
 const rows=[['Contas a pagar em aberto · posição do Painel',recHora(p.posicao?.em)],['Corte de dívida antiga',recData(p.corte?.data)],[],['Credor','Descrição','Centro de custo','Classe','Entra na necessidade de giro','Vencimento','Dias (positivo = vencido)','Valor (R$)'],
  ...p.titulos.map(x=>[x.fornecedor,x.descricao,x.categoria,nomeGrupo(x.grupo),p.grupos.find(g=>g.id===x.grupo)?.ncg?'Sim':'Não',recData(x.vencimento),String(x.dias),x.valor.toFixed(2).replace('.',',')]),...(p.truncado?[[`Lista com as ${p.titulos.length} maiores de ${p.totais.quantidade} contas.`]]:[])];
 download('contas-a-pagar-'+(p.posicao?.base||'posicao')+'.csv','﻿'+rows.map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv');
 return rows;
}
function wireGiro(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-giro-csv],[data-giro-recarregar]');if(!b)return;if(b.hasAttribute('data-giro-csv'))giroCSV();else if(!giroUI.busy){giroUI.foco=true;carregarGiro(true);if(typeof render==='function')render();giroFocar();}});
 document.addEventListener('toggle',e=>{if(e.target?.classList?.contains('giro-detalhe'))giroUI.aberto=e.target.open;},true);
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wireGiro);
