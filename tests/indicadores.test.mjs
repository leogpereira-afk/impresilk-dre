import {test} from 'node:test';import assert from 'node:assert/strict';
import * as M from '../indicadores-modelo.mjs';
import fs from 'node:fs';import vm from 'node:vm';
import {consultarIndicadores} from '../supabase/functions/dre-sync/indicadores.mjs';
const p={de:'2026-09-01',ate:'2026-09-30'};
const event=(id,valor,extra={})=>({empresa:'Impresilk',tituloId:'T',pagamentoId:id,indiceNaColeta:0,data:'2026-09-02',natureza:'entrada',nomeConta:'Vendas',valor,...extra});
const reg=(eventos,extra={})=>({id:'Set_2026',label:'Set/2026',eventos,qualidade:{ate:p.ate,apiContratoValidado:true,conciliado:false},...extra});
test('ausência não vira zero, centavos e margem ponderada',()=>{assert.equal(M.numero(null),null);assert.equal(M.numero(''),null);assert.equal(M.soma([1,null]),null);assert.equal(M.soma([.1,.2]),.3);assert.equal(M.margem(0,1),null);assert.equal(M.margem(-100,30),null);assert.equal(M.margem(100,null),null);const r=M.resumir([{venda:100,custo:0,valor:0},{venda:900,custo:900,valor:900}]);assert.equal(r.margem,10);});
test('valida intervalo real e limita leitura a 12 meses',()=>{assert.throws(()=>M.validarPeriodo('2026-02-30',p.ate));assert.throws(()=>M.validarPeriodo('2020-01-01',p.ate));assert.deepEqual(M.periodoPreset('Out/2026','trimestre'),{de:'2026-10-01',ate:'2026-12-31'});});
test('baixas parciais, estornos, empresas e título compartilhado conservam total',()=>{const r=M.caixa([reg([event('a',50,{ordensServico:['1','2']}),event('b',25),event('c',-10),event('a',20,{empresa:'Universo'})])],p,'entrada');assert.equal(M.resumir(r.rows).valor,85);assert.equal(r.rows.length,4);});
test('pagamento repetido não dobra valor e ressalva qualidade',()=>{const r=M.caixa([reg([event('a',10),event('a',10)])],p,'entrada');assert.equal(r.qualidade,'Parcial');assert.equal(r.rows.length,1);assert.match(r.avisos.join(' '),/repetido/);});
test('sem fonte não vira período zerado; ausência de valor permanece parcial',()=>{assert.equal(M.caixa([],p,'entrada').disponivel,false);const r=M.caixa([reg([event('a',null)])],p,'entrada');assert.equal(r.qualidade,'Parcial');assert.equal(M.resumir(r.rows).somaCompleta,false);});
test('mês sem trilha não é proporcionalizado ao selecionar dias',()=>{const r=reg([],{cells:[{code:'1',value:200}]});assert.equal(M.caixa([r],p,'entrada').rows[0].valor,200);assert.equal(M.caixa([r],{...p,ate:'2026-09-10'},'entrada').disponivel,false);});
test('venda normal exclui canceladas, retrabalho e situação desconhecida',()=>{const comercial={tipo:'Normal',cancelada:false,valorConfirmado:true};const r=M.normalizarComercial([{id:1,valor:100,comercial},{id:2,valor:80,comercial:{...comercial,cancelada:true}},{id:3,valor:20,comercial:{...comercial,tipo:'Retrabalho'}},{id:4,valor:100}]);assert.equal(r.length,1);assert.equal(r[0].valor,100);});
test('custo ausente, zero e cents da integração se distinguem',()=>{const r=M.normalizarSnapshot({completo:true,desde:p.de,ate:p.ate,itens:[{id:'1',venda:90000,custo:64098},{id:'2',venda:10000,custo:null},{id:'3',venda:10000,custo:0}]},'custos',p);assert.equal(r.rows[0].valor,640.98);assert.equal(r.rows[1].valor,null);assert.equal(r.rows[2].valor,0);const s=M.resumir(r.rows);assert.equal(s.pares,2);assert.equal(s.valor,640.98);assert.equal(s.somaCompleta,false);});
test('snapshot antigo não muda de período e detalhes exigem janela exata',()=>{const s={completo:true,desde:p.de,ate:p.ate,itens:[]};assert.equal(M.normalizarSnapshot(s,'fiscal',{de:'2026-10-01',ate:'2026-10-08'}).disponivel,false);assert.equal(M.normalizarSnapshot(s,'custos',{...p,ate:'2026-09-10'}).disponivel,false);});
test('fiscal exclui cancelamento, devolução, entrada e rejeitada; compras não são consumo',()=>{const n={id:'1',em:'2026-09-02',valor:10000,normal:true,saida:true,status:'Aprovada'},s={desde:p.de,ate:p.ate,completo:true,itens:[n,{...n,id:'2',cancelada:true},{...n,id:'3',normal:false},{...n,id:'4',saida:false},{...n,id:'5',status:'Rejeitada'}]};assert.equal(M.normalizarSnapshot(s,'fiscal',p).rows.length,1);assert.match(M.normalizarSnapshot(s,'compras',p).limite,/não comprova consumo/);});
test('filtro, agrupamento, paginação e exportação usam a mesma seleção',()=>{const rows=Array.from({length:125},(_,i)=>({id:String(i),numero:String(i),nome:'Título',grupo:i<60?'A':'B',valor:1}));const a=M.resumir(rows,{grupo:'A',pagina:1}),b=M.resumir(rows,{grupo:'A',tamanho:5000});assert.equal(a.valor,60);assert.equal(a.rows.length,10);assert.equal(b.rows.length,60);assert.equal(b.valor,a.valor);const csv=M.exportarCSV({titulo:'Teste',periodo:p,fonte:'Caixa',qualidade:'Parcial',rows:[{...rows[0],nome:'=HYPERLINK("x")'}],valor:1});assert.match(csv,/'=HYPERLINK/);assert.match(csv,/Impresilk \+ Universo/);});
test('mês parcial compara só mesmos dias quando trilhas estão validadas',()=>{const out={...reg([event('out',200,{data:'2026-10-03'})]),id:'Out_2026',label:'Out/2026',qualidade:{ate:'2026-10-07',apiContratoValidado:true}};const c=M.compararCaixa([reg([event('a',100),event('b',500,{data:'2026-09-10'})]),out],{de:'2026-10-01',ate:'2026-10-31'},'entrada');assert.equal(c.dias,7);assert.equal(c.delta,100);assert.equal(c.anterior,100);out.qualidade.apiContratoValidado=false;assert.equal(M.compararCaixa([reg([]),out],{de:'2026-10-01',ate:'2026-10-31'},'entrada').disponivel,false);});
function fakeDB(rows,erro=false){return {from(table){assert.ok(['painel_ordens','painel_cache'].includes(table));const q={select(){return q},gte(){return q},lte(){return q},order(){return q},eq(){return q},range(a,b){return Promise.resolve({data:rows.slice(a,b+1),error:erro?new Error('falha'):null})},maybeSingle(){return Promise.resolve({data:rows[0]||null,error:erro?new Error('falha'):null})}};return q;}};}
test('servidor consulta páginas, resume e retorna apenas 50 registros',async()=>{const rows=Array.from({length:551},(_,i)=>({id:String(i),valor:1,comercial:{tipo:'Normal',cancelada:false,valorConfirmado:true}}));const r=await consultarIndicadores(fakeDB(rows),{fonte:'comercial',...p});assert.equal(r.total,551);assert.equal(r.valor,551);assert.equal(r.rows.length,50);assert.equal(r.qualidade,'Parcial');});
test('falha de banco é erro, fonte ausente não retorna um total apurado',async()=>{await assert.rejects(()=>consultarIndicadores(fakeDB([],true),{fonte:'custos',...p}),/Não foi possível/);const r=await consultarIndicadores(fakeDB([]),{fonte:'custos',...p});assert.equal(r.disponivel,false);assert.equal(r.qualidade,'Indisponível');});
test('todos os valores ausentes deixam o total indisponível, sem zero fictício',()=>{const s=M.resumir([{valor:null},{valor:null}]);assert.equal(s.valor,null);assert.equal(s.comValor,0);});
test('diferença entre trilha e controle mensal aparece e impede apuração completa',()=>{const r=M.caixa([reg([event('1',100)],{cells:[{code:'1',value:150}]})],p,'entrada');assert.equal(r.qualidade,'Parcial');assert.match(r.avisos.join(' '),/diferença entre trilha/);assert.equal(M.resumir(r.rows).valor,100);});
test('histórico de gráficos mantém lacunas, filtros e separação de empresas',()=>{
 const r=reg([event('a',100),event('b',null)],{company:'Impresilk + Universo',basis:'Caixa'});
 let h=M.historicoCaixa([r],p,'recebimentos');assert.equal(h.length,12);assert.equal(h[7].valor,null);assert.equal(h[8].valor,100);assert.equal(h[8].parcial,true);
 h=M.historicoCaixa([r],p,'recebimentos',{query:'inexistente'});assert.equal(h[8].valor,null);
 const ago={...r,label:'Ago/2026',company:'Impresilk',eventos:[event('ago',50,{data:'2026-08-02'})]};
 h=M.historicoCaixa([r,ago],p,'recebimentos');assert.equal(h[7].valor,50);assert.equal(h[7].mesmaBase,false);assert.match(h[7].nota,/Base diferente/);assert.equal(h[0].periodo,'2026-01');assert.equal(h[11].periodo,'2026-12');
});
test('gráfico dos pares não mistura custos sem venda nem a página visível',()=>{
 const m={disponivel:true,...M.resumir([{valor:80,custo:80,venda:100},{valor:50,custo:50,venda:null}],{tamanho:1})};
 assert.equal(m.valor,130);assert.deepEqual(M.comparativoPares(m).map(x=>x.valor),[100,80]);assert.deepEqual(M.comparativoPares({...m,pares:0}),[]);
});
test('histórico não perde centavos ou estornos e resultado respeita o grupo',()=>{
 const r=reg([event('a',100),event('b',-20),event('c',30,{natureza:'saida'})],{company:'Impresilk + Universo',basis:'Caixa'});
 assert.equal(M.historicoCaixa([r],p,'variacao')[8].valor,50);
 assert.equal(M.historicoCaixa([r],p,'variacao',{grupo:'Pagamentos'})[8].valor,-30);
});

test('comparação percentual continua bloqueada entre empresas apesar do histórico visível',()=>{
 const atual=reg([event('a',100)],{company:'Impresilk + Universo',basis:'Caixa'});
 const anterior={...atual,label:'Ago/2026',company:'Impresilk',qualidade:{ate:'2026-08-31',apiContratoValidado:true},eventos:[event('b',50,{data:'2026-08-02'})]};
 assert.equal(M.historicoCaixa([anterior,atual],p,'recebimentos')[7].valor,50);
 assert.equal(M.compararCaixa([anterior,atual],p,'entrada').disponivel,false);
});

// ── Fase 12.3: meses sem trilha pelas contas da DRE; o mesmo período um ano antes ──
const mesConta=(label,ate,cells)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa',qualidade:{ate,apiContratoValidado:true},cells});
const C=(code,name,value)=>({code,name,value});
test('zero mensal conhecido sem trilha permanece zero em indicadores, histórico e comparação',()=>{
 const zero=mesConta('Set/2026','2026-09-30',[C('1','Receitas',0),C('2','Despesas',0)]);
 const ant=mesConta('Set/2025','2025-09-30',[C('1','Receitas',0),C('2','Despesas',0)]);
 for(const [natureza,fonte] of [['entrada','recebimentos'],['saida','pagamentos']]){
  const c=M.caixa([zero],p,natureza);assert.equal(c.disponivel,true);assert.equal(M.resumir(c.rows).valor,0);
  assert.equal(M.historicoCaixa([zero],p,fonte,{},'2026-10-24')[8].valor,0);
  const cmp=M.compararAno([ant,zero],p,fonte);assert.equal(cmp.disponivel,true);assert.equal(cmp.delta,0);assert.equal(cmp.percentual,null);
 }
 assert.equal(M.historicoCaixa([zero],p,'variacao',{},'2026-10-24')[8].valor,0);
 assert.equal(M.historicoCaixa([zero],p,'recebimentos',{query:'inexistente'},'2026-10-24')[8].valor,null,'filtro sem correspondência não recebe zero inventado');
 assert.equal(M.caixa([zero],{...p,ate:'2026-09-10'},'entrada').disponivel,false,'não proporcionaliza total mensal para um recorte');
 const parcial={...zero,qualidade:{...zero.qualidade,ate:'2026-09-12'}};
 assert.equal(M.caixa([parcial],p,'entrada').qualidade,'Parcial');assert.equal(M.historicoCaixa([parcial],p,'recebimentos',{},'2026-10-24')[8].marca,'*');
});
test('sem raiz ou raiz inválida não cria um total mensal zero',()=>{
 for(const cells of [[],[C('1','Receitas',null)],[C('1','Receitas','inválido')],[C('1.1','Vendas',0)]]){
  const r=mesConta('Set/2026','2026-09-30',cells);assert.equal(M.caixa([r],p,'entrada').disponivel,false);assert.equal(M.historicoCaixa([r],p,'recebimentos',{},'2026-10-24')[8].valor,null);
 }
});
test('mês sem trilha entra pelas contas da DRE, com o valor próprio de cada uma; soma igual ao total',()=>{
 const r=mesConta('Set/2025','2025-09-30',[C('1','Receitas',1000),C('1.1','Comunicação Visual',900),C('1.1.1','Produtos',700),C('1.4','Empréstimos',100),C('2','Despesas',600),C('2.1','Pessoal',600),C('2.1.4','Salário',500)]);
 const p={de:'2025-09-01',ate:'2025-09-30'},e=M.caixa([r],p,'entrada'),s=M.caixa([r],p,'saida');
 assert.deepEqual(e.rows.map(x=>[x.numero,x.nome,x.valor]),[['1.1','Comunicação Visual',200],['1.1.1','Produtos',700],['1.4','Empréstimos',100]],'1.1 tem 200 próprios além de 1.1.1');
 assert.equal(M.resumir(e.rows).valor,1000);assert.equal(M.resumir(s.rows).valor,600);assert.equal(e.semTrilha,1);assert.equal(e.faltam,0);
 assert.deepEqual(M.resumir(s.rows).grupos.map(g=>g.nome),['Salário','Pessoal'],'composição por conta também no histórico');
 assert.match(e.rows[0].origem,/conta 1\.1 · total do mês, sem trilha por pagamento/);assert.match(e.avisos.join(' '),/pelas contas da DRE/);
});
test('mesmo período um ano antes: fim de mês e 29/02; compara só com os dois lados completos',()=>{
 assert.deepEqual(M.periodoAnterior({de:'2026-01-01',ate:'2026-12-31'}),{de:'2025-01-01',ate:'2025-12-31'});
 assert.deepEqual(M.periodoAnterior({de:'2024-02-01',ate:'2024-02-29'}),{de:'2023-02-01',ate:'2023-02-28'});
 assert.deepEqual(M.periodoAnterior({de:'2025-02-01',ate:'2025-02-28'}),{de:'2024-02-01',ate:'2024-02-29'},'fevereiro inteiro continua inteiro');
 assert.deepEqual(M.periodoAnterior({de:'2026-03-10',ate:'2026-03-20'}),{de:'2025-03-10',ate:'2025-03-20'});
 const a=mesConta('Set/2025','2025-09-30',[C('1','Receitas',1000),C('1.1','CV',1000),C('2','Despesas',400),C('2.1','Pessoal',400)]),b=mesConta('Set/2026','2026-09-30',[C('1','Receitas',1200),C('1.1','CV',1200),C('2','Despesas',500),C('2.1','Pessoal',500)]);
 const p={de:'2026-09-01',ate:'2026-09-30'};
 const r=M.compararAno([a,b],p,'recebimentos');assert.deepEqual([r.disponivel,r.atual,r.anterior,r.delta,r.percentual],[true,1200,1000,200,20]);
 const v=M.compararAno([a,b],p,'variacao');assert.deepEqual([v.atual,v.anterior,v.delta],[700,600,100]);
 const g=M.compararAno([a,b],p,'pagamentos',{query:'Pessoal'});assert.deepEqual([g.atual,g.anterior],[500,400],'mesmos filtros dos dois lados');
 const sem=M.compararAno([b],p,'recebimentos');assert.equal(sem.disponivel,false);assert.match(sem.motivo,/O mesmo período de 2025 não compara \(sem fonte\)/);
 const ano=M.compararAno([a,b],{de:'2026-01-01',ate:'2026-12-31'},'recebimentos');assert.equal(ano.disponivel,false,'ano com meses sem fonte não compara');assert.match(ano.motivo,/mês\(es\) sem fonte/);
});

test('revisão 12.3: mês pela metade, mês sem trilha cortado, base diferente, filtro entre trilha e contas da DRE e CSV com negativo',()=>{
 const a=mesConta('Out/2025','2025-10-31',[C('1','Receitas',1000),C('1.1','CV',1000),C('2','Despesas',400),C('2.1','Pessoal',400)]);
 const b=mesConta('Out/2026','2026-10-08',[C('1','Receitas',300),C('1.1','CV',300),C('2','Despesas',100),C('2.1','Pessoal',100)]);
 const out={de:'2026-10-01',ate:'2026-10-31'},r=M.compararAno([a,b],out,'recebimentos');
 assert.equal(r.disponivel,false,'outubro coletado até 08/10 não vira queda');assert.match(r.motivo,/Out\/2026 tem lançamentos só até 08\/10\/2026; o comparativo espera o mês terminar/);
 assert.equal(M.mesCortado({periodo:'Out/2026',corte:'2026-10-08'},'2026-10-08'),false,'intervalo até o dia do corte não está cortado');
 // julho sem trilha cortado pelo intervalo de um lado
 const j25=mesConta('Jul/2025','2025-07-31',[C('1','Receitas',100),C('1.1','CV',100)]),j26={...mesConta('Jul/2026','2026-07-31',[C('1','Receitas',100),C('1.1','CV',100)]),eventos:[event('x',100,{data:'2026-07-20'})]};
 const c=M.compararAno([j25,j26],{de:'2026-07-10',ate:'2026-07-31'},'recebimentos');assert.equal(c.disponivel,false);assert.match(c.motivo,/sem trilha cortado/);
 // empresa ou critério diferente entre os anos
 const s25={...mesConta('Set/2025','2025-09-30',[C('1','R',100),C('1.1','CV',100)]),company:'Impresilk'},s26=mesConta('Set/2026','2026-09-30',[C('1','R',120),C('1.1','CV',120)]);
 assert.match(M.compararAno([s25,s26],{de:'2026-09-01',ate:'2026-09-30'},'recebimentos').motivo,/Empresas ou critérios diferentes entre os anos/);
 // filtro: mês com trilha (contas do Mubisys) contra mês antigo (contas da DRE)
 const t26={...s26,company:'Impresilk + Universo',eventos:[event('y',120,{data:'2026-09-03',nomeConta:'Receita de vendas'})]},d25={...s25,company:'Impresilk + Universo'};
 const f=M.compararAno([d25,t26],{de:'2026-09-01',ate:'2026-09-30'},'recebimentos',{grupo:'Receita de vendas',dimensao:'grupo'});
 assert.equal(f.disponivel,false,'filtro não vira zero do outro lado');assert.match(f.motivo,/nenhum registro no filtro|só compara bases do mesmo tipo/);
 // variação conta o mês ausente uma vez só
 const v=M.compararAno([s26],{de:'2026-09-01',ate:'2026-09-30'},'variacao');assert.match(v.motivo,/não compara/);
 // CSV: número negativo continua número; texto que começa com sinal continua protegido
 assert.equal(M.csvCelula('-40000,00'),'"-40000,00"');assert.equal(M.csvCelula('-1.234,50'),'"-1.234,50"');assert.equal(M.csvCelula('-cmd'),'"\'-cmd"');assert.equal(M.csvCelula('=HYPERLINK(1)'),'"\'=HYPERLINK(1)"');
});

// ── v133 (I6, I5): percentual só com base positiva; mês sem trilha não é "leitura parcial" ──
test('compararAno: base anterior negativa ou zero e atual negativo ficam sem percentual; base positiva continua igual',()=>{
 const p={de:'2026-09-01',ate:'2026-09-30'};
 const mes=(label,ate,ent,sai)=>mesConta(label,ate,[C('1','Receitas',ent),C('1.1','CV',ent),C('2','Despesas',sai),C('2.1','Pessoal',sai)]);
 // variação do caixa: -200 em 2025 e +300 em 2026; antes dava +250% sobre a base negativa
 let r=M.compararAno([mes('Set/2025','2025-09-30',800,1000),mes('Set/2026','2026-09-30',1300,1000)],p,'variacao');
 assert.deepEqual([r.disponivel,r.atual,r.anterior,r.delta,r.percentual],[true,300,-200,500,null],'base negativa: sem percentual, o R$ continua');
 r=M.compararAno([mes('Set/2025','2025-09-30',1000,1000),mes('Set/2026','2026-09-30',1300,1000)],p,'variacao');
 assert.deepEqual([r.anterior,r.delta,r.percentual],[0,300,null],'base zero: sem percentual');
 r=M.compararAno([mes('Set/2025','2025-09-30',1100,1000),mes('Set/2026','2026-09-30',900,1000)],p,'variacao');
 assert.deepEqual([r.atual,r.anterior,r.delta,r.percentual],[-100,100,-200,null],'atual negativo sobre base positiva: sem percentual');
 r=M.compararAno([mes('Set/2025','2025-09-30',600,1000),mes('Set/2026','2026-09-30',500,1000)],p,'variacao');
 assert.equal(r.percentual,null,'dois negativos não viram +X%');
 r=M.compararAno([mes('Set/2025','2025-09-30',1000,400),mes('Set/2026','2026-09-30',1200,500)],p,'recebimentos');
 assert.equal(r.percentual,20,'base positiva inalterada');
});
test('histórico: mês fechado sem trilha é total do mês completo, sem marca; mês cortado leva "*"',()=>{
 const set=mesConta('Set/2025','2025-09-30',[C('1','Receitas',1000),C('1.1','CV',1000),C('2','Despesas',400),C('2.1','Pessoal',400)]);
 const out=mesConta('Out/2025','2025-10-10',[C('1','Receitas',300),C('1.1','CV',300),C('2','Despesas',100),C('2.1','Pessoal',100)]);
 for(const fonte of ['recebimentos','pagamentos','variacao']){
  const h=M.historicoCaixa([set,out],{de:'2025-10-01',ate:'2025-10-31'},fonte);
  assert.match(h[8].nota,/Total do mês completo; sem trilha por pagamento/,fonte);assert.doesNotMatch(h[8].nota,/Leitura parcial/,fonte);assert.equal(h[8].marca,'',fonte);
  assert.equal(h[9].fechado,false);assert.equal(h[9].marca,'*','mês pela metade é incompleto');assert.doesNotMatch(h[9].nota,/Total do mês completo/);
 }
 const t=reg([event('a',100)],{company:'Impresilk + Universo',basis:'Caixa',qualidade:{ate:'2026-09-30',apiContratoValidado:false}});
 const h=M.historicoCaixa([t],{de:'2026-09-01',ate:'2026-09-30'},'recebimentos');
 assert.equal(h[8].marca,'°','fechado com cobertura a conferir usa outro sinal');assert.match(h[8].nota,/cobertura a conferir/);
});
test('v133 (I19): DREIndicadores.area escolhe a área e a fonte e recomeça os filtros; o botão do CFO leva a Margem',()=>{
 const c=vm.createContext({M,window:{},document:{addEventListener(){}}});
 vm.runInContext(fs.readFileSync(new URL('../indicadores.js',import.meta.url),'utf8').replace(/^import \* as M from [^\n]*\n/,''),c);
 const ui=()=>JSON.parse(vm.runInContext('JSON.stringify({area:ui.area,fonte:ui.fonte,dimensao:ui.dimensao,query:ui.query,grupo:ui.grupo})',c));
 vm.runInContext("ui.query='lona';ui.grupo='Vendas'",c);
 c.window.DREIndicadores.area('Margem');assert.deepEqual(ui(),{area:'Margem',fonte:'margem',dimensao:'cliente',query:'',grupo:''},'Margem abre na margem por O.S., por cliente');
 c.window.DREIndicadores.area('Resultado','competencia');assert.deepEqual([ui().area,ui().fonte,ui().dimensao],['Resultado','competencia','grupo']);
 c.window.DREIndicadores.area('Receita','margem');assert.equal(ui().fonte,'recebimentos','fonte de outra área cai na primeira da área');
 c.window.DREIndicadores.area('Inexistente');assert.equal(ui().area,'Receita','área desconhecida não muda nada');
 assert.match(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),/\[data-go\]'\)\.forEach\(b=>b\.onclick=\(\)=>\{if\(b\.dataset\.indArea\)window\.DREIndicadores\?\.area\?\.\(b\.dataset\.indArea,b\.dataset\.indFonte\);state\.view=b\.dataset\.go;render\(\);\}\)/,'o [data-go] passa a área antes de abrir a tela');
});

// ── v135: auditoria v133 (frente indicadores) ──
const telaInd=()=>{const c=vm.createContext({M,window:{},document:{addEventListener(){}}});vm.runInContext(fs.readFileSync(new URL('../indicadores.js',import.meta.url),'utf8').replace(/^import \* as M from [^\n]*\n/,''),c);return c;};
test('v135 (D11): mês futuro sem registro é "Mês ainda não chegou"; mês passado sem registro é "Sem fonte"',()=>{
 const r=reg([event('a',100)],{company:'Impresilk + Universo',basis:'Caixa'});
 const h=M.historicoCaixa([r],p,'recebimentos',{},'2026-09-21');
 for(const i of [9,10,11])assert.equal(h[i].nota,'Mês ainda não chegou',h[i].periodo);
 assert.equal(h[7].nota,'Sem fonte','agosto já passou e não tem registro');assert.equal(h[7].valor,null);assert.notEqual(h[8].nota,'Sem fonte');
 assert.equal(M.historicoCaixa([r],p,'recebimentos',{},'2026-12-31')[11].nota,'Sem fonte','dezembro começado e sem registro é falta de fonte');
});
test('v135 (D16, D37): percentual com 1 casa, sinal de menos "−" sem -0 e datas da fonte em dd/mm/aaaa',()=>{
 const c=telaInd(),run=x=>vm.runInContext(x,c);
 assert.equal(run('pct(15.87)'),'15,9%');assert.equal(run('pct(61)'),'61,0%');assert.equal(run('pct(-0.01)'),'0,0%');assert.equal(run('pct(-2.84)'),'−2,8%');assert.equal(run('pct(null)'),'Indeterminada');
 assert.match(run('br(-1234.5)'),/^−R\$\s1\.234,50$/);assert.match(run('br(-0)'),/^R\$\s0,00$/);assert.doesNotMatch(run('br(-0.001)'),/-|−/);
 assert.equal(M.dataBRIso('2026-08-01'),'01/08/2026');assert.equal(M.dataBRIso('2026-08-01T12:00:00Z'),'01/08/2026');assert.equal(M.dataBRIso(null),'');
 const s={completo:true,desde:'2026-08-01',ate:'2026-08-31',em:'2026-09-01T12:00:00Z',itens:[]};
 assert.equal(M.normalizarSnapshot(s,'fiscal',{de:'2026-08-01',ate:'2026-08-31'}).fontes[0].periodo,'01/08/2026 a 31/08/2026');
 assert.match(M.normalizarSnapshot(s,'fiscal',p).avisos[0],/^Fonte disponível de 01\/08\/2026 a 31\/08\/2026/);
 assert.equal(run("dataTxt('Recorte de 2026-08-01 a 2026-08-31, coletado 2026-09-01T12:00:00Z')"),'Recorte de 01/08/2026 a 31/08/2026, coletado 2026-09-01T12:00:00Z');
 // Evolução das fontes importadas: Referência "Ago/2026", eixo "Ago/26", nunca "2026-08" nem "08/26".
 run("ui.fonte='fiscal';ui.area='Receita';ui.periodo={de:'2026-08-01',ate:'2026-09-30'};ui.ctx={records:[]}");
 c.m={evolucao:[{nome:'2026-08',valor:-10,quantidade:1,ausentes:0},{nome:'2026-09',valor:20,quantidade:1,ausentes:0}],grupos:[]};
 const html=run('analises(m)');assert.match(html,/<td>Ago\/2026<\/td>/);assert.match(html,/class="ind-axis">Ago\/26</);assert.doesNotMatch(html,/2026-08|08\/26/);assert.match(html,/−R\$\s10,00/);
});
test('v135 (D44, D45): ausência sai como vazio no cartão; coluna Data só quando algum registro tem data',()=>{
 const c=telaInd(),run=x=>vm.runInContext(x,c);
 for(const v of ['Não apurado','Sem comparação','Indisponível','Indeterminada'])assert.match(run(`metric('X',${JSON.stringify(v)},'')`),/<strong class="ind-vazio">/,v);
 assert.match(run("metric('X','R$ 1,00','','','entra')"),/<strong class="tom-entra">/);assert.match(run("metric('X','Não apurado','','','sai')"),/<strong class="ind-vazio">/,'vazio vence o tom');
 run("ui.fonte='custos'");const semData=run("tabela([{id:'1',numero:'1',nome:'OS',grupo:'Normal',data:null,valor:10}])");assert.doesNotMatch(semData,/<th>Data<\/th>|Não atribuída/);
 run("ui.fonte='recebimentos'");const comData=run("tabela([{id:'1',numero:'1',nome:'A',data:'2026-09-02',valor:10},{id:'2',numero:'2',nome:'B',data:null,valor:5}])");assert.match(comData,/<th>Data<\/th>/);assert.match(comData,/Não atribuída/);
});
test('v135 (I33): NF-e e notas de compra abrem por cliente; O.S. comerciais por vendedor, sem a opção grupo',()=>{
 const c=telaInd(),run=x=>vm.runInContext(x,c),dim=()=>run('ui.dimensao'),ops=r=>JSON.parse(run(`JSON.stringify(dimensoes(${r}))`));
 c.window.DREIndicadores.area('Receita','fiscal');assert.equal(dim(),'cliente');assert.deepEqual(ops(true),[['grupo','Situação da nota'],['cliente','Cliente / fornecedor']]);
 c.window.DREIndicadores.area('Custos','compras');assert.equal(dim(),'cliente');assert.equal(ops(true)[0][1],'Situação da nota');
 c.window.DREIndicadores.area('Receita','comercial');assert.equal(dim(),'vendedor');assert.deepEqual(ops(true).map(x=>x[0]),['cliente','vendedor']);
 c.window.DREIndicadores.area('Receita','recebimentos');assert.equal(dim(),'grupo');assert.deepEqual(ops(false),[['grupo','Conta / grupo']]);
});
test('v135 (N3): rota() devolve área e fonte; mount reabre a rota do link e mantém os filtros quando ela é a atual',async()=>{
 const c=telaInd(),run=x=>vm.runInContext(x,c),I=c.window.DREIndicadores,ctx=rota=>({periodo:'Set/2026',records:[],rota,api:async()=>({ok:false,erro:'sem rede no teste'})});
 assert.deepEqual({...I.rota()},{area:'Receita',fonte:'recebimentos'});
 I.mount({},ctx({area:'Custos',fonte:'compras'}));assert.deepEqual({...I.rota()},{area:'Custos',fonte:'compras'});
 run("ui.query='lona'");I.mount({},ctx({area:'Custos',fonte:'compras'}));assert.equal(run('ui.query'),'lona','mesma rota não recomeça os filtros');
 I.mount({},ctx({area:'Inexistente',fonte:'x'}));assert.deepEqual({...I.rota()},{area:'Custos',fonte:'compras'});
 I.mount({},ctx(null));assert.equal(I.rota().area,'Custos','sem rota fica onde está');
 const src=fs.readFileSync(new URL('../indicadores.js',import.meta.url),'utf8');
 assert.match(src,/all\('\[data-area\]',b=>b\.onclick=\(\)=>\{[^}]*reset\(\);window\.gravarRota\?\.\(\);carregar\(\);\}\)/);assert.match(src,/all\('\[data-source\]',b=>b\.onclick=\(\)=>\{[^}]*reset\(\);window\.gravarRota\?\.\(\);carregar\(\);\}\)/);
 await new Promise(r=>setTimeout(r,0));
});
test('v135 (N7, N27, M10): foco volta ao controle depois de repintar; ROE e ROA abrem o glossário; impressão com logo.webp',()=>{
 const src=fs.readFileSync(new URL('../indicadores.js',import.meta.url),'utf8');
 assert.match(src,/FOCO_ATTRS=\['data-area','data-source','data-ind-period'/);assert.match(src,/ligar\(\);window\.wireGlossario\?\.\(\);\n if\(foco\)ui\.container\.querySelector\(foco\)\?\.focus\(\{preventScroll:true\}\);/);
 // O "?" fica dentro da descrição: a linha é uma grade de 3 colunas (sigla, descrição, taxa).
 assert.match(src,/<b>ROE<\/b><span>\$\{esc\(base\)\} ÷ patrimônio médio <button type="button" class="term-help" data-term="ROE \(retorno sobre o patrimônio\)" aria-label="Entender ROE">\?<\/button><\/span>/);
 assert.match(src,/<b>ROA<\/b><span>\$\{esc\(base\)\} ÷ ativo médio <button type="button" class="term-help" data-term="ROA \(retorno sobre o ativo\)" aria-label="Entender ROA">\?<\/button><\/span>/);
 assert.match(src,/<img src="logo\.webp" alt="Impresilk">/);assert.doesNotMatch(src,/logo\.png/);
});

// Ano com seleção do ano comparado (PLANO-ANO, IND-1 e IND-2).
const MESES_T=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const anoFix=(ano,valor,ate=9,parcial=null)=>Array.from({length:ate},(_,i)=>{const fim=new Date(Date.UTC(ano,i+1,0)).toISOString().slice(0,10);return mesConta(`${MESES_T[i]}/${ano}`,parcial&&i===ate-1?parcial:fim,[C('1','Receitas',valor),C('1.1','CV',valor),C('2','Despesas',valor/2),C('2.1','Pessoal',valor/2)]);});
test('IND-1: periodoNoAno leva o intervalo ao ano dado; compararAno com {ano} usa esse ano; sem ele, um ano antes',()=>{
 assert.deepEqual(M.periodoNoAno({de:'2024-02-01',ate:'2024-02-29'},2023),{de:'2023-02-01',ate:'2023-02-28'});
 assert.deepEqual(M.periodoNoAno({de:'2023-02-01',ate:'2023-02-28'},2024),{de:'2024-02-01',ate:'2024-02-29'},'fim de fevereiro continua fim');
 assert.deepEqual(M.periodoNoAno({de:'2026-01-01',ate:'2026-08-31'},2024),{de:'2024-01-01',ate:'2024-08-31'});
 assert.deepEqual(M.periodoNoAno({de:'2026-03-10',ate:'2026-03-20'},'2025'),{de:'2025-03-10',ate:'2025-03-20'});
 assert.deepEqual(M.periodoNoAno({de:'2025-10-01',ate:'2026-09-30'},2023),{de:'2023-10-01',ate:'2024-09-30'},'intervalo que cruza o ano anda inteiro');
 assert.deepEqual(M.periodoNoAno({de:'2027-01-01',ate:'2027-01-31'},2026),{de:'2026-01-01',ate:'2026-01-31'},'ano novo, sem ano escrito no código');
 assert.deepEqual(M.periodoAnterior({de:'2024-02-01',ate:'2024-02-29'}),M.periodoNoAno({de:'2024-02-01',ate:'2024-02-29'},2023));
 const recs=[...anoFix(2024,100),...anoFix(2025,200),...anoFix(2026,300)],p={de:'2026-01-01',ate:'2026-08-31'};
 const c=M.compararAno(recs,p,'recebimentos',{},{ano:2024});assert.deepEqual([c.disponivel,c.atual,c.anterior,c.delta,c.percentual,c.periodo.de,c.periodo.ate],[true,2400,800,1600,200,'2024-01-01','2024-08-31']);
 const d=M.compararAno(recs,p,'recebimentos');assert.deepEqual([d.anterior,d.periodo.de],[1600,'2025-01-01'],'sem {ano}: um ano antes, como na v135');
 assert.deepEqual(M.compararAno(recs,p,'recebimentos',{},{}),d);assert.deepEqual(M.compararAno(recs,p,'recebimentos',{},{ano:null}),d);
 const sem=M.compararAno(anoFix(2026,300),p,'recebimentos',{},{ano:2024});assert.equal(sem.disponivel,false);assert.match(sem.motivo,/^O mesmo período de 2024 não compara \(/);
});
const ctxAno=(c,extra)=>{c.ctx={records:[...anoFix(2024,100),...anoFix(2025,200),...anoFix(2026,300,9,'2026-09-20')],...extra};vm.runInContext('ui.ctx=ctx;ui.area="Receita";ui.fonte="recebimentos";ui.anoApp=true;ui.periodo={de:"2026-01-01",ate:"2026-09-30"};ui.query="";ui.grupo="";ui.dimensao="grupo";ui.pagina=0',c);return vm.runInContext('resultado(montarLocal())',c);};
const cartao=(html,i)=>[...html.matchAll(/<button type="button" class="ind-metric[^"]*"[^>]*><span>([^<]*)<\/span><strong[^>]*>([^<]*)<\/strong><small>([\s\S]*?)<\/small><\/button>/g)][i];
test('IND-2: no Ano, o cartão e o gráfico usam o ano escolhido, só nos meses comparáveis desde janeiro',()=>{
 const c=telaInd();
 // Set/2026 em andamento: compara Jan a Ago com 2024.
 let html=ctxAno(c,{anoComparado:2024,mesesComparaveis:[0,1,2,3,4,5,6,7]}),k=cartao(html,1);
 assert.equal(k[1],'Jan a Ago de 2024');assert.match(k[2],/800,00/);assert.match(k[3],/nos mesmos meses \(Jan a Ago\)/);assert.match(k[3],/01\/01\/2024 a 31\/08\/2024/);assert.match(k[3],/\+200,0%/);
 assert.match(html,/Janeiro a dezembro de 2026, com 2024 ao lado \(barra cinza\)/);assert.match(html,/ind-chave-anterior"><\/i>2024</);assert.doesNotMatch(html,/2025 ao lado|Mesmo período de 2025|de 2025</);
 assert.match(html,/<th>2024<\/th>/);assert.match(html,/mês pela metade/,'Set/2026 fica sem variação mês a mês');assert.doesNotMatch(html,/fora dos meses comparáveis/);
 // Julho fora da base comparável: o cartão para em junho e o gráfico tira a variação de julho.
 html=ctxAno(c,{anoComparado:2024,mesesComparaveis:[0,1,2,3,4,5,7]});k=cartao(html,1);
 assert.equal(k[1],'Jan a Jun de 2024');assert.match(k[2],/600,00/);assert.match(k[3],/nos mesmos meses \(Jan a Jun\)/);assert.match(html,/<td>Jul\/2026<\/td>[\s\S]*?fora dos meses comparáveis/);
 // Ano até agosto, todos os meses comparáveis: "Mesmo período de 2024", sem a nota dos mesmos meses.
 vm.runInContext('ctx.mesesComparaveis=[0,1,2,3,4,5,6,7];ui.periodo={de:"2026-01-01",ate:"2026-08-31"}',c);html=vm.runInContext('resultado(montarLocal())',c);k=cartao(html,1);
 assert.equal(k[1],'Mesmo período de 2024');assert.doesNotMatch(k[3],/nos mesmos meses/);
 // Sem janeiro comparável: sem comparação, com o motivo.
 html=ctxAno(c,{anoComparado:2025,mesesComparaveis:[1,2,3]});k=cartao(html,1);
 assert.equal(k[1],'Mesmo período de 2025');assert.equal(k[2],'Sem comparação');assert.equal(k[3],'Sem meses completos, da mesma base, desde janeiro em 2026 e 2025.');
 // "Sem comparação" no topo: cartão Comparação e gráfico sem a série cinza.
 html=ctxAno(c,{anoComparado:null,mesesComparaveis:[]});k=cartao(html,1);
 assert.deepEqual([k[1],k[2],k[3]],['Comparação','Sem comparação','Escolha um ano em “Comparar com”, no topo.']);
 assert.doesNotMatch(html,/ao lado|ind-chave-anterior|ind-fill-anterior|<th>Variação<\/th>/);assert.match(html,/Janeiro a dezembro de 2026 · mesmos filtros/);
 // App sem o contrato (campo ausente) ou fora do Ano: como na v135, o ano anterior.
 html=ctxAno(c,{});assert.equal(cartao(html,1)[1],'Mesmo período de 2025');assert.match(html,/com 2025 ao lado/);
 vm.runInContext('ui.anoApp=false;ui.periodo={de:"2026-08-01",ate:"2026-08-31"};ctx.anoComparado=2024;ctx.mesesComparaveis=[0,1,2,3,4,5,6,7]',c);html=vm.runInContext('resultado(montarLocal())',c);
 assert.equal(cartao(html,1)[1],'Mesmo período de 2025');assert.match(cartao(html,1)[2],/200,00/);assert.match(html,/com 2025 ao lado/);
});
test('IND-2: "Aplicar" do filtro no Ano mantém o ano de "Comparar com"; outro intervalo sai do Ano e voltar ao ano religa (v136, RC-1)',()=>{
 const c=telaInd(),run=x=>vm.runInContext(x,c);
 const form={elements:{preset:{},de:{},ate:{}}};c.form=form;c.intervalos=[];
 // onIntervalo faz o papel do app (atualizarChipsPeriodo): diz se o intervalo é o ano do app.
 c.ctx={records:[...anoFix(2024,100),...anoFix(2025,200),...anoFix(2026,300,9,'2026-09-20')],anoComparado:2024,mesesComparaveis:[0,1,2,3,4,5,6,7],onIntervalo:p=>{c.intervalos.push(p.de+'|'+p.ate);return p.de==='2026-01-01'&&p.ate==='2026-09-30';}};
 run('ui.container={isConnected:false,querySelectorAll:()=>[],querySelector:s=>s==="#indFilters"?form:{}};ui.ctx=ctx;ui.area="Receita";ui.fonte="recebimentos";ui.anoApp=true;ui.periodo={de:"2026-01-01",ate:"2026-09-30"};ui.query="";ui.grupo="";ui.dimensao="grupo";ui.pagina=0;ligar()');
 const aplicar=(de,ate,preset,query='')=>{Object.assign(form.elements,{de:{value:de},ate:{value:ate},preset:{value:preset},query:{value:query},dimensao:{value:'grupo'}});form.onsubmit({preventDefault(){}});return run('resultado(ui.modelo)');};
 let html=aplicar('2026-01-01','2026-09-30','ano');
 assert.equal(run('ui.anoApp'),true,'Aplicar sem mudar o intervalo continua no Ano');assert.equal(cartao(html,1)[1],'Jan a Ago de 2024');assert.match(html,/com 2024 ao lado/);assert.doesNotMatch(html,/2025 ao lado|de 2025</);
 html=aplicar('2026-01-01','2026-09-30','ano','CV');assert.equal(run('ui.anoApp'),true,'a busca também');assert.match(html,/com 2024 ao lado/);
 html=aplicar('2026-07-01','2026-09-30','trimestre');assert.equal(run('ui.anoApp'),false,'trimestre sai do Ano');assert.match(html,/com 2025 ao lado/,'fora do Ano, o ano anterior, como na v135');
 html=aplicar('2026-01-01','2026-09-30','ano');assert.equal(run('ui.anoApp'),true,'voltar ao ano pelo filtro religa');assert.equal(cartao(html,1)[1],'Jan a Ago de 2024');assert.match(html,/com 2024 ao lado/);
 assert.deepEqual(c.intervalos,['2026-01-01|2026-09-30','2026-01-01|2026-09-30','2026-07-01|2026-09-30','2026-01-01|2026-09-30'],'o app decide o Ano antes da conta');
 // Sem o app (onIntervalo ausente): só o mesmo intervalo mantém o vínculo.
 run('ctx.onIntervalo=undefined');aplicar('2026-01-01','2026-09-30','ano');assert.equal(run('ui.anoApp'),true);aplicar('2026-01-01','2026-06-30','personalizado');assert.equal(run('ui.anoApp'),false);
});
test('IND-2: virada para 2027 (Jan/2027 em andamento) compara com o ano escolhido, sem ano escrito no código',()=>{
 const c=telaInd();c.ctx={records:[...anoFix(2025,200,12),...anoFix(2026,300,12),...anoFix(2027,400,1,'2027-01-15')],anoComparado:2026,mesesComparaveis:[]};
 vm.runInContext('ui.ctx=ctx;ui.area="Receita";ui.fonte="recebimentos";ui.anoApp=true;ui.periodo={de:"2027-01-01",ate:"2027-01-31"}',c);let html=vm.runInContext('resultado(montarLocal())',c);
 assert.equal(cartao(html,1)[3],'Sem meses completos, da mesma base, desde janeiro em 2027 e 2026.');assert.match(html,/Janeiro a dezembro de 2027, com 2026 ao lado/);assert.match(html,/class="ind-value">400\*</,'Jan/2027 marcado *');
 c.ctx.anoComparado=2025;html=vm.runInContext('resultado(montarLocal())',c);assert.match(html,/com 2025 ao lado/);assert.doesNotMatch(html,/2026 ao lado/);
 const src=fs.readFileSync(new URL('../indicadores.js',import.meta.url),'utf8'),corpo=src.slice(src.indexOf('const anoComparadoTela'),src.indexOf('async function consultarIndicadores'));
 assert.doesNotMatch(corpo,/\b(19|20)\d\d\b/);const mod=fs.readFileSync(new URL('../indicadores-modelo.mjs',import.meta.url),'utf8');assert.doesNotMatch(mod.slice(mod.indexOf('export function periodoNoAno'),mod.indexOf('export function caixa(')),/\b(19|20)\d\d\b/);
});
