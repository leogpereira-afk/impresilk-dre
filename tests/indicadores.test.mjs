import {test} from 'node:test';import assert from 'node:assert/strict';
import * as M from '../indicadores-modelo.mjs';
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
 assert.equal(r.disponivel,false,'outubro coletado até 08/10 não vira queda');assert.match(r.motivo,/Out\/2026 tem lançamentos só até 08\/10\/2026; o comparativo espera o mês fechar/);
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
