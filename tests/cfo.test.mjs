import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
const c={document:{addEventListener(){},querySelectorAll:()=>[]},localStorage:{getItem:()=>null},structuredClone};vm.createContext(c);
for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','pdf-cfo.js','app.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
const F=c.DREFinancas,C=c.DRECFO;
const rec=(values,more={})=>({label:'Ago/2026',company:'Empresa teste',basis:'caixa',origem:'erp',qualidade:{estado:'fechado',ate:'2026-08-31',regra:'v2',escopo:'DRE'},cells:Object.entries(values).map(([code,value])=>({code,value,name:code})),...more});
test('cada fórmula exibida reconcilia o total gerencial no centavo',()=>{
 const codes=[...new Set(Object.values(C.caixa).flat().map(x=>x[0]))];
 for(let i=1;i<=50;i++){const r=rec(Object.fromEntries(codes.map((x,j)=>[x,(i+j)*9.13])));for(const id of Object.keys(C.caixa)){const d=C.decompor(r,id);assert.equal(Math.round(d.value*100),d.partes.reduce((n,x)=>n+Math.round((x.value||0)*100)*x.sinal,0),id);}}
});
test('ausência, zero e fórmula sem totais são distintos',()=>{assert.equal(C.decompor(null,'entradas').value,null);assert.equal(C.decompor(rec({'1':0,'2':0}),'variacao').value,0);assert.equal(C.decompor(rec({'1':100}),'variacao').value,null);assert.equal(C.decompor(rec({'1':100,'2':50}),'2.5').value,null);});
test('prioridades não somam pai e filho, e conservam diferença negativa',()=>{const a=C.analise(rec({'1':100,'2':80,'2.5':100,'2.5.3':100}));assert.equal(a.ranking.length,2);assert.equal(a.residual,-20);assert.equal(a.ranking.reduce((n,x)=>n+x.value,0),80);});
test('meses parciais não recebem ranking de variações nem causas inventadas',()=>{const old=rec({'1':100,'2':80,'2.5':80},{label:'Jul/2026'}),now=rec({'1':20,'2':15,'2.5':15},{qualidade:{estado:'parcial',ate:'2026-08-10'}});assert.equal(C.analise(now,old).variacoes.length,0);assert.equal(C.analise(now,old).comparavel,false);});
test('conta renomeada não recebe diferença automática',()=>{const a=rec({'1':100,'2':80,'2.5':80}),b=rec({'1':90,'2':70,'2.5':70},{label:'Jul/2026'});assert.equal(C.analise(a,b).variacoes[0].delta,10);b.cells.at(-1).name='Outra';assert.equal(C.analise(a,b).variacoes.length,0);});
test('não liga pagamentos a produtos por código semelhante',()=>{const r=rec({'1':100,'2':50},{eventos:[{natureza:'entrada',contaOrigem:'1.1',valor:100},{natureza:'saida',contaOrigem:'2.5',valor:50}]});assert.equal(C.origem(r,'1').eventos.length,1);assert.equal(C.origem(r,'2').eventos.length,1);assert.equal(C.origem(r,'1.1').disponivel,false);assert.equal(C.origem(r,'2.5').eventos.length,0);});
test('cenário de equilíbrio usa margem de contribuição, bloqueia premissas inválidas',()=>{const r=C.sensibilidade({receita:10000,custoVariavel:6000,fixos:2000,meta:1000});assert.equal(r.equilibrio,5000);assert.equal(r.vendaMeta,7500);assert.equal(r.resultado,2000);for(const p of [{receita:0,custoVariavel:0,fixos:1},{receita:100,custoVariavel:100,fixos:1},{receita:100,custoVariavel:-1,fixos:1},{receita:100,custoVariavel:10,fixos:NaN}])assert.equal(C.sensibilidade(p).valido,false);});
test('fórmulas de competência coincidem com todos os subtotais',()=>{const vals=Object.fromEntries(c.DREModelo.campos.map((x,i)=>[x.id,(i+1)*100.13])),r=c.DREModelo.calcular(vals);for(const [id,parts] of Object.entries(C.competencia)){assert.equal(Math.round(r[id]*100),parts.reduce((n,[k,s])=>n+Math.round(r[k]*100)*s,0),id);}});
function stateFixture(){c.fixture=rec({'1':1000,'2':800,'2.5':800,'2.5.3':800});vm.runInContext("state.periodo='Ago/2026';state.records=[fixture];state.D={accounts:[]};state.comparar='';",c);}
test('telas CFO escapam nomes e preservam mês das células clicadas',()=>{stateFixture();c.fixture.cells.at(-1).name='<img src=x onerror=alert(1)>';const html=vm.runInContext('renderCFO(regAtual())+tabelaDRE(dadosDRE())+tabelaCustos()',c);assert.doesNotMatch(html,/<img src=x|NaN|undefined/);assert.match(html,/data-cfo-period="Ago\/2026"/);assert.match(html,/data-cfo-rubrica="entradas"/);});
test('PDF mensal inclui 12 meses, todas as rubricas e lacunas, sem depender do scroll',()=>{stateFixture();const r=vm.runInContext("relatorioCFO({tipo:'anual',base:'caixa',periodo:state.periodo})",c);assert.equal(r.blocos.length,5);assert.ok(r.blocos[0].colunas.includes('Jan/2026'));assert.ok(r.blocos[3].colunas.includes('Dez/2026'));assert.ok(r.blocos[0].linhas.some(row=>row.includes('Não apurado')));});
test('PDF de origem contém todos os movimentos, não apenas os 80 da tela',()=>{stateFixture();c.fixture.eventos=Array.from({length:251},(_,i)=>({natureza:'saida',empresa:'Teste',tituloId:String(i),data:'2026-08-10',valor:1,contaOrigem:'2.5',nomeConta:'Teste'}));const r=vm.runInContext("relatorioCFO({tipo:'origem',code:'2',periodo:state.periodo})",c);assert.equal(r.blocos[0].linhas.length,251);assert.match(r.blocos[0].linhas.at(-1)[1],/250/);});
test('PDF detalhado respeita o filtro da tela',()=>{stateFixture();const r=vm.runInContext("state.consulta='2.5.3';state.tipo='2';relatorioCFO({tipo:'contas',periodo:state.periodo})",c);assert.equal(r.blocos.at(-1).linhas.length,1);assert.equal(r.blocos.at(-1).linhas[0][0],'2.5.3');});

