/* Os cinco defeitos confirmados na revisão de 25/09/2026. Cada teste reproduz o
   cenário que provou o defeito (mês corrente pela metade, mês ausente, empresa
   diferente, cor da variação, CSV) e trava a correção. */
import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
function view(){
 const mem=new Map(),elements={};
 const c={document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,getElementById:id=>elements[id]},
  localStorage:{getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)},navigator:{onLine:true}};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','pdf-cfo.js','app.js'])
  vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 c.run=(src)=>vm.runInContext(src,c);
 c.run(`var erp=(label,ate,cells,extra={})=>({id:label.replace('/','_'),label,company:extra.company||'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',atualizadoEm:ate+'T21:00:00Z',qualidade:{coletadoEm:ate+'T21:00:00Z',ate,regra:'caixa-v2',escopo:'compõe DRE',apiContratoValidado:false,estado:extra.estado||'aguardando-conferencia'},cells});
  var cel=o=>Object.entries(o).map(([code,value])=>({code,name:'Conta '+code,value}));
  var fechados=['Mai','Jun','Jul','Ago'].map((m,i)=>erp(m+'/2026','2026-0'+(5+i)+'-'+['31','30','31','31'][i],cel({'1':500000,'2':450000})));
  state.D={accounts:[]};`);
 return c;
}
const texto=(html)=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

test('régua: mês pela metade não recebe veredito e diz até que dia foi coletado', () => {
 const c=view();
 c.run(`state.records=[...fechados,erp('Set/2026','2026-09-05',cel({'1':80000,'2':70000}),{estado:'parcial'})];state.periodo='Set/2026';`);
 const t=texto(c.run('relatorioRegua()'));
 assert.match(t,/Set\/2026 tem lançamentos só até 05\/09\/2026/);
 assert.equal((t.match(/sem veredito até o mês fechar/g)||[]).length,2);
 assert.doesNotMatch(t,/▼|▲/, 'mês parcial não pode ganhar seta de acima/abaixo da média');
});

test('régua: mês fechado de outra empresa não entra na média', () => {
 const c=view();
 c.run(`state.records=[...fechados,erp('Abr/2026','2026-04-30',cel({'1':5000000,'2':4800000}),{company:'Impresilk'})];state.periodo='Ago/2026';`);
 assert.match(c.run('relatorioRegua()'),/referência dos 3 meses/);
});

