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
 assert.match(h,/Demais grupos \(1\)<small>[^<]*<\/small><\/th><td class="num tom-entra">-R\$\s50,00/,'estorno numa conta de saída, somado na cauda, em azul');
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