test('composição com valor inválido não produz percentuais de concentração',()=>{const a=C.analise(rec({'1':100,'2':80,'2.1':null,'2.5':40}));assert.equal(a.incompleta,true);assert.equal(a.concentracao,null);assert.ok(a.ranking.every(x=>x.peso==null));});
// C1, C11, C25, I19, I21 e N15: valores com a cor do sentido (o link não pinta o número),
// nomes iguais aos do menu e o card 4 apontando a margem por O.S. que já existe.
test('Análise CFO: saídas em vermelho, estorno em azul, variação pela direção e nomes do menu',()=>{
 c.fixture=rec({'1':1000,'2':900,'2.5':800,'2.5.3':800,'2.1':150,'2.12':-50});c.anterior=rec({'1':900,'2':700,'2.5':500,'2.1':200,'2.12':0},{label:'Jul/2026'});
 vm.runInContext("state.periodo='Ago/2026';state.records=[fixture,anterior];state.D={accounts:[]};state.comparar='Jul/2026';state.view='cfo';",c);
 c.fixture.pendencias=[{tipo:'sem-classe'},{tipo:'duplicado'}];
 const h=vm.runInContext('renderCFO(regAtual())',c);
 assert.match(h,/<td class="num tom-sai"><button class="cfo-link" data-cfo-account="2\.5"/,'grupo de saída em vermelho, mesmo dentro do link');
 assert.match(h,/Demais grupos \(1\)<small>[^<]*<\/small><\/th><td class="num tom-entra">[−-]R\$\s50,00/,'estorno numa conta de saída, somado na cauda, em azul');
 assert.match(h,/Diferença de <b class="tom-entra">/,'entradas menos saídas positiva em azul');
 assert.match(h,/Variação <span class="delta-ruim">▲ R\$\s300,00<\/span>/,'despesa que sobe é ruim');assert.match(h,/Variação <span class="delta-bom">▼ R\$\s50,00<\/span>/,'despesa que cai é boa, sem sinal de menos');
 assert.match(h,/Jul\/2026: <span class="tom-sai">R\$\s500,00<\/span> → Ago\/2026: <span class="tom-sai">R\$\s800,00<\/span>/);
 assert.match(h,/2 pendências a conferir<\/b>/);assert.doesNotMatch(h,/Detalhamento|para revisar|DRE mensal/);
 assert.match(h,/Indicadores › Margem\.<\/p><div class="actions"><button data-go="indicadores" data-ind-area="Margem">/,'I19: o card 4 leva a Indicadores › Margem');
});
test('diálogo da conta: valor principal, composição e histórico com a cor do sentido',()=>{
 c.fixture=rec({'1':1000,'2':800,'2.5':800,'2.5.3':900,'2.5.4':-100});vm.runInContext("state.periodo='Ago/2026';state.records=[fixture];state.D={accounts:[]};state.comparar='';",c);
 const el={};c.document.getElementById=id=>el[id]||(el[id]={id,open:true,innerHTML:'',textContent:'',querySelectorAll:()=>[],showModal(){}});
 vm.runInContext("abrirAnaliseConta('2.5','Ago/2026')",c);const h=el.detailContent.innerHTML;
 assert.match(h,/<strong class="tom-sai">R\$\s800,00<\/strong>/);assert.match(h,/<b class="tom-sai"><button class="cfo-link" data-cfo-account="2\.5\.3"/);assert.match(h,/<b class="tom-entra"><button class="cfo-link" data-cfo-account="2\.5\.4"/);
 assert.match(h,/<td class="num tom-sai"><button class="cfo-link" data-cfo-account="2\.5" data-cfo-period="Ago\/2026">R\$\s800,00/);
 vm.runInContext("abrirAnaliseConta('variacao','Ago/2026')",c);assert.match(el.detailContent.innerHTML,/<strong class="tom-entra">R\$\s200,00<\/strong>/,'rubrica do caixa usa o tom da rubrica');
 c.document.getElementById=()=>null;
});
// v135 · D25, I22, I26, I34 e N26: cobertura só quando o mês não é comparável; código do
// Mubisys ao lado do código do painel; "grupo(s)"; sem travessão; th de linha com scope.
test('Análise CFO: cobertura só fora do mês comparável, código do Mubisys, grupos e cabeçalhos com scope',()=>{
 c.fixture=rec({'1':1000,'2':1600,'2.5':800,'2.12':600,'2.1':150,'2.13':50});c.anterior=rec({'1':900,'2':1300,'2.5':500,'2.12':600,'2.1':140,'2.13':60},{label:'Jul/2026'});
 vm.runInContext("state.periodo='Ago/2026';state.records=[fixture,anterior];state.D={accounts:[]};state.comparar='Jul/2026';state.view='cfo';",c);
 const h=vm.runInContext('renderCFO(regAtual())',c);
 assert.doesNotMatch(h,/cfo-alert/,'mês comparável: o status fica no chip do topo');
 assert.match(h,/<small>2\.12 · Mubisys 2\.9<\/small><\/th>/,'I22: código do Mubisys quando difere');assert.match(h,/<small>2\.1<\/small><\/th>/,'código igual não ganha sufixo');
 assert.match(h,/<tr><th scope="row"><button class="cfo-link" data-cfo-account="2\.5"/);assert.match(h,/<thead><tr><th scope="col">Grupo<\/th><th scope="col" class="num">Registrado/);
 assert.match(h,/Somente grupos presentes/);assert.doesNotMatch(h,/contas presentes|Mais \d+ contas?</);
 assert.doesNotMatch(h,/ — /,'sem travessão em frase');
 const parc=rec({'1':100,'2':80,'2.5':80},{qualidade:{estado:'parcial',ate:'2026-08-10'}});c.fixture=parc;vm.runInContext("state.records=[fixture];state.comparar=''",c);
 assert.match(vm.runInContext('renderCFO(regAtual())',c),/<div class="cfo-alert"><b>/,'mês parcial: o cartão de cobertura volta');
});
test('Análise CFO: "Mais N grupos" na cauda das variações e compensação negativa sem travessão',()=>{
 const codes=['2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8','2.9','2.10','2.11'];
 c.fixture=rec({'1':5000,'2':codes.reduce((n,_,i)=>n+100*(i+1),0),...Object.fromEntries(codes.map((k,i)=>[k,100*(i+1)]))});c.anterior=rec({'1':5000,'2':codes.reduce((n,_,i)=>n+100*(i+1)+10*(i+1),0),...Object.fromEntries(codes.map((k,i)=>[k,100*(i+1)+10*(i+1)]))},{label:'Jul/2026'});
 vm.runInContext("state.periodo='Ago/2026';state.records=[fixture,anterior];state.D={accounts:[]};state.comparar='Jul/2026';state.view='cfo';",c);
 const h=vm.runInContext('renderCFO(regAtual())',c);assert.match(h,/<b>Mais \d+ grupos?<\/b>/);assert.match(h,/Nenhum deles, sozinho, muda a decisão do mês\.|, sozinho, não muda a decisão do mês\./);
 c.fixture=rec({'1':1000,'2':100,'2.5':300,'2.6':-200});vm.runInContext("state.records=[fixture];state.comparar=''",c);
 const n=vm.runInContext('renderCFO(regAtual())',c);assert.doesNotMatch(n,/ — há compensações/);assert.match(n,/%<\/b> das saídas líquidas registradas; há compensações negativas na composição\./);
});
// v135 · D19: a DRE passa 'metric-param' para o cartão de rubrica entrar na mesma família.
test('metricRubricaCFO: sem classe extra o HTML é o de antes; com classe, ela entra depois de "metric"',()=>{
 vm.runInContext("state.periodo='Ago/2026'",c);
 const a=vm.runInContext("metricRubricaCFO('liquida','Receita líquida',1000,'Vendas')",c),b=vm.runInContext("metricRubricaCFO('liquida','Receita líquida',1000,'Vendas','metric-param')",c);
 assert.match(a,/^<button class="metric metric-entra" data-cfo-rubrica="liquida"/);assert.equal(b,a.replace('class="metric ','class="metric metric-param '));
 assert.match(vm.runInContext("metricRubricaCFO('liquida','Receita líquida',0,'Vendas')",c),/^<button class="metric" data-cfo-rubrica/);
});

