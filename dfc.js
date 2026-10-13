/* ── FLUXO DE CAIXA (DFC, método direto) · Fase 4 ─────────────────────────
   Sai das mesmas linhas da DRE Simples (DRESimples.apurar), para as duas telas
   nunca discordarem:
   - FCO (operação): vendas, rendimentos, Simples (DAS e DARF), ISS, devoluções,
     custos variáveis, despesas fixas e juros/tarifas (juros pagos ficam na
     operação). Entradas a identificar e saídas sem detalhamento também, marcadas.
   - FCI (investimento): compras de máquinas e veículos e parcelas de ativos.
   - FCF (financiamento): empréstimos recebidos, dívidas pagas (o parcelamento do
     DAS à parte), retiradas e arrendamento, transferências entre as empresas.
   Geração = FCO + FCI + FCF, que fecha com entradas − saídas do ERP.
   Saldo final = saldo inicial + geração. O saldo inicial vem de Parâmetros ou,
   sem ele, do saldo final do mês anterior (contíguo, fechado e que fecha com o
   ERP). Quando a sequência para, a tela diz onde e por quê; quando o informado
   difere do calculado, a diferença vira "ajuste" e aparece. Nada é inventado. */
const DFC_LINHAS=[
 ['fco','Caixa da operação (FCO)','bloco',1,''],
 ['vendas','(+) Recebimentos de vendas','item',1,'fco'],['receitasFinanceiras','(+) Rendimentos e outras receitas','item',1,'fco'],
 ['aIdentificar','(+) Entradas a identificar','item',1,'fco'],['foraOutras','(+) Entradas sem linha na DRE','item',1,'fco'],
 ['das','(−) Simples do mês (DAS e DARF)','item',-1,'fco'],['impostosVendas','(−) ISS fora do DAS','item',-1,'fco'],['devolucoes','(−) Devoluções a clientes','item',-1,'fco'],
 ['variaveis','(−) Custos variáveis pagos','item',-1,'fco'],['fixas','(−) Despesas fixas','item',-1,'fco'],['despesasFinanceiras','(−) Juros, tarifas e IOF','item',-1,'fco'],
 ['semDetalhamento','(−) Saídas sem detalhamento','item',-1,'fco'],
 ['fci','Investimentos (FCI)','bloco',1,''],
 ['investimentos','(−) Compras de máquinas, veículos e parcelas de ativos','item',-1,'fci'],
 ['fcf','Financiamentos (FCF)','bloco',1,''],
 ['emprestimos','(+) Empréstimos recebidos','item',1,'fcf'],['parcelamentoDAS','(−) Parcelamento do DAS','item',-1,'fcf'],['dividasOutras','(−) Empréstimos, antecipações e outras dívidas pagas','item',-1,'fcf'],
 ['socios','(−) Retiradas e arrendamento','item',-1,'fcf'],['transferencias','(−) Transferências entre empresas','item',-1,'fcf'],
 ['geracao','(=) Geração de caixa do mês','total',1,''],['saldoInicial','Saldo inicial','saldo',1,''],['ajustes','(±) Ajuste de saldo informado','saldo',1,''],['saldoFinal','(=) Saldo final','saldo',1,'']
].map(([id,nome,tipo,sentido,bloco])=>({id,nome,tipo,sentido,bloco}));
const DFC_ITENS=DFC_LINHAS.filter(l=>l.tipo==='item');
// Cor pelo sentido do dinheiro (entrou azul, saiu vermelho), também no financiamento
// e no mês em andamento. Só o ajuste de saldo, que é acerto de conferência, fica sem cor.
const DFC_NEUTRAS=new Set(['ajustes']);
// Linhas da DRE Simples que entram em cada bloco (o parcelamento do DAS sai das dívidas).
const DFC_BLOCO_DA_LINHA={vendas:'fco',receitasFinanceiras:'fco',aIdentificar:'fco',foraOutras:'fco',das:'fco',impostosVendas:'fco',devolucoes:'fco',variaveis:'fco',
 pessoal:'fco',ocupacao:'fco',administrativas:'fco',veiculos:'fco',marketing:'fco',taxas:'fco',fixasOutras:'fco',despesasFinanceiras:'fco',semDetalhamento:'fco',
 investimentos:'fci',emprestimos:'fcf',dividas:'fcf',socios:'fcf',transferencias:'fcf'};
const dfcCent=v=>Math.round(Number(v)*100);
const dfcPrefixo=(c,p)=>c===p||c.startsWith(p+'.');
const dfcRedondo=v=>Math.round(v*100)/100+0;

