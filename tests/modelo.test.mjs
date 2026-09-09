import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
const file=new URL('../financeiro.js',import.meta.url);const ctx={};vm.createContext(ctx);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),ctx);const F=ctx.DREFinancas||{};
const rec=(cells={},extra={})=>({label:'Ago/2026',origem:'erp',atualizadoEm:'2026-08-10T16:00:00Z',cells:Object.entries(cells).map(([code,value])=>({code,value,name:code})),...extra});
test('mês antigo coletado antes do fim é parcial',()=>assert.equal(F.qualidade?.(rec({'1':100}),new Date('2026-09-09')).estado,'parcial'));
test('sem registro é ausência de dados, nunca zero financeiro',()=>assert.equal(F.qualidade?.(null,new Date('2026-09-09'))?.estado,'sem-dados'));
test('entrada não identificada é separada de empréstimo',()=>{const v=F.resumo?.(rec({'1':150,'1.1':100,'1.4':30,'1.7':20,'2':80}));assert.equal(v?.emprestimos,30);assert.equal(v?.naoIdentificadas,20);assert.equal(v?.variacao,70);});
test('sem saldo inicial não se calcula saldo disponível',()=>assert.equal(F.projecao?.({saldo:null,movimentos:[],inicio:'2026-09-09'})?.disponivel,false));
test('projeção aplica vencimentos e conserva centavos',()=>{const r=F.projecao?.({saldo:1000,movimentos:[{id:'1',data:'2026-09-10',tipo:'saida',valor:1200},{id:'2',data:'2026-09-17',tipo:'entrada',valor:400}],inicio:'2026-09-09',semanas:2});assert.equal(r?.minimo,-200);assert.equal(r?.final,200);assert.equal(r?.primeiroAperto,'2026-09-10');});
test('mês parcial não é comparável a completo',()=>{assert.equal(F.comparacao?.(rec({'1':100}),rec({'1':200},{label:'Jul/2026'}),new Date('2026-09-09'))?.permitida,false);});
test('resíduo de conta pai aparece no detalhamento',()=>{const r=F.residuos?.(rec({'1':100,'1.1':90}));assert.equal(r?.find(x=>x.code==='1')?.value,10);});
test('margem acumulada usa razão dos totais',()=>assert.equal(F.margemAcumulada?.([{receita:100,resultado:50},{receita:900,resultado:90}]),.14));
test('empresas de escopos distintos não são comparadas',()=>{const q={estado:'aguardando-conferencia',ate:'2026-08-31',escopo:'compõe DRE',regra:'v2'};assert.equal(F.comparacao(rec({}, {company:'A',qualidade:q}),rec({}, {company:'B',qualidade:q})).permitida,false);});
test('transferência entre empresas não vira custo operacional',()=>{const r=F.resumo(rec({'2':100,'2.18':80}));assert.equal(r.transferencias,80);assert.equal(r.pagamentosOperacionais,20);});
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