// Contrato do Ano (PLANO-ANO §2), só quando o app ou graficos.js ainda não o trazem.
const STUB_ANO=`(()=>{const g=globalThis,T=['inicio','cfo','dre','caixa','resultado','custos','detalhe','conferencia','dfc','balanco','precos','parametros','indicadores'];
if(typeof telaNoAno!=='function')g.telaNoAno=()=>!!state.anoTodo&&T.includes(state.view);
if(typeof anoDaTela!=='function')g.anoDaTela=()=>Number(String(state.periodo).split('/')[1])||null;
if(typeof TEXTO_SEM_ANO_COMPARADO==='undefined')g.TEXTO_SEM_ANO_COMPARADO='Sem comparação: escolha um ano em “Comparar com”, no topo.';
if(typeof textoSemMesesComparaveis!=='function')g.textoSemMesesComparaveis=(a,b)=>'Sem meses completos, da mesma base e com plano de contas em '+a+' e '+b+' para comparar.';
if(typeof rotuloMesesAno!=='function')g.rotuloMesesAno=ix=>{if(ix.length===12)return 'ano inteiro';const f=[];for(const i of ix){const u=f[f.length-1];if(u&&i===u[1]+1)u[1]=i;else f.push([i,i]);}const t=f.map(([a,b])=>a===b?PT_MON[a]:PT_MON[a]+' a '+PT_MON[b]);return t.length>1?t.slice(0,-1).join(', ')+' e '+t[t.length-1]:t[0]||'';};
const regDe=l=>state.records.find(r=>monthSortKey(r.label)===monthSortKey(l))||null;
if(typeof rotuloAno!=='function')g.rotuloAno=(ano=anoDaTela())=>{const f=fimDoAno(ano),m=String(f).split('/')[0],r=regDe(f);return ano+' · '+(m==='Jan'?'Jan':'Jan a '+m)+(r&&F.qualidade(r).parcial?'*':'');};
if(typeof anosComparaveis!=='function')g.anosComparaveis=(ano=anoDaTela())=>[...new Set(state.records.map(r=>Number(String(r.label).split('/')[1])).filter(Boolean))].filter(y=>y!==Number(ano)).sort((a,b)=>b-a);
if(typeof anoPadraoComparado!=='function')g.anoPadraoComparado=(ano=anoDaTela())=>{const l=anosComparaveis(ano);return l.includes(ano-1)?ano-1:l.find(y=>y<ano)??null;};
if(typeof anoComparado!=='function')g.anoComparado=()=>{const v=state.anoComparar||'';if(v==='nenhum')return null;if(/^\\d{4}$/.test(v)&&anosComparaveis().includes(Number(v)))return Number(v);return anoPadraoComparado();};
if(typeof mesesComparaveisAno!=='function')g.mesesComparaveisAno=(a,b)=>PT_MON.map((m,i)=>i).filter(i=>{const x=regDe(PT_MON[i]+'/'+a),y=regDe(PT_MON[i]+'/'+b);if(!x||!y)return false;const ok=r=>F.periodo(r.label).ate<dfcHoje()&&!F.qualidade(r).parcial&&!((DRESimples.apurar(r)?.pctSemConta??0)>10);return ok(x)&&ok(y)&&F.comparavelComRessalva(x,y).pode;});
if(typeof registroDoAno!=='function')g.registroDoAno=(ano,ix=null)=>{const f=fimDoAno(ano),ate=PT_MON.indexOf(String(f).split('/')[0]),idx=ix||PT_MON.slice(0,ate+1).map((m,i)=>i),ls=idx.map(i=>PT_MON[i]+'/'+ano),regs=ls.map(regDe),faltam=ls.filter((l,i)=>!regs[i]);
 if(faltam.length)return {disponivel:false,faltam,motivo:faltam.join(', ')+' sem dados coletados: sem todos os meses, o acumulado de '+ano+' não é somado.',meses:ls,parcial:false};
 const cod=new Map();for(const r of regs)for(const c of r.cells||[]){const k=cod.get(c.code)||{code:c.code,name:c.name,v:0};k.v+=Math.round(Number(c.value)*100);k.name=c.name;cod.set(c.code,k);}
 const parcial=regs.some(r=>F.qualidade(r).parcial),r0=regs[regs.length-1];
 const reg={id:'ano_'+ano,label:String(ano),rotulo:ix?ano+' · '+rotuloMesesAno(ix):rotuloAno(ano),ano:{meses:ls,parcial,ressalva:false},company:r0.company,basis:r0.basis,origem:r0.origem,qualidade:{...r0.qualidade,estado:'ano'},cells:[...cod.values()].sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})).map(k=>({code:k.code,name:k.name,value:k.v/100})),pendencias:regs.flatMap(r=>(r.pendencias||[]).map(p=>({...p,mes:r.label}))),eventos:[]};
 return {disponivel:true,reg,motivo:'',faltam:[],meses:ls,parcial};};
if(typeof comparacaoDoAno!=='function')g.comparacaoDoAno=(ano=anoDaTela(),anoComp=anoComparado())=>{if(anoComp==null)return {ano,anoComp,indices:[],meses:'',atual:null,anterior:null,ressalva:false,motivo:TEXTO_SEM_ANO_COMPARADO};const indices=mesesComparaveisAno(ano,anoComp);if(!indices.length)return {ano,anoComp,indices,meses:'',atual:null,anterior:null,ressalva:false,motivo:textoSemMesesComparaveis(ano,anoComp)};return {ano,anoComp,indices,meses:rotuloMesesAno(indices),atual:registroDoAno(ano,indices).reg,anterior:registroDoAno(anoComp,indices).reg,ressalva:false,motivo:''};};
if(typeof compLinhaAno!=='function')g.compLinhaAno=(rotulo,anterior,delta,dir,{tomAnterior='',motivo='',atual=null,rotuloAtual='',formato=money,unidade=''}={})=>anterior==null?'<span class="comp-ano">'+esc(rotulo)+': '+esc(motivo)+'</span>':'<span class="comp-ano">'+esc(rotulo)+': <span class="'+tomAnterior+'">'+formato(anterior)+'</span>'+(rotuloAtual?' · '+esc(rotuloAtual)+': '+formato(atual):'')+' · <b class="'+(tomDelta(dir,delta)||'delta-neutro')+'">'+(delta>0?'▲':delta<0?'▼':'■')+' '+formato(Math.abs(delta))+unidade+(delta>0?' a mais':delta<0?' a menos':'')+'</b></span>';
})()`;
// Ano (PLANO-ANO §4.2): leitura do ano somado, card 2 contra o ano escolhido nos mesmos meses, cenário só por mês.
function contextoAno(anoComparar=''){
 const k={document:{addEventListener(){},querySelectorAll:()=>[]},localStorage:{getItem:()=>null},structuredClone};vm.createContext(k);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','pdf-cfo.js','app.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),k);
 const fim=(a,m)=>new Date(Date.UTC(a,m+1,0)).toISOString().slice(0,10),M=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
 const mes=(a,m,v,ate=fim(a,m))=>rec(v,{label:`${M[m]}/${a}`,qualidade:{estado:'fechado',ate,regra:'v2',escopo:'DRE'}});
 k.regs=[...M.map((_,m)=>mes(2025,m,{'1':1000,'2':700,'2.5':500,'2.12':200})),...M.slice(0,8).map((_,m)=>mes(2026,m,{'1':1000,'2':900,'2.5':600,'2.12':300})),mes(2026,8,{'1':300,'2':200,'2.5':150,'2.12':50},'2026-09-15')];
 k.regs[13].pendencias=[{tipo:'sem-classe'}];k.regs[20].pendencias=[{tipo:'duplicado'}];
 vm.runInContext(`dfcHoje=()=>'2026-09-22';state.records=regs;state.periodo='Set/2026';state.D={accounts:[]};state.comparar='';state.view='cfo';state.anoTodo=true;state.anoComparar=${JSON.stringify(anoComparar)};`,k);vm.runInContext(STUB_ANO,k);
 return k;
}
test('Análise CFO no Ano: leitura do ano, pesos do ano, card 2 contra o ano escolhido e cenário só por mês',()=>{
 const k=contextoAno(),h=vm.runInContext('renderCFO(regAtual())',k);
 assert.match(h,/<p class="eyebrow">LEITURA CFO · 2026 · Jan a Set\*<\/p><h2>As entradas registradas cobriram as saídas\.<\/h2>/);
 assert.match(h,/Diferença de <b class="tom-entra">R\$\s900,00<\/b> no caixa considerado em 2026 · Jan a Set\*\. O ano inclui o mês em andamento: a leitura ainda muda\./,'8 × 100 + 100 de Set');
 assert.match(h,/<b>2 pendências a conferir no ano<\/b>/);
 assert.match(h,/Grupos de saídas somados em 2026 · Jan a Set\*, em ordem de valor absoluto\./);
 assert.match(h,/data-cfo-account="2\.5" data-cfo-period="Set\/2026">R\$\s4\.950,00<\/button><\/td><td class="num">66,9%<\/td>/,'peso nas saídas do ano: 4.950 de 7.400');
 const c2=h.slice(h.indexOf('2. O que mudou em relação ao outro ano'),h.indexOf('3. Receita necessária'));
 assert.match(c2,/2025 \(Jan a Ago\): <span class="tom-sai">R\$\s4\.000,00<\/span> → 2026 \(Jan a Ago\): <span class="tom-sai">R\$\s4\.800,00<\/span>/);
 assert.match(c2,/Variação <span class="delta-ruim">▲ R\$\s800,00<\/span>/,'saída que sobe é ruim');assert.match(c2,/2025 → 2026 nos mesmos meses \(Jan a Ago\)/);
 const c3=h.slice(h.indexOf('3. Receita necessária'),h.indexOf('4. Para conhecer'));assert.match(c3,/<p>O cenário é por mês: escolha um mês na barra para simular e salvar\.<\/p>/);assert.doesNotMatch(c3,/<form|cfoCenario/);
 assert.match(h,/<div class="cfo-alert">/,'ano com mês em andamento: aviso de cobertura');assert.doesNotMatch(h,/NaN|undefined| — /);
 // Sem comparação: o motivo no card 2
 const n=vm.runInContext('renderCFO(regAtual())',contextoAno('nenhum'));assert.match(n,/2\. O que mudou em relação ao outro ano[\s\S]*<p>Sem comparação: escolha um ano em “Comparar com”, no topo\.<\/p>/);assert.doesNotMatch(n,/2025 \(Jan/);
 // Dashboard usa a mesma leitura do ano
 const d=contextoAno();vm.runInContext("state.view='inicio'",d);assert.match(vm.runInContext('cfoResumo(regAtual())',d),/LEITURA CFO · 2026 · Jan a Set\*[\s\S]*data-go="cfo"/);
 // Fora do Ano: tudo como antes
 const m=contextoAno();vm.runInContext("state.anoTodo=false",m);const hm=vm.runInContext('renderCFO(regAtual())',m);assert.match(hm,/LEITURA CFO · Set\/2026/);assert.match(hm,/id="cfoCenario"/);assert.match(hm,/2\. O que mudou em relação ao outro mês/);
});
test('Análise CFO: o PDF do topo leva ano:true no Ano e ano:false no mês',()=>{
 for(const [ano,esperado] of [[true,true],[false,false]]){
  const k=contextoAno(),el={cfoPDF:{}};vm.runInContext(`state.anoTodo=${ano}`,k);k.document.getElementById=id=>el[id]||null;k.document.querySelectorAll=()=>[];
  vm.runInContext('__op=null;exportarCFO=op=>{__op=op};wireCFO(document)',k);el.cfoPDF.onclick();
  const op=vm.runInContext('__op',k);assert.equal(op.ano,esperado);assert.equal(op.tipo,'executivo');assert.equal(op.periodo,'Set/2026');
 }
});
