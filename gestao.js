/* Gestão compartilhada: regras de leitura e planejamento, sem alterar lançamentos. */
let gestaoSaving=false,planoSujo=false,planoBase=null,rotaAtual='',rotaLida=false;
const gestaoUI={evolucao:'mensal',serie:'variacao',dre:'mes',pendTipo:'todos',pendBusca:'',pendPagina:0};
const mesmoEscopo=(a,b)=>!!a&&!!b&&[a.company,a.basis,a.qualidade?.escopo,a.qualidade?.regra].join('|')===[b.company,b.basis,b.qualidade?.escopo,b.qualidade?.regra].join('|');
function navContexto(){
 const groups={inicio:[['inicio','Resumo'],['cfo','O que mudou'],['detalhe','Contas e origem']],dre:[['dre','Demonstrativo'],['glossario','Entenda os conceitos']],caixa:[['caixa','Movimento e previsão'],['resultado','Composição']],indicadores:[['indicadores','Indicadores'],['cfo','Investigar variações'],['custos','Despesas e categorias'],['detalhe','Contas e origem']],conferencia:[['conferencia','Conferência'],['config','Configurações']]};
 if(['inicio','dre','detalhe','glossario'].includes(state.view))return '';
 const group=['cfo','custos'].includes(state.view)?'indicadores':state.view==='resultado'?'caixa':state.view==='glossario'?'dre':state.view==='config'?'conferencia':state.view;
 return `<nav class="context-nav" aria-label="Seções desta área">${(groups[group]||[]).filter(([v])=>v!==state.view&&!['inicio','detalhe','glossario'].includes(v)).map(([v,t])=>`<button data-go="${v}" aria-current="${v===state.view?'page':'false'}">${t}</button>`).join('')}</nav>`;
}
function restaurarRota(){
 if(typeof location==='undefined')return;const q=new URLSearchParams(location.hash.replace(/^#/,''));
 const views=['inicio','dre','caixa','indicadores','cfo','custos','detalhe','resultado','conferencia','config','ajuda','glossario'];
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
async function salvarGestao(chave,valor,original=state.cfg?.gestao?.[chave]??null){
 if(!state.permissoes.admin)throw new Error('É necessário acesso administrativo para salvar planejamento e revisões.');
 if(gestaoSaving)throw new Error('Aguarde a gravação em andamento.');
 const sessao=STORE_KEY;gestaoSaving=true;
 try{
  const r=await api('getCfg');if(!r.ok)throw new Error('Não foi possível ler a versão compartilhada.');
  const atual=r.cfg?.gestao?.[chave]??null;if(JSON.stringify(atual)!==JSON.stringify(original))throw new Error('Este planejamento mudou na nuvem. Sua edição continua aberta. Leia a base e confira antes de salvar.');
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
 return `<section class="management-panel"><div class="section-row"><h2>O que mudou</h2><button id="gestaoPlanejamento">Orçamento e alertas</button></div>${cmp.permitida?`<p class="hint">${esc(state.comparar)} → ${esc(state.periodo)} · variações das categorias de saídas. ${cmp.ressalva?'Cobertura a conferir.':''}</p><div class="table-scroll"><table><thead><tr><th>Categoria</th><th class="num">Anterior</th><th class="num">Atual</th><th class="num">Diferença</th></tr></thead><tbody>${mostradas.map(x=>`<tr><td>${botaoConta(x.code,x.name)}</td><td class="num">${money(x.cmp.anterior)}</td><td class="num">${money(x.value)}</td><td class="num">${money(x.cmp.delta)}</td></tr>`).join('')}${resto.length?`<tr><td>Demais ${resto.length} categorias comparáveis</td><td colspan="3" class="num">${money(resto.reduce((s,x)=>s+Math.round(x.cmp.delta*100),0)/100)}</td></tr>`:''}</tbody></table></div><small>Somente grupos comparáveis. Novos códigos, mudanças de nome e resíduos permanecem em Contas e origem. A variação não comprova sua causa.</small>`:`<p>${esc(cmp.motivo||'Escolha um período de comparação no topo.')}</p>`}<div class="management-chips">${alertasPeriodo(reg).map(t=>`<button class="chip-warn" data-go="conferencia">${esc(t)}</button>`).join('')}<button data-go="detalhe">Investigar contas</button></div><details><summary>Mesmo mês do ano anterior e orçamento</summary><p>${yoy.permitida?'Variação do caixa versus '+esc(anoAnt.label)+': '+money(yoy.delta):'Ano anterior: '+esc(yoy.motivo)}</p>${tabelaOrcamento(reg)}</details>${actions.length?`<div class="management-actions">${actions.map(([k,v])=>`<button data-acao-key="${esc(k)}">${esc(v.titulo)} · ${esc(v.responsavel||'Sem responsável')} · ${esc(v.prazo||'Sem prazo')}</button>`).join('')}</div>`:''}</section>`;
}
function tabelaOrcamento(reg){const b=state.cfg.gestao?.['orcamento:'+safeId(state.periodo)],r=F.resumo(reg);return !b?'<p>Orçamento mensal ainda não informado. Não há referência inventada.</p>':`<div class="table-scroll"><table><thead><tr><th>Caixa gerencial</th><th class="num">Orçamento</th><th class="num">Realizado</th><th class="num">Desvio R$</th></tr></thead><tbody>${[['entradas','Entradas'],['saidas','Saídas'],['variacao','Entradas menos saídas']].map(([k,t])=>`<tr><td>${t}</td><td class="num">${money(b[k])}</td><td class="num">${money(r[k])}</td><td class="num">${b[k]==null||r[k]==null?'Não apurado':money(r[k]-b[k])}</td></tr>`).join('')}</tbody></table></div><p>Fonte: ${esc(b.fonte)} · versão de ${esc(dataBR(b.atualizadoEm))}. Não é orçamento por competência.</p>`;}
function evolucaoCompacta(){
 const series={entradas:['1','Entradas'],saidas:['2','Saídas'],variacao:['variacao','Entradas menos saídas']},[code,nome]=series[gestaoUI.serie];
 const alvo=regAtual(),acum=gestaoUI.evolucao==='acumulado',data=acum?acumularAno(code):F.serieAnual(state.records,state.periodo,code);
 const pts=data.map(x=>({...x,valor:monthSortKey(x.label)>monthSortKey(state.periodo)||!mesmoEscopo(x.reg,alvo)?null:acum?x.acumulado:code==='variacao'?F.resumo(x.reg).variacao:x.value}));
 return painelGrafico('Evolução do caixa',`${esc(nome)} · até ${esc(state.periodo)} · ${acum?'acumulado de janeiro':'valores mensais'}`,`<div class="management-chips"><select id="evolucaoModo" aria-label="Tipo de evolução"><option value="mensal" ${!acum?'selected':''}>Mensal</option><option value="acumulado" ${acum?'selected':''}>Acumulado</option></select><select id="evolucaoSerie" aria-label="Indicador de evolução">${Object.entries(series).map(([k,[,t]])=>`<option value="${k}" ${gestaoUI.serie===k?'selected':''}>${t}</option>`).join('')}</select><button data-metas>Metas do ano</button></div>${graficoBarras(pts,[{chave:'valor',nome,cor:code==='2'?'var(--chart-out)':code==='variacao'?'var(--chart-net)':'var(--chart-in)'}],nome)}<p class="hint">Lacunas, meses posteriores ao selecionado e escopos diferentes não formam barras. O acumulado exige continuidade desde janeiro.</p><details><summary>Metas e referências anuais</summary>${graficoRitmoAno()}</details>`);
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
