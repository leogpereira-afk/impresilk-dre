// Código do Mubisys ao lado do código do painel. O painel guarda a numeração antiga
// do plano (série histórica); o robô traduz a nova. A volta tem de ser exata ou dizer
// que não sabe — nunca inventar um código que não existe no Mubisys.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';import {execFileSync} from 'node:child_process';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const raiz=new URL('..',import.meta.url).pathname;
const c={};vm.createContext(c);vm.runInContext(ler('dre-modelo.js'),c);
const J=s=>JSON.parse(vm.runInContext(`JSON.stringify(${s})`,c));
const nm=(code,reg=null)=>{c.__reg=reg;return J(`CodigosMubisys.noMubisys(${JSON.stringify(code)},__reg)`);};
const tabelaPy=nome=>{const py=ler('scripts/erp_mes.py'),i=py.indexOf(nome+' = [');return [...py.slice(i,py.indexOf('\n]',i)+2).matchAll(/\("([\d.]+)",\s*"([\d.]+)"\)/g)].map(m=>[m[1],m[2]]);};

test('as tabelas de tradução são as mesmas do robô (Python), na mesma ordem',()=>{
 for(const nome of ['DE_PARA_PLANO_NOVO','DE_PARA_SUBCONTA'])assert.deepEqual(J('CodigosMubisys.'+nome),tabelaPy(nome),nome);
 const py=ler('scripts/erp_mes.py');assert.deepEqual(J('CodigosMubisys.DE_PARA_FIXAS'),[...py.match(/DE_PARA_FIXAS = \[([^\]]*)\]/)[1].matchAll(/\("([\d.]+)",\s*"([\d.]+)"\)/g)].map(m=>[m[1],m[2]]));
 assert.match(py,/for novo, canon in DE_PARA_SUBCONTA \+ DE_PARA_FIXAS \+ DE_PARA_PLANO_NOVO:/,'a ordem de aplicação do robô continua a mesma');
});
test('gabarito do próprio robô: para cada código novo do Mubisys, a volta inclui o código de verdade',()=>{
 // gera códigos novos plausíveis (todos os prefixos das tabelas e filhos), roda traduzir_plano do Python e confere a volta
 const py=`import sys,json;sys.path.insert(0,'scripts');import erp_mes as m
novos=set()
for novo,_ in m.DE_PARA_SUBCONTA+m.DE_PARA_FIXAS+m.DE_PARA_PLANO_NOVO:
  novos.add(novo)
  for i in range(1,13):novos.add(novo+'.'+str(i))
for g in ['2.1','2.2']:
  for i in range(1,25):novos.add(g+'.'+str(i))
print(json.dumps({n:m.traduzir_plano(n) for n in sorted(novos)}))`;
 const gabarito=JSON.parse(execFileSync('python3',['-c',py],{cwd:raiz,encoding:'utf8'}));
 let conferidos=0;const colisoes=[],regras=[...J('CodigosMubisys.DE_PARA_SUBCONTA'),...J('CodigosMubisys.DE_PARA_FIXAS'),...J('CodigosMubisys.DE_PARA_PLANO_NOVO')];
 for(const [novo,canon] of Object.entries(gabarito)){
  // renomeadas, parcelas do Nordeste e a soma 2.13.7 têm teste próprio (não são volta 1 para 1)
  if(canon.split('.').slice(1).some(x=>Number(x)>=51)||canon.startsWith('2.13.7.1.')||canon==='2.13.7')continue;
  const r=nm(canon);
  // colisão teórica: um código novo hipotético que cairia no destino EXATO de uma regra
  // do robô (ex.: 2.1.13, 2.10.6). A regra foi montada com os títulos reais de antes e
  // depois da renumeração, então o código dela é a resposta; o hipotético fica de fora.
  const exatos=regras.filter(([,k])=>k===canon).map(([n])=>n);
  if(exatos.length&&!exatos.includes(novo)&&r.codigos.every(x=>exatos.includes(x))){colisoes.push(novo+'→'+canon);continue;}
  assert.ok(r.codigos.includes(novo),`${novo} → ${canon}: a volta deu ${r.codigos.join(', ')||r.texto}`);
  for(const x of r.codigos)assert.equal(gabarito[x]??J(`CodigosMubisys.traduzir(${JSON.stringify(x)})`),canon,`candidato ${x} não leva a ${canon}`);
  conferidos++;
 }
 assert.ok(conferidos>300,'o gabarito cobriu '+conferidos+' códigos');
 assert.ok(colisoes.length<15,'colisões teóricas: '+colisoes.join(', '));
});
test('contas que o Léo conferiu no Mubisys: o código da volta é o dele',()=>{
 const casos={'2.4.2':['2.3.2'],'2.4.3':['2.3.3'],'2.4.3.1':['2.3.3.1'],'2.4.1.2':['2.3.1.2'],'2.5.2':['2.4.2'],'2.5.3':['2.4.3'],'2.5.3.1':['2.4.3.1'],'2.12.1':['2.9.1'],'2.6.9':['2.5.9'],'2.14.2':['2.11.2'],'2.13.1':['2.10.1'],'2.2.6':['2.2.5'],'2.16.3':['2.13.4.1'],'2.9.1':['2.1.18.1'],'2.1.4':['2.1.4'],'1.3.2':['1.3.2'],'1.1.1.13.1':['1.1.1.13.1']};
 for(const [painel,mub] of Object.entries(casos))assert.deepEqual(nm(painel).codigos,mub,painel);
 assert.equal(nm('2.1.4').tipo,'igual');assert.equal(J("CodigosMubisys.rotulo('2.1.4')"),'','mesmo código: nada ao lado');assert.equal(J("CodigosMubisys.rotulo('2.4.2')"),'Mubisys 2.3.2');
});
test('Nordeste separado pela descrição, contas do robô e da O.S.: ditas como são, sem código inventado',()=>{
 assert.deepEqual(nm('2.13.7.1'),{tipo:'varios',codigos:['2.13.1','2.13.2'],texto:'Mubisys 2.13.1 ou 2.13.2'});
 for(const k of ['2.13.7.1.1','2.13.7.1.2','2.13.7.1.3'])assert.deepEqual(nm(k),{tipo:'dividida',codigos:['2.13.1','2.13.2'],texto:'Mubisys 2.13.1 ou 2.13.2 (separado pela descrição)'},k);
 assert.equal(nm('2.13.7').texto,'Mubisys 2.13.1 ou 2.13.2 (Nordeste) ou 2.10.7','a soma vem do Nordeste; o lançamento direto, do 2.10.7');
 assert.equal(nm('2.99').tipo,'robo');assert.equal(nm('1.1.98').texto,'criada pelo robô (recebido sem O.S. completa)');assert.equal(nm('1.1.99').tipo,'robo');
 assert.deepEqual(nm('1.2.51'),{tipo:'os',codigos:[],texto:'criada pela O.S.'});assert.equal(nm('x').tipo,'sem-codigo');
});
test('conta renomeada pelo robô (51 em diante, em qualquer nível): origem pela pendência do mês, senão "conferir"',()=>{
 const reg={pendencias:[{tipo:'conta-renomeada-no-erp',conta:'2.5.51',texto:'No ERP, a conta 2.5.2 aparece como “Aluguel galpão” (antes “Aluguel lote”). O valor foi separado em 2.5.51 e segue em …'}]};
 assert.deepEqual(nm('2.5.51',reg),{tipo:'renomeada',codigos:['2.4.2'],texto:'renomeada; no Mubisys 2.4.2'});
 assert.deepEqual(nm('2.5.51.1',reg).codigos,['2.4.2.1'],'filha herda a origem da mãe');
 for(const k of ['2.51','2.51.9','2.1.51.5','2.14.51.2','2.12.52'])assert.equal(nm(k).texto,'renomeada pelo robô: conferir no Mubisys',k);
});
test('plano de contas: mostra o código do Mubisys, acha a conta pelos dois códigos e leva para a planilha',()=>{
 const p={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};vm.createContext(p);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','plano-contas.js'])vm.runInContext(ler(f),p,{filename:f});
 p.__r=[{label:'Set/2026',cells:[{code:'2',name:'Despesas',value:600},{code:'2.4',name:'Impostos',value:600},{code:'2.4.2',name:'ICMS',value:100},{code:'2.5',name:'Fixas',value:500},{code:'2.5.2',name:'Aluguel lote',value:500}]}];
 const cat=JSON.parse(vm.runInContext("JSON.stringify(PlanoContas.catalogo(__r,'2026','Set/2026'))",p));
 assert.equal(cat.find(x=>x.code==='2.4.2').mubisys.texto,'Mubisys 2.3.2');
 const achou=q=>JSON.parse(vm.runInContext(`JSON.stringify(PlanoContas.filtrar(PlanoContas.catalogo(__r,'2026','Set/2026'),{query:${JSON.stringify(q)}}).map(x=>x.code))`,p));
 assert.ok(achou('2.3.2').includes('2.4.2'),'busca pelo código do Mubisys acha o ICMS');assert.ok(achou('2.4.2').includes('2.4.2')&&achou('2.4.2').includes('2.5.2'),'o código 2.4.2 acha o ICMS (painel) e o Aluguel (Mubisys)');
 assert.match(vm.runInContext("planoMubisys({mubisys:CodigosMubisys.noMubisys('2.5.2')})",p),/ · Mubisys 2\.4\.2/);
 assert.match(ler('plano-contas.js'),/<small>· \$\{esc\(c\.code\)\}\$\{planoMubisys\(c\)\}<\/small><\/h2>/,'o cabeçalho da conta mostra os dois códigos');
});
