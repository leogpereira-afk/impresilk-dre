/* Catálogo de leitura: nenhuma conta ou classificação é criada na origem. */
const PlanoContas=(()=>{
 const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function catalogo(records,year,preferred){
  const map=new Map();
  const recs=records.filter(r=>r.label?.endsWith('/'+year));
  for(const r of [...recs.filter(r=>r.label!==preferred),...recs.filter(r=>r.label===preferred)])for(const c of r.cells||[]){
   const old=map.get(c.code);map.set(c.code,{code:c.code,name:c.name,names:[...new Set([...(old?.names||[]),c.name])],tipo:c.code.split('.')[0],nivel:c.code.split('.').length});
  }
  return [...map.values()].sort((a,b)=>a.code.localeCompare(b.code,'pt-BR',{numeric:true}));
 }
 function filtrar(rows,{query='',tipo='todos',grupo='todos',conta=''}={}){
  const q=normalize(query.trim()),terms=q==='agua'?['agua','copasa']:['energia','cemig'].includes(q)?['energia','cemig']:[q];
  return rows.filter(c=>(tipo==='todos'||c.tipo===tipo)&&(grupo==='todos'||c.code===grupo||c.code.startsWith(grupo+'.'))&&(!conta||c.code===conta||c.code.startsWith(conta+'.'))&&(!q||terms.some(t=>q==='agua'?normalize(c.names.join(' ')).split(/[^a-z0-9]+/).some(w=>w===t||w===t+'s'):normalize(c.code+' '+c.names.join(' ')).includes(t))));
 }
 function comparacao(a,b,code){return F.compararConta(a,b,code);}
 return {catalogo,filtrar,comparacao};
})();
let planoContasPagina=0,planoContasScroll=0;
function contextoPlano(){
 const year=state.periodo.split('/')[1],catalogo=PlanoContas.catalogo(state.records,year,state.periodo),filtros={query:state.consulta,tipo:state.tipo,grupo:state.grupo};
 const contas=PlanoContas.filtrar(catalogo,filtros),selected=state.contaSelecionada||'';
 const rows=PlanoContas.filtrar(catalogo,{...filtros,conta:selected});
 const months=PT_MON.map(m=>({label:m+'/'+year,reg:state.records.find(r=>r.label===m+'/'+year)}));
 return {year,catalogo,contas,selected,rows,months};
}
function planoValor(reg,code){const c=reg?.cells?.find(c=>c.code===code);return c?.value==null?null:c.value;}
function planoTom(code,v){return tomDoValor(code.startsWith('1')?'entradas':code.startsWith('2')?'saidas':'',v);}
function tabelaPlano(ctx,rows=ctx.rows){
 return `<div class="table-scroll plano-matrix" tabindex="0" role="region" aria-label="Planilha mês a mês, com rolagem horizontal"><table><caption>${esc(ctx.year)} · valores em R$ · clique no valor para ver a origem · — = não informado</caption><thead><tr><th scope="col">Conta</th>${ctx.months.map(m=>`<th scope="col" class="num ${m.label===state.periodo?'selected-month':''}">${esc(m.label.split('/')[0])}${m.reg&&!F.qualidade(m.reg).comparavel?' *':''}</th>`).join('')}</tr></thead><tbody>${rows.map(c=>`<tr><th scope="row"><button data-plano-select="${esc(c.code)}">${esc(c.name)}</button><small>${esc(c.code)} · ${c.tipo==='1'?'Entrada':c.tipo==='2'?'Saída':'Outro'} · nível ${c.nivel}</small></th>${ctx.months.map(m=>{const v=planoValor(m.reg,c.code),name=nomeConta(m.reg,c.code);return `<td class="num ${planoTom(c.code,v)} ${m.label===state.periodo?'selected-month':''}">${v==null?'<span title="Valor não informado nesta base">—</span>':`<button class="plano-value" data-plano-origin="${esc(c.code)}" data-plano-month="${esc(m.label)}" aria-label="${esc(c.name+' em '+m.label+': '+money(v))}">${money(v).replace('R$','').trim()}</button>`}${name&&name!==c.name?`<small class="old-account-name">${esc(name)}</small>`:''}</td>`;}).join('')}</tr>`).join('')||'<tr><td colspan="13">Nenhuma conta corresponde à seleção. Limpe a seleção ou os filtros.</td></tr>'}</tbody></table></div>`;
}
function comparativosConta(ctx){
 const c=ctx.catalogo.find(c=>c.code===ctx.selected);if(!c)return '';
 return `<section class="plano-comparisons"><h2>${esc(c.name)} · comparação mensal</h2><div class="table-scroll"><table><thead><tr><th>Mês</th><th>Nome registrado / empresa</th><th class="num">Valor</th><th class="num">Δ mês anterior</th><th class="num">Δ %</th><th>Leitura</th></tr></thead><tbody>${ctx.months.map((m,i)=>{const prev=i?ctx.months[i-1].reg:state.records.find(r=>r.label==='Dez/'+(Number(ctx.year)-1));const cp=PlanoContas.comparacao(m.reg,prev,c.code),v=planoValor(m.reg,c.code);return `<tr><td>${esc(m.label)}</td><td>${esc(nomeConta(m.reg,c.code)||'Não consta neste mês')}<small>${esc(m.reg?.company||'Sem base')}</small></td><td class="num ${planoTom(c.code,v)}">${v==null?'—':money(v)}</td><td class="num">${cp.permitida?money(cp.delta):'—'}</td><td class="num">${cp.percentual==null?'—':cp.percentual.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</td><td><small>${esc(cp.permitida?(cp.ressalva?'Comparação calculada; cobertura a conferir':'Base comparável'):(cp.motivo||'Sem base comparável'))}</small></td></tr>`;}).join('')}</tbody></table></div><p class="hint">Δ é a diferença para o mês anterior. A situação da coleta, a empresa e a classificação precisam ser compatíveis. Uma base anterior igual a zero não gera percentual.</p></section>`;
}
function renderPlanoContas(){
 const x=contextoPlano(),pag=Math.min(planoContasPagina,Math.max(0,Math.ceil(x.rows.length/40)-1)),selected=x.catalogo.find(c=>c.code===x.selected);
 const grupos=x.catalogo.filter(c=>c.nivel===2),tipos=[...new Set(x.catalogo.map(c=>c.tipo))];
 return `<section class="plano-shell"><div class="plano-toolbar"><label class="plano-search"><span class="sr-only">Buscar conta ou produto</span><input id="searchAccounts" type="search" aria-label="Buscar conta ou produto" value="${esc(state.consulta)}" placeholder="Buscar Cemig, água, produtos…"></label><select id="accountType" aria-label="Tipo de movimento"><option value="todos">Todos os tipos</option>${tipos.map(t=>`<option value="${esc(t)}" ${state.tipo===t?'selected':''}>${t==='1'?'Entradas':t==='2'?'Saídas':'Tipo '+esc(t)}</option>`).join('')}</select><select id="accountGroup" aria-label="Categoria"><option value="todos">Todas as categorias</option>${grupos.map(c=>`<option value="${esc(c.code)}" ${state.grupo===c.code?'selected':''}>${esc(c.name)}</option>`).join('')}</select><button data-plano-clear>Limpar filtros</button></div><div class="plano-quick"><span class="tom-entra">● Entradas</span><span class="tom-sai">● Saídas</span><button data-plano-search="energia">Cemig / energia</button><button data-plano-search="água">Água / Copasa</button><span>${x.contas.length} contas no ano</span></div><div class="plano-layout"><aside class="plano-sidebar" aria-label="Lista de contas"><button class="plano-all" data-plano-select="" aria-pressed="${!x.selected}">Todas as contas</button><div class="plano-list" tabindex="0" role="region" aria-label="Contas disponíveis, lista com rolagem">${x.contas.map(c=>`<button class="plano-account ${c.tipo==='1'?'entrada':c.tipo==='2'?'saida':''} nivel-${Math.min(c.nivel,3)}" data-plano-select="${esc(c.code)}" aria-pressed="${x.selected===c.code}"><span>${esc(c.name)}</span><small>${esc(c.code)}</small></button>`).join('')||'<p>Nenhuma conta encontrada.</p>'}</div></aside><div class="plano-content"><div class="section-row"><div><h2>${esc(selected?.name||'Todas as contas')} <small>· ${x.year}</small></h2><p class="hint">${x.rows.length} contas na seleção${selected?' · conta e subcontas':''}</p></div>${selected?'<button data-plano-select="">Ver todas</button>':''}</div>${tabelaPlano(x,x.rows.slice(pag*40,pag*40+40))}<div class="plano-pagination"><button data-plano-page="${pag-1}" ${pag===0?'disabled':''}>Anterior</button><span>${pag+1} / ${Math.max(1,Math.ceil(x.rows.length/40))}</span><button data-plano-page="${pag+1}" ${(pag+1)*40>=x.rows.length?'disabled':''}>Próxima</button><button id="exportAccounts">↓ Planilha da seleção</button></div>${comparativosConta(x)}<details class="plano-rules"><summary>Como ler esta planilha</summary><p>Os valores são os registros originais de cada mês. Totais e subcontas pertencem à mesma árvore: não some níveis entre si. Ausência de conta ou de mês não significa valor zero. Meses marcados com * exigem conferência de cobertura. Mudanças de nome aparecem junto ao valor. Não se calcula acumulado entre escopos diferentes.</p><p>O catálogo reúne as contas registradas no ano selecionado, inclusive as que não aparecem no mês atual. Filtros e seleção também se aplicam à planilha e ao PDF.</p></details></div></div></section>`;
}
function linhasCSVPlano(x){
 const lines=[['Plano de contas',x.year],['Busca',state.consulta||'Todas'],['Tipo',state.tipo],['Categoria',state.grupo],['Conta selecionada',x.selected||'Todas'],['Critério','Valores originais por mês. Não somar totais e subcontas. Não informado não é zero.'],['Código','Nome de referência','Tipo','Nível',...x.months.map(m=>m.label)]];
 for(const c of x.rows)lines.push([c.code,c.name,c.tipo==='1'?'Entrada':c.tipo==='2'?'Saída':'Outro',c.nivel,...x.months.map(m=>{const v=planoValor(m.reg,c.code);return v==null?'Não informado':v.toFixed(2).replace('.',',');})]);
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
 const matrix=document.querySelector('.plano-matrix'),month=matrix?.querySelector('thead .selected-month');if(matrix&&month)matrix.scrollLeft=Math.max(0,month.offsetLeft-matrix.offsetLeft-matrix.clientWidth/2);
 const list=document.querySelector('.plano-list');if(list){list.scrollTop=planoContasScroll;list.onscroll=()=>planoContasScroll=list.scrollTop;}
 const reset=()=>{planoContasPagina=0;state.contaSelecionada='';planoContasScroll=0;};
 for(const b of document.querySelectorAll('[data-plano-select]'))b.onclick=()=>{state.contaSelecionada=b.dataset.planoSelect;planoContasPagina=0;render();};
 for(const b of document.querySelectorAll('[data-plano-page]'))b.onclick=()=>{planoContasPagina=Number(b.dataset.planoPage);render();};
 for(const b of document.querySelectorAll('[data-plano-origin]'))b.onclick=()=>{cfoVoltas=[];abrirAnaliseConta(b.dataset.planoOrigin,b.dataset.planoMonth);};
 for(const b of document.querySelectorAll('[data-plano-search]'))b.onclick=()=>{reset();state.consulta=b.dataset.planoSearch;state.tipo='todos';state.grupo='todos';render();};
 document.querySelector('[data-plano-clear]').onclick=()=>{reset();state.consulta='';state.tipo='todos';state.grupo='todos';render();};
 $$('searchAccounts').oninput=e=>{const pos=e.target.selectionStart;reset();state.consulta=e.target.value;render();$$('searchAccounts').focus();$$('searchAccounts').setSelectionRange(pos,pos);};
 $$('accountType').onchange=e=>{reset();state.tipo=e.target.value;state.grupo='todos';render();};
 $$('accountGroup').onchange=e=>{reset();state.grupo=e.target.value;render();};
 $$('exportAccounts').onclick=baixarCSVPlano;$$('cfoPDF').onclick=()=>baixarPDFPlano($$('cfoPDF'));
}