test('ritmo do ano: veredito é do último mês fechado, não do mês em andamento', () => {
 const c=view();
 c.run(`localStorage.setItem('dre_metas_ano',JSON.stringify({semAlvoZero:true,'2026':{receita:1200000,custos:1080000,caixa:null}}));
  state.records=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago'].map((m,i)=>erp(m+'/2026','2026-'+String(i+1).padStart(2,'0')+'-'+['31','28','31','30','31','30','31','31'][i],cel({'1':100000,'2':90000})));
  state.records.push(erp('Set/2026','2026-09-05',cel({'1':16666.67,'2':15000}),{estado:'parcial'}));state.periodo='Set/2026';`);
 const html=c.run('graficoRitmoAno()');
 const sit=[...html.matchAll(/ritmo-situacao (\w+)">([^<]*)</g)].map(m=>m[2]);
 // \s: o Intl põe espaço NÃO separável entre "R$" e o número
 assert.match(sit[0],/^No ritmo · esperado R\$\s800\.000,00 até Ago\/2026$/);
 assert.match(sit[1],/^No ritmo · esperado R\$\s720\.000,00 até Ago\/2026$/);
 assert.match(html,/lançamentos até 05\/09\/2026/);
 assert.match(html,/ritmo-ponto parcial/);
});

test('caixa: acumulado não atravessa mês ausente nem soma meses depois do escolhido', () => {
 const c=view();
 c.run(`state.records=[erp('Jan/2026','2026-01-31',cel({'1':100,'2':60})),erp('Mar/2026','2026-03-31',cel({'1':200,'2':90}))];state.periodo='Mar/2026';`);
 assert.match(texto(c.run('historicoTabela()')),/Sem acumulado: falta Fev\/2026/);
 c.run(`state.records=['Jan','Fev','Mar'].map((m,i)=>erp(m+'/2026','2026-0'+(i+1)+'-'+['31','28','31'][i],cel({'1':100,'2':60})));state.periodo='Jan/2026';`);
 assert.match(texto(c.run('historicoTabela()')),/Acumulado Jan–Jan\/2026 Inclui períodos a conferir R\$\s?100,00/);
});

test('cor da variação: declarada por linha, nunca adivinhada pelo nome', () => {
 const c=view();
 c.run(`var v=(p,t,i)=>({entradas:1000,saidas:p+t+i,pendentes:p,transferencias:t,investimentos:i});
  var dcx={competencia:false,ate:2,cols:[{reg:erp('Jul/2026','2026-07-31',cel({'1':1000,'2':500}))},{reg:erp('Ago/2026','2026-08-31',cel({'1':1000,'2':900}))}],valores:[v(100,100,100),v(400,400,400)]};
  var dk={competencia:true,ate:2,cols:[{},{}],valores:[{operacional:100,antesTributos:100,receitasFinanceiras:10,devolucoes:5,descontos:5,liquida:1000},{operacional:200,antesTributos:200,receitasFinanceiras:20,devolucoes:50,descontos:50,liquida:1000}]};
  var cor=(d,lista,id)=>{const h=celulaComparativo(d,lista.find(x=>x.id===id));return (h.match(/class="(delta-\\w+)"/)||[])[1]||'neutro';};`);
 assert.equal(c.run(`cor(dcx,linhasCaixa,'pendentes')`),'delta-ruim');
 assert.equal(c.run(`cor(dcx,linhasCaixa,'transferencias')`),'neutro');
 assert.equal(c.run(`cor(dcx,linhasCaixa,'investimentos')`),'neutro');
 for(const id of ['operacional','antesTributos','receitasFinanceiras'])
  assert.equal(c.run(`cor(dk,DREModelo.linhas,'${id}')`),'delta-bom',id+' subiu e não pode sair vermelho');
 for(const id of ['devolucoes','descontos'])
  assert.equal(c.run(`cor(dk,DREModelo.linhas,'${id}')`),'delta-ruim',id+' subiu e não pode sair verde');
});

test('CSV: número negativo sai como número; fórmula continua neutralizada', () => {
 const c=view();
 assert.equal(c.run('celulaCSV(-15)'),'"-15"');
 assert.equal(c.run("celulaCSV('-763,69')"),'"-763,69"');
 assert.equal(c.run("celulaCSV('1.234,56')"),'"1.234,56"');
 assert.equal(c.run("celulaCSV('=HYPERLINK(1)')"),`"'=HYPERLINK(1)"`);
 assert.equal(c.run("celulaCSV('-cmd')"),`"'-cmd"`);
});

/* Mais dois defeitos da mesma revisão, nos "Comparativos do ano": a coluna
   de um mês que "somava 100%" só com os grupos do mês-base, e a saída sem
   detalhamento que aparecia como empréstimo/dívida. */
test('estrutura: a coluna de cada mês fecha com a conta 2 dele, não com os grupos do mês-base', () => {
 const c=view();
 // Set/2026 parcial só tem Funcionários e Materiais; Ago/2026 tem também Impostos e Fixas.
 c.run(`var nomes={'2.1':'Funcionários','2.12':'Materiais','2.4':'Impostos','2.5':'Fixas'};
  var celN=o=>cel(o).map(x=>({...x,name:nomes[x.code]||x.name}));
  state.records=[erp('Ago/2026','2026-08-31',celN({'2':1000,'2.1':100,'2.12':100,'2.4':300,'2.5':500})),
   erp('Set/2026','2026-09-24',celN({'2':300,'2.1':200,'2.12':100}),{estado:'parcial'})];state.periodo='Set/2026';`);
 const html=c.run('relatorioEstrutura()');
 const ago=Object.fromEntries([...html.matchAll(/title="Ago\/2026 · ([^:"]+): ([\d.]+)%/g)].map(m=>[m[1],Number(m[2])]));
 assert.equal(ago['Funcionários'],10,'era 50%: a base da coluna não pode ser só Funcionários + Materiais');
 assert.equal(ago['Materiais'],10);
 // Impostos (30%) e Fixas (50%) não são grupos do mês-base: entram em "Demais grupos", não somem
 const impostosEFixas=(ago['Impostos']||0)+(ago['Fixas']||0)+(ago['Demais grupos']||0);
 assert.equal(impostosEFixas,80);
 assert.equal(Math.round(Object.values(ago).reduce((a,b)=>a+b,0)),100,'cada coluna soma 100% das saídas daquele mês');
 assert.match(html,/Demais grupos<\/span>/,'"Demais grupos" tem de estar na legenda mesmo com o mês-base tendo menos de cinco grupos');
});

test('caixa: saída sem detalhamento (2.99) não vira empréstimo nem dívida', () => {
 const c=view();
 c.run(`state.records=[erp('Jul/2026','2026-07-31',cel({'1':1000,'1.1':1000,'2':1000,'2.5':600,'2.99':400}))];state.periodo='Ago/2026';`);
 const html=c.run('blocosDoCaixa()');
 const jul=Object.fromEntries([...html.matchAll(/<title>Jul\/2026 · ([^:<]+): ([^<]+)<\/title>/g)].map(m=>[m[1],m[2]]));
 assert.deepEqual(Object.keys(jul).filter(k=>/Empréstimo/.test(k)),[],'mês sem empréstimo nem dívida não pode ter barra de empréstimo');
 // \s: o Intl põe espaço NÃO separável entre "R$" e o número
 assert.match(jul['Sem detalhamento'],/^-R\$\s400,00$/);
 assert.match(jul['Sobra da operação'],/^R\$\s400,00$/);
 assert.match(jul['variação do mês'],/^R\$\s0,00$/,'as barras continuam somando a variação do mês');
 assert.doesNotMatch(texto(html),/Empréstimo e outros/);
});