// Um mês: valores das linhas (positivos no sentido da linha) e os três blocos.
function dfcApurar(reg){
 const a=typeof DRESimples!=='undefined'?DRESimples.apurar(reg):null;if(!a)return null;
 const l=a.linhas,c=k=>dfcCent(l[k]||0);
 const parc=(a.composicao.dividas||[]).filter(x=>dfcPrefixo(x.code,'2.4.1.1')).reduce((t,x)=>t+dfcCent(x.valor),0);
 const v={vendas:c('vendas'),receitasFinanceiras:c('receitasFinanceiras'),aIdentificar:c('aIdentificar'),foraOutras:c('foraOutras'),das:c('das'),impostosVendas:c('impostosVendas'),devolucoes:c('devolucoes'),
  variaveis:c('variaveis'),fixas:c('fixas'),despesasFinanceiras:c('despesasFinanceiras'),semDetalhamento:c('semDetalhamento'),investimentos:c('investimentos'),
  emprestimos:c('emprestimos'),parcelamentoDAS:parc,dividasOutras:c('dividas')-parc,socios:c('socios'),transferencias:c('transferencias')};
 const bloco=b=>DFC_ITENS.filter(i=>i.bloco===b).reduce((t,i)=>t+i.sentido*v[i.id],0);
 const fco=bloco('fco'),fci=bloco('fci'),fcf=bloco('fcf'),geracao=fco+fci+fcf;
 const r=n=>n/100+0;
 return {valores:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,r(x)])),fco:r(fco),fci:r(fci),fcf:r(fcf),geracao:r(geracao),caixa:a.caixa,
  diferenca:dfcRedondo(r(geracao)-a.caixa),composicao:a.composicao,conferir:a.conferir};
}
// Mês do caixa com a apuração do DFC e a marca de mês parcial: em andamento (o mês
// ainda corre) ou incompleto (já acabou, mas a coleta ou a planilha parou antes do fim).
const dfcCache=new WeakMap();
function dfcHoje(){const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;}
// Até onde a rotina do Mubisys alcança: coleta o mês atual e o anterior e relê, de vez
// em quando, os dois antes deles se vieram do ERP; o resto só por planilha.
const dfcAlcance=(label,n)=>{const h=dfcHoje(),k=monthSortKey(PT_MON[Number(h.slice(5,7))-1]+'/'+h.slice(0,4));return monthSortKey(label)>=k-n;};
function dfcMes(label){
 const reg=label?state.records.find(r=>monthSortKey(r.label)===monthSortKey(label))||null:null;
 let d=null;if(reg){if(!dfcCache.has(reg))dfcCache.set(reg,dfcApurar(reg));d=dfcCache.get(reg);}
 const q=reg?F.qualidade(reg):null,per=reg?F.periodo(reg.label):null;
 const parcial=!!q?.parcial||!!(per&&q?.coletadoAte&&q.coletadoAte<per.ate);
 return {label,reg,d,parcial,ate:q?.coletadoAte||null,origem:reg?.origem||null,emAndamento:parcial&&!!per&&per.ate>=dfcHoje()};
}
const dfcMesDesloca=(label,n)=>typeof dreMesDesloca==='function'?dreMesDesloca(label,n):null;
const dfcSaldoInformado=label=>{const v=typeof paramOperacao==='function'?paramOperacao(label)?.saldoInicial:null;return v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);};
// Meses com saldo inicial informado em Parâmetros, com ou sem dados coletados.
function dfcInformados(){
 const op=state.cfg?.parametros?.operacao||{};
 return Object.keys(op).map(k=>{const x=/^(\d{4})-(\d{2})$/.exec(k);return x&&PT_MON[+x[2]-1]?PT_MON[+x[2]-1]+'/'+x[1]:null;}).filter(l=>l&&dfcSaldoInformado(l)!=null).map(label=>({label,key:monthSortKey(label)})).sort((a,b)=>a.key-b.key);
}
// Saldos de todos os meses com registro, em ordem, uma vez por tela. A sequência
// passa de um mês para o seguinte só se o anterior existe, é contíguo, está fechado
// e fecha com o ERP; senão o motivo da parada fica guardado. O ajuste é a diferença
// entre o saldo informado e o final mostrado do mês anterior (mesmo parcial), para
// cada coluna fechar: saldo inicial + ajuste + geração = saldo final.
function dfcSaldos(){
 const regs=[...state.records].filter(r=>monthSortKey(r.label)!=null).sort((a,b)=>monthSortKey(a.label)-monthSortKey(b.label));
 const informados=dfcInformados(),comRegistro=new Set(regs.map(r=>monthSortKey(r.label)));
 const res=new Map();let prev=null;
 for(const r of regs){
  const k=monthSortKey(r.label);if(res.has(k))continue;
  const m=dfcMes(r.label),informado=dfcSaldoInformado(r.label),ult=informados.filter(x=>x.key<k).pop()||null,contiguo=!!prev&&prev.key===k-1;let calculado=null,quebra=null;
  // O que impede a sequência de passar do mês anterior (com ou sem buraco depois dele).
  const causa=!prev?null:prev.final==null?(prev.quebra||{motivo:'mes-sem-dados',mes:prev.label,mesAte:prev.label}):prev.parcial?{motivo:'anterior-parcial',mes:prev.label,ate:prev.ate,planilha:prev.origemReg!=='erp'}:prev.diferenca?{motivo:'nao-fecha',mes:prev.label,dif:prev.diferenca}:null;
  if(!prev)quebra=ult?{motivo:'mes-sem-dados',mes:ult.label,mesAte:dfcMesDesloca(r.label,-1)}:{motivo:'sem-saldo'};
  else if(!contiguo){
   // Buraco: com saldo informado dentro dele, a sequência recomeça ali; senão, se ela já
   // não passava do mês anterior, vale a causa mais antiga e o buraco entra como "depois".
   const dentro=!!ult&&ult.key>prev.key,buraco={mes:dentro?ult.label:dfcMesDesloca(prev.label,1),mesAte:dfcMesDesloca(r.label,-1)};
   if(dentro||!causa)quebra={motivo:'mes-sem-dados',...buraco};
   else if(causa.motivo==='mes-sem-dados'&&causa.mesAte===prev.label&&!causa.depois?.length)quebra={...causa,mesAte:buraco.mesAte};
   else quebra={...causa,depois:[...(causa.depois||[]),buraco]};
  }
  else if(causa)quebra=causa;
  else calculado=prev.final;
  const inicial=informado!=null?informado:calculado,final=inicial!=null&&m.d?dfcRedondo(inicial+m.d.geracao):null;
  const divergencia=informado!=null&&calculado!=null&&Math.abs(informado-calculado)>=.01?dfcRedondo(informado-calculado):null;
  const base=informado==null?calculado:contiguo&&prev.final!=null?prev.final:null;
  const ajuste=inicial==null?null:informado==null?0:base==null?null:dfcRedondo(informado-base);
  const baseParcial=informado!=null&&base!=null&&prev.parcial?{mes:prev.label,ate:prev.ate,emAndamento:prev.emAndamento}:null;
  const s={label:r.label,key:k,inicial,origem:informado!=null?'informado':calculado!=null?'calculado':null,final,calculado,divergencia,base,ajuste,baseParcial,
   parcial:m.parcial,emAndamento:m.emAndamento,ate:m.ate,origemReg:m.origem,diferenca:m.d?.diferenca||0,
   quebra:inicial==null?{...quebra,ultimoInformado:ult?.label||null,informadoSemDados:!!ult&&(!comRegistro.has(ult.key)||quebra.motivo==='mes-sem-dados'&&ult.label===quebra.mes)}:null};
  res.set(k,s);prev=s;
 }
 return res;
}
// Saldo de um mês (para a nota e os testes).
const dfcSaldo=(label,saldos=dfcSaldos())=>saldos.get(monthSortKey(label))||null;
const dfcDia=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||'')?`${iso.slice(8,10)}/${iso.slice(5,7)}`:'';
const dfcTom=v=>v>0?'tom-entra':v<0?'tom-sai':'';
// Marca do mês parcial nos cards: até quando há dados, de onde vieram e se o mês ainda corre.
function dfcMarca(m){
 if(!m?.parcial)return '';
 const estado=m.emAndamento?'mês em andamento':'mês incompleto',dia=dfcDia(m.ate)||(m.emAndamento?'agora':'uma data não registrada');
 return m.origem&&m.origem!=='erp'?` · planilha com dados até ${dia} (${estado})`:` · coletado ${m.emAndamento?'':'só '}até ${dia} (${estado})`;
}
function dfcCartao(rotulo,valor,nota,tom=''){return `<div class="metric metric-param"><span class="label">${esc(rotulo)}</span><strong class="${tom}">${esc(valor)}</strong><small>${esc(nota)}</small></div>`;}
function dfcPainel(titulo,descricao,html,largo=true){return `<section class="chart-card dre-grafico${largo?' dre-grafico-largo':''}"><div class="chart-heading"><div><h2>${esc(titulo)}</h2><p>${esc(descricao)}</p></div></div>${html}</section>`;}
// Valor da linha com o sinal do caixa (entrada +, saída −), para a tabela e o CSV.
// Com ajuste, o saldo inicial da coluna é o final do mês anterior e a diferença
// para o informado vem na linha de ajuste.
function dfcValorLinha(m,s,id){
 if(id==='saldoInicial')return s?.inicial==null?null:s.ajuste!=null?s.base:s.inicial;
 if(id==='saldoFinal')return s?.final??null;if(id==='ajustes')return s?.ajuste??null;
 if(!m.d)return null;if(['fco','fci','fcf','geracao'].includes(id))return m.d[id];
 return dfcRedondo(DFC_LINHAS.find(x=>x.id===id).sentido*m.d.valores[id]);
}
// Acumulado de janeiro ao mês escolhido: fluxos e ajustes somados; saldo inicial de
// janeiro, saldo final do mês. Janeiro sem mês anterior para comparar não tem ajuste:
// o acumulado já parte do saldo informado nele.
function dfcAcumulado(meses,saldos,ate,id){
 if(ate<0)return null;
 // Saldos do acumulado só com a cadeia de ajustes completa: senão inicial + geração + ajustes não daria o final.
 if(id==='saldoInicial'||id==='saldoFinal')return dfcAcumulado(meses,saldos,ate,'ajustes')==null?null:id==='saldoInicial'?dfcValorLinha(meses[0],saldos[0],id):saldos[ate]?.final??null;
 const vs=meses.slice(0,ate+1).map((m,i)=>{const v=dfcValorLinha(m,saldos[i],id);return v==null&&id==='ajustes'&&i===0&&saldos[0]?.inicial!=null?0:v;});
 return !vs.length||vs.some(v=>v==null)?null:vs.reduce((t,v)=>t+Math.round(v*100),0)/100+0;
}
const dfcTomLinha=(id,v)=>DFC_NEUTRAS.has(id)?'':dfcTom(v);
const dfcAcumParcial=(meses,ate)=>meses.slice(0,ate+1).filter(m=>m.parcial);
const dfcCardAttrs=(titulo,aberto=false)=>{const a=typeof cardAttrs==='function'?cardAttrs(titulo,aberto):aberto?'open':'';return a?' '+a:'';};
function dfcTabela(label,meses,saldos){
 const ate=meses.findIndex(m=>monthSortKey(m.label)===monthSortKey(label)),sel=m=>monthSortKey(m.label)===monthSortKey(label)?'selected-month':'',acumParcial=dfcAcumParcial(meses,ate).length>0;
 return `<details class="card dfc-mensal"${dfcCardAttrs('Fluxo de caixa mês a mês')}><summary>Fluxo de caixa mês a mês · ${esc(String(label).split('/')[1])}</summary><div class="card-body"><div class="actions"><button type="button" data-dfc-csv>Baixar planilha (CSV)</button></div><div class="table-scroll"><table class="tabela-controle dre-simples-meses dfc-tabela"><caption>Método direto · R$ · entradas positivas, saídas negativas · — = sem dados ou sem mês anterior para comparar · * = mês em andamento ou incompleto (no saldo inicial: final de um mês incompleto)</caption><thead><tr><th scope="col">Linha</th>${meses.map(m=>`<th scope="col" class="num ${sel(m)}">${esc(m.label)}${m.parcial?' *':''}</th>`).join('')}<th scope="col" class="num">Acumulado até ${esc(String(label).split('/')[0])}${acumParcial?' *':''}</th></tr></thead><tbody>${DFC_LINHAS.map(l=>{const acum=dfcAcumulado(meses,saldos,ate,l.id);return `<tr class="dre-l-${l.tipo==='bloco'||l.tipo==='total'?'subtotal':l.tipo==='saldo'?'resultado':'detalhe'}"><th scope="row">${esc(l.nome)}</th>${meses.map((m,i)=>{const v=dfcValorLinha(m,saldos[i],l.id),bp=l.id==='saldoInicial'&&saldos[i]?.baseParcial;return `<td class="num ${sel(m)} ${dfcTomLinha(l.id,v)}">${valorDRE(v)}${bp?' *':''}</td>`;}).join('')}<td class="num ${dfcTomLinha(l.id,acum)}">${valorDRE(acum)}${l.id==='saldoInicial'&&acum!=null&&saldos[0]?.baseParcial?' *':''}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">Em cada coluna, saldo inicial + ajuste + geração = saldo final. Quando o saldo informado em Parâmetros difere do final do mês anterior, o saldo inicial mostra esse final e a diferença vem na linha de ajuste. O acumulado parte do saldo inicial de janeiro e fica sem valor quando falta algum mês. Juros pagos ficam na operação. Entrada em azul e saída em vermelho em todas as linhas, inclusive no financiamento e no mês em andamento; só o ajuste fica sem cor.</p></div></details>`;
}
// Contas de cada bloco: o mesmo mapeamento da DRE Simples, agrupado por FCO/FCI/FCF.
function dfcContas(m){
 const d=m.d,vendas=d.valores.vendas,grupos={fco:[],fci:[],fcf:[]};
 for(const [linha,itens] of Object.entries(d.composicao||{})){const b=DFC_BLOCO_DA_LINHA[linha];if(b)for(const x of itens)grupos[b].push({...x,linha,bloco:b});}
 const nomeBloco={fco:'Caixa da operação (FCO)',fci:'Investimentos (FCI)',fcf:'Financiamentos (FCF)'};
 const comSinal=x=>dfcRedondo((x.code.startsWith('1')?1:-1)*x.valor);
 const mub=x=>{const r=typeof CodigosMubisys!=='undefined'?CodigosMubisys.rotulo(x.code,m.reg):'';return r?' · '+esc(r):'';};
 const linha=x=>`<tr><th scope="row"><button data-account="${esc(x.code)}">${esc(x.name)}</button> <small class="param-conta">${esc(x.code)}${mub(x)}${x.residuo?' · além das subcontas':''}</small>${x.conferir?` <span class="origem-dado origem-padrao">${esc(x.conferir)}</span>`:''}${dfcPrefixo(x.code,'2.4.1.1')?' <small class="dre-nota">parcelamento do DAS: financiamento, não imposto do mês</small>':''}</th><td class="num ${dfcTom(comSinal(x))}">${valorDRE(comSinal(x))}</td><td class="num">${vendas>0?esc(drePct(x.valor/vendas*100)):'—'}</td></tr>`;
 return `<details class="card dfc-contas"${dfcCardAttrs('De onde vem cada bloco')}><summary>De onde vem cada bloco · contas do plano em ${esc(m.label)}${esc(dfcMarca(m))}${d.conferir.length?` · ${d.conferir.length} a conferir`:''}</summary><div class="card-body"><p class="hint">O mesmo mapeamento da DRE Simples: cada conta cai no bloco da sua linha. Clique na conta para ver a origem.</p>${Math.abs(d.diferenca)<.01?`<p class="hint">A geração de caixa fecha com o ERP: entradas menos saídas de ${esc(m.label)} = ${esc(money(d.caixa))}.</p>`:`<p class="param-avisos">A geração ficou ${esc(money(Math.abs(d.diferenca)))} ${d.diferenca<0?'abaixo':'acima'} do caixa do ERP (entradas menos saídas de ${esc(m.label)} = ${esc(money(d.caixa))}): confira no Plano de contas.</p>`}<div class="table-scroll"><table class="tabela-controle dre-composicao-tabela"><caption>Contas por bloco do fluxo de caixa · ${esc(m.label)} · entradas positivas, saídas negativas</caption><thead><tr><th scope="col">Conta</th><th scope="col" class="num">Valor</th><th scope="col" class="num">% das vendas</th></tr></thead>${['fco','fci','fcf'].filter(b=>grupos[b].length).map(b=>`<tbody><tr class="dre-composicao-grupo"><th scope="rowgroup" colspan="3">${esc(nomeBloco[b])} · <span class="${dfcTom(d[b])}">${esc(money(d[b]))}</span></th></tr>${grupos[b].sort((x,y)=>Math.abs(y.valor)-Math.abs(x.valor)).map(linha).join('')}</tbody>`).join('')}</table></div></div></details>`;
}
// O que dizer sobre o saldo do mês: divergência, de onde o saldo parte ou onde a
// sequência parou (a causa mais antiga e os buracos depois dela), com a ação que cabe
// a quem está vendo e que a rotina do Mubisys alcança.
function dfcNotaSaldo(label,s,todos,perm){
 if(!s)return '';
 if(s.divergencia!=null)return `<p class="param-avisos">O saldo inicial informado em Parâmetros (${esc(money(s.inicial))}) é ${esc(money(Math.abs(s.divergencia)))} ${s.divergencia>0?'maior':'menor'} que o saldo final calculado de ${esc(dfcMesDesloca(label,-1))} (${esc(money(s.calculado))}). Pode ser lançamento fora do ERP, tarifa ou conta bancária não coletada: confira. A diferença entra como ajuste na tabela.</p>`;
 if(s.inicial==null){
  const q=s.quebra||{},acao=perm.admin?'<button type="button" data-go="parametros">Informar em Parâmetros</button>':'<button type="button" data-go="parametros">Ver Parâmetros</button>';
  const quem=perm.admin?'Informe':'Peça a um administrador para informar';
  let titulo='Falta o saldo inicial',texto=`${quem} o saldo bancário do início de algum mês em Parâmetros; daí em diante o saldo de cada mês é calculado: saldo final = saldo inicial + geração de caixa.`;
  if(q.motivo&&q.motivo!=='sem-saldo'&&q.ultimoInformado){
   titulo='O saldo calculado parou';
   const faixa=f=>f.mesAte&&f.mesAte!==f.mes?`${f.mes} a ${f.mesAte}`:f.mes,varios=f=>faixa(f)!==f.mes,lista=xs=>xs.length>1?xs.slice(0,-1).join(', ')+' e '+xs[xs.length-1]:xs[0]||'';
   const falta=f=>dfcAlcance(f.mes,1)?[`colete ${faixa(f)}`,`coletar ${faixa(f)}`]:[`importe ${varios(f)?'as planilhas':'a planilha'} de ${faixa(f)}`,`importar ${varios(f)?'as planilhas':'a planilha'} de ${faixa(f)}`];
   const dia=dfcDia(q.ate)||'o meio do mês',depois=q.depois||[];
   let porque=q.motivo==='anterior-parcial'?(q.planilha?`a planilha de ${q.mes} tem dados só até ${dia}`:`${q.mes} foi coletado só até ${dia}`):q.motivo==='nao-fecha'?`a geração de ${q.mes} ficou ${money(Math.abs(q.dif))} ${q.dif<0?'abaixo':'acima'} do caixa do ERP`:`${faixa(q)} ${varios(q)?'não têm':'não tem'} dados${q.informadoSemDados?' para calcular o saldo final':''}`;
   if(depois.length)porque+=`; ${lista(depois.map(faixa))} também ${depois.length>1||varios(depois[0])?'não têm':'não tem'} dados`;
   const raiz=q.motivo==='anterior-parcial'?(q.planilha||!dfcAlcance(q.mes,3)?[`importe de novo a planilha completa de ${q.mes}`,`importar de novo a planilha completa de ${q.mes}`]:[`atualize o Mubisys de ${q.mes}`,`atualizar o Mubisys de ${q.mes}`]):q.motivo==='nao-fecha'?[`confira as contas de ${q.mes} no Plano de contas`,`conferir as contas de ${q.mes}`]:falta(q);
   const acoes=[raiz,...depois.map(falta)],faca=lista(acoes.map(a=>a[0])),fazer=lista(acoes.map(a=>a[1])),virgula=acoes.length>1?',':'';
   const informar=`o saldo inicial de ${label} em Parâmetros`,passo=perm.edicao?`${faca}${virgula} ou ${perm.admin?'informe':'peça para informar'} ${informar}`:`peça para ${fazer}${virgula} ou ${perm.admin?'informe':'para informar'} ${informar}`;
   texto=`${q.informadoSemDados?`O saldo inicial de ${q.ultimoInformado} foi informado, mas`:`O saldo vinha de ${q.ultimoInformado} (informado) e parou porque`} ${porque}. Para seguir, ${passo}.`;
  }
  return `<section class="estado-vazio dfc-sem-saldo"><div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></div>${acao}</section>`;
 }
 // De onde o saldo parte: o último saldo informado até este mês e o ajuste dele.
 const ult=[...todos.values()].filter(x=>x.key<=s.key&&x.origem==='informado').pop();
 if(!ult)return '';
 const comparado=x=>`${money(Math.abs(x.ajuste))} ${x.ajuste>0?'acima':'abaixo'} do saldo final mostrado de ${dfcMesDesloca(x.label,-1)}${x.baseParcial?`, que tem dados só até ${dfcDia(x.baseParcial.ate)||'uma data não registrada'} (${x.baseParcial.emAndamento?'mês em andamento':'mês incompleto'})`:''}`;
 if(ult.key===s.key)return s.ajuste?`<p class="hint">O saldo inicial informado ficou ${esc(comparado(s))}; a diferença está na linha de ajuste da tabela.</p>`:'';
 if(!ult.ajuste)return `<p class="hint">O saldo é calculado a partir do saldo inicial informado em ${esc(ult.label)}.</p>`;
 const ano=ult.label.split('/')[1],onde=ano===String(label).split('/')[1]?'na linha de ajuste da tabela':`na tabela de ${ano}`;
 return `<p class="hint">O saldo segue o saldo inicial informado em ${esc(ult.label)}, que ficou ${esc(comparado(ult))}; a diferença está ${esc(onde)}.</p>`;
}
// Ano inteiro (chip "Ano", Fase 9.1): cartões com o acumulado de janeiro até o último
// mês com dados. Mês sem dados no caminho deixa o acumulado sem valor, dito no cartão
// (a mesma regra do acumulado da tabela); mês parcial no caminho fica marcado.
function dfcCartoesAno(meses,saldos,ate){
 const ult=meses[ate],ano=ult.label.split('/')[1],faltam=meses.slice(0,ate+1).filter(m=>!m.d).map(m=>m.label),parc=dfcAcumParcial(meses,ate);
 const lista0=xs=>xs.length>1?xs.slice(0,-1).join(', ')+' e '+xs[xs.length-1]:xs[0];
 const marca=parc.length?` · inclui ${lista0(parc.map(m=>`${m.label} (${m.emAndamento?'mês em andamento':'mês incompleto'})`))}`:'';
 const v=id=>dfcAcumulado(meses,saldos,ate,id),txt=x=>x==null?'Não apurado':money(x);
 const lista=xs=>xs.length>1?xs.slice(0,-1).join(', ')+' e '+xs[xs.length-1]:xs[0];
 // Meses seguidos viram faixa: "Jan/2026 a Jun/2026".
 const faixas=xs=>{const g=[];for(const l of xs){const k=monthSortKey(l),u=g[g.length-1];if(u&&k===u.k+1){u.fim=l;u.k=k;}else g.push({ini:l,fim:l,k});}return lista(g.map(x=>x.ini===x.fim?x.ini:`${x.ini} a ${x.fim}`));};
 const nota=base=>faltam.length?`${faixas(faltam)} sem dados coletados: sem todos os meses, o acumulado de ${ano} não é somado.`:`${base}, de janeiro a ${ult.label.split('/')[0]} de ${ano}${marca}`;
 const fco=v('fco'),fci=v('fci'),fcf=v('fcf'),saldo=saldos[ate]?.final??null;
 return `<div class="cards cards-controle">${dfcCartao(`Caixa da operação (FCO) · ${ano}`,txt(fco),nota('Vendas e despesas do dia a dia, já com o Simples e os juros'),fco==null?'':dfcTom(fco))}${dfcCartao(`Investimentos (FCI) · ${ano}`,txt(fci),nota('Compras de máquinas e veículos e parcelas de ativos'),fci==null?'':dfcTom(fci))}${dfcCartao(`Financiamentos (FCF) · ${ano}`,txt(fcf),nota('Empréstimos, dívidas, parcelamento do DAS, retiradas, arrendamento e transferências entre as empresas'),fcf==null?'':dfcTom(fcf))}${dfcCartao(`Saldo final · ${ult.label}`,txt(saldo),saldo==null?(!ult.d||!saldos[ate]?`${ult.label} sem dados coletados: o saldo depende do mês coletado.`:'Falta o saldo inicial: veja abaixo onde a sequência parou.'):`Saldo no fim de ${ult.label}, o último mês com dados de ${ano}${dfcMarca(ult)}`,saldo==null?'':dfcTom(saldo))}</div>`;
}
function renderDFC(){
 const label=state.periodo;if(!label||!F.periodo(label))return '<p class="hint">Escolha um mês para ver o fluxo de caixa.</p>';
 const ano=label.split('/')[1],meses=PT_MON.map(x=>dfcMes(x+'/'+ano)),todos=dfcSaldos(),saldos=meses.map(m=>todos.get(monthSortKey(m.label))||null),perm={admin:!!state.permissoes?.admin,edicao:!!state.permissoes?.edicao};
 const sel=meses.findIndex(m=>monthSortKey(m.label)===monthSortKey(label)),m=meses[sel]||dfcMes(label),s=sel>=0?saldos[sel]:null,marca=dfcMarca(m);
 // Ano: de janeiro ao último mês com dados até hoje, calculado aqui (não o mês guardado).
 const fimAno=state.anoTodo&&typeof fimDoAno==='function'?fimDoAno(ano):label,selAno=meses.findIndex(x=>monthSortKey(x.label)===monthSortKey(fimAno)),anoTodo=!!state.anoTodo&&selAno>=0;
 let cards;
 if(anoTodo)cards=dfcCartoesAno(meses,saldos,selAno);
 else if(!m.d)cards=`<div class="cards cards-controle">${dfcCartao(`Caixa da operação (FCO) · ${label}`,'Não apurado',`${label} sem dados coletados. Use “Atualizar Mubisys” ou importe a planilha do mês.`)}${['Investimentos (FCI)','Financiamentos (FCF)','Saldo final'].map(t=>dfcCartao(t,'Não apurado','Depende do mês coletado.')).join('')}</div>`;
 else{
  const saldoTxt=s?.final!=null?money(s.final):'Não apurado';
  const saldoNota=s?.final!=null?`Saldo inicial ${money(s.inicial)} (${s.origem==='informado'?'informado em Parâmetros':'final de '+dfcMesDesloca(label,-1)}) + geração ${money(m.d.geracao)}${marca}`:`Geração do mês ${money(m.d.geracao)}; falta o saldo inicial.`;
  cards=`<div class="cards cards-controle">${dfcCartao(`Caixa da operação (FCO) · ${label}`,money(m.d.fco),`Vendas e despesas do dia a dia, já com o Simples e os juros${marca}`,dfcTom(m.d.fco))}${dfcCartao('Investimentos (FCI)',money(m.d.fci),`Compras de máquinas e veículos e parcelas de ativos${marca}`,dfcTom(m.d.fci))}${dfcCartao('Financiamentos (FCF)',money(m.d.fcf),`Empréstimos, dívidas, parcelamento do DAS, retiradas, arrendamento e transferências entre as empresas${marca}`,dfcTom(m.d.fcf))}${dfcCartao('Saldo final',saldoTxt,saldoNota,s?.final!=null?dfcTom(s.final):'')}</div>`;
 }
 // Gráficos: os três blocos por mês; a operação no ano; e o saldo, num gráfico próprio
 // (no mesmo eixo, um saldo de banco achataria as barras). Mês parcial (*) fica hachurado:
 // os valores dele estão nos cards e na tabela, e entram no gráfico quando o mês fechar.
 const fechado=x=>x.d&&!x.parcial,rot=x=>x.label.slice(0,3)+(x.d&&x.parcial?'*':'');
 const g1=dfcPainel('Para onde foi o caixa em cada mês?','Operação, investimento e financiamento por mês. Hachurado: mês sem dados ou parcial (*); os valores do mês parcial estão nos cards e na tabela.',gEmpilhadas(meses.map(x=>({rotulo:rot(x),valores:fechado(x)?{fco:x.d.fco,fci:x.d.fci,fcf:x.d.fcf}:{},linha:null})),{series:[{chave:'fco',rotulo:'Operação (FCO)',sinal:true},{chave:'fci',rotulo:'Investimento (FCI)'},{chave:'fcf',rotulo:'Financiamento (FCF)'}],selecionado:sel,titulo:'Fluxo de caixa por mês'}));
 const g2=dfcPainel('A operação se paga sozinha?','Caixa da operação mês a mês: acima de zero, a operação gera caixa; abaixo, consome. Mês parcial (*) fica de fora até o mês terminar.',gLinhaArea(meses.map(x=>({rotulo:rot(x),valor:fechado(x)?x.d.fco:null})),{selecionado:sel,titulo:'Caixa da operação',rotulo:'FCO',cor:'resultado'}),false);
 const g3=dfcPainel('Quanto sobrou no banco?','Saldo final de cada mês completo: saldo inicial + ajuste (quando o saldo informado difere) + geração de caixa.',gLinhaArea(meses.map((x,i)=>({rotulo:rot(x),valor:fechado(x)&&saldos[i]?.final!=null?saldos[i].final:null})),{selecionado:sel,titulo:'Saldo final',rotulo:'Saldo final',cor:'marca'}),false);
 // No ano, as contas de cada bloco ficam por mês: a composição de um mês sai ao escolher o mês.
 const contas=anoTodo?`<p class="hint dfc-ano-contas">${esc(`Ano ${ano} inteiro, de janeiro a ${String(fimAno).split('/')[0]}. As contas de cada bloco são mostradas por mês: escolha um mês na barra para ver a composição; o acumulado de cada linha está na tabela abaixo.`)}</p>`:m.d?dfcContas(m):'';
 return cards+dfcNotaSaldo(label,s,todos,perm)+`<div class="graficos-controle">${g1}${g2}${g3}</div>`+contas+dfcTabela(label,meses,saldos);
}
// Planilha do ano (mesmas linhas da tabela, com o acumulado).
function dfcCSV(){
 const label=state.periodo,ano=label.split('/')[1],meses=PT_MON.map(x=>dfcMes(x+'/'+ano)),todos=dfcSaldos(),saldos=meses.map(m=>todos.get(monthSortKey(m.label))||null),ate=meses.findIndex(m=>monthSortKey(m.label)===monthSortKey(label));
 const num=v=>v==null?'Não apurado':v.toFixed(2).replace('.',','),parc=dfcAcumParcial(meses,ate);
 const rows=[['Fluxo de caixa (método direto)',...meses.map(m=>m.label+(m.parcial?(m.emAndamento?' (em andamento)':' (incompleto)'):'')),'Acumulado até '+label+(parc.length?(parc.some(m=>m.emAndamento)?' (inclui mês em andamento)':' (inclui mês incompleto)'):'')],...DFC_LINHAS.map(l=>[l.nome,...meses.map((m,i)=>num(dfcValorLinha(m,saldos[i],l.id))),num(dfcAcumulado(meses,saldos,ate,l.id))])];
 download('fluxo-de-caixa-'+ano+'.csv','﻿'+rows.map(r=>r.map(celulaCSV).join(';')).join('\n'),'text/csv');
 return rows;
}
// Interação: planilha e, ao abrir a tabela, rola até o mês escolhido.
function wireDFC(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('click',e=>{if(e.target?.closest?.('[data-dfc-csv]'))dfcCSV();});
 document.addEventListener('toggle',e=>{const d=e.target;if(!d?.classList?.contains('dfc-mensal')||!d.open)return;const wrap=d.querySelector('.table-scroll'),cel=wrap?.querySelector('thead .selected-month');if(!wrap||!cel)return;const ths=[...wrap.querySelectorAll('thead th')],fixa=ths[0]?.offsetWidth||0,max=wrap.scrollWidth-wrap.clientWidth;let alvo=cel.offsetLeft-fixa;if(alvo>max)alvo=Math.max(0,...ths.slice(1).map(t=>t.offsetLeft-fixa).filter(x=>x<=max));wrap.scrollLeft=Math.max(0,alvo);},true);
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wireDFC);
