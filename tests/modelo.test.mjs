import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
const file=new URL('../financeiro.js',import.meta.url);const ctx={};vm.createContext(ctx);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),ctx);const F=ctx.DREFinancas||{};
const rec=(cells={},extra={})=>({label:'Ago/2026',origem:'erp',atualizadoEm:'2026-08-10T16:00:00Z',cells:Object.entries(cells).map(([code,value])=>({code,value,name:code})),...extra});
test('mês antigo coletado antes do fim é parcial',()=>assert.equal(F.qualidade?.(rec({'1':100}),new Date('2026-09-09')).estado,'parcial'));
test('sem registro é ausência de dados, nunca zero financeiro',()=>assert.equal(F.qualidade?.(null,new Date('2026-09-09'))?.estado,'sem-dados'));
test('entrada não identificada é separada de empréstimo',()=>{const v=F.resumo?.(rec({'1':150,'1.1':100,'1.4':30,'1.7':20,'2':80}));assert.equal(v?.emprestimos,30);assert.equal(v?.naoIdentificadas,20);assert.equal(v?.variacao,70);});
test('sem saldo inicial não se calcula saldo disponível',()=>assert.equal(F.projecao?.({saldo:null,movimentos:[],inicio:'2026-09-09'})?.disponivel,false));
test('projeção aplica vencimentos e conserva centavos',()=>{const r=F.projecao?.({saldo:1000,movimentos:[{id:'1',data:'2026-09-10',tipo:'saida',valor:1200},{id:'2',data:'2026-09-17',tipo:'entrada',valor:400}],inicio:'2026-09-09',semanas:2});assert.equal(r?.minimo,-200);assert.equal(r?.final,200);assert.equal(r?.primeiroAperto,'2026-09-10');});
test('mês parcial não é comparável a completo',()=>{assert.equal(F.comparacao?.(rec({'1':100}),rec({'1':200},{label:'Jul/2026'}),new Date('2026-09-09'))?.permitida,false);});
const corrente=(extra={})=>({label:'Set/2026',origem:'erp',atualizadoEm:'2026-09-20T09:00:00Z',cells:[{code:'1',value:100,name:'1'},{code:'2',value:80,name:'2'}],qualidade:{estado:'parcial',ate:'2026-09-20',regra:'v2',escopo:'DRE'},...extra});
const fechado=(extra={})=>({label:'Ago/2026',origem:'erp',atualizadoEm:'2026-09-01T09:00:00Z',cells:[{code:'1',value:200,name:'1'},{code:'2',value:160,name:'2'}],qualidade:{estado:'aguardando-conferencia',ate:'2026-08-31',regra:'v2',escopo:'DRE'},...extra});
const AGORA=new Date('2026-09-22T12:00:00Z');
test('mês corrente parcial e atrasado: o rótulo vira desatualizado mas o fato parcial permanece',()=>{const q=F.qualidade(corrente(),AGORA);assert.equal(q.estado,'desatualizado');assert.equal(q.parcial,true);assert.equal(q.coletadoAte,'2026-09-20');});
test('mês corrente parcial não se compara com mês fechado, mesmo com o rótulo sobrescrito',()=>{const c=F.comparacao(corrente(),fechado(),AGORA);assert.equal(c.permitida,false);assert.match(c.motivo,/20\/09\/2026/);});
test('conta bloqueada por renome recebe o motivo da conta, não o do par de meses',()=>{const a=fechado({label:'Set/2026',cells:[{code:'2.5',value:50,name:'Cemig'}],qualidade:{estado:'aguardando-conferencia',ate:'2026-09-30',regra:'v2',escopo:'DRE'}});const b=fechado({cells:[{code:'2.5',value:40,name:'CEMIG antigo'}]});const r=F.compararConta(a,b,'2.5');assert.equal(r.permitida,false);assert.match(r.motivo,/mudou de nome/);});
test('resíduo de conta pai aparece no detalhamento',()=>{const r=F.residuos?.(rec({'1':100,'1.1':90}));assert.equal(r?.find(x=>x.code==='1')?.value,10);});
test('margem acumulada usa razão dos totais',()=>assert.equal(F.margemAcumulada?.([{receita:100,resultado:50},{receita:900,resultado:90}]),.14));
test('empresas de escopos distintos não são comparadas',()=>{const q={estado:'aguardando-conferencia',ate:'2026-08-31',escopo:'compõe DRE',regra:'v2'};assert.equal(F.comparacao(rec({}, {company:'A',qualidade:q}),rec({}, {company:'B',qualidade:q})).permitida,false);});
test('transferência entre empresas não vira custo operacional',()=>{const r=F.resumo(rec({'2':100,'2.18':80}));assert.equal(r.transferencias,80);assert.equal(r.pagamentosOperacionais,null,'componentes ausentes não podem ser tratados como zero');});
test('saldo já abaixo da reserva é sinalizado no primeiro dia',()=>{const r=F.projecao({saldo:10,reserva:50,movimentos:[],inicio:'2026-09-09'});assert.equal(r.primeiroAperto,'2026-09-09');});
test('coleta com contrato da API ainda não validado não libera comparação',()=>{const r=rec({}, {qualidade:{estado:'aguardando-conferencia',ate:'2026-08-31',apiContratoValidado:false}});assert.equal(F.qualidade(r).comparavel,false);});
test('gráficos distinguem conta ausente de gasto zero e rejeitam valor inválido',()=>{
 assert.equal(F.valorConta(rec({'2':0}),'2'),0);
 assert.equal(F.valorConta(rec({}),'2'),null);
 assert.equal(F.valorConta(rec({'2':'inválido'}),'2'),null);
 assert.equal(F.valorConta(rec({'2':null}),'2'),null);
});
test('composição soma um nível de contas sem duplicar descendentes',()=>{
 const r=F.composicao(rec({'2':100,'2.5':60,'2.5.1':20,'2.5.3':40,'2.6':30}),'2');
 assert.equal(r.total,100);assert.equal(r.itens.length,3);
 assert.equal(r.itens.reduce((s,c)=>s+Math.round(c.value*100),0),10000);
 assert.equal(r.itens.find(c=>c.residuo).value,10);
});
test('conta órfã é incluída sem duplicar e diferença negativa fica explícita',()=>{
 const r=F.composicao(rec({'2':50,'2.5.3':70,'2.5.3.1':70}),'2');
 assert.equal(r.itens.length,2);assert.equal(r.itens.find(c=>c.residuo).value,-20);
});
test('ausência de total ou detalhe inválido não produz fechamento inventado',()=>{
 assert.equal(F.composicao(rec({'2.5':10}),'2').total,null);
 const r=F.composicao(rec({'2':100,'2.5':null}),'2');
 assert.equal(r.incompleta,true);assert.equal(r.itens.some(c=>c.residuo),false);
});
test('histórico anual conserva lacunas e nomes de cada período',()=>{
 const rows=F.serieAnual([rec({'2.5.3':0},{label:'Jan/2026'}),rec({'2.5.3':50},{label:'Mar/2026'})],'Ago/2026','2.5.3');
 assert.equal(rows.length,12);assert.equal(rows[0].value,0);assert.equal(rows[1].value,null);assert.equal(rows[2].value,50);assert.equal(rows[7].value,null);
});
test('conta com nome ou origem incompatível não recebe variação automática',()=>{
 const extra={company:'Empresa',basis:'caixa',qualidade:{estado:'fechado',ate:'2026-08-31',regra:'v2',escopo:'DRE'}};
 const a=rec({'2.5':120},extra),b=rec({'2.5':100},{...extra,label:'Jul/2026'});
 a.cells[0].name='Despesas fixas';b.cells[0].name='Despesas fixas';
 assert.equal(F.compararConta(a,b,'2.5').delta,20);assert.equal(F.compararConta(a,b,'2.5').percentual,20);
 b.cells[0].name='Outra categoria';assert.equal(F.compararConta(a,b,'2.5').delta,null);
});
test('comparação não converte mês parcial, conta ausente ou base zero em percentual',()=>{
 const extra={company:'Empresa',basis:'caixa',qualidade:{estado:'fechado',ate:'2026-08-31'}};
 const a=rec({'2':100},extra),b=rec({'2':0},extra);
 assert.equal(F.compararConta(a,b,'2').percentual,null);
 assert.equal(F.compararConta(a,rec({},extra),'2').delta,null);
 assert.equal(F.compararConta(a,rec({'2':10}),'2').delta,null);
});
const q2=(extra={})=>({estado:'aguardando-conferencia',ate:'2026-08-31',escopo:'compõe DRE',regra:'v2',apiContratoValidado:false,...extra});
test('cobertura não validada vira ressalva, não bloqueio de comparação',()=>{
 const a=rec({'1':100},{qualidade:q2()}),b=rec({'1':80},{label:'Jul/2026',qualidade:q2({ate:'2026-07-31'})});
 const c=F.comparavelComRessalva?.(a,b,new Date('2026-09-09'));
 assert.equal(c?.pode,true);assert.equal(c?.ressalva,true);
 assert.equal(F.qualidade(a,new Date('2026-09-09')).comparavel,false);
});
test('empresas diferentes continuam sem comparação',()=>{
 const a=rec({'1':100},{company:'A',qualidade:q2()}),b=rec({'1':80},{company:'B',label:'Jul/2026',qualidade:q2()});
 assert.equal(F.comparavelComRessalva?.(a,b,new Date('2026-09-09'))?.pode,false);
});
test('referência aceita mês coletado até o fim mesmo sem contrato validado',()=>{
 const cheio=rec({'1':100},{label:'Jul/2026',qualidade:q2({ate:'2026-07-31',coletadoEm:'2026-08-01T10:00:00Z'})});
 const meio=rec({'1':50},{label:'Ago/2026',qualidade:q2({ate:'2026-08-10',coletadoEm:'2026-08-10T10:00:00Z'})});
 const r=F.mesesDeReferencia?.([cheio,meio],new Date('2026-09-09'))||[];
 assert.equal(r.length,1);assert.equal(r[0].label,'Jul/2026');
});

