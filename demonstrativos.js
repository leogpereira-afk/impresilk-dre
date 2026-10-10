/* Visões mensais, separadas por regime. Nenhuma gravação acontece ao navegar. */
const dreUI={base:'caixa',detalhar:false,movimento:false};
const linhasCaixa=[
 ['entradas','(+) Recebimentos considerados','total','Recebimento'],
 ['operacionais','Recebimentos operacionais','detail','Caixa operacional'],
 ['emprestimos','Entradas de empréstimos','detail','Principal de empréstimo'],
 ['rendimentos','Rendimentos financeiros recebidos','detail','Receita financeira'],
 ['naoIdentificadas','Entradas a identificar','detail','Conciliação'],
 ['outrasEntradas','Outras entradas','detail','Recebimento'],
 ['saidas','(−) Pagamentos considerados','total','Pagamento'],
 ['pagamentosOperacionais','Pagamentos classificados na operação','detail','Caixa operacional'],
 ['socios','Sócios e arrendamento','detail','Pró-labore'],
 ['parcelasAtivos','Parcelas de ativos','detail','CAPEX'],
 ['investimentos','Investimentos classificados','detail','Investimento'],
 ['dividas','Dívidas classificadas','detail','Principal de empréstimo'],
 ['transferencias','Transferências entre empresas','detail','Transferência'],
 ['pendentes','Saídas sem detalhamento','detail','Conciliação'],
 ['variacao','(=) Variação do caixa no mês','result','Variação de caixa']
].map(([id,nome,tipo,termo])=>({id,nome,tipo,termo}));
function mesesDRE(){const ano=Number(state.periodo.split('/')[1])||new Date().getFullYear();return PT_MON.map((m,i)=>{const label=m+'/'+ano,reg=state.records.find(r=>monthSortKey(r.label)===ano*12+i)||null,comp=DRECompetencia.obter(state.cfg,safeId(label));return {label,reg,comp};});}
function valorDRE(v,ratio=false){return v==null?'<span class="muted" title="Não apurado: faltam informações">—</span>':ratio?Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':money(v);}
function dadosDRE(){
 const competencia=dreUI.base==='competencia',cols=mesesDRE(),ate=cols.findIndex(x=>x.label===state.periodo)+1||12,periodos=cols.slice(0,ate);
 const valores=cols.map(x=>competencia?DREModelo.calcular(x.comp?.valores||{}):x.reg&&F.valorConta(x.reg,'1')!=null&&F.valorConta(x.reg,'2')!=null?F.resumo(x.reg):{});
 const escopos=new Set(periodos.filter(x=>competencia?x.comp:x.reg).map(x=>competencia?x.comp.company.trim().toLocaleLowerCase('pt-BR'):JSON.stringify([x.reg.company,x.reg.basis,x.reg.qualidade?.escopo,x.reg.qualidade?.regra])));
 let soma={};if(escopos.size<=1){if(competencia)soma=DREModelo.acumulado(periodos.map(x=>x.comp));else for(const row of linhasCaixa){const vs=valores.slice(0,ate).map(v=>v[row.id]);soma[row.id]=vs.some(v=>v==null)?null:vs.reduce((s,v)=>s+Math.round(v*100),0)/100;}}
 return {competencia,cols,ate,valores,soma,mesmoEscopo:escopos.size<=1,linhas:(competencia?DREModelo.linhas:linhasCaixa).filter(r=>dreUI.detalhar||r.tipo!=='detail')};
}
function statusCompetencia(c){return !c?'Não preenchido':c.estado==='preenchido'?'Preenchido · a validar':'Preenchimento parcial';}

/* ── COMPARATIVO NA PRÓPRIA LINHA ────────────────────────────────────────
   A matriz mostrava 12 números e nada mais: sem peso, sem direção e sem
   desenho. Aqui cada rubrica ganha, na mesma linha, o traço dos 12 meses, o
   peso sobre a base do mês e a variação contra o mês anterior.

   O peso usa como base a RECEITA (competência) ou o total de entradas/saídas
   do próprio lado (caixa) — comparar uma saída com a receita daria um
   percentual sem significado na base gerencial.

   A variação só aparece quando os dois meses são comparáveis: escopo,
   cobertura e critério iguais. Fora disso fica "—" em vez de um número que
   parece medida e não é. */
function baseDoPeso(d,i,r){
 if(d.competencia)return d.valores[i].liquida;
 const saida=['saidas','pagamentosOperacionais','socios','parcelasAtivos','dividas','transferencias','investimentos','pendentes'];
 return saida.includes(r.id)?d.valores[i].saidas:d.valores[i].entradas;
}
/* Para onde a linha "melhora". Dívida e empréstimo ficam em 0 de propósito:
   aumento de dívida nunca é movimento favorável, e pagar mais dívida também não
   é "piora" — a seta aparece, a cor não. Linha nova sem entrada aqui fica
   neutra, nunca com cor chutada. */
const DIRECAO_DA_LINHA={
 // caixa
 entradas:1,operacionais:1,emprestimos:0,rendimentos:1,naoIdentificadas:-1,outrasEntradas:0,
 saidas:-1,pagamentosOperacionais:-1,socios:-1,parcelasAtivos:0,investimentos:0,dividas:0,
 transferencias:0,pendentes:-1,variacao:1,
 // competência
 bruta:1,produtos:1,servicos:1,outrasVendas:1,deducoes:-1,devolucoes:-1,descontos:-1,tributosVendas:-1,
 liquida:1,custos:-1,bruto:1,margemBruta:1,despesasVendas:-1,administrativas:-1,outrasDespesas:-1,
 outrasReceitas:1,equivalencia:1,operacional:1,margemOperacional:1,receitasFinanceiras:1,
 despesasFinanceiras:-1,antesTributos:1,tributosLucro:-1,tributosDiferidos:0,continuadas:1,
 descontinuadas:1,liquido:1,margemLiquida:1,da:0,ebitda:1,margemEbitda:1,
};
function celulaComparativo(d,r){
 const i=d.ate-1,serie=d.valores.slice(0,d.ate).map(v=>v[r.id]??null);
 const atual=d.valores[i]?.[r.id]??null,anterior=i>0?(d.valores[i-1]?.[r.id]??null):null;
 // rubricas que já SÃO percentual não recebem peso nem valor em reais
 const ratio=r.tipo==='ratio';
 // "100% do mês" na própria linha-base é ruído; variação do caixa dividida
 // pela receita também não mede nada. Nesses casos o peso é omitido.
 const semPeso=ratio||['entradas','saidas','variacao','bruta','liquida'].includes(r.id)||r.tipo==='total';
 const base=semPeso?null:baseDoPeso(d,i,r);
 const peso=!semPeso&&atual!=null&&base?atual/base*100:null;
 // Não usar qualidade().comparavel como liga/desliga: o coletor grava
 // apiContratoValidado:false em todo mês e a coluna inteira ficava em "sem
 // comparação". Aqui o bloqueio duro (empresa/base/critério) continua, e a
 // cobertura não validada vira o asterisco que o resto do painel já usa.
 let comparavel=atual!=null&&anterior!=null,ressalva=false;
 if(comparavel&&!d.competencia){
  const a=d.cols[i]?.reg,b=d.cols[i-1]?.reg,c=F.comparavelComRessalva(a,b);
  comparavel=c.pode;ressalva=c.ressalva;
 }
 if(comparavel&&d.competencia)comparavel=!!d.cols[i]?.comp?.company&&!!d.cols[i-1]?.comp?.company&&String(d.cols[i]?.comp?.company||'').trim().toLowerCase()===String(d.cols[i-1]?.comp?.company||'').trim().toLowerCase();
 const delta=comparavel?Math.round((atual-anterior)*100)/100:null;
 const pct=comparavel&&anterior>0?delta/Math.abs(anterior)*100:null;
 // Subir é bom (+1), ruim (−1) ou nenhum dos dois (0) — declarado linha a
 // linha. Adivinhar pela palavra no nome invertia a cor: "resultado antes dos
 // TRIBUTOS" e "receitas FINANCEIRAS" subindo saíam vermelhos; devoluções e
 // descontos subindo, verdes; "Saídas" (com acento) escapava de "saida".
 const dir=DIRECAO_DA_LINHA[r.id]??0;
 const tom=delta==null||delta===0||!dir?'':((delta>0)===(dir>0)?'delta-bom':'delta-ruim');
 const seta=delta==null?'':delta>0?'▲':delta<0?'▼':'■';
 const tomLinha=delta==null||delta===0||!dir?'':((delta>0)===(dir>0)?'cai':'sobe');
 return `<td class="num col-relatorio"><div class="dre-compare">
  ${miniSerie(serie,{tom:tomLinha})}
  <b>${delta==null?'<span class="muted">sem comparação</span>':`<span class="${tom}" ${ressalva?'title="Cobertura ainda não validada nos dois meses — confira antes de decidir."':''}>${seta} ${esc(ratio?delta.toLocaleString('pt-BR',{maximumFractionDigits:1})+' p.p.':money(delta))}${pct!=null&&!ratio?' · '+(pct>0?'+':'')+pct.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':''}</span>`}</b>
  ${peso!=null?`<span>${peso.toLocaleString('pt-BR',{maximumFractionDigits:1})}% do mês</span>`:''}
 </div></td>`;
}
function tabelaDRE(d){
 const COLAPSAVEL=['cobertura-nao-validada','aguardando-conferencia'];
 const q=d.cols.map(x=>d.competencia?null:F.qualidade(x.reg));
 const rot=d.cols.map((x,i)=>d.competencia?statusCompetencia(x.comp):q[i].rotulo);
 const conta={};rot.forEach((r,i)=>{if(r&&!d.competencia&&COLAPSAVEL.includes(q[i].estado))conta[r]=(conta[r]||0)+1;});
 const par=Object.entries(conta).sort((a,b)=>b[1]-a[1])[0];
 const comum=par&&par[1]>=3?par[0]:null;
 const legenda=comum?` · <b class="marca-conferir">*</b> = ${esc(comum)}`:'';
 return `<div class="dre-table-wrap" tabindex="0" role="region" aria-label="Demonstrativo mensal. Role para acompanhar os meses."><table class="dre-table"><caption>${d.competencia?'DRE por competência':'Demonstrativo gerencial de caixa'} · ${esc(state.periodo.split('/')[1])} · valores em R$ · — = não apurado${legenda}</caption><thead><tr><th scope="col">Conta / resultado</th><th scope="col" class="num col-relatorio">12 meses<small>e vs mês anterior${comum?' · '+esc(comum.toLowerCase()):''}</small></th>${d.cols.map((x,i)=>`<th scope="col" class="num ${x.label===state.periodo?'selected-month':''}"><button data-period="${esc(x.label)}">${esc(x.label)}</button>${comum&&rot[i]===comum&&COLAPSAVEL.includes(q[i]?.estado)?`<b class="marca-conferir" title="${esc(comum)}">*</b>`:`<small>${esc(rot[i]||'')}</small>`}</th>`).join('')}<th scope="col" class="num">Acumulado<small>Jan até ${esc(state.periodo.split('/')[0])}</small></th></tr></thead><tbody>${d.linhas.map(r=>`<tr class="dre-row-${r.tipo}"><th scope="row"><span>${esc(r.nome)}</span><button class="term-help" data-term="${esc(r.termo)}" aria-label="Entender ${esc(r.termo)}">?</button></th>${celulaComparativo(d,r)}${d.valores.map((v,i)=>`<td class="num ${d.cols[i].label===state.periodo?'selected-month':''} ${tomDoValor(r.id,v[r.id])||(v[r.id]<0?'neg':'')}"><button class="cfo-value" data-cfo-rubrica="${esc(r.id)}" data-cfo-period="${esc(d.cols[i].label)}" data-cfo-base="${d.competencia?'competencia':'caixa'}" aria-label="Analisar ${esc(r.nome)} em ${esc(d.cols[i].label)}">${valorDRE(v[r.id],r.tipo==='ratio')}</button></td>`).join('')}<td class="num dre-accumulated ${tomDoValor(r.id,d.soma[r.id])}"><button class="cfo-value" data-cfo-acumulado="${esc(r.id)}" aria-label="Analisar acumulado de ${esc(r.nome)}">${valorDRE(d.soma[r.id],r.tipo==='ratio')}</button></td></tr>`).join('')}</tbody></table></div>`;}
function disponibilidadeCompetencia(d){
 const preenchidos=d.cols.filter(x=>x.comp);
 return `<details class="dre-period-control"><summary>Informar outro mês ou ano</summary><label>Mês da apuração<input id="drePeriodo" type="month" min="2000-01" max="2100-12" value="${esc(F.periodo(state.periodo)?.de.slice(0,7)||'')}"></label></details><div class="dre-coverage"><b>${preenchidos.length} de 12 meses com apuração registrada em ${esc(state.periodo.split('/')[1])}</b>. Escolha o mês para consultar ou preencher.</div>`;
}
function contasRegistradasDRE(reg){
 if(!reg)return '';
 const other=state.records.find(x=>x.label===state.comparar);
 return `<details class="dre-criteria"><summary>Contas registradas em ${esc(state.periodo)} · árvore do ERP</summary><p class="hint">Classificação original do ERP. Clique na conta para consultar a origem. Uma rubrica gerencial sem todos os componentes permanece não apurada.</p><div class="source-grid">${['1','2'].map(code=>{const c=F.composicao(reg,code);return `<div class="table-scroll"><table><caption>${code==='1'?'Entradas':'Saídas'} · ${money(c.total)}</caption><thead><tr><th>Conta</th><th class="num">Valor</th><th class="num">% do total</th>${other?'<th class="num">Δ mês</th>':''}</tr></thead><tbody>${c.itens.map(x=>{const cmp=x.residuo?null:F.compararConta(reg,other,x.code);return `<tr><th>${x.residuo?esc(x.name):`<button data-account="${esc(x.code)}">${esc(x.name)}</button>`}</th><td class="num ${code==='1'?'tom-entra':'tom-sai'}">${valorDRE(x.value)}</td><td class="num">${x.value!=null&&c.total?valorDRE(x.value/c.total*100,true):'—'}</td>${other?`<td class="num">${cmp?.permitida?valorDRE(cmp.delta):'<span title="Base, conta ou cobertura não comparável">—</span>'}</td>`:''}</tr>`;}).join('')}</tbody></table></div>`;}).join('')}</div><div class="actions"><button id="dreContasCSV">Planilha das contas do mês</button><button data-go="detalhe">Comparar contas no ano</button></div></details>`;
}
function renderDRE(){
 const d=dadosDRE(),atual=d.cols.find(x=>x.label===state.periodo),calc=atual?d.valores[d.cols.indexOf(atual)]:{};
 const controls=`<div class="dre-controls"><div class="dre-switch" role="group" aria-label="Regime do demonstrativo"><button data-dre-base="caixa" aria-pressed="${!d.competencia}">🏦 Gerencial de caixa</button><button data-dre-base="competencia" aria-pressed="${d.competencia}">📑 Por competência</button></div><div class="actions"><button id="dreCSV">↓ Planilha CSV</button><button id="drePrint">Imprimir / PDF</button></div></div>`;
 const intro=d.competencia?`<div class="dre-intro"><div><h2>O resultado econômico, mês a mês</h2><p>Receita, custos, despesas e lucro no período em que aconteceram.</p><small>${esc(atual?.comp?atual.comp.company+' · Fonte: '+atual.comp.fonte+' · Revisão: '+dataBR(atual.comp.revisadoEm):'A base atual contém caixa. A competência precisa de valores reconhecidos e revisados para cada mês.')}</small></div><button id="editarCompetencia" class="primary" ${state.permissoes.admin?'':'disabled'}>${atual?.comp?'Revisar':'Preencher'} ${esc(state.periodo)}</button></div>${!state.permissoes.admin?'<p class="hint">O preenchimento compartilhado está disponível para administradores do DRE.</p>':''}`:`<div class="dre-intro"><div><h2>O movimento do dinheiro, mês a mês</h2><p>Recebimentos, pagamentos e a diferença entre os dois.</p><small>Base gerencial filtrada por “compõe DRE”. Não representa lucro por competência nem saldo bancário disponível.</small></div></div>`;
 const simples=d.competencia?null:dreSimplesCaixa();
 const cards=d.competencia?`<div class="cards finance-kpis">${metricRubricaCFO('liquida','Receita líquida',calc.liquida,state.periodo)}${metricRubricaCFO('liquido','Lucro / prejuízo líquido',calc.liquido,'Após financeiro e tributos')}${metricRubricaCFO('margemLiquida','Margem líquida',calc.margemLiquida,'Lucro líquido ÷ receita líquida')}</div>`:simples.cards;
 const dadosNota=d.competencia?'Campos não preenchidos impedem os subtotais que dependem deles. Zero deve ser confirmado como zero ou não aplicável. EBITDA usa as operações continuadas e soma de volta a depreciação e amortização já incluídas nos custos e despesas.':'Os totais conservam a classificação de cada mês. Abra as rubricas para ver a decomposição. Meses parciais e mudanças de classificação exigem conferência antes de comparar.';
 const chart=d.competencia&&!d.valores.some(v=>v.liquida!=null||v.liquido!=null)?painelGrafico('Receita líquida e resultado ao longo do ano','Gráfico por competência','<p class="empty">O gráfico será preenchido conforme as receitas e os resultados mensais forem apurados.</p>'):d.competencia?painelGrafico('Receita líquida e resultado ao longo do ano','Valores por competência informados; mês vazio permanece sem barra.',graficoBarras(d.cols.map((x,i)=>({label:x.label,reg:x.comp,qualidade:{comparavel:false,rotulo:statusCompetencia(x.comp)},receita:d.valores[i].liquida,resultado:d.valores[i].liquido})),[{chave:'receita',nome:'Receita líquida',cor:'var(--chart-in)'},{chave:'resultado',nome:'Lucro / prejuízo',cor:'var(--chart-net)'}],'Receita e resultado por competência')):graficoEvolucao();
 if(d.competencia&&!atual?.comp){
  return controls+disponibilidadeCompetencia(d)+`<section class="source-empty"><h2>Falta a apuração de ${esc(state.periodo)}</h2><p>Resultado não apurado. Preencha as rubricas com o balancete ou a apuração revisada. Caixa e custos informados nas O.S. não substituem a competência.</p><div class="actions"><button id="editarCompetencia" class="primary" ${state.permissoes.admin?'':'disabled'}>Preencher ${esc(state.periodo)}</button></div>${!state.permissoes.admin?'<p class="hint">Preenchimento disponível para administradores.</p>':''}</section><details class="dre-criteria"><summary>Consultar estrutura da DRE e meses preenchidos</summary>${typeof tabelaDRECompacta==='function'?tabelaDRECompacta(d):tabelaDRE(d)}</details>`+(d.cols.some(x=>x.comp)?chart:'');
 }
 return controls+(d.competencia?disponibilidadeCompetencia(d)+intro:`<details class="dre-criteria"><summary>Base e critérios de caixa</summary>${intro}</details>`)+cards+(d.competencia?dreSimplesCompetencia(d):simples.resto+contasRegistradasDRE(atual?.reg))+(d.competencia?(h=>h):(h=>`<details class="card dre-movimento"${dreUI.movimento?' open':''}><summary>Movimento de caixa · entradas e saídas</summary><div class="card-body">${h}</div></details>`))(painelGrafico(d.competencia?'Demonstração do resultado':'Movimento de caixa',`${typeof gestaoUI!=='undefined'&&gestaoUI.dre==='mes'?'Mês selecionado e comparação':'Janeiro a dezembro'} · acumulado até ${state.periodo}`,`<div class="actions"><label class="check-label"><input id="dreDetalhar" type="checkbox" ${dreUI.detalhar?'checked':''}>Abrir rubricas detalhadas</label>${typeof gestaoUI==='undefined'||gestaoUI.dre==='ano'?`<button id="dreMesAtual">Ir à coluna de ${esc(state.periodo)}</button>`:''}</div>${typeof tabelaDRECompacta==='function'?tabelaDRECompacta(d):tabelaDRE(d)}<p class="hint">${dadosNota}</p><p class="hint">O acumulado fica sem valor quando falta algum mês ou os escopos diferem. Meses parciais continuam parciais no acumulado. ${d.mesmoEscopo?'':'Há empresas ou critérios diferentes neste ano.'}</p>`))+card('Evolução e relatórios',chart+(d.competencia?'':relatoriosDRE()),false)+(atual?.comp?.notas?card('Notas de '+state.periodo,`<p class="preserve-lines">${esc(atual.comp.notas)}</p>`,false):'');
}
function wireDRE(){
 if($$('dreContasCSV'))$$('dreContasCSV').onclick=()=>{const reg=regAtual(),rows=[['Contas registradas',state.periodo,reg?.company||''],['Natureza','Código','Conta','Valor R$','Percentual do total'],...['1','2'].flatMap(code=>{const c=F.composicao(reg,code);return c.itens.map(x=>[code==='1'?'Entrada':'Saída',x.code,x.name,x.value==null?'Não apurado':x.value.toFixed(2).replace('.',','),x.value!=null&&c.total?(x.value/c.total*100).toFixed(2).replace('.',','):'Não apurado']);})];download('contas-dre-'+safeId(state.periodo)+'.csv','\ufeff'+rows.map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv');};
 if($$('drePeriodo'))$$('drePeriodo').onchange=e=>{if(!e.target.validity.valid||!e.target.value)return;const [y,m]=e.target.value.split('-');state.periodo=PT_MON[Number(m)-1]+'/'+y;render();};
 document.querySelectorAll('[data-dre-base]').forEach(b=>b.onclick=()=>{dreUI.base=b.dataset.dreBase;render();});
 if($$('dreDetalhar'))$$('dreDetalhar').onchange=e=>{dreUI.detalhar=e.target.checked;render();};
 if($$('editarCompetencia'))$$('editarCompetencia').onclick=()=>abrirCompetencia(state.periodo);
 if($$('dreMesAtual'))$$('dreMesAtual').onclick=()=>{const wrap=document.querySelector('.dre-table-wrap'),cell=wrap?.querySelector('thead .selected-month');if(wrap&&cell)wrap.scrollTo({left:Math.max(0,cell.offsetLeft-wrap.querySelector('th').offsetWidth),behavior:'smooth'});};
 if($$('drePrint'))$$('drePrint').onclick=()=>exportarCFO({tipo:typeof gestaoUI!=='undefined'&&gestaoUI.dre==='mes'?'mensal':'anual',periodo:state.periodo,base:dreUI.base},$$('drePrint'));
 if($$('dreCSV'))$$('dreCSV').onclick=()=>exportarDRECSV();
 // o Movimento de caixa fica aberto entre redesenhos (trocar a visão ou detalhar redesenha a tela)
 {const mov=document.querySelector('.dre-movimento');if(mov)mov.ontoggle=()=>{dreUI.movimento=mov.open;};}
 document.querySelectorAll('[data-dre-origem]').forEach(b=>b.onclick=()=>{const det=document.querySelector('.dre-composicao');if(!det)return;det.open=true;det.scrollIntoView({behavior:'smooth',block:'start'});det.querySelector('summary')?.focus();});
}
function abrirCompetencia(label){
 if(!state.permissoes.admin)return;
 const session=STORE_KEY;const id=safeId(label),original=structuredClone(DRECompetencia.obter(state.cfg,id));
 let draft=original||{label,company:'',fonte:'',notas:'',valores:{}};
 const grupos=[...new Set(DREModelo.campos.map(c=>c.grupo))];
 // DAS da competência: a guia é paga no mês seguinte. Só sugere, e só com o mês
 // de pagamento fechado e valor positivo; quem decide é quem preenche.
 const dasRef=dreDASCompetencia(label),fmtDAS=v=>Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 const podeUsarDAS=!!dasRef.reg&&dasRef.guia.temGuia&&!dasRef.parcial&&dasRef.guia.total>0;
 const refDAS=`<p class="${podeUsarDAS?'note':'hint'}">${esc(dreDASTexto(label,dasRef))} ${podeUsarDAS?'<button type="button" id="competenciaUsarDAS">Usar em “Tributos sobre vendas”</button> Some ICMS, DIFAL e ISS pagos fora do DAS, se houver.':''} No Simples, IRPJ e CSLL ficam vazios: já estão no DAS.</p>`;
 const mostrar=()=>{
 dialog('Competência · '+label,`<form id="competenciaForm"><p>Informe valores reconhecidos neste mês. Receber uma venda antiga ou pagar uma compra não define a competência. Use a apuração, o balancete ou registros conferidos.</p>${refDAS}<div class="form-grid"><label>Empresas incluídas<input name="company" value="${esc(draft.company)}" placeholder="Ex.: Impresilk + Universo" required maxlength="200"></label><label>Fonte da apuração<input name="fonte" value="${esc(draft.fonte)}" placeholder="Ex.: balancete revisado de setembro" required maxlength="300"></label></div>${grupos.map(g=>`<fieldset class="competencia-group"><legend>${esc(g)}</legend><div class="form-grid">${DREModelo.campos.filter(c=>c.grupo===g).map(c=>`<label>${esc(c.nome)} (R$)<input name="${c.id}" type="text" inputmode="decimal" value="${draft.valores[c.id]==null?'':Number(draft.valores[c.id]).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}" placeholder="Não informado" maxlength="24"><small>${esc(c.ajuda)}</small></label>`).join('')}</div></fieldset>`).join('')}<button type="button" id="competenciaZeros">Marcar campos vazios como zero / não aplicável</button><label>Notas e critérios<textarea name="notas" rows="3" maxlength="3000">${esc(draft.notas)}</textarea></label><p id="competenciaErro" class="neg" role="alert"></p><div class="actions"><button class="primary" type="submit">Revisar valores antes de salvar</button><button id="competenciaCancelar" type="button">Cancelar</button></div></form>`);
 $$('competenciaCancelar').onclick=()=>$$('detailDialog').close();
 if($$('competenciaUsarDAS'))$$('competenciaUsarDAS').onclick=()=>{const el=$$('competenciaForm').elements.namedItem('tributosVendas'),novo=fmtDAS(dasRef.guia.total);if(String(el.value||'').trim()&&el.value!==novo&&!confirm(`Trocar ${el.value} por ${novo}? O valor digitado pode incluir ICMS, DIFAL e ISS fora do DAS.`))return;el.value=novo;el.focus();toast('DAS pago colocado em Tributos sobre vendas. Confira antes de salvar.');};
 $$('competenciaZeros').onclick=()=>{DREModelo.campos.forEach(c=>{const el=$$('competenciaForm').elements.namedItem(c.id);if(!el.value.trim())el.value='0,00';});toast('Campos vazios marcados como zero. Confira antes de salvar.');};
 $$('competenciaForm').onsubmit=e=>{e.preventDefault();try{const fd=new FormData(e.target),valores={};for(const c of DREModelo.campos){const raw=String(fd.get(c.id)).trim();valores[c.id]=raw===''?null:parseNum(raw);}draft={...draft,label,company:String(fd.get('company')).trim(),fonte:String(fd.get('fonte')).trim(),notas:String(fd.get('notas')),valores:DREModelo.validar(valores)};if(!draft.company||!draft.fonte)throw new Error('Informe empresas e fonte da apuração.');if(Object.values(draft.valores).every(v=>v==null))throw new Error('Preencha ao menos uma rubrica.');revisar();}catch(err){$$('competenciaErro').textContent=err.message;}};
 };
 const revisar=()=>{
  const calc=DREModelo.calcular(draft.valores),pendentes=DREModelo.pendentes(draft.valores);
  dialog('Conferir competência · '+label,`<p><b>${esc(draft.company)}</b><br>Fonte: ${esc(draft.fonte)}</p><p class="note">${pendentes.length?`${pendentes.length} rubricas sem valor. O mês será salvo como parcial.`:'Todas as rubricas foram preenchidas. Isso não substitui a validação contábil.'}</p><div class="table-scroll"><table><thead><tr><th>Rubrica</th><th class="num">Na nuvem</th><th class="num">Nova versão</th></tr></thead><tbody>${DREModelo.campos.map(c=>`<tr><th>${esc(c.nome)}</th><td class="num">${valorDRE(original?.valores?.[c.id])}</td><td class="num">${valorDRE(draft.valores[c.id])}</td></tr>`).join('')}</tbody></table></div>${linha('Receita líquida',calc.liquida??'Não apurado')}${linha('Lucro / prejuízo líquido',calc.liquido??'Não apurado',true)}<label class="check-label"><input id="competenciaConfirmar" type="checkbox">Conferi o mês, as empresas, a fonte e os valores desta apuração.</label><p id="competenciaSaveErro" class="neg" role="alert"></p><div class="actions"><button id="competenciaSalvar" class="primary" disabled>Salvar competência na nuvem</button><button id="competenciaVoltar">Voltar e ajustar</button><button id="competenciaCopia">Baixar cópia desta edição</button></div>`);
  const registro={...draft,revisao:crypto.randomUUID(),revisadoEm:new Date().toISOString()};
  $$('competenciaConfirmar').onchange=e=>$$('competenciaSalvar').disabled=!e.target.checked;
  $$('competenciaVoltar').onclick=mostrar;
  $$('competenciaCopia').onclick=()=>download('competencia-'+id+'.json',JSON.stringify(registro,null,2));
  $$('competenciaSalvar').onclick=async()=>{if(!$$('competenciaConfirmar').checked)return;const btn=$$('competenciaSalvar');btn.disabled=true;$$('competenciaVoltar').disabled=true;$$('competenciaConfirmar').disabled=true;try{const res=await DRECompetencia.salvar({api,admin:state.permissoes.admin,id,original,registro});if(session!==STORE_KEY||!state.D)return;state.cfg=res.cfg;state.cfgVersion=res.atualizadoEm;$$('detailDialog').close();render();toast('Competência de '+label+' salva e confirmada na nuvem.');}catch(err){if($$('competenciaSaveErro'))$$('competenciaSaveErro').textContent=err.message;else toast(err.message,'err');btn.disabled=false;if($$('competenciaVoltar'))$$('competenciaVoltar').disabled=false;if($$('competenciaConfirmar'))$$('competenciaConfirmar').disabled=false;}};
 };
 mostrar();
}

function exportarDRECSV(){
 const d=dadosDRE(),mensal=typeof gestaoUI!=='undefined'&&gestaoUI.dre==='mes',indices=mensal?[d.ate-1,d.cols.findIndex(x=>x.label===state.comparar)].filter(i=>i>=0):d.cols.map((_,i)=>i);
 const rows=[[(d.competencia?'DRE por competência':'Caixa gerencial'),...indices.map(i=>d.cols[i].label),'Acumulado até '+state.periodo],['Situação',...indices.map(i=>d.competencia?statusCompetencia(d.cols[i].comp):F.qualidade(d.cols[i].reg).rotulo),'Depende de todos os meses e do mesmo escopo'],['Empresa / escopo',...indices.map(i=>(d.competencia?d.cols[i].comp:d.cols[i].reg)?.company||'Não informado'),''],...d.linhas.map(r=>[r.nome,...[...indices.map(i=>d.valores[i]),d.soma].map(v=>v[r.id]==null?'Não apurado':v[r.id].toFixed(r.tipo==='ratio'?4:2).replace('.',',')+(r.tipo==='ratio'?'%':''))])];
 if(!d.competencia)rows.push(...dreSimplesCSV(indices,d.cols));
 download('dre-'+dreUI.base+'-'+(mensal?safeId(state.periodo):state.periodo.split('/')[1])+'.csv','\ufeff'+rows.map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv');
}

/* ── DRE SIMPLES (Fase 3) ───────────────────────────────────────────────
   Da venda ao resultado, nas duas bases, sempre com o percentual sobre as
   VENDAS. Caixa: linhas montadas pelas contas do plano (DRESimples), com a
   composição conta a conta e a ponte até a variação do caixa. Competência:
   as rubricas informadas, com o DAS da guia (paga no mês seguinte) ao lado
   para conferir. Mês sem dados é "Não apurado"; mês em andamento é marcado. */
// Para onde a linha "melhora" na comparação. Dívida, empréstimo, investimento e a
// própria variação do caixa (que sobe com empréstimo) nunca são bons nem ruins.
const DIRECAO_SIMPLES={vendas:1,das:-1,impostosVendas:-1,devolucoes:-1,receitaLiquida:1,variaveis:-1,margemContribuicao:1,fixas:-1,pessoal:-1,ocupacao:-1,administrativas:-1,veiculos:-1,maquinas:-1,marketing:-1,taxas:-1,fixasOutras:-1,ebitda:1,receitasFinanceiras:1,despesasFinanceiras:-1,resultado:1,socios:0,investimentos:0,dividas:0,transferencias:0,semDetalhamento:0,emprestimos:0,aIdentificar:0,foraOutras:0,variacao:0};
function dreMesDesloca(label,n){const [m,a]=String(label||'').split('/'),i=PT_MON.findIndex(x=>x.toLowerCase()===String(m||'').toLowerCase());if(i<0||!/^\d{4}$/.test(a||''))return null;const t=Number(a)*12+i+n;return PT_MON[((t%12)+12)%12]+'/'+Math.floor(t/12);}
const drePct=(v,d=1)=>v==null||!Number.isFinite(v)?'—':(Math.round(v*10**d)/10**d+0).toLocaleString('pt-BR',{maximumFractionDigits:d})+'%';
const dreDia=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||'')?`${iso.slice(8,10)}/${iso.slice(5,7)}`:'';
const dreMesmoMes=(a,b)=>a&&b&&monthSortKey(a)===monthSortKey(b);
// Cor do dinheiro: subtotal pelo sinal; linha de entrada ou saída pelo sentido.
function dreTomSimples(l,v){if(v==null||!v)return '';if(['subtotal','resultado'].includes(l.tipo))return v>0?'tom-entra':'tom-sai';return v*l.sentido>0?'tom-entra':'tom-sai';}
function drePainel(titulo,descricao,html,largo=false){return `<section class="chart-card dre-grafico${largo?' dre-grafico-largo':''}"><div class="chart-heading"><div><h3>${esc(titulo)}</h3><p>${esc(descricao)}</p></div></div>${html}</section>`;}
// Card que leva à composição conta a conta ("clique nos valores para ver a origem").
function dreCartao(rotulo,valor,nota,tom=''){return `<button type="button" class="metric metric-param" data-dre-origem><span class="label">${esc(rotulo)}</span><strong class="${tom}">${esc(valor)}</strong><small>${esc(nota)}</small></button>`;}
// Mês do caixa: apuração (guardada por registro, para não refazer a cada render),
// qualidade e marcação de mês em andamento. Casa o mês sem depender de maiúsculas.
const dreCacheApuracao=new WeakMap();
function dreMesCaixa(label){
 const reg=label?state.records.find(r=>dreMesmoMes(r.label,label))||null:null;
 let a=null;if(reg){if(!dreCacheApuracao.has(reg))dreCacheApuracao.set(reg,DRESimples.apurar(reg));a=dreCacheApuracao.get(reg);}
 const q=reg?F.qualidade(reg):null;return {label,reg,a,parcial:!!q?.parcial,ate:q?.coletadoAte||null};
}
const dreAteTexto=m=>m?.parcial?` · coletado até ${dreDia(m.ate)||'agora'} (mês em andamento)`:'';
const dreMesesDoAno=label=>PT_MON.map(x=>x+'/'+String(label||'').split('/')[1]);
function dreCascataCaixa(m){
 const l=m.a.linhas,neg=v=>v?-v:0;
 return gCascata([
  {rotulo:'Receita bruta de vendas',curto:'Vendas',valor:l.vendas,total:true},{rotulo:'(−) DAS do mês',curto:'DAS',valor:neg(l.das)},{rotulo:'(−) ICMS, DIFAL e ISS',curto:'ICMS/ISS',valor:neg(l.impostosVendas)},{rotulo:'(−) Devoluções',curto:'Devol.',valor:neg(l.devolucoes)},
  {rotulo:'(=) Receita líquida',curto:'Líquida',valor:l.receitaLiquida,total:true},{rotulo:'(−) Custos variáveis',curto:'Variáveis',valor:neg(l.variaveis)},{rotulo:'(=) Margem de contribuição',curto:'Margem',valor:l.margemContribuicao,total:true},
  {rotulo:'(−) Despesas fixas',curto:'Fixas',valor:neg(l.fixas)},{rotulo:'(=) EBITDA de caixa',curto:'EBITDA',valor:l.ebitda,total:true},{rotulo:'(+/−) Financeiro',curto:'Financ.',valor:l.receitasFinanceiras-l.despesasFinanceiras},{rotulo:'(=) Resultado do mês',curto:'Resultado',valor:l.resultado,total:true}
 ],{base:l.vendas>0?l.vendas:0});
}
// Tabela de comparação. Linha de detalhe ou da ponte zerada nos dois meses só ocupa espaço.
function dreComparacao(linhas,valA,valB,pctA,pctB,{rotuloA,rotuloB,pode=true,motivo='',ressalva=false,parcialB=false}){
 const corpo=linhas.filter(l=>!(['detalhe','detail','ponte'].includes(l.tipo)&&!valA(l.id)&&!valB(l.id))).map(l=>{
  const a=valA(l.id),b=valB(l.id),delta=pode&&a!=null&&b!=null?Math.round((a-b)*100)/100:null,dir=DIRECAO_SIMPLES[l.id]??(l.sentido||0);
  const tom=delta==null||!delta||!dir?'':((delta>0)===(dir>0)?'delta-bom':'delta-ruim'),pa=pctA(l.id),pb=pctB(l.id),pp=pode&&pa!=null&&pb!=null?Math.round((pa-pb)*10)/10:null;
  return `<tr class="dre-l-${esc(l.tipo)}"><th scope="row">${esc(l.nome)}</th><td class="num ${dreTomSimples(l,a)}">${valorDRE(a)}</td><td class="num">${pa==null?'—':esc(drePct(pa))}</td><td class="num ${dreTomSimples(l,b)}">${valorDRE(b)}</td><td class="num">${pb==null?'—':esc(drePct(pb))}</td><td class="num"><span class="${tom}">${delta==null?'—':`${delta>0?'▲':delta<0?'▼':'■'} ${esc(money(delta))}`}</span></td><td class="num">${pp==null?'—':pp===0?'0 p.p.':esc((pp>0?'+':'')+pp.toLocaleString('pt-BR',{maximumFractionDigits:1})+' p.p.')}</td></tr>`;
 }).join('');
 return `<div class="table-scroll"><table class="tabela-controle dre-comparacao"><caption>${esc(rotuloA)} contra ${esc(rotuloB)}${parcialB?' *':''} · % sobre as vendas${pode?'':` · sem comparação: ${esc(motivo||'bases diferentes')}`}${ressalva?' · cobertura a conferir nos dois meses':''}</caption><thead><tr><th scope="col">Linha</th><th scope="col" class="num">${esc(rotuloA)}</th><th scope="col" class="num">%</th><th scope="col" class="num">${esc(rotuloB)}${parcialB?' *':''}</th><th scope="col" class="num">%</th><th scope="col" class="num">Δ R$</th><th scope="col" class="num">Δ p.p.</th></tr></thead><tbody>${corpo}</tbody></table></div>`;
}
function dreComposicao(m){
 const a=m.a,vendas=a.linhas.vendas,secoes=DRESimples.LINHAS.filter(l=>a.composicao[l.id]?.length);
 const linha=(l,x)=>`<tr><th scope="row"><button data-account="${esc(x.code)}">${esc(x.name)}</button> <small class="param-conta">${esc(x.code)}${x.residuo?' · além das subcontas':''}</small>${x.conferir?` <span class="origem-dado origem-padrao">${esc(x.conferir)}</span>`:''}${x.nota?` <small class="dre-nota">${esc(x.nota)}</small>`:''}</th><td class="num ${dreTomSimples(l,x.valor)}">${valorDRE(x.valor)}</td><td class="num">${vendas>0?esc(drePct(x.valor/vendas*100)):'—'}</td></tr>`;
 const fecha=Math.abs(a.diferenca)<.01?`<p class="hint">A DRE inteira fecha com o caixa do ERP: entradas menos saídas de ${esc(m.label)} = ${esc(money(a.caixa))}.</p>`:`<p class="param-avisos">Diferença de ${esc(money(a.diferenca))} entre a soma das linhas e o caixa do ERP (${esc(money(a.caixa))}): confira no Plano de contas.</p>`;
 return `<details class="card dre-composicao"><summary>De onde vem cada linha · contas do plano em ${esc(m.label)}${a.conferir.length?` · ${a.conferir.length} a conferir`:''}</summary><div class="card-body"><p class="hint">Cada conta entra na linha da regra mais específica do plano. Clique na conta para ver a origem. Percentual sobre as vendas.</p>${fecha}<div class="table-scroll"><table class="tabela-controle dre-composicao-tabela"><caption>Contas do plano por linha da DRE · ${esc(m.label)} · % sobre as vendas</caption><thead><tr><th scope="col">Conta</th><th scope="col" class="num">Valor</th><th scope="col" class="num">% das vendas</th></tr></thead>${secoes.map(l=>`<tbody><tr class="dre-composicao-grupo"><th scope="rowgroup" colspan="3">${esc(l.nome)} · ${esc(money(a.linhas[l.id]))}</th></tr>${a.composicao[l.id].map(x=>linha(l,x)).join('')}</tbody>`).join('')}</table></div></div></details>`;
}
function dreMesesSimples(label,ms){
 const ate=ms.findIndex(m=>dreMesmoMes(m.label,label)),linhas=DRESimples.LINHAS;
 const acum=id=>{if(ate<0)return null;const vs=ms.slice(0,ate+1).map(m=>m.a?.linhas[id]);return !vs.length||vs.some(v=>v==null)?null:vs.reduce((t,v)=>t+Math.round(v*100),0)/100;};
 return `<details class="card"><summary>DRE Simples mês a mês · ${esc(String(label).split('/')[1])}</summary><div class="card-body"><div class="table-scroll"><table class="tabela-controle dre-simples-meses"><caption>Base de caixa · R$ · — = mês sem dados · * = mês em andamento</caption><thead><tr><th scope="col">Linha</th>${ms.map(m=>`<th scope="col" class="num ${dreMesmoMes(m.label,label)?'selected-month':''}">${esc(m.label)}${m.parcial?' *':''}</th>`).join('')}<th scope="col" class="num">Acumulado até ${esc(String(label).split('/')[0])}</th></tr></thead><tbody>${linhas.map(l=>`<tr class="dre-l-${esc(l.tipo)}"><th scope="row">${esc(l.nome)}</th>${ms.map(m=>`<td class="num ${dreMesmoMes(m.label,label)?'selected-month':''} ${dreTomSimples(l,m.a?.linhas[l.id])}">${valorDRE(m.a?m.a.linhas[l.id]:null)}</td>`).join('')}<td class="num ${dreTomSimples(l,acum(l.id))}">${valorDRE(acum(l.id))}</td></tr>`).join('')}</tbody></table></div><p class="hint">O acumulado fica sem valor quando falta algum mês. Mês em andamento entra como está, marcado com *.</p></div></details>`;
}
function dreSimplesCaixa(){
 const label=state.periodo,m=dreMesCaixa(label),meses=dreMesesDoAno(label).map(x=>dreMesmoMes(x,label)?m:dreMesCaixa(x)),sel=meses.findIndex(x=>x===m);
 const tendencia=gLinhaArea(meses.map(x=>({rotulo:x.label.slice(0,3),valor:x.a&&!x.parcial?x.a.margens.margemContribuicao:null})),{selecionado:sel,titulo:'Margem de contribuição sobre as vendas',formato:v=>drePct(v),rotulo:'Margem de contribuição',cor:'marca'});
 const painelTendencia=drePainel('A margem de contribuição está melhorando?','Percentual sobre as vendas, mês a mês. Mês sem dados ou em andamento fica hachurado.',tendencia,true);
 if(!m.a){
  // Sem o mês: os cards dizem o que falta e como resolver; o ano continua visível.
  const como='Use “Atualizar Mubisys” (mês atual e anterior) ou importe a planilha do mês.';
  return {cards:`<div class="cards cards-controle">${dreCartao(`Vendas · ${label}`,'Não apurado',`${label} sem dados coletados. ${como}`)}${['Margem de contribuição','Resultado operacional (EBITDA de caixa)','Resultado do mês'].map(t=>dreCartao(t,'Não apurado','Depende das vendas do mês.')).join('')}</div>`,
   resto:`<div class="graficos-controle">${drePainel(`Da venda ao resultado · ${label}`,'Sem dados do mês.',GX.aviso('cascata',`Não apurado: ${label} sem dados coletados.`),true)}${painelTendencia}</div>${dreMesesSimples(label,meses)}`};
 }
 const l=m.a.linhas,g=m.a.margens,ate=dreAteTexto(m),tom=v=>m.parcial?'':v>0?'tom-entra':v<0?'tom-sai':'';
 const cards=`<div class="cards cards-controle">${dreCartao(`Vendas · ${label}`,money(l.vendas),`Receita bruta de vendas${ate}`,l.vendas>0?'tom-entra':'')}${dreCartao('Margem de contribuição',money(l.margemContribuicao),`${drePct(g.margemContribuicao)} das vendas, depois do DAS, impostos, devoluções e custos variáveis${ate}`,tom(l.margemContribuicao))}${dreCartao('Resultado operacional (EBITDA de caixa)',money(l.ebitda),`${drePct(g.ebitda)} das vendas, depois das despesas fixas${ate}`,tom(l.ebitda))}${dreCartao('Resultado do mês',money(l.resultado),`${drePct(g.resultado)} das vendas, antes de retiradas, investimentos e dívidas${ate}`,tom(l.resultado))}</div>`;
 const graficos=`<div class="graficos-controle">${drePainel(`Da venda ao resultado · ${label}`,`Cada degrau com o percentual sobre as vendas${ate}. Toque num degrau para ver o valor.`,dreCascataCaixa(m),true)}${painelTendencia}</div>`;
 const outro=state.comparar||dreMesDesloca(label,-1),mb=dreMesCaixa(outro);
 let comparacao;
 if(!mb.a)comparacao=card(`Comparação · ${label} contra ${outro}`,`<p class="hint">${esc(outro)} sem dados coletados: escolha outro mês em “Comparação”, no topo.</p>`,false);
 else{const c=F.comparavelComRessalva(m.reg,mb.reg);
  comparacao=card(`Comparação · ${label} contra ${outro}${c.pode?'':' · sem comparação'}`,dreComparacao(DRESimples.LINHAS,id=>m.a.linhas[id],id=>mb.a.linhas[id],id=>m.a.pct(id),id=>mb.a.pct(id),{rotuloA:label,rotuloB:outro,pode:!!c.pode,motivo:c.motivo,ressalva:!!c.ressalva,parcialB:mb.parcial})+`<p class="hint">Mude o mês em “Comparação”, no topo. Sócios, investimentos, dívidas e empréstimos aparecem sem cor: pegar ou pagar empréstimo muda o caixa, mas não é bom nem ruim por si.</p>`,!!c.pode);}
 return {cards,resto:graficos+comparacao+dreComposicao(m)+dreMesesSimples(label,meses)};
}
// DAS de uma competência pelas guias do mês seguinte (total pago no DAS, sem o
// parcelamento). Usado na tela e no formulário da competência.
function dreDASCompetencia(label){
 const seg=dreMesDesloca(label,1),reg=seg?state.records.find(r=>dreMesmoMes(r.label,seg))||null:null,guia=DRESimples.dasDaGuia(reg),q=reg?F.qualidade(reg):null;
 return {seg,reg,guia,parcial:!!q?.parcial,ate:q?.coletadoAte||null};
}
function dreDASTexto(label,d){
 const {seg,reg,guia,parcial,ate}=d;
 if(!reg)return `${seg} ainda sem dados: a guia da competência ${label} vence no mês seguinte.`;
 if(!guia.temGuia)return parcial?`${seg} em andamento: guia da competência ${label} ainda não paga até ${dreDia(ate)}.`:`Nenhuma guia do DAS lançada em ${seg}.`;
 const emp=n=>n==null?'sem guia':money(n);
 return `DAS da competência ${label} pago em ${seg}: ${money(guia.total)} (Impresilk ${emp(guia.impresilk)} · Universo ${emp(guia.universo)}${guia.resto?` · ${money(guia.resto)} no DAS fora das subcontas, a conferir`:''})${parcial?`, até ${dreDia(ate)} (mês em andamento)`:''}.`;
}
function dreSimplesCompetencia(d){
 const i=d.ate-1,col=d.cols[i],v=d.valores[i]||{};if(!col?.comp)return '';
 const label=col.label,das=dreDASCompetencia(label);
 const desp=['despesasVendas','administrativas','outrasDespesas'].reduce((t,k)=>t==null||v[k]==null?null:t+v[k],0),outras=['outrasReceitas','equivalencia'].reduce((t,k)=>t==null||v[k]==null?null:t+v[k],0);
 const ir=(v.tributosLucro||0)+(v.tributosDiferidos||0),neg=x=>x==null?null:x?-x:0;
 const passos=[{rotulo:'Receita bruta',curto:'Bruta',valor:v.bruta,total:true},{rotulo:'(−) Tributos sobre vendas (DAS e fora dele)',curto:'Tributos',valor:neg(v.tributosVendas)},{rotulo:'(−) Devoluções e descontos',curto:'Devol.',valor:v.devolucoes==null||v.descontos==null?null:neg(v.devolucoes+v.descontos)},{rotulo:'(=) Receita líquida',curto:'Líquida',valor:v.liquida,total:true},{rotulo:'(−) Custos',curto:'Custos',valor:neg(v.custos)},{rotulo:'(=) Lucro bruto',curto:'Bruto',valor:v.bruto,total:true},{rotulo:'(−) Despesas operacionais',curto:'Despesas',valor:desp==null||outras==null?null:(outras-desp)+0},{rotulo:'(=) Resultado operacional',curto:'Operac.',valor:v.operacional,total:true},{rotulo:'(+/−) Financeiro',curto:'Financ.',valor:v.financeiro},...(ir?[{rotulo:'(−) IRPJ e CSLL fora do Simples',curto:'IR/CSLL',valor:-ir}]:[]),...(v.descontinuadas?[{rotulo:'(+/−) Descontinuadas',curto:'Descont.',valor:v.descontinuadas}]:[]),{rotulo:'(=) Lucro líquido',curto:'Líquido',valor:v.liquido,total:true}];
 const pctBruta=(x,base)=>base>0&&x!=null?x/base*100:null;
 let nota=dreDASTexto(label,das);
 if(das.reg)nota+=` Informado em “Tributos sobre vendas”: ${v.tributosVendas==null?'não informado':money(v.tributosVendas)}${v.tributosVendas!=null&&das.guia.temGuia&&!das.parcial&&v.tributosVendas+.005<das.guia.total?' — menor que o DAS pago: confira':''}.`;
 // Mês de comparação: o escolhido no topo (qualquer ano) ou o anterior, mesmo em janeiro.
 const outroLabel=state.comparar||dreMesDesloca(label,-1),outroComp=outroLabel?DRECompetencia.obter(state.cfg,safeId(outroLabel)):null,vb=outroComp?DREModelo.calcular(outroComp.valores||{}):null;
 const pode=!!outroComp&&String(outroComp.company||'').trim().toLowerCase()===String(col.comp.company||'').trim().toLowerCase();
 const linhasCmp=DREModelo.linhas.filter(r=>r.tipo!=='detail'&&r.tipo!=='ratio'&&r.tipo!=='info').map(r=>({id:r.id,nome:r.nome,tipo:r.tipo==='result'?'resultado':r.tipo,sentido:DIRECAO_DA_LINHA[r.id]||0}));
 const comparacao=!outroLabel?'':!outroComp?card(`Comparação · ${label} contra ${outroLabel}`,`<p class="hint">${esc(outroLabel)} sem apuração por competência: escolha outro mês em “Comparação”, no topo.</p>`,false):card(`Comparação · ${label} contra ${outroLabel}${pode?'':' · sem comparação'}`,dreComparacao(linhasCmp,id=>v[id]??null,id=>vb[id]??null,id=>pctBruta(v[id],v.bruta),id=>pctBruta(vb[id],vb.bruta),{rotuloA:label,rotuloB:outroLabel,pode,motivo:'empresas diferentes nas duas apurações'}),pode);
 const tendencia=gLinhaArea(d.cols.map((x,k)=>({rotulo:x.label.slice(0,3),valor:x.comp?pctBruta(d.valores[k].liquido,d.valores[k].bruta):null})),{selecionado:i,titulo:'Lucro líquido sobre a receita bruta',formato:x=>drePct(x),rotulo:'Lucro líquido / receita bruta',cor:'marca'});
 return `<p class="note dre-das-ref">${esc(nota)}</p><div class="graficos-controle">${drePainel(`Da receita ao lucro · ${label}`,'Competência informada; cada degrau com o percentual sobre a receita bruta. No Simples, IRPJ e CSLL estão dentro do DAS.',gCascata(passos,{base:v.bruta>0?v.bruta:0}),true)}${drePainel('O lucro sobre a receita está melhorando?','Lucro líquido sobre a receita bruta, nos meses com apuração.',tendencia,true)}</div>${comparacao}<p class="hint">A composição conta a conta fica na base de caixa; na competência, as rubricas vêm da apuração informada.</p>`;
}
// Planilha: na base de caixa, a DRE Simples vai junto do movimento do caixa.
function dreSimplesCSV(indices,cols){
 const ms=indices.map(i=>dreMesCaixa(cols[i].label));
 return [[],['DRE Simples (base de caixa)',...ms.map(m=>m.label+(m.parcial?' (em andamento)':'')),'% das vendas em '+state.periodo],...DRESimples.LINHAS.map(l=>{const sel=dreMesCaixa(state.periodo);return [l.nome,...ms.map(m=>m.a?m.a.linhas[l.id].toFixed(2).replace('.',','):'Não apurado'),sel.a&&sel.a.pct(l.id)!=null?sel.a.pct(l.id).toFixed(2).replace('.',',')+'%':'Não apurado'];})];
}
