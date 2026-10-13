/* Gestão compartilhada: regras de leitura e planejamento, sem alterar lançamentos. */
let gestaoSaving=false,planoSujo=false,planoBase=null,rotaAtual='',rotaLida=false;
const gestaoUI={evolucao:'mensal',serie:'variacao',dre:'mes',pendTipo:'todos',pendBusca:'',pendPagina:0};
const mesmoEscopo=(a,b)=>!!a&&!!b&&[a.company,a.basis,a.qualidade?.escopo,a.qualidade?.regra].join('|')===[b.company,b.basis,b.qualidade?.escopo,b.qualidade?.regra].join('|');
const gestaoCard=(titulo,aberto)=>typeof cardAttrs==='function'?cardAttrs(titulo,aberto):(aberto?'open':'');
function navContexto(){
 const groups={inicio:[['inicio','Dashboard'],['cfo','Análise CFO'],['detalhe','Plano de contas']],dre:[['dre','DRE'],['glossario','Glossário']],caixa:[['caixa','Caixa e planejamento'],['resultado','Composição do caixa']],indicadores:[['indicadores','Indicadores'],['cfo','Análise CFO'],['custos','Despesas e categorias'],['detalhe','Plano de contas']],conferencia:[['conferencia','Conferência'],['config','Sistemas e configurações']]};
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
 // Ano (Fase 9.1): uma fonte só; a rota da DRE antiga (visao=ano) também liga.
 const ano=q.get('ano')==='1'||q.get('visao')==='ano';state.anoTodo=ano;gestaoUI.dre=ano?'ano':'mes';rotaLida=true;rotaAtual=location.hash;
}
function gravarRota(){
 if(typeof location==='undefined'||!rotaLida)return;const p=new URLSearchParams({tela:state.view,mes:state.periodo,comparar:state.comparar,base:dreUI.base});
 if(state.view==='detalhe'){p.set('busca',state.consulta);p.set('tipo',state.tipo);p.set('grupo',state.grupo);if(state.contaSelecionada)p.set('conta',state.contaSelecionada);}
 if(state.view==='dre')p.set('visao',gestaoUI.dre);
 if(typeof ANO_TELAS!=='undefined'&&ANO_TELAS.includes(state.view)&&state.anoTodo)p.set('ano','1');
 const hash='#'+p.toString();if(hash===rotaAtual)return;
 const anterior=new URLSearchParams(rotaAtual.slice(1)).get('tela');
 // N2: a entrada do diálogo vira a da tela nova, e o fechamento não volta no histórico.
 history[anterior&&anterior!==state.view&&!history.state?.dialogo?'pushState':'replaceState']({},'',hash);rotaAtual=hash;
}
if(typeof window!=='undefined')window.addEventListener('popstate',()=>{
 const d=document.getElementById('detailDialog');
 // O evento close chega depois: a marca só sai quando ele for tratado (o ouvinte do app.js vem antes).
 if(d?.open){if(typeof fechandoPorVoltar!=='undefined'){fechandoPorVoltar=true;d.addEventListener('close',()=>{fechandoPorVoltar=false;},{once:true});}d.close();return;}
 // A entrada do diálogo tem a mesma URL da anterior: não há rota a restaurar.
 if(location.hash===rotaAtual)return;
 if(typeof voltandoHistorico!=='undefined')voltandoHistorico=true;
 try{restaurarRota();render();}finally{if(typeof voltandoHistorico!=='undefined')voltandoHistorico=false;}
});
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
  state.cfg=cfg;state.cfgVersion=saved.atualizadoEm;if(typeof cfgConfirmada==='function')cfgConfirmada();return item;
 }finally{gestaoSaving=false;}
}
function alertasPeriodo(reg){
 const cfg=state.cfg.gestao?.alertas||{},q=F.qualidade(reg),a=[];const limite=cfg.horas??24;
 if(q.coletadoEm&&(Date.now()-Date.parse(q.coletadoEm))/36e5>limite)a.push('Coleta com mais de '+limite+'h');
 if(!q.coletadoEm)a.push('Coleta não registrada');if(q.parcial)a.push('Período parcial');
 if(reg?.pendencias?.length)a.push(reg.pendencias.length+' pendência(s) a conferir');
 if(state.cacheOk===false)a.push('Sem cópia offline');return a;
}
// Seta da variação: a cor diz bom ou ruim, a seta diz se subiu ou caiu.
const gestaoSeta=d=>d>0?'▲ ':d<0?'▼ ':'';
function resumoGestao(reg){
 const anterior=state.records.find(r=>r.label===state.comparar),cmp=F.comparacao(reg,anterior);
 const rows=F.composicao(reg,'2').itens.filter(x=>!x.residuo).map(x=>({...x,cmp:F.compararConta(reg,anterior,x.code)})).filter(x=>x.cmp.permitida).sort((a,b)=>Math.abs(b.cmp.delta)-Math.abs(a.cmp.delta));
 const lim=state.cfg.gestao?.alertas?.variacao??0,mostradas=rows.filter(x=>Math.abs(x.cmp.delta)>=lim).slice(0,5),resto=rows.filter(x=>!mostradas.includes(x));
 const anoAnt=state.records.find(r=>monthSortKey(r.label)===monthSortKey(state.periodo)-12),yoy=F.comparacao(reg,anoAnt);
 const actions=Object.entries(state.cfg.gestao||{}).filter(([k,v])=>k.startsWith('acao:'+safeId(state.periodo)+':')&&v.situacao!=='Resolvida').slice(0,3);
 return `<section class="management-panel"><div class="section-row"><h2>O que mudou</h2><button id="gestaoPlanejamento">Orçamento e alertas</button></div>${cmp.permitida?`<p class="hint">${esc(state.comparar)} → ${esc(state.periodo)} · variações das categorias de saídas. ${cmp.ressalva?'Cobertura a conferir.':''}</p><div class="table-scroll"><table><thead><tr><th>Categoria</th><th class="num">Diferença</th><th class="num">Atual</th><th class="num">Anterior</th></tr></thead><tbody>${mostradas.map(x=>`<tr><td>${botaoConta(x.code,x.name)}</td><td class="num ${tomDelta(dirConta(x.code),x.cmp.delta)}">${gestaoSeta(x.cmp.delta)}<span class="nowrap">${money(Math.abs(x.cmp.delta))}</span></td><td class="num ${tomDoValor('saidas',x.value)}">${money(x.value)}</td><td class="num ${tomDoValor('saidas',x.cmp.anterior)}">${money(x.cmp.anterior)}</td></tr>`).join('')}${resto.length?`<tr><td>Demais ${resto.length} categorias comparáveis</td><td class="num">${(d=>`${gestaoSeta(d)}<span class="nowrap">${money(Math.abs(d))}</span>`)(resto.reduce((s,x)=>s+Math.round(x.cmp.delta*100),0)/100)}</td><td colspan="2"></td></tr>`:''}</tbody></table></div><small>Somente grupos comparáveis. Novos códigos, mudanças de nome e resíduos permanecem no Plano de contas. A variação não comprova sua causa.</small>`:`<p>${esc(cmp.motivo||'Escolha um período de comparação no topo.')}</p>`}<div class="management-chips">${alertasPeriodo(reg).map(t=>`<button class="chip-warn" data-go="conferencia">${esc(t)}</button>`).join('')}<button data-go="detalhe">Investigar contas</button></div><details><summary>Mesmo mês do ano anterior e orçamento</summary><p>${yoy.permitida?gestaoAnoAnterior(reg,anoAnt,yoy.delta):'Ano anterior: '+esc(yoy.motivo)}</p>${tabelaOrcamento(reg)}</details>${actions.length?`<div class="management-actions">${actions.map(([k,v])=>`<button data-acao-key="${esc(k)}">${esc(v.titulo)} · ${esc(v.responsavel||'Sem responsável')} · ${esc(v.prazo||'Sem prazo')}</button>`).join('')}</div>`:''}</section>`;
}
// Mesmo mês do ano anterior: entradas menos saídas de cada um e quanto mudou.
function gestaoAnoAnterior(reg,anoAnt,delta){
 const v=r=>F.resumo(r).variacao,dir=typeof DIRECAO_DA_LINHA!=='undefined'?DIRECAO_DA_LINHA.variacao:1;
 const dif=!delta?'mesmo valor':`<b class="${tomDelta(dir,delta)}">${gestaoSeta(delta)}${money(Math.abs(delta))} ${delta>0?'a mais':'a menos'}</b>`;
 return `Entradas menos saídas: <b class="${tomDoValor('variacao',v(reg))}">${money(v(reg))}</b> em ${esc(reg.label)} contra <b class="${tomDoValor('variacao',v(anoAnt))}">${money(v(anoAnt))}</b> em ${esc(anoAnt.label)} (${dif})`;
}
function tabelaOrcamento(reg){const b=state.cfg.gestao?.['orcamento:'+safeId(state.periodo)],r=F.resumo(reg),parcial=F.qualidade(reg).parcial;return !b?'<p>Orçamento mensal ainda não informado. Não há referência inventada.</p>':`<div class="table-scroll"><table><thead><tr><th>Caixa gerencial</th><th class="num">Orçamento</th><th class="num">Realizado</th><th class="num">Desvio R$</th></tr></thead><tbody>${[['entradas','Entradas'],['saidas','Saídas'],['variacao','Entradas menos saídas']].map(([k,t])=>`<tr><td>${t}</td><td class="num ${tomDoValor(k,b[k])}">${money(b[k])}</td><td class="num ${tomDoValor(k,r[k])}">${money(r[k])}</td>${b[k]==null||r[k]==null?'<td class="num">Não apurado</td>':(dv=>`<td class="num ${tomDelta(parcial?0:DIRECAO_DA_LINHA[k],dv)}">${gestaoSeta(dv)}${money(Math.abs(dv))}</td>`)(Math.round((r[k]-b[k])*100)/100)}</tr>`).join('')}</tbody></table></div><p>Fonte: ${esc(b.fonte)} · versão de ${esc(dataBR(b.atualizadoEm))}. Não é orçamento por competência.</p>`;}
function evolucaoCompacta(){
 const series={entradas:['1','Entradas'],saidas:['2','Saídas'],variacao:['variacao','Entradas menos saídas']},[code,nome]=series[gestaoUI.serie];
 const alvo=regAtual(),acum=gestaoUI.evolucao==='acumulado',data=acum?acumularAno(code):F.serieAnual(state.records,state.periodo,code);
 const pts=data.map(x=>({...x,valor:acum?x.acumulado:code==='variacao'?F.resumo(x.reg).variacao:x.value}));
 return painelGrafico('Evolução do caixa',`${esc(nome)} · ${esc(state.periodo.split('/')[1])} · ${acum?'acumulado até '+esc(state.periodo):'janeiro a dezembro'}`,`<div class="management-chips"><select id="evolucaoModo" aria-label="Tipo de evolução"><option value="mensal" ${!acum?'selected':''}>Mensal</option><option value="acumulado" ${acum?'selected':''}>Acumulado</option></select><select id="evolucaoSerie" aria-label="Indicador de evolução">${Object.entries(series).map(([k,[,t]])=>`<option value="${k}" ${gestaoUI.serie===k?'selected':''}>${t}</option>`).join('')}</select><button data-metas>Metas do ano</button></div>${graficoBarras(pts,[{chave:'valor',nome,cor:code==='2'?'var(--chart-out)':code==='variacao'?'var(--chart-net)':'var(--chart-in)',porSinal:code==='variacao'}],nome)}<p class="hint">Histórico mensal preservado por fonte. Mudanças de empresa ou critério impedem a comparação direta. O acumulado exige continuidade e a mesma base desde janeiro.</p><details><summary>Metas e referências anuais</summary>${graficoRitmoAno()}</details>`);
}
function tabelaDRECompacta(d){
 const controls=`<div class="management-chips"><button data-dre-visao="mes" aria-pressed="${gestaoUI.dre==='mes'}">Mês e comparação</button><button data-dre-visao="ano" aria-pressed="${gestaoUI.dre==='ano'}">Matriz do ano</button></div>`;
 if(gestaoUI.dre==='ano')return controls+tabelaDRE(d);
 const i=d.ate-1,j=d.cols.findIndex(x=>x.label===state.comparar),a=d.valores[i]||{},b=d.valores[j]||{};
 const same=d.competencia?!!d.cols[i]?.comp&&!!d.cols[j]?.comp&&d.cols[i].comp.company.trim().toLowerCase()===d.cols[j].comp.company.trim().toLowerCase():F.comparavelComRessalva(d.cols[i]?.reg,d.cols[j]?.reg).pode;
 return controls+`<div class="table-scroll"><table class="dre-compact"><caption>${d.competencia?'Competência':'Caixa gerencial'} · ${esc(state.periodo)} · valores em R$ · AV sobre ${d.competencia?'receita líquida':'entradas ou saídas'}</caption><thead><tr><th>Rubrica</th><th class="num">${esc(state.periodo)}</th><th class="num">AV %</th><th class="num">${esc(state.comparar||'Comparação')}</th><th class="num">Δ R$ / p.p.</th><th class="num">Acumulado até ${esc(state.periodo)}</th></tr></thead><tbody>${d.linhas.map(r=>{const v=a[r.id],old=b[r.id],base=baseDoPeso(d,i,r),av=r.tipo==='ratio'||r.tipo==='total'||['entradas','saidas','variacao','bruta','liquida'].includes(r.id)||v==null||!base?null:v/base*100;return `<tr class="dre-row-${r.tipo}"><th>${esc(r.nome)}</th><td class="num ${tomDoValor(r.id,v)}"><button data-cfo-rubrica="${r.id}" data-cfo-period="${esc(state.periodo)}" data-cfo-base="${dreUI.base}">${valorDRE(v,r.tipo==='ratio')}</button></td><td class="num">${av==null?'—':av.toFixed(1).replace('.',',')+'%'}</td><td class="num ${tomDoValor(r.id,old)}">${valorDRE(old,r.tipo==='ratio')}</td>${same&&v!=null&&old!=null?(dv=>`<td class="num ${tomDelta(DIRECAO_DA_LINHA[r.id]??(typeof DIRECAO_SIMPLES!=='undefined'?DIRECAO_SIMPLES[r.id]:0),dv)}">${gestaoSeta(dv)}${r.tipo==='ratio'?Math.abs(dv).toLocaleString('pt-BR',{maximumFractionDigits:1})+' p.p.':valorDRE(Math.abs(dv))}</td>`)(r.tipo==='ratio'?Math.round((v-old)*10)/10:Math.round((v-old)*100)/100):'<td class="num">—</td>'}<td class="num ${tomDoValor(r.id,d.soma[r.id])}">${valorDRE(d.soma[r.id],r.tipo==='ratio')}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">Comparações exigem mesmo escopo; caixa parcial não se compara a mês completo. Ausências permanecem não apuradas. Percentuais e margens preservam o sinal.</p>`;
}
function chavePendencia(reg,p){return 'acao:'+safeId(reg.label)+':'+encodeURIComponent([p.tipo,p.conta,p.texto,p.tituloId,p.pagamentoId].join('|'));}
function painelPendencias(reg){
 const todas=reg?.pendencias||[],tipos=[...new Set(todas.map(p=>p.tipo||'Sem tipo'))];
 const rows=todas.filter(p=>(gestaoUI.pendTipo==='todos'||(p.tipo||'Sem tipo')===gestaoUI.pendTipo)&&normalizarBusca([p.texto,p.conta,p.tipo].join(' ')).includes(normalizarBusca(gestaoUI.pendBusca)));
 const pagina=Math.min(gestaoUI.pendPagina,Math.max(0,Math.ceil(rows.length/20)-1));
 return card('Fila de conferência',`<div class="filterbar"><input id="pendBusca" aria-label="Buscar pendência" placeholder="Texto ou conta" value="${esc(gestaoUI.pendBusca)}"><select id="pendTipo" aria-label="Tipo de pendência"><option value="todos">Todos os tipos</option>${tipos.map(t=>`<option ${gestaoUI.pendTipo===t?'selected':''}>${esc(t)}</option>`).join('')}</select><button id="novaAcao">+ Ação de revisão</button></div><p class="hint">${rows.length} pendência(s) a conferir. A mesma movimentação pode aparecer em mais de um alerta; os valores não são somados como perda. Resolver uma ação não reclassifica o ERP.</p>${rows.slice(pagina*20,pagina*20+20).map(p=>{const key=chavePendencia(reg,p),v=state.cfg.gestao?.[key];return `<div class="review-row"><div><b>${esc(p.texto||p.tipo)}</b><small>${esc(p.conta||'')} · ${esc(v?.situacao||'A conferir')}${v?.responsavel?' · '+esc(v.responsavel):''}${v?.prazo?' · '+esc(v.prazo):''}</small></div><b class="${typeof planoTom==='function'?planoTom(String(p.conta||''),p.valor):''}">${money(p.valor)}</b><button data-pend-key="${esc(key)}" data-pend-title="${esc(p.texto||p.tipo)}">Revisar</button></div>`;}).join('')||'<p>Nenhuma pendência a conferir neste filtro. Isso não comprova conciliação.</p>'}<div class="management-chips"><button data-pend-page="${pagina-1}" ${pagina===0?'disabled':''}>Anterior</button><span>${pagina+1} / ${Math.max(1,Math.ceil(rows.length/20))}</span><button data-pend-page="${pagina+1}" ${(pagina+1)*20>=rows.length?'disabled':''}>Próxima</button></div><details><summary>Ações e decisões registradas</summary>${Object.entries(state.cfg.gestao||{}).filter(([k])=>k.startsWith('acao:'+safeId(state.periodo)+':')).map(([k,v])=>`<button class="action-line" data-acao-key="${esc(k)}">${esc(v.titulo)} · ${esc(v.situacao)} · ${esc(v.responsavel||'Sem responsável')} · ${esc(v.prazo||'Sem prazo')}</button>`).join('')||'<p>Nenhuma ação registrada.</p>'}</details>`);
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
 // "Matriz do ano" e "Mês e comparação" são o mesmo Ano do chip (Fase 9.1).
 document.querySelectorAll('[data-dre-visao]').forEach(b=>b.onclick=()=>{if(typeof anoCompetencia==='function'&&anoCompetencia()&&typeof ligarAno==='function'){ligarAno(b.dataset.dreVisao==='ano');return render();}if(b.dataset.dreVisao==='ano'&&typeof selecionarAno==='function')return selecionarAno();if(b.dataset.dreVisao==='mes'&&typeof selecionarPeriodo==='function')return selecionarPeriodo(state.periodo);gestaoUI.dre=b.dataset.dreVisao;render();});
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
// Saldos (v134, decisão do dono): a receber, estoque e ativo em azul; a pagar e passivo em vermelho;
// necessidade de giro e patrimônio pelo sinal. Vencido e provisão são risco: vermelho.
const saldoTom=(lado,v)=>{const n=Number(v);if(v==null||!Number.isFinite(n)||n===0)return '';return (lado==='pagar'?-n:n)>0?'tom-entra':'tom-sai';};
const saldoCls=(lado,v)=>{const t=saldoTom(lado,v);return t?' '+t:'';};
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
 const cards=`<div class="cards cards-controle">${recCartao('A receber',money(t.aberto),`${t.titulos} título${t.titulos===1?'':'s'} de ${t.clientes} cliente${t.clientes===1?'':'s'}: vencidos e a vencer em até 90 dias`,saldoTom('receber',t.aberto))}${recCartao('Vencido',money(t.vencido),`${recPct(t.vencido,t.aberto)} do que há a receber · ${t.vencidos} título${t.vencidos===1?'':'s'}`,t.vencido>0?'tom-sai':'')}${pdd.valor!=null?recCartao('Provisão estimada (PDD)',money(pdd.valor),`Estimativa: ${pdd.pct.toLocaleString('pt-BR')}% de ${pdd.mes} (Parâmetros) sobre ${money(pdd.base)} vencidos há mais de 90 dias; não entra no caixa nem na DRE`,pdd.valor>0?'tom-sai':''):recCartao('Provisão estimada (PDD)','Não informado',`Falta o % de provisão acima de 90 dias de ${pdd.mes||'o mês da posição'} em Parâmetros; vencido há mais de 90 dias: ${pdd.base==null?'não apurado':money(pdd.base)}`)}${top?recCartao('Maior devedor',money(top.vencido),`${top.nome} · ${recPct(top.vencido,t.vencido)} do vencido · atraso de até ${recDias(top.maiorAtraso)}`,top.vencido>0?'tom-sai':''):recCartao('Maior devedor',money(0),'Nenhum título vencido na posição')}</div>`;
 const antigas=d.antigas?.quantidade?` Vencidos antes de ${recData(d.corte?.data)} (${d.antigas.quantidade} título${d.antigas.quantidade===1?'':'s'}, ${money(d.antigas.valor)}) ficam fora dos números, como na tela Contas Atrasadas do Painel.`:'';
 const linhaPosicao=`<p class="hint rec-posicao">Posição do Painel de ${esc(posicao)} (a carga roda a cada 20 minutos); dias de atraso contados até hoje, como no Painel. Esta tela é uma foto da carteira: não muda com o mês escolhido.${esc(antigas)}</p>`;
 // Avisos do servidor que a tela já diz em outro lugar: a janela de 90 dias (card A receber) e as antigas (linha da posição).
 const jaDito=a=>/^"A vencer" cobre/.test(a)||(!!d.antigas?.quantidade&&a.startsWith(`${d.antigas.quantidade} título(s) vencido(s) antes de`));
 const restantes=(d.avisos||[]).filter(a=>!jaDito(a)),avisos=restantes.length?`<ul class="param-avisos rec-avisos">${restantes.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`:'';
 const semPdd=pdd.valor==null?`<section class="estado-vazio rec-sem-pdd"><div><h2>Falta a política de provisão</h2><p>${esc(perm.admin?`Informe em Parâmetros o % de provisão para vencidos há mais de 90 dias de ${pdd.mes||'o mês da posição'}; a provisão estimada sai daí.`:`Peça a um administrador para informar em Parâmetros o % de provisão para vencidos há mais de 90 dias de ${pdd.mes||'o mês da posição'}.`)}</p></div><button type="button" ${irParam}>${perm.admin?'Informar em Parâmetros':'Ver Parâmetros'}</button></section>`:'';
 const g1=recPainel('Quanto do que vou receber já está atrasado?',`O que há a receber (${money(t.aberto)}) por faixa de atraso na data da posição.`,gCemPorCento(d.faixas.map(f=>({rotulo:f.rotulo,valor:f.valor,...(f.id==='avencer'?{cor:'entrada'}:{})})),{titulo:'Recebíveis por faixa de atraso',tons:(f,i)=>i===0?saldoTom('receber',f.valor):f.valor>0?'tom-sai':'',tomTotal:saldoTom('receber',t.aberto)}));
 const demais=d.clientes?.demais?.quantidade?` Os demais ${d.clientes.demais.quantidade} devedores somam ${money(d.clientes.demais.vencido)}.`:'';
 const g2=t.vencidos?recPainel('Quem concentra os atrasos?',`Vencido por cliente, os dez maiores; os cinco primeiros somam ${d.clientes?.top5Pct==null?'—':d.clientes.top5Pct.toLocaleString('pt-BR')+'%'} do vencido.${demais}`,gBarrasOrdenadas((d.clientes?.itens||[]).map(c=>({rotulo:c.nome,valor:c.vencido})),{limite:10,cor:'saida',titulo:'Maiores devedores'}),false)
  :recPainel('Quem concentra os atrasos?','Vencido por cliente, os dez maiores.','<p class="hint rec-sem-vencido">Nenhum título vencido na posição.</p>',false);
 const g3=recPainel('A carteira está envelhecendo?','Idade média dos títulos em aberto (dias desde a emissão, ponderada pelo saldo), gravada pelo Painel uma vez por dia; um ponto por semana.',gLinhaArea(recSemanas(d.prazo?.serie),{titulo:'Idade média da carteira',rotulo:'Dias',cor:'marca',eixo:'Semana',formato:recDias,selecionado:recSemanas(d.prazo?.serie).length-1}),false);
 const parametro=pdd.mes&&typeof paramOperacao==='function'?paramOperacao(pdd.mes)?.prazoRecebimento:null;
 const prazo=`<p class="note rec-prazo">Prazo concedido médio da carteira: <b>${esc(recDias(d.prazo?.concedido?.dias))}</b> (vencimento − emissão, ponderado pelo saldo; ${d.prazo?.concedido?.com??0} de ${d.prazo?.concedido?.total??0} títulos com emissão). Em Parâmetros (${esc(pdd.mes||'mês da posição')}): <b>${esc(parametro==null||parametro===''?'não informado':recDias(Number(parametro)))}</b>. Idade média da carteira: <b>${esc(recDias(d.prazo?.idade?.dias))}</b>, a mesma conta do DSO da tela Contas Atrasadas do Painel. O prazo realizado (pagamento − emissão) ainda não é apurado: a carga do Painel não traz os títulos pagos com a data de emissão.</p>`;
 const faixas=`<div class="table-scroll"><table class="tabela-controle rec-faixas"><caption>Por faixa de atraso · posição de ${esc(recData(d.posicao?.base))}</caption><thead><tr><th scope="col">Faixa</th><th scope="col" class="num">Títulos</th><th scope="col" class="num">Valor</th><th scope="col" class="num">% do que há a receber</th></tr></thead><tbody>${d.faixas.map(f=>`<tr><th scope="row">${esc(f.rotulo)}</th><td class="num">${f.quantidade}</td><td class="num${f.id==='avencer'?saldoCls('receber',f.valor):f.valor>0?' tom-sai':''}">${esc(money(f.valor))}</td><td class="num">${esc(recPct(f.valor,t.aberto))}</td></tr>`).join('')}</tbody></table></div>`;
 const titulos=`<div class="table-scroll"><table class="tabela-controle rec-titulos"><caption>Títulos vencidos, do maior para o menor${d.truncado?` · os ${d.titulosVencidos.length} maiores de ${t.vencidos}`:''}</caption><thead><tr><th scope="col">Cliente</th><th scope="col" class="num">Valor</th><th scope="col" class="num">Dias</th><th scope="col">Vencimento</th><th scope="col">NF</th><th scope="col">O.S.</th></tr></thead><tbody>${d.titulosVencidos.map(x=>`<tr><th scope="row">${esc(x.cliente)}</th><td class="num${x.valor>0?' tom-sai':''}">${esc(money(x.valor))}</td><td class="num">${x.dias}</td><td>${esc(recData(x.vencimento))}</td><td>${esc(x.nf||'—')}</td><td>${esc(x.os||'—')}</td></tr>`).join('')||'<tr><td colspan="6">Nenhum título vencido na posição.</td></tr>'}</tbody></table></div>`;
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
 // Botão que leva a um mês: vai ao mês (sai do Ano, que é de outro recorte).
 document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-rec-mes]');if(b&&b.dataset.recMes){state.periodo=b.dataset.recMes;if(typeof ligarAno==='function')ligarAno(false);}},true);
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
  .finally(()=>{if(seq!==giroUI.seq)return;giroUI.busy=false;giroUI.em=Date.now();if(['giro','balanco','indicadores'].includes(state.view)&&typeof render==='function'){render();giroFocar();}});
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
 const g1=recPainel('A necessidade de giro está crescendo?','A receber menos o a pagar operacional no fim de cada mês, sem o estoque, para os meses serem comparáveis; vencimentos até 60 dias de cada fechamento.',gLinhaArea(h.map(m=>({rotulo:curto(m),valor:m.ncgSemEstoque})),{selecionado:h.length-1,titulo:'Necessidade de giro sem estoque',rotulo:'Sem estoque',cor:'resultado'}),false);
 const g2=recPainel(`Quantos dias o dinheiro fica preso? · ${ult.mes}`,'Estoque mais recebimento, menos pagamento a fornecedores, em dias, nos três meses até o fechamento. O prazo de estoque usa as compras de produção como aproximação do custo.',gCiclo({pme:ult.pme,pmr:ult.pmr,pmpf:ult.pmp}),false);
 const dia=v=>v==null||!Number.isFinite(Number(v))?'—':esc(String(Math.round(Number(v)))),cel=(v,lado='receber')=>`<td class="num${saldoCls(lado,v)}">${v==null?'<span class="muted" title="Não apurado">—</span>':esc(money(v))}</td>`;
 const linhas=h.map(m=>`<tr${m.parcial?' class="giro-parcial"':''}><th scope="row">${esc(m.mes)}${m.parcial?' *':''}</th>${cel(m.receber?.total)}${cel(m.pagar?.operacional,'pagar')}${cel(m.estoque)}${m.ncg!=null?cel(m.ncg):`<td class="num${saldoCls('receber',m.ncgSemEstoque)}">${esc(money(m.ncgSemEstoque))} <small>sem estoque</small></td>`}<td class="num">${dia(m.pmr)}</td><td class="num">${dia(m.pmp)}</td><td class="num">${dia(m.pme)}</td><td class="num">${dia(m.ciclo)}</td><td class="num">${dia(m.fluxos?.receber?.prazoReal)}</td><td class="num">${dia(m.fluxos?.pagar?.prazoReal)}</td></tr>`).join('');
 const tabela=`<div class="table-scroll"><table class="tabela-controle giro-historico"><caption>Prazos e saldos no fim de cada mês · dias de recebimento, pagamento e estoque sobre os três meses até o fechamento</caption><thead><tr><th scope="col">Mês</th><th scope="col" class="num">A receber</th><th scope="col" class="num">A pagar operacional</th><th scope="col" class="num">Estoque</th><th scope="col" class="num">Necessidade de giro</th><th scope="col" class="num">Recebimento (dias)</th><th scope="col" class="num">Pagamento (dias)</th><th scope="col" class="num">Estoque (dias)</th><th scope="col" class="num">Ciclo (dias)</th><th scope="col" class="num">Recebimento real (dias)</th><th scope="col" class="num">Pagamento real (dias)</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
 const cortes=[...new Set(h.map(m=>m.corte).filter(Boolean))],corteAtual=d.historico?.corteAtual,difCorte=corteAtual&&cortes.some(c=>c!==corteAtual)?` O histórico usou o corte de dívida antiga ${cortes.map(recData).join(', ')}; o Painel hoje usa ${recData(corteAtual)}.`:'';
 const parciais=h.filter(m=>m.parcial),avisoParcial=parciais.length?`<div class="param-avisos giro-hist-parcial"><b>Fechamentos parciais (*).</b><ul>${parciais.map(m=>`<li>${esc(m.mes)}: ${esc((m.motivos||[]).join('; '))}.</li>`).join('')}</ul></div>`:'';
 const nota=`<p class="hint giro-historico-nota">${esc(`Histórico remontado em ${recHora(ult.gravadoEm||ult.geradoEm)} com os títulos como estavam no Mubisys nessa data: título cancelado, apagado ou renegociado depois do fechamento não aparece. Prazos de recebimento e de pagamento sobre a carteira inteira; a necessidade de giro, só até 60 dias de cada fechamento, como a de hoje. Prazo real = data do pagamento − emissão, das parcelas pagas no mês.${difCorte}`)}</p>`;
 return `<div class="graficos-controle">${g1}${g2}</div>${nota}${avisoParcial}<details class="card giro-hist-detalhe" ${gestaoCard('Prazos e saldos por mês',false)}><summary>Prazos e saldos por mês · ${h.length} fechamento${h.length===1?'':'s'}</summary><div class="card-body">${tabela}</div></details>`;
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
 const cardNcg=ncg!=null?recCartao('Necessidade de capital de giro',money(ncg),`A receber ${money(R)} + estoque ${money(est.valor)} − a pagar operacional ${money(P)}`,saldoTom('receber',ncg))
  :semEst!=null?recCartao('Necessidade de giro sem estoque',money(semEst),`A receber ${money(R)} − a pagar operacional ${money(P)}; falta o estoque de ${est.mes||'o mês'} em Parâmetros`,saldoTom('receber',semEst))
  :recCartao('Necessidade de capital de giro','Não apurado',r?.disponivel?'Faltam as contas a pagar do Painel.':'Faltam os recebíveis do Painel.');
 const ate=recData(d.horizonte?.ate);
 const cards=`<div class="cards cards-controle">${cardNcg}${recCartao('A receber',R==null?'Não apurado':money(R),r?.disponivel?`Vencidos e a vencer até ${ate} (60 dias da carga, o mesmo horizonte das contas a pagar); vencidos antes de ${recData(r.corte?.data)} ficam fora`:'Recebíveis do Painel indisponíveis',saldoTom('receber',R))}${recCartao('A pagar operacional',P==null?'Não apurado':money(P),p?.disponivel?`Fornecedores (1.xx e 2.xx), impostos e prédio, vencidas e a vencer até ${ate} · ${money(p.totais.vencidoOperacional)} já vencido`:'Contas a pagar do Painel indisponíveis',saldoTom('pagar',P))}${recCartao('Estoque',est.valor==null?'Não informado':money(est.valor),est.valor==null?`Informe o estoque no fim de ${est.mes||'o mês'} em Parâmetros`:`Parâmetros, ${est.mes}`,saldoTom('receber',est.valor))}</div>`;
 const hR=r?.disponivel?recHora(r.posicao?.em):null,hP=p?.disponivel?recHora(p.posicao?.em):null,horas=hR&&hP&&hR!==hP?`a receber de ${hR}, a pagar de ${hP}`:hP||hR;
 const fora=d.horizonte?.receberFora?.quantidade?` ${d.horizonte.receberFora.quantidade} título(s) a receber que vencem depois de ${ate} (${money(d.horizonte.receberFora.valor)}) ficam fora da necessidade de giro e estão na tela Recebíveis.`:'';
 const posicao=`<p class="hint giro-posicao">Posição do Painel: ${esc(horas)} (a carga roda a cada 20 minutos); dias contados até hoje. Esta tela é uma foto: não muda com o mês escolhido.${esc(fora)}</p>`;
 const lista=[...(d.avisos||[]),...(r?.disponivel?[]:(r?.avisos||[]).slice(0,1).map(a=>'A receber: '+a)),...(p?.disponivel?[]:(p?.avisos||[]).slice(0,1).map(a=>'A pagar: '+a))];
 const avisos=lista.length?`<div class="param-avisos giro-avisos">${d.qualidade!=='Apurado'?'<b>Leitura parcial.</b> ':''}<ul>${lista.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></div>`:'';
 const semEstoque=est.valor==null?`<section class="estado-vazio giro-sem-estoque"><div><h2>Falta o estoque</h2><p>${esc(perm.admin?`Informe em Parâmetros o estoque no fim de ${est.mes||'o mês'}; sem ele, a necessidade de capital de giro sai sem o estoque, marcada.`:`Peça a um administrador para informar em Parâmetros o estoque no fim de ${est.mes||'o mês'}.`)}</p></div><button type="button" ${irParam}>${perm.admin?'Informar em Parâmetros':'Ver Parâmetros'}</button></section>`:'';
 const passos=[{rotulo:'A receber',curto:'Receber',valor:R,total:true},...(est.valor!=null?[{rotulo:'Estoque',curto:'Estoque',valor:est.valor}]:[]),{rotulo:'A pagar operacional',curto:'Pagar',valor:P==null?null:-P},{rotulo:est.valor!=null?'Necessidade de giro':'Sem estoque',curto:'NCG',valor:est.valor!=null?ncg:semEst,total:true}];
 const g1=recPainel('Quanto dinheiro fica preso no giro?',est.valor!=null?'O que há a receber, mais o estoque, menos o que se deve a fornecedores, impostos e prédio.':'O que há a receber menos o que se deve a fornecedores, impostos e prédio; o estoque entra quando for informado em Parâmetros.',gCascata(passos,{base:0,titulo:'Necessidade de capital de giro',inicio:'entrada'}));
 const classes=(p?.grupos||[]).filter(g=>g.quantidade);
 const g2=recPainel('O que eu devo, por classe?','Contas a pagar em aberto por classe do centro de custo do Mubisys; sócios, empréstimos e sem classificação não entram na necessidade de giro.',!p?.disponivel?'<p class="hint">Não apurado: faltam as contas a pagar do Painel.</p>':classes.length?gBarrasOrdenadas(classes.map(g=>({rotulo:g.rotulo,valor:g.valor})),{limite:7,cor:'saida',titulo:'A pagar por classe'}):'<p class="hint">Nenhuma conta a pagar em aberto.</p>',false);
 const g3=recPainel('E o que eu devo vence quando?','A pagar operacional por faixa de vencimento na data da posição.',!p?.disponivel?'<p class="hint">Não apurado: faltam as contas a pagar do Painel.</p>':p.totais.operacional>0?gCemPorCento(p.faixas.map(f=>({rotulo:f.rotulo,valor:f.valor})),{titulo:'A pagar operacional por vencimento',tons:f=>saldoTom('pagar',f.valor),tomTotal:saldoTom('pagar',p.totais.operacional)}):'<p class="hint">Nenhuma conta operacional em aberto.</p>',false);
 const prazos=(()=>{const mes=est.mes,op=mes&&typeof paramOperacao==='function'?paramOperacao(mes):null,v=k=>op?.[k]==null||op?.[k]===''?'não informado':recDias(Number(op[k]));
  return `<p class="note giro-prazos">Prazos em Parâmetros (${esc(mes||'mês de hoje')}): recebimento <b>${esc(v('prazoRecebimento'))}</b>, pagamento <b>${esc(v('prazoPagamento'))}</b>. Na carteira a receber de hoje: prazo concedido médio <b>${esc(recDias(r?.prazo?.concedido?.dias))}</b> e idade média <b>${esc(recDias(r?.prazo?.idade?.dias))}</b>. O ciclo financeiro (estoque + recebimento − pagamento, em dias) de cada fechamento está no histórico abaixo.</p>`;})();
 const linhaGrupo=g=>`<tr class="${g.ncg?'':'giro-fora'}"><th scope="row">${esc(g.rotulo)}</th><td>${g.ncg?'Sim':'Não'}</td><td class="num">${g.quantidade}</td><td class="num${saldoCls('pagar',g.vencido)}">${esc(money(g.vencido))}</td><td class="num${saldoCls('pagar',g.aVencer)}">${esc(money(g.aVencer))}</td><td class="num${saldoCls('pagar',g.valor)}">${esc(money(g.valor))}</td></tr>${g.categorias.map(k=>`<tr class="giro-categoria"><td>${esc(k.rotulo)}</td><td></td><td class="num">${k.quantidade}</td><td></td><td></td><td class="num${saldoCls('pagar',k.valor)}">${esc(money(k.valor))}</td></tr>`).join('')}`;
 const extras=p?.disponivel?`${p.antigas?.quantidade?`<tr class="giro-fora"><th scope="row">Vencidas antes de ${esc(recData(p.corte?.data))}</th><td>Não</td><td class="num">${p.antigas.quantidade}</td><td class="num${saldoCls('pagar',p.antigas.valor)}">${esc(money(p.antigas.valor))}</td><td></td><td class="num${saldoCls('pagar',p.antigas.valor)}">${esc(money(p.antigas.valor))}</td></tr>`:''}${p.projetado?.quantidade?`<tr class="giro-fora"><th scope="row">Projetado no Mubisys (ainda não é título)</th><td>Não</td><td class="num">${p.projetado.quantidade}</td><td></td><td></td><td class="num${saldoCls('pagar',p.projetado.valor)}">${esc(money(p.projetado.valor))}</td></tr>${p.projetado.categorias.map(k=>`<tr class="giro-categoria"><td>${esc(k.rotulo)}</td><td></td><td class="num">${k.quantidade}</td><td></td><td></td><td class="num${saldoCls('pagar',k.valor)}">${esc(money(k.valor))}</td></tr>`).join('')}`:''}`:'';
 const tabelaClasses=p?.disponivel?`<div class="table-scroll"><table class="tabela-controle giro-classes"><caption>Contas a pagar em aberto por classe · posição de ${esc(recData(p.posicao?.base))}</caption><thead><tr><th scope="col">Classe e centro de custo</th><th scope="col">Entra na necessidade de giro?</th><th scope="col" class="num">Contas</th><th scope="col" class="num">Vencido</th><th scope="col" class="num">A vencer</th><th scope="col" class="num">Total</th></tr></thead><tbody>${(p.grupos||[]).filter(g=>g.quantidade).map(linhaGrupo).join('')}${extras}</tbody></table></div>`:'';
 const titulos=p?.disponivel?`<div class="table-scroll"><table class="tabela-controle giro-titulos"><caption>Contas a pagar em aberto, da maior para a menor${p.truncado?` · as ${p.titulos.length} maiores de ${p.totais.quantidade}`:''}</caption><thead><tr><th scope="col">Credor</th><th scope="col">Descrição</th><th scope="col">Centro de custo</th><th scope="col">Vencimento</th><th scope="col" class="num">Atraso</th><th scope="col" class="num">Valor</th></tr></thead><tbody>${p.titulos.map(x=>`<tr><th scope="row">${esc(x.fornecedor)}</th><td>${esc(x.descricao||'—')}</td><td>${esc(x.categoria)}</td><td>${esc(recData(x.vencimento))}</td><td class="num">${esc(x.dias>0?recDias(x.dias):x.dias===0?'vence hoje':'vence em '+recDias(-x.dias))}</td><td class="num${saldoCls('pagar',x.valor)}">${esc(money(x.valor))}</td></tr>`).join('')||'<tr><td colspan="6">Nenhuma conta a pagar em aberto.</td></tr>'}</tbody></table></div>`:'';
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

/* ── PREÇO E PONTO DE EQUILÍBRIO · FASE 7 ─────────────────────────────────
   Base caixa, das mesmas linhas da DRE Simples (DRESimples.apurar): vendas,
   Simples pago, ISS e devoluções, custos variáveis, despesas fixas. Vendas
   recebidas e custos pagos podem cair em meses diferentes; por isso tudo usa a
   média dos três últimos meses FECHADOS até o mês escolhido (mês parcial fica
   fora). Margem de contribuição = vendas − impostos sobre vendas − variáveis;
   índice = margem ÷ vendas; ponto de equilíbrio = fixas ÷ índice (sem índice
   positivo, não há ponto de equilíbrio, nunca infinito). O simulador usa o
   markup divisor: preço = custo variável ÷ (1 − impostos − fixas − lucro). */
const precosUI={custo:'',lucro:'',imposto:'observado',fixas:''};
const precoCache=new WeakMap();
// Mês com mais de 10% das saídas sem plano de contas (2.99) não entra: em 2020 e no começo
// de 2021 quase tudo era lançado sem conta, e a margem sairia perto de 100%.
const PRECO_SEM_CONTA_MAX=10;
function precoMes(label){
 const m=typeof dfcMes==='function'?dfcMes(label):null,reg=m?.reg;if(!reg)return {label,dado:null,parcial:false};
 if(!precoCache.has(reg))precoCache.set(reg,typeof DRESimples!=='undefined'?DRESimples.apurar(reg):null);
 const a=precoCache.get(reg);if(!a)return {label,dado:null,parcial:!!m.parcial};
 const l=a.linhas;return {label,parcial:!!m.parcial,emAndamento:!!m.emAndamento,ate:m.ate,semConta:a.pctSemConta!=null&&a.pctSemConta>PRECO_SEM_CONTA_MAX,dado:{vendas:l.vendas,das:l.das,impostosVendas:l.impostosVendas,devolucoes:l.devolucoes,variaveis:l.variaveis,mc:l.margemContribuicao,fixas:l.fixas,resultado:l.ebitda,financeiro:(l.despesasFinanceiras||0)-(l.receitasFinanceiras||0)}};
}
const precoUsavel=m=>!!m.dado&&!m.parcial&&!m.semConta;
const precoMotivo=m=>!m.dado?'sem dados':m.semConta?'sem plano de contas':m.emAndamento?'em andamento':'incompleto';
// Média dos três últimos meses fechados até `label` (olha até 12 meses para trás).
function precoBase(label){
 const meses=[],pulados=[];let cur=label;
 for(let i=0;i<12&&cur&&meses.length<3;i++){const m=precoMes(cur);if(precoUsavel(m))meses.push(m);else pulados.push({label:cur,motivo:precoMotivo(m)});cur=typeof dfcMesDesloca==='function'?dfcMesDesloca(cur,-1):null;}
 // Fora da média e dentro da janela (do mais antigo usado ao escolhido): dito na tela. O mês
 // escolhido em andamento não é lacuna, é o mês que ainda não fechou.
 const ki=meses.length?monthSortKey(meses[meses.length-1].label):Infinity;
 return precoCalcular(meses,pulados.filter(p=>monthSortKey(p.label)>ki&&!(p.label===label&&p.motivo==='em andamento')));
}
// Média de uma lista de meses (o ano no chip Ano; o mesmo período do ano anterior).
function precoBaseLista(labels){
 const meses=[],pulados=[];
 for(const l of [...labels].sort((a,b)=>monthSortKey(b)-monthSortKey(a))){const m=precoMes(l);if(precoUsavel(m))meses.push(m);else if(precoMotivo(m)!=='em andamento')pulados.push({label:l,motivo:precoMotivo(m)});}
 return precoCalcular(meses,pulados);
}
// Chip Ano: de janeiro ao mês escolhido (o último com dados do ano), só os meses fechados.
function precoBaseAno(label){
 const [mm,ano]=String(label).split('/'),ate=PT_MON.indexOf(mm)+1;if(!ate)return null;
 const b=precoBaseLista(PT_MON.slice(0,ate).map(x=>x+'/'+ano));if(b)b.ano=ano;return b;
}
const precoAno=()=>typeof anoAtivo==='function'&&anoAtivo();
const precoBaseTela=label=>precoAno()?precoBaseAno(label):precoBase(label);
// Comparação: os mesmos meses um ano antes (só os que fecharam lá).
function precoComparacao(b){
 if(!b||typeof dfcMesDesloca!=='function')return null;
 const ls=b.meses.map(l=>dfcMesDesloca(l,-12)).filter(Boolean);return ls.length?precoBaseLista(ls):null;
}
function precoCalcular(meses,pulados){
 if(!meses.length)return null;
 const n=meses.length,soma=k=>meses.reduce((t,m)=>t+Math.round((Number(m.dado[k])||0)*100),0),med=k=>Math.round(soma(k)/n)/100;
 const b={meses:meses.map(m=>m.label).reverse(),n,lacunas:[...pulados].sort((a,c)=>monthSortKey(a.label)-monthSortKey(c.label)),vendas:med('vendas'),das:med('das'),impostosVendas:med('impostosVendas'),devolucoes:med('devolucoes'),variaveis:med('variaveis'),mc:med('mc'),fixas:med('fixas'),resultado:med('resultado'),financeiro:med('financeiro')};
 // Índices e equilíbrio pelas somas em centavos (arredondar as médias antes desviaria um centavo).
 const sv=soma('vendas'),pct=k=>sv>0?Math.round(soma(k)/sv*10000)/100:null;
 b.indice=sv>0?soma('mc')/sv:null;
 b.pe=b.indice>0?Math.round(soma('fixas')/n/b.indice)/100:null;
 b.pct={das:pct('das'),iss:pct('impostosVendas'),dev:pct('devolucoes'),variaveis:pct('variaveis'),mc:pct('mc'),fixas:pct('fixas')};
 return b;
}
const precoPct=v=>v==null||!Number.isFinite(v)?'—':v.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
/* Avaliação (Fase 12.2): cada cartão diz se o número está ruim, bom ou excelente, por faixas
   de referência de comunicação visual no Simples, escritas aqui e explicadas na tela e no
   Glossário. Margem de contribuição: material, terceiros e Simples consomem o resto de cada
   venda. Ponto de equilíbrio e distância usam a sazonalidade da casa: o mês mais fraco do ano
   (fevereiro) vende cerca de 70% do mês médio, então com o equilíbrio acima de 70% das vendas
   os meses fracos ficam no prejuízo. A distância é o espelho do equilíbrio (100% − equilíbrio).
   min e max só desenham a régua. */
const PRECO_FAIXAS={
 mc:{maior:true,excelente:55,boa:45,min:30,max:70,nome:'Margem de contribuição',
  // Os níveis seguem a referência do setor que o Léo trouxe (12/10): apagar incêndio, produção controlada, governança e valor agregado.
  texto:{excelente:'mais de 55% de cada venda sobra para a estrutura e o lucro: nível de quem vende projeto de valor, com fluxo roteirizado e material bem aproveitado',boa:'sobra de 45% a 55% de cada venda: produção controlada (arquivo conferido antes da máquina, manutenção em dia); preço e aproveitamento de material ainda podem subir',ruim:'menos de 45% sobra de cada venda: sinal de produção apagando incêndio (improviso, retalho alto) ou de briga pelo preço do metro quadrado'}},
 pe:{maior:false,excelente:50,boa:70,min:20,max:110,nome:'Ponto de equilíbrio',
  texto:{excelente:'a estrutura se paga com até metade das vendas de um mês médio',boa:'a estrutura pede de 50% a 70% das vendas: os meses fracos ficam perto do limite',ruim:'a estrutura pede mais de 70% das vendas: os meses fracos do ano dão prejuízo'}},
 seguranca:{maior:true,excelente:50,boa:30,min:-20,max:80,nome:'Distância do equilíbrio',
  texto:{excelente:'as vendas podem cair mais da metade antes de dar prejuízo',boa:'as vendas podem cair de 30% a 50% antes de dar prejuízo',ruim:'uma queda de menos de 30% nas vendas já dá prejuízo'}},
 fixas:{maior:false,excelente:25,boa:35,min:10,max:50,nome:'Despesas fixas',
  texto:{excelente:'estrutura leve: até 25% das vendas',boa:'de 25% a 35% das vendas; atenção à folha crescendo mais que as vendas',ruim:'mais de 35% das vendas vão para a estrutura fixa'}},
};
const PRECO_NIVEL={excelente:'Excelente',boa:'Boa',ruim:'Ruim'};
function precoAvaliar(chave,v){
 const f=PRECO_FAIXAS[chave];if(!f||v==null||!Number.isFinite(v))return null;
 v=Math.round(v*10)/10; // avalia o número como a tela mostra (uma casa): 54,96% aparece e vale 55%
 const nivel=f.maior?(v>=f.excelente?'excelente':v>=f.boa?'boa':'ruim'):(v<=f.excelente?'excelente':v<=f.boa?'boa':'ruim');
 const texto=chave==='seguranca'&&v<0?'as vendas ficaram abaixo do equilíbrio: deram prejuízo':chave==='pe'&&v>100?'nem as vendas médias pagam a estrutura: o mês médio dá prejuízo':f.texto[nivel];
 return {nivel,rotulo:PRECO_NIVEL[nivel],texto};
}
const precoFaixasTexto=chave=>{const f=PRECO_FAIXAS[chave],u=v=>precoPct(v);return f.maior?`excelente a partir de ${u(f.excelente)}, boa de ${u(f.boa)} a ${u(f.excelente)}, ruim abaixo de ${u(f.boa)}`:`excelente até ${u(f.excelente)}, boa até ${u(f.boa)}, ruim acima de ${u(f.boa)}`;};
// Régua com as três faixas, o valor de agora (traço cheio) e o do ano anterior (traço vazado).
function precoAvalHtml(chave,v,ant,rotuloAnt){
 const f=PRECO_FAIXAS[chave],a=precoAvaliar(chave,v);if(!a)return '';
 const pos=x=>Math.min(100,Math.max(0,(x-f.min)/(f.max-f.min)*100)),c1=pos(f.maior?f.boa:f.excelente),c2=pos(f.maior?f.excelente:f.boa);
 const ordem=f.maior?['ruim','boa','excelente']:['excelente','boa','ruim'],larg=[c1,c2-c1,100-c2];
 const temAnt=ant!=null&&Number.isFinite(ant),aAnt=temAnt?precoAvaliar(chave,ant):null;
 const leitura=`${f.nome} ${precoPct(v)}: ${a.rotulo.toLowerCase()}. Faixas: ${precoFaixasTexto(chave)}.${temAnt?` ${rotuloAnt}: ${precoPct(ant)} (${aAnt.rotulo.toLowerCase()}).`:''}`;
 return `<div class="aval"><span class="aval-selo aval-${a.nivel}">${esc(a.rotulo)}</span><span class="aval-texto">${esc(a.texto)}.</span>`
  +`<div class="aval-regua" role="img" aria-label="${esc(leitura)}" title="${esc(leitura)}">${ordem.map((n,i)=>`<span class="aval-faixa aval-f-${n}" style="width:${larg[i].toFixed(2)}%"></span>`).join('')}`
  +`${temAnt?`<i class="aval-marca-ant" style="left:${pos(ant).toFixed(2)}%"></i>`:''}<i class="aval-marca" style="left:${pos(v).toFixed(2)}%"></i></div>`
  +`<span class="aval-legenda">${esc(precoFaixasTexto(chave))}${temAnt?` · traço vazado: ${esc(rotuloAnt)}`:''}</span></div>`;
}
// Comparação dentro do cartão: o valor de antes e a diferença; azul quando melhorou, vermelho quando piorou.
function precoCompHtml(rotuloAnt,valorAnt,dif,melhorou,unidade,semTxt){
 if(valorAnt==null)return `<span class="aval-comp">${esc(rotuloAnt)}: ${esc(semTxt||'sem os mesmos meses completos')}</span>`;
 const d=dif==null||!Number.isFinite(dif)||Math.abs(dif)<.05?'':` (${dif>0?'+':'−'}${Math.abs(dif).toLocaleString('pt-BR',{maximumFractionDigits:1})}${unidade})`;
 return `<span class="aval-comp">${esc(rotuloAnt)}: ${esc(valorAnt)}${d?`<b class="${melhorou==null?'':melhorou?'tom-entra':'tom-sai'}">${esc(d)}</b>`:''}</span>`;
}
// Imposto do simulador: o observado (Simples pago ÷ vendas) ou a alíquota do PGDAS de cada empresa.
function precoImpostos(b,label){
 const ops=[{id:'observado',rotulo:`${precoAno()?'Observado no ano':'Observado nos últimos meses'}: ${precoPct(b?.pct?.das)}`,valor:b?.pct?.das??null}];
 if(typeof PARAM_EMPRESAS!=='undefined'&&typeof paramAliquota==='function')for(const e of PARAM_EMPRESAS){const a=paramAliquota(e.id,label);ops.push({id:e.id,rotulo:`${e.nome} (PGDAS ${a.origem==='padrao'?'— padrão provisório':'de '+label}): ${precoPct(a.valor)}`,valor:a.valor});}
 return ops;
}
function precoSimular(b,label){
 const num=v=>{const x=typeof paramNumeroBR==='function'?paramNumeroBR(v):Number(String(v).replace(',','.'));return x==null||!Number.isFinite(x)?null:x;};
 const custo=num(precosUI.custo),lucro=num(precosUI.lucro),fixas=precosUI.fixas===''?b?.pct?.fixas??null:num(precosUI.fixas);
 const imp=precoImpostos(b,label).find(o=>o.id===precosUI.imposto)??precoImpostos(b,label)[0],iss=b?.pct?.iss??0;
 if(custo==null||custo<=0)return {texto:'Informe o custo variável de uma unidade (material, tinta, terceiros) para ver o preço.'};
 if(lucro==null)return {texto:'Informe o lucro desejado, em % do preço.'};
 if(precosUI.fixas!==''&&fixas==null)return {texto:'Informe as despesas fixas em % do preço (ex.: 20 ou 20,5), ou deixe vazio para usar o peso de hoje.'};
 if(imp.valor==null||fixas==null)return {texto:'Faltam os meses completos para o imposto observado ou o peso das despesas fixas.'};
 const tot=imp.valor+iss+fixas+lucro;
 if(tot>=100)return {texto:`Não fecha: impostos (${precoPct(imp.valor+iss)}), despesas fixas (${precoPct(fixas)}) e lucro (${precoPct(lucro)}) somam ${precoPct(tot)} do preço. Abaixo de 100% é que existe preço.`};
 const preco=Math.round(custo/(1-tot/100)*100)/100;
 return {preco,markup:Math.round(preco/custo*100)/100,texto:`Preço de ${money(preco)} (markup ${(preco/custo).toLocaleString('pt-BR',{maximumFractionDigits:2})}): custo ${money(custo)}, impostos ${precoPct(imp.valor+iss)}, despesas fixas ${precoPct(fixas)} e lucro ${precoPct(lucro)} do preço.`};
}
function precoSimuladorHtml(b,label){
 const ops=precoImpostos(b,label),r=precoSimular(b,label);
 return `<form class="param-form precos-sim" data-precos-sim novalidate><div class="precos-sim-campos"><label>Custo variável de uma unidade (R$)<small>Material, tinta, terceiros e frete do trabalho</small><input name="custo" type="text" inputmode="decimal" autocomplete="off" value="${esc(precosUI.custo)}"></label><label>Imposto sobre a venda<small>O ISS fora do DAS observado (${precoPct(b?.pct?.iss)}) entra junto</small><select name="imposto">${ops.map(o=>`<option value="${esc(o.id)}"${o.id===precosUI.imposto?' selected':''}>${esc(o.rotulo)}</option>`).join('')}</select></label><label>Despesas fixas (% do preço)<small>Vazio: o peso de hoje, ${precoPct(b?.pct?.fixas)} das vendas</small><input name="fixas" type="text" inputmode="decimal" autocomplete="off" value="${esc(precosUI.fixas)}" placeholder="${esc(b?.pct?.fixas==null?'':String(b.pct.fixas).replace('.',','))}"></label><label>Lucro desejado (% do preço)<input name="lucro" type="text" inputmode="decimal" autocomplete="off" value="${esc(precosUI.lucro)}"></label></div><p class="note precos-sim-resultado" role="status" aria-live="polite">${r.preco!=null?`<b>${esc(money(r.preco))}</b> · `:''}${esc(r.texto)}</p></form>`;
}
function renderPrecos(){
 const label=state.periodo;if(!label||!F.periodo(label))return '<p class="hint">Escolha um mês para ver o preço e o ponto de equilíbrio.</p>';
 const modoAno=precoAno(),b=precoBaseTela(label),m=precoMes(label),ano=label.split('/')[1],perm={admin:!!state.permissoes?.admin};
 if(!b){
  // Meses coletados, mas quase tudo lançado sem plano de contas (2020, começo de 2021): não manda coletar.
  const janela=modoAno?PT_MON.slice(0,PT_MON.indexOf(label.split('/')[0])+1).map(x=>x+'/'+ano):Array.from({length:12},(_,i)=>typeof dfcMesDesloca==='function'?dfcMesDesloca(label,-i):null).filter(Boolean);
  const semPlano=janela.map(precoMes).some(x=>x.dado&&!x.parcial&&x.semConta);
  const motivo=semPlano?`Os meses ${modoAno?`de ${ano}`:`até ${label}`} foram coletados, mas mais de ${PRECO_SEM_CONTA_MAX}% das saídas estão sem plano de contas no Mubisys: margem e equilíbrio sairiam errados.`:'Faltam meses completos com vendas na DRE de caixa.';
  return `<div class="cards cards-controle">${['Margem de contribuição','Ponto de equilíbrio','Distância do equilíbrio','Despesas fixas por mês (média)'].map(t=>recCartao(t,'Não apurado',motivo)).join('')}</div><section class="estado-vazio precos-sem-dados"><div><h2>${semPlano?`Meses sem plano de contas ${modoAno?`em ${esc(ano)}`:`até ${esc(label)}`}`:modoAno?`Sem meses completos em ${esc(ano)}`:`Sem meses completos até ${esc(label)}`}</h2><p>${semPlano?'Escolha um mês a partir de junho de 2021, quando as saídas passaram a ter plano de contas.':`${modoAno?'No Ano, o cálculo usa a média dos meses completos do ano':'O cálculo usa a média dos três últimos meses completos'} da DRE de caixa, com plano de contas. Colete os meses no Mubisys ou importe a planilha.`}</p></div></section>`;
 }
 // Meses seguidos: "de Jul a Set"; com lacuna, a lista dos usados e o que ficou fora.
 const lista=xs=>xs.length>1?xs.slice(0,-1).join(', ')+' e '+xs[xs.length-1]:xs[0];
 const usados=precoFaixasDeMeses(b.meses.map(l=>({label:l}))),txtUsados=usados.length===1?precoFaixaTxt(usados[0]):lista(b.meses);
 const periodo=b.lacunas.length?`${txtUsados} (${lista(precoFaixasDeMeses(b.lacunas).map(f=>`${precoFaixaTxt(f)} ${f.motivo}`))} ${b.lacunas.length>1?'ficaram':'ficou'} de fora)`:txtUsados;
 const media=modoAno?`média de ${periodo} (${b.n} ${b.n===1?'mês completo':'meses completos'} de ${ano})`:`média de ${periodo}${b.n<3?` (só ${b.n} ${b.n===1?'mês completo':'meses completos'})`:''}`;
 // No Ano, a distância é a das vendas médias do ano; no mês, a das vendas do mês escolhido.
 const vendasDist=modoAno?b.vendas:m.dado&&!m.parcial?m.dado.vendas:null,dist=vendasDist!=null&&b.pe!=null?Math.round((vendasDist-b.pe)*100)/100:null;
 // O mesmo período um ano antes, para cada cartão (e a distância do mesmo mês, no modo mês).
 // Ano da comparação pelo último mês da base: em janeiro, a base Nov a Jan compara com Nov a Jan de um ano antes.
 const anoFim=Number(b.meses[b.meses.length-1].split('/')[1]),cruza=b.meses[0].split('/')[1]!==b.meses[b.meses.length-1].split('/')[1];
 const bc0=precoComparacao(b);
 // Comparar só os mesmos meses: se lá fecharam menos, o lado de hoje também usa só esses.
 const bcMes=bc0?new Set(bc0.meses):null,bh=bc0&&bc0.n<b.n?precoBaseLista(b.meses.filter(l=>bcMes.has(dfcMesDesloca(l,-12)))):b,bc=bh?bc0:null;
 const rotAnt=`${modoAno?'Mesmos meses de':'Mesmo período de'} ${cruza&&bc?`${bc.meses[0]} a ${bc.meses[bc.meses.length-1]}`:anoFim-1}${bc&&bc.n<b.n?` (só ${bc.n} de ${b.n} meses, comparados com os mesmos meses de hoje)`:''}`;
 const mAnt=!modoAno&&typeof dfcMesDesloca==='function'?precoMes(dfcMesDesloca(label,-12)):null,bAnt=mAnt&&precoUsavel(mAnt)?precoBase(mAnt.label):null;
 const distAnt=modoAno?(bc&&bc.pe!=null?bc.vendas-bc.pe:null):(bAnt&&bAnt.pe!=null?mAnt.dado.vendas-bAnt.pe:null),vendasAnt=modoAno?bc?.vendas:mAnt?.dado?.vendas;
 const semEq='sem ponto de equilíbrio (margem de contribuição não positiva)',semDistAnt=modoAno?(bc?semEq:null):!mAnt?.dado?'sem dados':!precoUsavel(mAnt)?precoMotivo(mAnt):bAnt&&bAnt.pe==null?semEq:null;
 const segPct=(d,v)=>d!=null&&v>0?d/v*100:null,pePct=x=>x&&x.pe!=null&&x.vendas>0?x.pe/x.vendas*100:null;
 const seg=segPct(dist,vendasDist),segAnt=segPct(distAnt,vendasAnt);
 const rotDistAnt=modoAno?rotAnt:mAnt?`${mAnt.label}`:rotAnt;
 // A meta de Parâmetros é o resultado do mês (depois de juros e tarifas): o financeiro líquido médio entra na conta.
 const meta=typeof paramOperacao==='function'?paramOperacao(label)?.metaResultado:null,metaN=meta==null||meta===''||!Number.isFinite(Number(meta))?null:Number(meta),paraMeta=metaN!=null&&b.pe!=null?Math.round((b.pe+(b.financeiro+metaN)/b.indice)*100)/100:null;
 const semDist=modoAno||(m.dado&&!m.parcial)?'Sem ponto de equilíbrio: a margem de contribuição não é positiva, então não há distância.':!m.dado?`${label} ainda não foi coletado: colete no Mubisys ou importe a planilha do mês.`:m.parcial?(m.emAndamento?`${label} ainda está em andamento: a distância sai quando o mês terminar.`:`${label} tem dados só até ${(m.ate||'').split('-').reverse().slice(0,2).join('/')||'uma data não registrada'}: atualize o Mubisys ou importe a planilha completa para ver a distância.`):'Sem ponto de equilíbrio: a margem de contribuição não é positiva, então não há distância.';
 const extra=(html,bloco)=>html.replace(/<\/div>$/,bloco+'</div>');
 const pp=(a,b2)=>a!=null&&b2!=null?a-b2:null,pr=(a,b2)=>a!=null&&b2>0?(a/b2-1)*100:null;
 const cMc=extra(recCartao('Margem de contribuição',precoPct(b.pct.mc),`${money(b.mc)} por mês sobre ${money(b.vendas)} de vendas, ${media}`,b.mc>0?'tom-entra':b.mc<0?'tom-sai':''),
  precoAvalHtml('mc',b.pct.mc,bc?.pct?.mc,rotAnt)+precoCompHtml(rotAnt,bc?precoPct(bc.pct.mc):null,pp(bh?.pct?.mc,bc?.pct?.mc),pp(bh?.pct?.mc,bc?.pct?.mc)>0,' p.p.'));
 const cPe=extra(recCartao('Ponto de equilíbrio',b.pe==null?'Sem equilíbrio':money(b.pe),b.pe==null?'A margem de contribuição não é positiva: nenhum volume de vendas cobre as despesas fixas.':`Vendas por mês que pagam ${money(b.fixas)} de despesas fixas com ${precoPct(b.pct.mc)} de margem`),
  b.pe==null?'':`<span class="aval-comp">${esc(precoPct(pePct(b)))} das vendas médias (${esc(money(b.vendas))} por mês)</span>`+precoAvalHtml('pe',pePct(b),pePct(bc),rotAnt)+precoCompHtml(rotAnt,bc&&bc.pe!=null?`${money(bc.pe)} (${precoPct(pePct(bc))} das vendas)`:null,pp(pePct(bh),pePct(bc)),pp(pePct(bh),pePct(bc))<0,' p.p. nas vendas',bc&&bc.pe==null?semEq:null));
 const cDist=dist!=null?extra(recCartao('Distância do equilíbrio',money(dist),modoAno?`Vendas por mês (${money(b.vendas)}, ${media}) ${dist>=0?'acima':'abaixo'} do ponto de equilíbrio`:`Vendas de ${label} (${money(m.dado.vendas)}) ${dist>=0?'acima':'abaixo'} do ponto de equilíbrio`,dist>0?'tom-entra':dist<0?'tom-sai':''),
  `<span class="aval-comp">Margem de segurança: ${esc(precoPct(seg))} das vendas${modoAno?'':' do mês'}</span>`+precoAvalHtml('seguranca',seg,segAnt,rotDistAnt)+precoCompHtml(rotDistAnt,distAnt!=null?`${money(distAnt)} (${precoPct(segAnt)})`:null,pp(modoAno?segPct(bh.pe!=null?bh.vendas-bh.pe:null,bh.vendas):seg,segAnt),pp(modoAno?segPct(bh.pe!=null?bh.vendas-bh.pe:null,bh.vendas):seg,segAnt)>0,' p.p.',semDistAnt))
  :recCartao('Distância do equilíbrio','Não apurado',semDist);
 const cFix=extra(recCartao(modoAno?'Despesas fixas por mês (média do ano)':'Despesas fixas por mês (média)',money(b.fixas),`${precoPct(b.pct.fixas)} das vendas, ${media}`,b.fixas>0?'tom-sai':''),
  precoAvalHtml('fixas',b.pct.fixas,bc?.pct?.fixas,rotAnt)+precoCompHtml(rotAnt,bc?`${money(bc.fixas)} (${precoPct(bc.pct.fixas)} das vendas)`:null,pp(bh?.pct?.fixas,bc?.pct?.fixas),pp(bh?.pct?.fixas,bc?.pct?.fixas)<0,' p.p. nas vendas'));
 const cards=`<div class="cards cards-controle precos-cards">${cMc}${cPe}${cDist}${cFix}</div>`;
 const nota=`<p class="hint precos-base">Base caixa: vendas recebidas e custos pagos, das linhas da DRE Simples, na ${esc(media)}. ${!modoAno&&b.n<3?'Com menos de três meses completos, a média oscila mais. ':''}Mês com mais de ${PRECO_SEM_CONTA_MAX}% das saídas sem plano de contas fica de fora. As faixas de excelente, boa e ruim são de referência para comunicação visual no Simples; o Glossário explica cada uma. O Simples entra pelo que foi pago (alíquota observada de ${esc(precoPct(b.pct.das))}); a alíquota do PGDAS de cada empresa fica no simulador.${paraMeta!=null?(paraMeta>0?` Para a meta de resultado do mês de ${esc(money(metaN))} em ${esc(label)} (Parâmetros; depois de juros e tarifas), as vendas precisam chegar a ${esc(money(paraMeta))} por mês.`:` A meta de resultado do mês de ${esc(money(metaN))} em ${esc(label)} (Parâmetros) é atingida com qualquer venda.`):''}</p>`;
 const anoMeses=PT_MON.map(x=>x+'/'+ano),serie=anoMeses.map(l=>{const pm=precoMes(l),pb=pm.dado?precoBase(l):null;return {l,pm,pe:pb?.pe??null};}),sel=modoAno?-1:anoMeses.findIndex(l=>monthSortKey(l)===monthSortKey(label));
 const g1=recPainel('Quanto falta vender para empatar?','Vendas recebidas por mês e o ponto de equilíbrio de cada mês (média dos três meses completos até ele). Mês parcial (*) fica hachurado.',gEmpilhadas(serie.map(x=>({rotulo:x.l.slice(0,3)+(x.pm.parcial&&x.pm.dado?'*':''),valores:x.pm.dado&&!x.pm.parcial?{vendas:x.pm.dado.vendas}:{},linha:x.pe})),{series:[{chave:'vendas',rotulo:'Vendas recebidas',sentido:'entradas'}],linha:{rotulo:'Ponto de equilíbrio'},selecionado:sel,titulo:'Vendas e ponto de equilíbrio'}));
 const g2=recPainel('Para onde vai cada real vendido?',`Da venda ao resultado operacional, ${media}; cada degrau em % das vendas.`,gCascata([{rotulo:'Vendas',curto:'Vendas',valor:b.vendas,total:true},{rotulo:'Simples pago',curto:'Simples',valor:-b.das},{rotulo:'ISS e devoluções',curto:'ISS/dev.',valor:-(b.impostosVendas+b.devolucoes)},{rotulo:'Custos variáveis',curto:'Variáveis',valor:-b.variaveis},{rotulo:'Margem de contribuição',curto:'Margem',valor:b.mc,total:true},{rotulo:'Despesas fixas',curto:'Fixas',valor:-b.fixas},{rotulo:'Resultado operacional',curto:'Resultado',valor:b.resultado,total:true}],{base:b.vendas,titulo:'Da venda ao resultado',inicio:'entrada'}),false);
 const g3=recPainel('Qual preço sustenta a margem?','Markup divisor: o preço que paga o custo variável, os impostos, a parte das despesas fixas e o lucro desejado.',precoSimuladorHtml(b,label),false);
 const cel=(v,tom='')=>`<td class="num${v!=null&&tom?' '+tom:''}">${v==null?'<span class="muted" title="Não apurado">—</span>':esc(money(v))}</td>`;
 const linhas=serie.map(x=>{const d=x.pm.dado,dm=d&&!x.pm.parcial&&x.pe!=null?Math.round((d.vendas-x.pe)*100)/100:null,t=(id,v)=>x.pm.parcial?'':tomDoValor(id,v),imp=d?d.das+d.impostosVendas+d.devolucoes:null;return `<tr${!modoAno&&monthSortKey(x.l)===monthSortKey(label)?' class="selected-month"':''}><th scope="row">${esc(x.l)}${x.pm.parcial&&d?' *':''}</th>${cel(d?.vendas,t('entradas',d?.vendas))}${cel(imp,t('saidas',imp))}${cel(d?.variaveis,t('saidas',d?.variaveis))}${cel(d?.mc,t('variacao',d?.mc))}<td class="num">${d&&d.vendas>0?esc(precoPct(Math.round(d.mc/d.vendas*10000)/100)):'—'}</td>${cel(d?.fixas,t('saidas',d?.fixas))}${cel(x.pe)}<td class="num ${x.pm.parcial||dm==null?'':dm>0?'tom-entra':dm<0?'tom-sai':''}">${dm==null?'<span class="muted" title="Não apurado">—</span>':esc(money(dm))}</td></tr>`;}).join('');
 const tabela=`<details class="card precos-mensal" ${gestaoCard('Margem e equilíbrio mês a mês',false)}><summary>Margem e equilíbrio mês a mês · ${esc(ano)}</summary><div class="card-body"><div class="table-scroll"><table class="tabela-controle precos-tabela"><caption>Base caixa · ponto de equilíbrio pela média dos três meses completos até cada mês · * = mês em andamento ou incompleto</caption><thead><tr><th scope="col">Mês</th><th scope="col" class="num">Vendas</th><th scope="col" class="num">Impostos e devoluções</th><th scope="col" class="num">Custos variáveis</th><th scope="col" class="num">Margem de contribuição</th><th scope="col" class="num">Margem %</th><th scope="col" class="num">Despesas fixas</th><th scope="col" class="num">Ponto de equilíbrio</th><th scope="col" class="num">Distância</th></tr></thead><tbody>${linhas}</tbody></table></div></div></details>`;
 return cards+nota+'<div class="actions"><button type="button" data-precos-csv>Baixar planilha (CSV)</button></div>'+precoComparativoHtml(b,modoAno)+`<div class="graficos-controle">${g1}${g2}${g3}</div>`+tabela;
}
// Meses seguidos com o mesmo motivo viram faixa: "Jan/2026 a Mai/2026 sem dados".
function precoFaixasDeMeses(itens){
 const g=[];for(const x of [...itens].sort((a,c)=>monthSortKey(a.label)-monthSortKey(c.label))){const k=monthSortKey(x.label),u=g[g.length-1];if(u&&u.motivo===x.motivo&&k===u.k+1){u.fim=x.label;u.k=k;u.n++;}else g.push({ini:x.label,fim:x.label,k,motivo:x.motivo,n:1});}
 return g;
}
const precoFaixaTxt=f=>f.ini===f.fim?f.ini:`${f.ini} a ${f.fim}`;
// Comparativo ano a ano: os mesmos meses da base em cada ano, do mais antigo com plano de contas
// até o escolhido, com a avaliação de cada número.
function precoAnos(b){
 if(!b||typeof dfcMesDesloca!=='function')return [];
 const anoFim=Number(b.meses[b.meses.length-1].split('/')[1]);
 const out=[];for(let k=0;k<10;k++){const ls=b.meses.map(l=>dfcMesDesloca(l,-12*k)).filter(Boolean);if(!ls.length)break;const x=k?precoBaseLista(ls):b;if(!x){if(k>1&&!out.length)break;continue;}out.unshift({ano:anoFim-k,b:x,pe:x.pe!=null&&x.vendas>0?x.pe/x.vendas*100:null,seg:x.pe!=null&&x.vendas>0?(x.vendas-x.pe)/x.vendas*100:null});}
 return out;
}
function precoComparativoHtml(b,modoAno){
 const anos=precoAnos(b);if(anos.length<2)return '';
 const ms=b.meses.map(l=>l.split('/')[0]),seguidos=precoFaixasDeMeses(b.meses.map(l=>({label:l}))).length===1,mesesTxt=ms.length===1?ms[0]:seguidos?`${ms[0]} a ${ms[ms.length-1]}`:ms.slice(0,-1).join(', ')+' e '+ms[ms.length-1];
 const selo=(chave,v)=>{const a=precoAvaliar(chave,v);return a?` <span class="aval-selo aval-${a.nivel}">${esc(a.rotulo)}</span>`:'';};
 const cel=(chave,v)=>`<td class="num">${v==null?'<span class="muted" title="Não apurado">—</span>':esc(precoPct(Math.round(v*10)/10))+selo(chave,v)}</td>`;
 const linhas=anos.map((x,i)=>`<tr${i===anos.length-1?' class="selected-month"':''}><th scope="row">${x.ano}${x.b.n<b.n?` <small>(${x.b.n} ${x.b.n===1?'mês':'meses'})</small>`:''}</th><td class="num">${esc(money(x.b.vendas))}</td>${cel('mc',x.b.pct.mc)}${cel('fixas',x.b.pct.fixas)}${cel('pe',x.pe)}${cel('seguranca',x.seg)}</tr>`).join('');
 return `<details class="card precos-anos" ${gestaoCard('Comparativo ano a ano',true)}><summary>Comparativo ano a ano · ${esc(mesesTxt)}</summary><div class="card-body"><p class="hint">${modoAno?'Os meses completos do ano escolhido':'Os mesmos meses da média'} em cada ano: ${esc(mesesTxt)}. Ano com menos meses completos mostra quantos entraram. Mês sem plano de contas fica de fora.</p><div class="table-scroll"><table class="tabela-controle precos-anos-tabela"><caption>Base caixa · média por mês · avaliação pelas faixas de referência</caption><thead><tr><th scope="col">Ano</th><th scope="col" class="num">Vendas por mês</th><th scope="col" class="num">Margem de contribuição</th><th scope="col" class="num">Despesas fixas</th><th scope="col" class="num">Ponto de equilíbrio</th><th scope="col" class="num">Margem de segurança</th></tr></thead><tbody>${linhas}</tbody></table></div></div></details>`;
}
// Planilha da tela (Fase 11.5): base da média, os quatro números, o mês a mês do ano e o
// simulador, se preenchido. Separador ';' e vírgula decimal (Excel em português).
function precosCSV(){
 const label=state.periodo,b=label?precoBaseTela(label):null;if(!b)return null;
 const n=v=>v==null||!Number.isFinite(Number(v))?'Não apurado':Number(v).toFixed(2).replace('.',','),pc=v=>v==null||!Number.isFinite(Number(v))?'Não apurado':Number(v).toFixed(2).replace('.',',')+'%';
 const modoAno=precoAno(),m=precoMes(label),ano=label.split('/')[1],vendasDist=modoAno?b.vendas:m.dado&&!m.parcial?m.dado.vendas:null,dist=vendasDist!=null&&b.pe!=null?Math.round((vendasDist-b.pe)*100)/100:null,seg=dist!=null&&vendasDist>0?dist/vendasDist*100:null,aSeg=precoAvaliar('seguranca',seg);
 const rows=[['Preço e ponto de equilíbrio',modoAno?`${ano} (média dos meses completos)`:label,'Base caixa (linhas da DRE Simples)'],
  ['Meses da média',b.meses.join(', '),b.n<3?`só ${b.n} mês(es) completo(s)`:''],
  ...(b.lacunas.length?[['Ficaram de fora',b.lacunas.map(p=>`${p.label} (${p.motivo})`).join(', ')]]:[]),
  [],['Indicador','Valor','Observação'],
  ['Vendas por mês (média)',n(b.vendas),''],['Simples pago (média)',n(b.das),pc(b.pct.das)+' das vendas'],['ISS e devoluções (média)',n(b.impostosVendas+b.devolucoes),''],['Custos variáveis (média)',n(b.variaveis),pc(b.pct.variaveis)+' das vendas'],
  ['Margem de contribuição (média)',n(b.mc),pc(b.pct.mc)+' das vendas'],['Despesas fixas por mês (média)',n(b.fixas),pc(b.pct.fixas)+' das vendas'],
  ['Ponto de equilíbrio (vendas por mês)',b.pe==null?'Sem equilíbrio':n(b.pe),b.pe==null?'margem de contribuição não positiva':''],
  ...[['Avaliação da margem de contribuição','mc',b.pct.mc],['Avaliação do ponto de equilíbrio (% das vendas)','pe',b.pe!=null&&b.vendas>0?b.pe/b.vendas*100:null],['Avaliação das despesas fixas','fixas',b.pct.fixas]].map(([r,k,v])=>{const a=precoAvaliar(k,v);return [r,a?a.rotulo:'Não apurado',a?precoFaixasTexto(k):''];}),
  [modoAno?`Distância do equilíbrio (vendas médias de ${ano})`:'Distância do equilíbrio em '+label,n(dist),dist==null?(modoAno||(m.dado&&!m.parcial)?'sem ponto de equilíbrio':m.dado?'mês em andamento ou incompleto':'mês sem dados'):''],
  ['Margem de segurança',seg==null?'Não apurado':pc(seg),aSeg?`${aSeg.rotulo}: ${precoFaixasTexto('seguranca')}`:''],
  [],['Mês','Vendas','Impostos e devoluções','Custos variáveis','Margem de contribuição','Margem %','Despesas fixas','Ponto de equilíbrio','Distância','Situação'],
  ...PT_MON.map(x=>x+'/'+ano).map(l=>{const pm=precoMes(l),d=pm.dado,pe=d?precoBase(l)?.pe??null:null,dm=d&&!pm.parcial&&pe!=null?Math.round((d.vendas-pe)*100)/100:null;
   return [l,n(d?.vendas),n(d?d.das+d.impostosVendas+d.devolucoes:null),n(d?.variaveis),n(d?.mc),d&&d.vendas>0?pc(Math.round(d.mc/d.vendas*10000)/100):'Não apurado',n(d?.fixas),n(pe),n(dm),!d?'sem dados':pm.parcial?'em andamento ou incompleto':'completo'];})];
 const sim=precoSimular(b,label);
 if(precosUI.custo!==''||precosUI.lucro!=='')rows.push([],['Simulador de preço','Valor'],['Custo variável da unidade',precosUI.custo||''],['Lucro desejado (% do preço)',precosUI.lucro||''],['Despesas fixas (% do preço)',precosUI.fixas===''?pc(b.pct.fixas)+' (peso de hoje)':precosUI.fixas],['Imposto',(precoImpostos(b,label).find(o=>o.id===precosUI.imposto)||{}).rotulo||''],['Preço',sim.preco!=null?n(sim.preco):'Não apurado'],['Resultado',sim.texto]);
 download('preco-equilibrio-'+safeId(label)+'.csv','\ufeff'+rows.map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv');
 return rows;
}
// Simulador: recalcula só o resultado ao digitar (o redesenho da tela apagaria o que está sendo digitado).
function wirePrecos(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('click',e=>{if(e.target?.closest?.('[data-precos-csv]'))precosCSV();});
 document.addEventListener('input',e=>{const f=e.target?.closest?.('[data-precos-sim]');if(!f||!e.target.name)return;precosUI[e.target.name]=e.target.value;const b=precoBaseTela(state.periodo),r=precoSimular(b,state.periodo),out=f.querySelector('.precos-sim-resultado');if(out)out.innerHTML=`${r.preco!=null?`<b>${esc(money(r.preco))}</b> · `:''}${esc(r.texto)}`;});
 document.addEventListener('change',e=>{if(e.target?.closest?.('[data-precos-sim]')&&e.target.name==='imposto'){precosUI.imposto=e.target.value;const b=precoBaseTela(state.periodo),r=precoSimular(b,state.periodo),out=e.target.closest('[data-precos-sim]').querySelector('.precos-sim-resultado');if(out)out.innerHTML=`${r.preco!=null?`<b>${esc(money(r.preco))}</b> · `:''}${esc(r.texto)}`;}});
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wirePrecos);

/* ── BALANÇO GERENCIAL · FASE 8 ─────────────────────────────────────────────
   Fim de cada mês fechado, as duas empresas juntas, sem inventar saldo:
   - caixa e bancos: o saldo bancário do início do mês seguinte, quando informado em
     Parâmetros (é o saldo real do banco); senão, o saldo final do Fluxo de caixa (DFC)
     de um mês fechado. Saldo negativo vai para o passivo ("Banco no vermelho");
   - contas a receber e a pagar: posição do fim do mês remontada pelo robô do
     histórico (erp_posicoes.py), a carteira inteira, sem o corte de 60 dias.
     Vencidos antes do corte de dívida antiga e títulos sem vencimento ficam fora,
     à parte. O DAS e o DARF do mês e os salários já são contas a pagar no Mubisys
     (3.02 e 2.02): não há estimativa à parte, para não contar duas vezes;
   - estoque (Prazos, estoque e metas) e imobilizado, empréstimos e parcelamento do
     DAS (Saldos do balanço) vêm de Parâmetros; sem cadastro no mês, vale o último
     informado, marcado com o mês de onde veio. Com o saldo devedor informado, as
     parcelas de empréstimo do Mubisys (3.04) não somam de novo; sem ele, entram
     como aproximação marcada. As parcelas do parcelamento do DAS lançadas no Mubisys
     caem nos impostos a pagar (o robô ainda não separa pelo plano de contas): com o
     saldo do parcelamento informado, os impostos saem marcados como aproximados.
   Patrimônio líquido = ativo − passivo (gerencial, não contábil). Sem o caixa ou sem
   a posição do mês, nada é somado; faltando cadastro, com valor aproximado ou com
   título ilegível, o total sai marcado como parcial; saldo herdado sai marcado (†). */
const BAL_LINHAS=[
 {id:'caixa',lado:'ativo',nome:'Caixa e bancos',curto:'caixa'},{id:'receber',lado:'ativo',nome:'Contas a receber',curto:'a receber'},{id:'estoque',lado:'ativo',nome:'Estoques',curto:'estoque'},{id:'imobilizado',lado:'ativo',nome:'Imobilizado',curto:'imobilizado'},
 {id:'bancoNegativo',lado:'passivo',nome:'Banco no vermelho',curto:'banco no vermelho'},
 {id:'fornecedores',lado:'passivo',nome:'Fornecedores, salários e despesas a pagar',curto:'fornecedores'},{id:'impostos',lado:'passivo',nome:'Impostos e taxas a pagar',curto:'impostos a pagar'},{id:'socios',lado:'passivo',nome:'Sócios a pagar',curto:'sócios a pagar'},
 {id:'semClasse',lado:'passivo',nome:'A pagar sem classificação',curto:'a pagar sem classificação'},{id:'emprestimos',lado:'passivo',nome:'Empréstimos e financiamentos',curto:'empréstimos'},{id:'parcelamento',lado:'passivo',nome:'Parcelamento do DAS',curto:'parcelamento do DAS'}];
// Linhas do caixa e da posição do mês: sem qualquer uma delas, o balanço não é somado.
const BAL_ESSENCIAIS=['caixa','bancoNegativo','receber','fornecedores','impostos','socios','semClasse'];
const balUI={contas:true,mensal:false};
// Número do servidor só se for número; do cadastro, também o texto numérico antigo.
const balNum=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const balCad=v=>v==null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const balReais=c=>c/100+0;
const balLista=xs=>xs.length>1?xs.slice(0,-1).join(', ')+' e '+xs[xs.length-1]:xs[0]||'';
const balCurto=id=>BAL_LINHAS.find(l=>l.id===id)?.curto||id;
const balLado=id=>BAL_LINHAS.find(l=>l.id===id)?.lado;
const balDia=iso=>{const t=Date.parse(iso||'');return Number.isFinite(t)?new Date(t).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'';};
// Por que o balanço do mês não foi somado (do caixa e da posição), numa frase.
const balNaoSomado=b=>'Não somado: '+[...new Set(b.faltaBase.map(id=>b.linhas[id].motivo))].join('; ')+'.';
// Cadastro de Parâmetros no mês ou, sem ele, o último informado antes (com o mês de onde
// veio). Mês que ainda não chegou não herda nada.
function balCadastro(label,campo,secao='balanco'){
 const k=typeof paramMesChave==='function'?paramMesChave(label):null,cad=state.cfg?.parametros?.[secao]||{};if(!k||k>dfcHoje().slice(0,7))return null;
 const ult=Object.keys(cad).filter(x=>/^\d{4}-(0[1-9]|1[0-2])$/.test(x)&&x<=k&&balCad(cad[x]?.[campo])!=null).sort().pop();
 return ult?{valor:balCad(cad[ult][campo]),mes:paramMesLabel(ult),proprio:ult===k,revisadoEm:cad[ult].revisadoEm||null}:null;
}
// Caixa do fim do mês (ver o cabeçalho): o informado do início do mês seguinte ou o da DFC.
function balCaixa(label,dm,s){
 const prox=typeof dfcMesDesloca==='function'?dfcMesDesloca(label,1):null,acabou=(F.periodo(label)?.ate||'9')<dfcHoje();
 const inf=acabou&&prox&&typeof dfcSaldoInformado==='function'?dfcSaldoInformado(prox):null;
 if(inf!=null)return {valor:inf,origem:'Parâmetros',informado:true,nota:`saldo bancário do início de ${prox} informado em Parâmetros: o saldo real do banco no fim de ${label}`};
 if(!dm?.reg)return {valor:null,motivo:`${label} sem dados coletados`};
 if(dm.parcial)return {valor:null,motivo:dm.emAndamento?`${label} ainda não fechou`:`${label} coletado só até ${dfcDia(dm.ate)||'uma data não registrada'}`};
 if(s?.final==null)return {valor:null,motivo:'sem o saldo inicial no Fluxo de caixa'};
 return {valor:s.final,origem:'Fluxo de caixa',nota:`saldo final de ${label} no Fluxo de caixa${s.origem==='informado'?', a partir do saldo inicial informado em Parâmetros':''}${Math.abs(s.diferenca||0)>=.01?'; a geração do mês não fecha com o ERP, confira no Fluxo de caixa':''}`};
}
function balApurar(label,hist,saldos){
 const k=typeof paramMesChave==='function'?paramMesChave(label):null,pos=(Array.isArray(hist)?hist:[]).find(m=>m?.id===k)||null;
 const dm=typeof dfcMes==='function'?dfcMes(label):null,s=saldos?.get?.(monthSortKey(label))||null,L={},avisos=[];
 // Caixa: saldo negativo (cheque especial, conta garantida) é dívida com o banco: vai para o passivo.
 const cx=balCaixa(label,dm,s);
 if(cx.valor==null){L.caixa=cx;L.bancoNegativo={valor:null,motivo:cx.motivo};}
 else if(cx.valor<0){L.caixa={...cx,valor:0,nota:cx.nota+'; negativo: está no passivo, em "Banco no vermelho"'};L.bancoNegativo={valor:balReais(-Math.round(cx.valor*100)),origem:cx.origem,nota:'saldo bancário negativo no fim do mês (cheque especial ou conta garantida)'};}
 else{L.caixa=cx;L.bancoNegativo={valor:0,origem:cx.origem,nota:'sem saldo negativo no banco'};}
 // Contas a receber e a pagar: a posição do fim do mês, sem o corte de 60 dias.
 const semPos=pos?{valor:null,motivo:'a posição do fim do mês veio sem este valor'}:{valor:null,motivo:`sem a posição do fim de ${label}`};
 const r=pos?.receber,rec=balNum(r?.totalSemHorizonte),rec60=balNum(r?.total);
 L.receber=!pos?{...semPos}:rec!=null?{valor:rec,origem:'Mubisys',nota:'títulos em aberto no fim do mês, vencidos e a vencer, inclusive os fora da DRE (como no Painel)'}:rec60!=null?{valor:rec60,origem:'Mubisys',aproximado:true,nota:'só os que vencem até 60 dias do fechamento'}:{...semPos};
 const pg=pos?.pagar,obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null,gs=obj(pg?.gruposSemHorizonte),g60=obj(pg?.grupos),G0=gs||g60,curto=!gs&&!!g60;
 // Parcelas do parcelamento do DAS separadas pelo robô (Fase 9.4): saem da classe em que
 // caíram (em geral 3.02) e vão para a linha do parcelamento. Só quando as classes fecham
 // com o total e a carteira é a inteira; senão vale a marca por evidência, mais abaixo.
 const pd=obj(pg?.parcelamentoDAS),pdV=balNum(pd?.valor),pdG=obj(pd?.porGrupo),pdOk=!curto&&!!G0&&pdV!=null&&!!pdG&&Math.abs(Object.values(pdG).reduce((t,x)=>t+(balNum(x)||0),0)-pdV)<.01;
 const G=pdOk?Object.fromEntries(Object.entries(G0).map(([k,v])=>[k,balNum(v)==null?v:balReais(Math.round(v*100)-Math.round((balNum(pdG[k])||0)*100))])):G0;
 const grupo=(ids,nota)=>{if(!G)return {...semPos};const v=ids.map(i=>balNum(G[i]));if(v.some(x=>x==null))return {...semPos};return {valor:balReais(v.reduce((t,x)=>t+Math.round(x*100),0)),origem:'Mubisys',aproximado:curto,nota:nota+(curto?'; só os que vencem até 60 dias do fechamento':'')};};
 L.fornecedores=grupo(['producao','apoio','predio'],'produção (1.xx), apoio e administrativo com os salários (2.xx) e prédio (3.03)');
 L.impostos=grupo(['impostos'],`centro 3.02, com o DAS e o DARF lançados como contas a pagar${pdOk&&balNum(pdG.impostos)>0?'; sem as parcelas do parcelamento do DAS, que ficam na linha do parcelamento':''}`);
 L.socios=grupo(['socios'],'centro 3.01 (retiradas, arrendamento e benefícios)');
 L.semClasse=grupo(['semClasse'],'centro de custo sem classe reconhecida; classifique no Mubisys');
 // Cadastros de Parâmetros: o do mês ou o último informado antes, marcado.
 const ces=balCadastro(label,'estoque','operacao');
 L.estoque=ces?{valor:ces.valor,origem:'Parâmetros',cadastro:ces,nota:'estoque do fim do mês'}:{valor:null,falta:true,motivo:`estoque do fim de ${label} não informado em Parâmetros`};
 const ci=balCadastro(label,'imobilizado');
 L.imobilizado=ci?{valor:ci.valor,origem:'Parâmetros',cadastro:ci,nota:'máquinas, veículos e instalações'}:{valor:null,falta:true,motivo:'não informado em Parâmetros'};
 const empErp=G?balNum(G.emprestimos):null,ce=balCadastro(label,'emprestimos'),ger=Date.parse(pos?.geradoEm||'');
 const alcance=curto?'que vencem até 60 dias do fechamento':Number.isFinite(ger)?`com vencimento até ${balDia(new Date(ger+730*864e5).toISOString())} (2 anos depois da remontagem)`:'com vencimento até 2 anos depois da remontagem';
 L.emprestimos=ce?{valor:ce.valor,origem:'Parâmetros',cadastro:ce,nota:`saldo devedor informado${empErp>0?`; as parcelas lançadas no Mubisys (${money(empErp)}) já estão nele e não somam de novo`:''}`}
  :empErp>0?{valor:empErp,origem:'Mubisys',aproximado:true,nota:`parcelas lançadas no Mubisys (3.04) ${alcance}, com os juros a vencer: informe o saldo devedor em Parâmetros`}
  :{valor:null,falta:true,motivo:'saldo devedor não informado em Parâmetros'};
 const cp=balCadastro(label,'parcelamentoDAS'),parcPaga=balNum(dm?.d?.valores?.parcelamentoDAS);
 L.parcelamento=cp?{valor:cp.valor,origem:'Parâmetros',cadastro:cp,nota:`saldo do parcelamento informado${pdOk&&pdV>0?`; as parcelas lançadas no Mubisys (${money(pdV)}) já estão nele e não somam de novo`:''}`}
  :pdOk&&pdV>0?{valor:pdV,origem:'Mubisys',aproximado:true,nota:`parcelas do parcelamento lançadas no Mubisys ${alcance}: informe em Parâmetros o saldo do extrato da Receita`}
  :{valor:null,falta:true,motivo:`saldo não informado em Parâmetros${parcPaga>0?`; houve parcela paga em ${label} (${money(parcPaga)})`:''}`};
 // Parcelas do parcelamento já lançadas no Mubisys caem no 3.02 e estão também no saldo
 // informado. Enquanto o robô não separar pelo plano de contas, os impostos ficam marcados
 // quando há evidência: imposto que vence depois dos 60 dias (não é o DAS do mês) ou parcela
 // do parcelamento paga no mês seguinte.
 const prox=typeof dfcMesDesloca==='function'?dfcMesDesloca(label,1):null,dmP=prox&&typeof dfcMes==='function'?dfcMes(prox):null;
 const impAlem=gs&&g60?(balNum(gs.impostos)||0)-(balNum(g60.impostos)||0):0,parcProx=balNum(dmP?.d?.valores?.parcelamentoDAS);
 if(!pdOk&&cp?.valor>0&&L.impostos.valor>0&&(impAlem>.005||parcProx>0)){L.impostos={...L.impostos,aproximado:true,nota:L.impostos.nota+'; pode incluir parcelas do parcelamento do DAS já lançadas no Mubisys, que também estão no saldo do parcelamento'};
  avisos.push(`Os impostos a pagar no fim de ${label} (${money(L.impostos.valor)}) podem incluir parcelas do parcelamento do DAS já lançadas no Mubisys, que também estão no saldo do parcelamento informado (${money(cp.valor)}): essa parte do passivo pode estar contada duas vezes. A separação automática depende de o robô ler o plano de contas dos títulos.`);}
 // Totais em centavos. Sem caixa ou sem a posição, nada é somado.
 const faltaBase=BAL_ESSENCIAIS.filter(id=>L[id].valor==null),apurado=!faltaBase.length;
 const semCadastro=BAL_LINHAS.filter(l=>L[l.id].valor==null&&!BAL_ESSENCIAIS.includes(l.id)).map(l=>l.id);
 const anteriores=BAL_LINHAS.filter(l=>L[l.id].valor!=null&&L[l.id].cadastro&&!L[l.id].cadastro.proprio).map(l=>l.id);
 const aproximados=BAL_LINHAS.filter(l=>L[l.id].valor!=null&&L[l.id].aproximado).map(l=>l.id);
 const cob=pos?.cobertura||{},ilegiveis=[cob.semValor,cob.semEmissao,cob.pagamentoInvalido].reduce((t,x)=>t+(balNum(x)||0),0);
 const soma=lado=>BAL_LINHAS.filter(l=>l.lado===lado&&L[l.id].valor!=null).reduce((t,l)=>t+Math.round(L[l.id].valor*100),0);
 const ativo=apurado?balReais(soma('ativo')):null,passivo=apurado?balReais(soma('passivo')):null,pl=apurado?balReais(soma('ativo')-soma('passivo')):null;
 // Fora do balanço: dito, nunca somado.
 const corte=typeof pos?.corte==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(pos.corte)?recData(pos.corte):'o corte';
 const fora=pos?[[`A receber vencido antes de ${corte}`,r?.antigas],[`A pagar vencido antes de ${corte}`,pg?.antigas],['A receber sem vencimento',r?.semVencimento],['A pagar sem vencimento',pg?.semVencimento]].map(([rotulo,x])=>({rotulo,valor:balNum(x?.valor),quantidade:balNum(x?.quantidade)})).filter(x=>x.valor>0):[];
 // Avisos: nenhum deles muda um valor; dizem o que conferir.
 const dasP=balNum(dmP?.d?.valores?.das);
 if(L.impostos.valor!=null&&dasP>0&&L.impostos.valor+.005<dasP)avisos.push(`Os impostos a pagar no fim de ${label} (${money(L.impostos.valor)}) são menores que o Simples da competência ${label} pago em ${prox}${dmP.parcial?' até agora':''} (${money(dasP)}): o DAS ou o DARF pode não ter sido lançado como conta a pagar até o fechamento. O balanço não soma nada por conta própria; confira no Mubisys.`);
 if(ilegiveis>0)avisos.push(`${ilegiveis} título(s) do Mubisys ilegíveis (sem valor, emissão ou pagamento legível) ficaram fora da posição de ${label}: o balanço sai marcado como parcial.`);
 const aId=balNum(dm?.d?.valores?.aIdentificar);
 if(aId>0)avisos.push(`${money(aId)} entraram em ${label} como Entradas a identificar e estão no caixa. Se pagaram um título que seguia aberto no fim do mês, o a receber está contado duas vezes; se foram sinal de pedido, falta o adiantamento no passivo. Identifique e dê baixa no Mubisys; o balanço não desconta nada por conta própria.`);
 const foraDRE=(balNum(r?.foraDRE?.valor)||0)+(balNum(pg?.foraDRE?.valor)||0);
 if(L.caixa.valor!=null&&!cx.informado&&foraDRE>0)avisos.push(`A carteira tem títulos fora da DRE (pelo menos ${money(foraDRE)} entre a receber e a pagar), mas o caixa calculado pelo Fluxo de caixa não registra o recebimento nem o pagamento deles: quando forem quitados, o patrimônio muda sem fato novo. Informe em Parâmetros o saldo bancário do início de ${prox}: ele passa a ser o caixa do fim de ${label}.`);
 return {label,id:k,pos,dm,linhas:L,apurado,faltaBase,semCadastro,anteriores,aproximados,ilegiveis,parcial:apurado&&(semCadastro.length>0||aproximados.length>0||ilegiveis>0),ativo,passivo,pl,endiv:apurado&&ativo>0?Math.round(passivo/ativo*1000)/10:null,fora,avisos};
}
// O que marca o total de um lado (ou do mês inteiro, sem lado): cadastro que falta, valor
// aproximado, título ilegível (vale para os dois lados) e saldo herdado de outro mês.
function balMarca(b,lado){
 if(!b.apurado)return '';
 const doLado=id=>!lado||balLado(id)===lado,sc=b.semCadastro.filter(doLado),ap=b.aproximados.filter(doLado),an=b.anteriores.filter(doLado);
 const partes=[sc.length?`sem ${balLista(sc.map(balCurto))}`:'',ap.length?`${balLista(ap.map(balCurto))} aproximado${ap.length>1?'s':''}`:'',b.ilegiveis?`${b.ilegiveis} título(s) ilegíveis fora`:''].filter(Boolean);
 return (partes.length?` · parcial: ${partes.join('; ')}`:'')+(an.length?` · último informado: ${balLista(an.map(id=>`${balCurto(id)} de ${b.linhas[id].cadastro.mes}`))}`:'');
}
function balOrigem(x){
 if(x.valor==null)return x.motivo||'Não apurado';
 const c=x.cadastro,de=c?` · ${c.proprio?c.mes:`último informado: ${c.mes}`}${balDia(c.revisadoEm)?`, revisado em ${balDia(c.revisadoEm)}`:''}`:'';
 return `${x.origem}${de}${x.aproximado?' · aproximado':''}: ${x.nota}`;
}
// Marca de uma célula: ≈ aproximado, † saldo de um mês anterior.
const balSinal=x=>x?.valor==null?'':(x.aproximado?' ≈':'')+(x.cadastro&&!x.cadastro.proprio?' †':'');
function balCartoes(b){
 if(!b.apurado)return `<div class="cards cards-controle">${['Ativo total','Passivo total','Patrimônio líquido','Endividamento'].map(t=>recCartao(t,'Não apurado',balNaoSomado(b))).join('')}</div>`;
 const L=b.linhas,v=id=>L[id].valor==null?'não informado':money(L[id].valor),m=balMarca(b);
 const contas=balReais(['fornecedores','impostos','socios','semClasse'].reduce((t,id)=>t+Math.round(L[id].valor*100),0));
 const endivNota=b.endiv==null?'Ativo zero: não há como dividir.':b.endiv<=100?`De cada R$ 100,00 do ativo, ${money(Math.round(b.passivo/b.ativo*10000)/100)} são de terceiros${m}`:`As dívidas passam do que a empresa tem: são ${(b.endiv/100).toLocaleString('pt-BR',{maximumFractionDigits:1})} vezes o ativo e o patrimônio está negativo${m}`;
 return `<div class="cards cards-controle">${recCartao('Ativo total',money(b.ativo),`Caixa ${v('caixa')}, a receber ${v('receber')}, estoque ${v('estoque')} e imobilizado ${v('imobilizado')}${balMarca(b,'ativo')}`,saldoTom('receber',b.ativo))}${recCartao('Passivo total',money(b.passivo),`Contas a pagar no Mubisys ${money(contas)}, empréstimos ${v('emprestimos')} e parcelamento do DAS ${v('parcelamento')}${L.bancoNegativo.valor>0?`, mais ${money(L.bancoNegativo.valor)} de banco no vermelho`:''}${balMarca(b,'passivo')}`,saldoTom('pagar',b.passivo))}${recCartao('Patrimônio líquido',money(b.pl),`Ativo − passivo no fim de ${b.label}: gerencial, não é o balanço do contador${m}`,b.pl>0?'tom-entra':b.pl<0?'tom-sai':'')}${recCartao('Endividamento',b.endiv==null?'Não apurado':precoPct(b.endiv),endivNota)}</div>`;
}
// "Banco no vermelho" só aparece quando existe (ou falta o caixa para saber).
const balVisivel=(l,b)=>l.id!=='bancoNegativo'||b.linhas.bancoNegativo.valor!==0;
function balTabela(b){
 const L=b.linhas,cel=v=>v==null?'<span class="nao-apurado">Não apurado</span>':esc(money(v)),tom=(lado,v)=>saldoCls(lado==='passivo'?'pagar':'receber',v);
 const linhas=lado=>BAL_LINHAS.filter(l=>l.lado===lado&&balVisivel(l,b)).map(l=>`<tr class="dre-l-detalhe"><th scope="row">${esc(l.nome)}${balSinal(L[l.id])}</th><td class="num${tom(lado,L[l.id].valor)}">${cel(L[l.id].valor)}</td><td>${esc(balOrigem(L[l.id]))}</td></tr>`).join('');
 const total=(rotulo,v,lado)=>{const mk=balMarca(b,lado).replace(/^ · /,'').replace(/ · /g,'; ');return `<tr class="dre-l-subtotal"><th scope="row">${esc(rotulo)}</th><td class="num${tom(lado,v)}">${cel(v)}</td><td>${esc(b.apurado?mk?mk.charAt(0).toUpperCase()+mk.slice(1):'Completo':balNaoSomado(b))}</td></tr>`;};
 const fora=b.fora.length?`<tbody><tr class="dre-composicao-grupo"><th scope="rowgroup" colspan="3">Fora do balanço · não somam</th></tr>${b.fora.map(x=>`<tr class="dre-l-detalhe"><th scope="row">${esc(x.rotulo)}</th><td class="num">${esc(money(x.valor))}</td><td>${esc(`${x.quantidade!=null?x.quantidade+' título(s), ':''}fora da carteira, como no Painel: confira se ainda são devidos`)}</td></tr>`).join('')}</tbody>`:'';
 return `<details class="card bal-contas"${balUI.contas?' open':''}><summary>Balanço por conta · fim de ${esc(b.label)}</summary><div class="card-body"><div class="table-scroll"><table class="tabela-controle dre-simples-meses bal-tabela" style="min-width:560px"><caption>Balanço gerencial · fim de ${esc(b.label)} · R$ · ≈ = aproximado · † = saldo de um mês anterior</caption><thead><tr><th scope="col">Conta</th><th scope="col" class="num">Saldo</th><th scope="col">De onde vem</th></tr></thead><tbody><tr class="dre-composicao-grupo"><th scope="rowgroup" colspan="3">Ativo · o que a empresa tem</th></tr>${linhas('ativo')}${total('Total do ativo',b.ativo,'ativo')}</tbody><tbody><tr class="dre-composicao-grupo"><th scope="rowgroup" colspan="3">Passivo · o que a empresa deve</th></tr>${linhas('passivo')}${total('Total do passivo',b.passivo,'passivo')}</tbody><tbody><tr class="dre-l-resultado"><th scope="row">Patrimônio líquido (ativo − passivo)</th><td class="num ${b.pl>0?'tom-entra':b.pl<0?'tom-sai':''}">${cel(b.pl)}</td><td>Gerencial: sem depreciação, provisões nem capital social</td></tr></tbody>${fora}</table></div></div></details>`;
}
// Ano do mês escolhido, mês a mês (mesmas regras), para a tabela, o gráfico e a planilha.
function balAno(label,hist,saldos){const ano=String(label).split('/')[1];return PT_MON.map(x=>balApurar(x+'/'+ano,hist,saldos));}
const BAL_TOTAIS=[['ativo','Total do ativo'],['passivo','Total do passivo'],['pl','Patrimônio líquido'],['endiv','Endividamento (%)']];
// Linhas do ano: "Banco no vermelho" só quando algum mês tiver.
const balLinhasAno=serie=>BAL_LINHAS.filter(l=>l.id!=='bancoNegativo'||serie.some(b=>b.linhas.bancoNegativo.valor>0));
const balCabecalho=b=>`${b.label}${b.parcial?' *':''}${b.anteriores.length?' †':''}`;
function balMensal(label,serie){
 const ano=String(label).split('/')[1],sel=b=>monthSortKey(b.label)===monthSortKey(label)?'selected-month':'',cel=(b,v,pct,sinal='',tom='')=>`<td class="num ${sel(b)}${tom?' '+tom:''}">${v==null?'<span class="muted" title="Não apurado">—</span>':esc((pct?precoPct(v):money(v))+sinal)}</td>`;
 const linhas=[...balLinhasAno(serie).map(l=>`<tr class="dre-l-detalhe"><th scope="row">${esc(l.nome)}</th>${serie.map(b=>cel(b,b.linhas[l.id].valor,false,balSinal(b.linhas[l.id]),saldoTom(l.lado==='passivo'?'pagar':'receber',b.linhas[l.id].valor))).join('')}</tr>`),...BAL_TOTAIS.map(([k,n])=>`<tr class="dre-l-${k==='pl'?'resultado':'subtotal'}"><th scope="row">${esc(n)}</th>${serie.map(b=>cel(b,b[k],k==='endiv','',k==='endiv'?'':saldoTom(k==='passivo'?'pagar':'receber',b[k]))).join('')}</tr>`)].join('');
 return `<details class="card bal-mensal"${balUI.mensal?' open':''}><summary>Balanço mês a mês · ${esc(ano)}</summary><div class="card-body"><div class="actions"><button type="button" data-bal-csv>Baixar planilha (CSV)</button></div><div class="table-scroll"><table class="tabela-controle dre-simples-meses bal-meses"><caption>Fim de cada mês · R$ · — = sem dados · * = mês em andamento ou incompleto · ≈ = aproximado · † = saldo de um mês anterior · mês sem caixa ou sem a posição não é somado</caption><thead><tr><th scope="col">Conta</th>${serie.map(b=>`<th scope="col" class="num ${sel(b)}">${esc(balCabecalho(b))}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div></div></details>`;
}
// Observação de um mês na planilha: o que foi somado e o que está marcado.
function balObservacao(b){
 if(!b.apurado)return balNaoSomado(b);
 const p=[b.semCadastro.length?`sem ${balLista(b.semCadastro.map(balCurto))}`:'',b.aproximados.length?`aproximado: ${balLista(b.aproximados.map(balCurto))}`:'',b.ilegiveis?`${b.ilegiveis} título(s) ilegíveis fora`:'',b.anteriores.length?`último informado: ${balLista(b.anteriores.map(id=>`${balCurto(id)} de ${b.linhas[id].cadastro.mes}`))}`:''].filter(Boolean);
 return p.length?(b.parcial?'Parcial: ':'')+p.join('; '):'Completo';
}
function balCSV(){
 const label=state.periodo;if(!label||!F.periodo(label))return null;
 const serie=balAno(label,giroUI.dados?.historico?.meses||[],typeof dfcSaldos==='function'?dfcSaldos():new Map());
 const num=v=>v==null?'Não apurado':v.toFixed(2).replace('.',',');
 const rows=[['Balanço gerencial (fim do mês)',...serie.map(b=>b.label+(b.parcial?' (parcial)':'')+(b.anteriores.length?' (com saldo de mês anterior)':''))],...balLinhasAno(serie).map(l=>[l.nome,...serie.map(b=>num(b.linhas[l.id].valor))]),...BAL_TOTAIS.map(([k,n])=>[n,...serie.map(b=>num(b[k]))]),['Observações',...serie.map(balObservacao)]];
 download('balanco-gerencial-'+label.split('/')[1]+'.csv','﻿'+rows.map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv');
 return rows;
}
function renderBalanco(){
 const label=state.periodo;if(!label||!F.periodo(label))return '<p class="hint">Escolha um mês para ver o balanço.</p>';
 carregarGiro();
 const d=giroUI.dados,hist=Array.isArray(d?.historico?.meses)?d.historico.meses:[],saldos=typeof dfcSaldos==='function'?dfcSaldos():new Map(),perm={admin:!!state.permissoes?.admin};
 const b=balApurar(label,hist,saldos),ult=hist.length?hist[hist.length-1]:null;
 const acoes=`<div class="actions"><button type="button" data-giro-recarregar aria-disabled="${giroUI.busy}">Ler de novo</button><span class="hint" role="status">${giroUI.busy?'Lendo o histórico de posições…':''}</span></div>`;
 const erro=giroUI.erro?`<p class="param-avisos">${esc(giroUI.erro)} ${d?'Mostrando a última leitura.':'Nenhum zero foi assumido.'}</p>`:'';
 const vazio=(titulo,texto,botao='')=>`<section class="estado-vazio bal-sem-dados"><div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></div>${botao}</section>`;
 const irUlt=ult&&ult.id!==b.id&&typeof ult.mes==='string'?`<button type="button" data-go="balanco" data-rec-mes="${esc(ult.mes)}">Ver ${esc(ult.mes)}</button>`:'';
 // Sem a posição do mês: diz por quê e leva ao último fechamento.
 if(!b.pos){
  let estado;const aberto=(F.periodo(label)?.ate||'')>=dfcHoje(),semDados=!b.dm?.reg?` ${label} também não tem dados coletados: colete no Mubisys ou importe a planilha do mês.`:'';
  if(!d)estado=giroUI.busy||!giroUI.erro?vazio('Balanço gerencial','Lendo o histórico de posições…'):'';
  else if(!d.historico)estado=vazio('O servidor ainda não tem o histórico de posições','Ele é publicado sozinho pelo Painel, que roda de hora em hora mas costuma atrasar algumas horas. Tente de novo mais tarde.');
  else if(!hist.length)estado=giroSecaoHistorico(d,perm);
  else if(b.dm?.emAndamento||(!b.dm?.reg&&aberto))estado=vazio('O balanço é do fim do mês',`${label} ainda não fechou: o balanço dele sai quando a posição do fim do mês for remontada. O último fechamento é ${ult.mes}.`,irUlt);
  else estado=vazio(`Sem a posição de ${label}`,`O histórico de posições vai de ${hist[0].mes} a ${ult.mes}${b.id>ult.id?': a remontagem de domingo inclui os meses que fecharem até lá':''}.${semDados}`,irUlt);
  return balCartoes(b)+erro+estado+acoes;
 }
 const ano=label.split('/')[1],serie=balAno(label,hist,saldos),sel=serie.findIndex(x=>monthSortKey(x.label)===monthSortKey(label));
 const semCaixa=b.linhas.caixa.valor==null?vazio(`Falta o caixa do fim de ${label}`,`O caixa sai do saldo bancário do início de ${dfcMesDesloca(label,1)} informado em Parâmetros ou do saldo final do Fluxo de caixa: ${b.linhas.caixa.motivo}.`,'<button type="button" data-go="dfc">Ver o Fluxo de caixa</button>'):'';
 const onde=[b.semCadastro.includes('estoque')?'o estoque em "Prazos, estoque e metas"':'',b.semCadastro.some(id=>id!=='estoque')?`${b.semCadastro.includes('estoque')?'os demais':balLista(b.semCadastro.map(balCurto))} em "Saldos do balanço"`:''].filter(Boolean).join(' e ');
 const faltam=b.apurado&&b.semCadastro.length?vazio('Faltam saldos em Parâmetros',`Sem ${balLista(b.semCadastro.map(balCurto))} em ${label}, o balanço sai marcado como parcial. ${perm.admin?`Informe em Parâmetros: ${onde}.`:'Peça a um administrador para informar em Parâmetros.'}`,`<button type="button" data-go="parametros" data-rec-mes="${esc(label)}">${perm.admin?'Informar em Parâmetros':'Ver Parâmetros'}</button>`):'';
 const avisos=b.avisos.length?`<div class="param-avisos bal-avisos"><ul>${b.avisos.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></div>`:'';
 const anteriores=b.anteriores.length?` Vale o último saldo informado para ${balLista(b.anteriores.map(id=>`${balCurto(id)} (${b.linhas[id].cadastro.mes})`))}: revise em Parâmetros.`:'';
 const nota=`<p class="hint bal-nota">${esc(`Fim de ${label}, as duas empresas juntas. Contas a receber e a pagar remontadas em ${recHora(b.pos.gravadoEm||b.pos.geradoEm)} com os títulos como estavam no Mubisys nessa data: título cancelado ou renegociado depois do fechamento não aparece. Não é o balanço do contador: sem depreciação, provisões nem capital social.${anteriores}`)}</p>`;
 const itens=lado=>BAL_LINHAS.filter(l=>l.lado===lado&&balVisivel(l,b)).map(l=>({rotulo:l.nome+balSinal(b.linhas[l.id]),valor:b.linhas[l.id].valor}));
 const sub=t=>`<h3 style="margin:0 0 2px;font-size:13px">${t}</h3>`;
 const g1=recPainel('Do que é feito o balanço?',`O que a empresa tem (ativo, em azul) e o que deve (passivo, em vermelho) no fim de ${label}, do maior para o menor. ≈ = aproximado · † = saldo de um mês anterior.`,`<div class="param-aliq-grade"><div class="param-aliq">${sub('Tem · ativo')}${gBarrasOrdenadas(itens('ativo'),{cor:'entrada',limite:4,titulo:`Ativo no fim de ${label}`})}</div><div class="param-aliq">${sub('Deve · passivo')}${gBarrasOrdenadas(itens('passivo'),{cor:'saida',limite:7,titulo:`Passivo no fim de ${label}`})}</div></div>`);
 // Barras só dos meses completos; parcial (*) e sem dados ficam hachurados, como na DFC.
 const g2=recPainel('O patrimônio cresce?',`Patrimônio líquido gerencial (ativo − passivo) no fim de cada mês de ${ano}. † = usa saldo de um mês anterior. Hachurado: mês sem caixa ou sem a posição, ou parcial (*); o valor parcial está na tabela "Balanço mês a mês".`,gEmpilhadas(serie.map(x=>({rotulo:x.label.slice(0,3)+(x.parcial?'*':x.apurado&&x.anteriores.length?'†':''),valores:x.apurado&&!x.parcial?{pl:x.pl}:{},linha:null})),{series:[{chave:'pl',rotulo:'Patrimônio líquido',sinal:true}],selecionado:sel,titulo:'Patrimônio líquido no fim de cada mês'}));
 return balCartoes(b)+nota+erro+semCaixa+faltam+avisos+acoes+`<div class="graficos-controle">${g1}${g2}</div>`+balTabela(b)+balMensal(label,serie);
}
/* ── RENTABILIDADE · FASE 9.2 ───────────────────────────────────────────────
   Retorno do período sobre o capital do Balanço gerencial (Fase 8), em meses inteiros:
   - período: de janeiro (ou do mês inicial) até o último mês FECHADO dentro dele; mês
     em andamento e mês que ainda não chegou ficam de fora, ditos;
   - resultado: o por competência quando todos os meses estão apurados (DREModelo);
     senão, o resultado de caixa da DRE Simples, marcado como gerencial (caixa não é lucro);
   - capital: patrimônio líquido e ativo médios entre o fim do mês anterior ao início e
     o fim do último mês, com as marcas do balanço (parcial, aproximado, herdado);
   - ROE = resultado ÷ patrimônio médio; ROA = resultado ÷ ativo médio, no período, sem
     anualizar. Patrimônio ou ativo médio zero ou negativo: sem taxa (nunca infinito).
   ROI depende do investimento de cada projeto e continua não apurado. */
function balRentabilidade(p,hist,saldos){
 const ok=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||''),fimMes=ym=>new Date(Date.UTC(+ym.slice(0,4),+ym.slice(5,7),0)).toISOString().slice(0,10);
 const vazio=(motivos,fora=[])=>({disponivel:false,roe:null,roa:null,resultado:null,base:null,plMedio:null,ativoMedio:null,meses:[],fora,ini:null,fim:null,motivos,marcas:[],parcial:false});
 if(!ok(p?.de)||!ok(p?.ate)||p.de.slice(8)!=='01'||p.ate!==fimMes(p.ate.slice(0,7)))return vazio(['A rentabilidade usa meses inteiros: escolha um mês, um trimestre, um semestre ou o ano.']);
 const rotulo=ym=>PT_MON[Number(ym.slice(5,7))-1]+'/'+ym.slice(0,4),todos=[];for(let d=new Date(p.de+'T00:00:00Z');d.toISOString().slice(0,7)<=p.ate.slice(0,7)&&todos.length<400;d.setUTCMonth(d.getUTCMonth()+1))todos.push(rotulo(d.toISOString().slice(0,7)));
 // Só meses fechados: o que ainda corre ou não chegou fica de fora, dito.
 const hoje=dfcHoje(),fechado=l=>(F.periodo(l)?.ate||'9')<hoje,meses=todos.filter(fechado),fora=todos.filter(l=>!fechado(l));
 if(!meses.length)return vazio([`${todos[0]}${todos.length>1?` a ${todos[todos.length-1]}`:''} ainda não ${todos.length>1?'fecharam':'fechou'}: a rentabilidade sai com o mês completo.`],todos);
 const motivos=[],marcas=[];
 if(fora.length)marcas.push(`até ${meses[meses.length-1]}: ${fora.length===1?fora[0]+' ainda não fechou':`${fora[0]} a ${fora[fora.length-1]} ainda não fecharam`}`);
 // Resultado: competência inteira, senão caixa (gerencial), mês a mês sem buraco.
 let resultado=null,base=null;
 // Competência só do consolidado (Impresilk + Universo), como o capital do balanço.
 const comp=meses.map(l=>state.cfg?.demonstrativosCompetencia?.meses?.[safeId(l)]||null),consolidado=c=>String(c?.company||'').trim().toLowerCase()==='impresilk + universo';
 if(comp.every(Boolean)&&!comp.every(consolidado))marcas.push(`competência de outro escopo (${[...new Set(comp.filter(c=>!consolidado(c)).map(c=>String(c.company||'sem empresa').trim()))].join(', ')}): vale o resultado de caixa do consolidado`);
 if(comp.every(Boolean)&&comp.every(consolidado)&&typeof DREModelo!=='undefined'){const a=DREModelo.acumulado(comp);if(balNum(a?.liquido)!=null){resultado=a.liquido;base='competencia';}}
 if(resultado==null){
  const rs=meses.map(l=>{const m=typeof dfcMes==='function'?dfcMes(l):null,a=m?.reg&&!m.parcial&&typeof DRESimples!=='undefined'?DRESimples.apurar(m.reg):null;return balNum(a?.linhas?.resultado);});
  const faltam=meses.filter((_,i)=>rs[i]==null);
  if(faltam.length)motivos.push(`resultado sem ${faltam.join(', ')} (sem dados coletados ou incompleto)`);
  else{resultado=balReais(rs.reduce((t,v)=>t+Math.round(v*100),0));base='caixa';}
 }
 // Capital: balanço no fim do mês anterior ao início e no fim do último mês.
 const antes=dfcMesDesloca(meses[0],-1),ini=balApurar(antes,hist,saldos),fim=balApurar(meses[meses.length-1],hist,saldos);
 for(const b of [ini,fim])if(!b.apurado)motivos.push(`balanço do fim de ${b.label} não somado (${balNaoSomado(b).replace(/^Não somado: /,'').replace(/\.$/,'')})`);
 const media=k=>ini.apurado&&fim.apurado?balReais(Math.round((Math.round(ini[k]*100)+Math.round(fim[k]*100))/2)):null;
 const plMedio=media('pl'),ativoMedio=media('ativo');
 if(plMedio!=null&&plMedio<=0)motivos.push('patrimônio médio zero ou negativo: não há retorno sobre o patrimônio');
 if(ativoMedio!=null&&ativoMedio<=0)motivos.push('ativo médio zero ou negativo');
 const taxa=(r,c)=>r!=null&&c!=null&&c>0?Math.round(r/c*10000)/100:null,roe=taxa(resultado,plMedio),roa=taxa(resultado,ativoMedio);
 for(const b of [ini,fim]){if(b.parcial)marcas.push(`balanço de ${b.label} parcial${balMarca(b).replace(/^ · parcial:/,':').replace(/ · /g,'; ')}`);else if(b.anteriores?.length)marcas.push(`balanço de ${b.label} com saldo de mês anterior`);}
 if(base==='caixa')marcas.push('resultado de caixa (gerencial): o por competência entra quando todos os meses estiverem apurados');
 const resumo=b=>({label:b.label,pl:b.pl,ativo:b.ativo,parcial:!!b.parcial,herdado:!!b.anteriores?.length,marca:b.apurado?balMarca(b).replace(/^ · /,''):''});
 return {disponivel:roe!=null||roa!=null,roe,roa,resultado,base,plMedio,ativoMedio,meses,fora,ini:resumo(ini),fim:resumo(fim),motivos,marcas,parcial:marcas.length>0};
}
function wireBalanco(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('click',e=>{if(e.target?.closest?.('[data-bal-csv]'))balCSV();});
 document.addEventListener('toggle',e=>{const c=e.target?.classList;if(c?.contains('bal-contas'))balUI.contas=e.target.open;else if(c?.contains('bal-mensal'))balUI.mensal=e.target.open;},true);
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wireBalanco);