test('totais ausentes não viram zero nem subtotais artificiais',()=>{assert.equal(F.resumo(null).entradas,null);assert.equal(F.resumo(rec({'1':100})).variacao,null);assert.equal(F.resumo(rec({'1':100,'2':0})).variacao,100);});

// Ano (chip "Ano" em todas as telas): F.somarMeses soma os meses em centavos e não inventa zero.
const qm=(ate,extra={})=>({estado:'aguardando-conferencia',ate,escopo:'compõe DRE',regra:'v2',...extra});
const mesAno=(label,ate,cells,extra={})=>({label,origem:'erp',company:'Impresilk + Universo',basis:'Caixa gerencial',atualizadoEm:ate+'T23:00:00Z',qualidade:qm(ate),cells:Object.entries(cells).map(([code,v])=>Array.isArray(v)?{code,value:v[0],name:v[1]}:{code,value:v,name:'Conta '+code}),...extra});
const TRES=()=>[mesAno('Mar/2026','2026-03-31',{'1':300,'1.1':300,'2':30.2,'2.5':0.2,'2.5.3':0.2,'2.12':30}),mesAno('Jan/2026','2026-01-31',{'1':100,'1.1':100,'2':10.1,'2.5':0.1,'2.5.3':0.1,'2.12':10}),mesAno('Fev/2026','2026-02-28',{'1':200,'1.1':200,'2':20,'2.12':20},{pendencias:[{tipo:'x',texto:'conferir'}]})];
test('somarMeses: centavos exatos, conta ausente num mês com registro é zero e a ordem é a do calendário',()=>{
 const r=F.somarMeses(TRES(),{label:'2026',rotulo:'2026 · Jan a Mar'});
 assert.equal(r.disponivel,true);const g=r.reg;
 assert.equal(g.id,'ano_2026');assert.equal(g.label,'2026');assert.equal(g.rotulo,'2026 · Jan a Mar');
 assert.equal(F.valorConta(g,'2.5.3'),0.3,'0,1 + 0,2 = 0,3, sem 0,30000000000000004');
 assert.equal(F.valorConta(g,'1'),600);assert.equal(F.valorConta(g,'2'),60.3);
 assert.deepEqual([...g.ano.meses],['Jan/2026','Fev/2026','Mar/2026']);
 assert.deepEqual([...g.cells.map(c=>c.code)],['1','1.1','2','2.5','2.5.3','2.12'],'ordem de código numérica');
 assert.equal(g.company,'Impresilk + Universo');assert.equal(g.basis,'Caixa gerencial');assert.equal(g.origem,'erp');
 assert.equal(g.qualidade.estado,'ano');assert.equal(g.qualidade.ate,'2026-03-31','corte do último mês');assert.equal(g.qualidade.coletadoEm,'2026-03-31T23:00:00Z','a coleta mais recente');
 assert.equal(g.pendencias.length,1);assert.equal(g.pendencias[0].mes,'Fev/2026');assert.deepEqual([...g.eventos],[]);
 const c=F.composicao(g,'2');assert.equal(c.itens.reduce((s,x)=>s+Math.round(x.value*100),0),Math.round(c.total*100),'a composição do ano fecha com o total');
});
test('somarMeses: valor inválido em qualquer mês deixa a soma sem valor; vazio e escopo diferente recusam com o motivo',()=>{
 const m=TRES();m[1].cells.find(c=>c.code==='2.5.3').value=null;
 assert.equal(F.valorConta(F.somarMeses(m,{label:'2026'}).reg,'2.5.3'),null,'null propaga');
 assert.equal(F.valorConta(F.somarMeses(m,{label:'2026'}).reg,'2.12'),60,'as outras contas continuam');
 assert.deepEqual({...F.somarMeses([],{label:'2026'})},{disponivel:false,motivo:'Nenhum mês no período.'});
 const d=TRES();d[2].company='Outra';
 assert.deepEqual({...F.somarMeses(d,{label:'2026'})},{disponivel:false,motivo:'Empresas ou critérios diferentes dentro do ano: os meses não se somam.'});
 const e=TRES();e[0].qualidade.regra='v3';assert.equal(F.somarMeses(e,{label:'2026'}).disponivel,false,'regra diferente também recusa');
 const o=TRES();o[0].origem='planilha';assert.equal(F.somarMeses(o,{label:'2026'}).reg.origem,'misto');
});
test('somarMeses: código renomeado pelo robô com nomes diferentes soma e fica misturado; compararConta não compara',()=>{
 const m=TRES();m[1].cells.push({code:'2.1.51',value:5,name:'Agência'});m[0].cells.push({code:'2.1.51',value:7,name:'Acabamento'});
 const g=F.somarMeses(m,{label:'2026'}).reg,cel=g.cells.find(c=>c.code==='2.1.51');
 assert.equal(cel.value,12);assert.equal(cel.misturado,true);assert.equal(cel.name,'Acabamento','nome do último mês');
 assert.equal(g.cells.find(c=>c.code==='2.5.3').misturado,undefined);
 const outro=F.somarMeses(TRES().map(r=>({...r,label:r.label.replace('2026','2025')})),{label:'2025'}).reg;
 const r=F.compararConta(g,outro,'2.1.51');assert.equal(r.permitida,false);assert.equal(r.motivo,'O código foi usado para contas diferentes no ano: não se compara.');assert.equal(r.delta,null);
 const n=TRES();n[1].cells.push({code:'2.1.4',value:5,name:'Salário'});n[0].cells.push({code:'2.1.4',value:7,name:'Salários'});
 assert.equal(F.somarMeses(n,{label:'2026'}).reg.cells.find(c=>c.code==='2.1.4').misturado,undefined,'abaixo de 51, o nome muda sem misturar');
});
test('qualidade do registro do ano: mês em andamento, cobertura a conferir e cobertura registrada',()=>{
 const agora=new Date('2026-04-12T12:00:00Z');
 const ok=F.somarMeses(TRES().map(r=>({...r,qualidade:{...r.qualidade,estado:'fechado'}})),{label:'2026',agora}).reg,q=F.qualidade(ok,agora);
 assert.deepEqual({e:q.estado,r:q.rotulo,c:q.comparavel,p:q.parcial,m:q.mensagem},{e:'ano',r:'Cobertura registrada',c:true,p:false,m:'Cobertura registrada em todos os meses do ano.'});
 const res=F.somarMeses(TRES().map((r,i)=>({...r,qualidade:{...r.qualidade,estado:i?'fechado':'cobertura-nao-validada'}})),{label:'2026',agora}).reg,qr=F.qualidade(res,agora);
 assert.deepEqual([qr.rotulo,qr.comparavel,qr.mensagem],['Cobertura a conferir',false,'Cobertura da coleta ainda não validada em algum mês do ano: confira antes de decidir.']);
 const p=TRES();p.push(mesAno('Abr/2026','2026-04-10',{'1':10,'2':5}));const qp=F.qualidade(F.somarMeses(p,{label:'2026',agora}).reg,agora);
 assert.deepEqual([qp.rotulo,qp.parcial,qp.comparavel,qp.mensagem],['Inclui mês em andamento',true,false,'O ano inclui o mês em andamento: os valores ainda mudam.']);
 assert.equal(qp.corte,null);assert.equal(qp.coletadoAte,null);
});
test('DRE Simples sobre o registro do ano: as vendas são a soma das vendas dos meses',()=>{
 const c={};vm.createContext(c);for(const f of ['financeiro.js','dre-modelo.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 c.__m=TRES();const v=vm.runInContext(`(()=>{const g=DREFinancas.somarMeses(__m,{label:'2026'}).reg;return [DRESimples.apurar(g).linhas.vendas,__m.reduce((t,r)=>t+Math.round(DRESimples.apurar(r).linhas.vendas*100),0)/100];})()`,c);
 assert.equal(v[0],600);assert.equal(v[0],v[1]);
});
