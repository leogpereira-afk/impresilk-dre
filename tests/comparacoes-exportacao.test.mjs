// Regressões com dados fictícios: seleção compartilhada, exportação e rastreabilidade.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const reg=(label,ate,v)=>({label,company:'Empresa fictícia',basis:'caixa',origem:'erp',qualidade:{estado:'fechado',ate,coletadoEm:ate+'T12:00:00Z',regra:'v2',escopo:'DRE',apiContratoValidado:false},cells:[{code:'1',name:'Receitas',value:v},{code:'1.1',name:'Vendas',value:v},{code:'2',name:'Despesas',value:200},{code:'2.5',name:'Despesas fixas',value:200}]});
function app(){
 const c={structuredClone,URLSearchParams,document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''}};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run('JSON.stringify('+s+')'));c.set=(k,v)=>{c.value=v;c.run(k+'=value')};
 c.set('state.records',[reg('Set/2025','2025-09-30',800),reg('Dez/2025','2025-12-31',700),reg('Jan/2026','2026-01-31',1100),reg('Ago/2026','2026-08-31',900),reg('Set/2026','2026-09-30',1000)]);
 c.run("state.periodo='Set/2026';state.comparar='Set/2025';state.D={accounts:[]};state.view='dre';state.updated='2026-10-24T12:00:00Z';dreUI.base='caixa';gestaoUI.dre='mes';download=(n,t)=>{globalThis.csv=t}");
 const valores=Object.fromEntries(c.json('DREModelo.campos').map(x=>[x.id,0]));
 const comp=(label,produtos)=>({label,company:'Empresa fictícia',fonte:'Apuração fictícia',revisao:'fixture-v1',revisadoEm:'2026-10-24T12:00:00Z',valores:{...valores,produtos,custos:8000,tributosVendas:500},estado:'preenchido'});
 c.set('state.cfg',{demonstrativosCompetencia:{meses:{Set_2026:comp('Set/2026',20000),Set_2025:comp('Set/2025',16000),Ago_2026:comp('Ago/2026',18000),Jan_2026:comp('Jan/2026',22000),Dez_2025:comp('Dez/2025',17000)}}});
 return c;
}
const pdf=c=>c.json("relatorioCFO({tipo:'mensal',base:dreUI.base,periodo:state.periodo})");
const csv=c=>{c.run('exportarDRECSV()');return c.run('csv')};
for(const base of ['caixa','competencia']){
 test(base+': tabela compacta usa o mesmo mês de outro ano e oculta colunas quando sem comparação',()=>{
  const c=app();c.run(`dreUI.base='${base}'`);
  const h=c.run('tabelaDRECompacta(dadosDRE())');
  assert.match(h,/Set\/2025/);assert.ok(h.includes(base==='caixa'?'800,00':'16.000,00'));
  c.run("state.comparar=''");const sem=c.run('tabelaDRECompacta(dadosDRE())');
  assert.doesNotMatch(sem,/Set\/2025|Δ R\$ \/ p\.p\./);
  const cabecalho=sem.slice(sem.indexOf('<thead>'),sem.indexOf('</thead>'));
  assert.equal((cabecalho.match(/<th scope="col"/g)||[]).length,base==='caixa'?3:4);
 });
 test(base+': Sem comparação fica sem comparação no cartão e nos arquivos',()=>{
  const c=app();c.run(`dreUI.base='${base}';state.comparar=''`);
  const h=c.run(base==='caixa'?'dreSimplesCaixa().resto':'dreSimplesCompetencia(dadosDRE())');
  assert.doesNotMatch(h,/dre-comparacao|contra Ago\/2026/);
  const p=pdf(c);assert.deepEqual(p.blocos[0].colunas,[base==='caixa'?'Linha':'Rubrica','Set/2026']);assert.ok(p.blocos[0].linhas.every(x=>x.length===2));
  assert.doesNotMatch(csv(c).split('\n')[0],/Ago\/2026|Set\/2025/);
  assert.equal(c.json('dreResolverComparacao()').ativo,false);
 });
 test(base+': mês de outro ano é o mesmo na tela, no PDF e no CSV',()=>{
  const c=app();c.run(`dreUI.base='${base}'`);
  const esperado=base==='caixa'?'800,00':'16.000,00',numero=base==='caixa'?800:16000;
  const h=c.run(base==='caixa'?'dreSimplesCaixa().resto':'dreSimplesCompetencia(dadosDRE())');
  assert.match(h,/Set\/2026 contra Set\/2025/);assert.ok(h.includes(esperado));
  const p=pdf(c);assert.equal(p.blocos[0].colunas[2],'Set/2025');assert.ok(p.blocos[0].linhas[0][2].includes(esperado));assert.notEqual(p.blocos[0].linhas[0][3],'Não comparável');
  const s=csv(c);assert.match(s.split('\n')[0],/Set\/2025/);assert.ok(s.includes('"'+numero.toFixed(2).replace('.',',')+'"'));
 });
 test(base+': janeiro compara dezembro anterior sem contaminar o acumulado de janeiro',()=>{
  const c=app();c.run(`dreUI.base='${base}';state.periodo='Jan/2026';state.comparar='Dez/2025'`);
  const p=pdf(c),valor=base==='caixa'?'700,00':'17.000,00',acumulado=base==='caixa'?'1.100,00':'22.000,00';
  assert.ok(p.blocos[0].linhas[0][2].includes(valor));assert.ok(p.blocos[1].linhas[0][1].includes(acumulado));
  assert.match(csv(c).split('\n')[0],/Dez\/2025/);
 });
 test(base+': mês escolhido ausente permanece ausente, sem troca automática',()=>{
  const c=app();c.run(`dreUI.base='${base}';state.comparar='Jul/2024'`);
  const p=pdf(c);assert.equal(p.blocos[0].colunas[2],'Jul/2024');assert.equal(p.blocos[0].linhas[0][2],'Não apurado');assert.equal(p.blocos[0].linhas[0][3],'Não comparável');
  assert.match(csv(c).split('\n')[0],/Jul\/2024/);assert.equal(c.json('dreResolverComparacao()').pode,false);
 });
 test(base+': escopos diferentes exibem registros, mas suspendem a diferença',()=>{
  const c=app();c.run(`dreUI.base='${base}';${base==='caixa'?"state.records.find(r=>r.label==='Set/2025').company='Outra empresa'":"state.cfg.demonstrativosCompetencia.meses.Set_2025.company='Outra empresa'"}`);
  assert.equal(c.json('dreResolverComparacao()').pode,false);assert.equal(pdf(c).blocos[0].linhas[0][3],'Não comparável');assert.match(csv(c),/"Comparabilidade";"Suspensa"/);
 });
}
test('caixa parcial mantém o corte visível e suspende deltas na comparação/exportação',()=>{
 const c=app();c.run("state.records.find(r=>r.label==='Set/2026').qualidade.ate='2026-09-15'");
 assert.equal(c.json('dreResolverComparacao()').pode,false);const p=pdf(c);assert.equal(p.blocos[0].linhas[0][3],'Não comparável');assert.match(csv(c),/2026-09-15/);assert.equal(p.metadados.periodos[0].corte,'2026-09-15');
});
test('PDF usa p.p. nos deltas de margens, incluindo sinal negativo e zero',()=>{
 const c=app();c.run("dreUI.base='competencia';state.comparar='Ago/2026'");
 const p=pdf(c),linhas=p.blocos[0].linhas.filter(x=>x[0].startsWith('Margem'));
 assert.ok(linhas.length);for(const l of linhas){assert.match(l[1],/%$/);assert.match(l[2],/%$/);assert.match(l[3],/ p\.p\.$/);assert.doesNotMatch(l[3],/%/);}
 assert.equal(c.run('pdfPontosPercentuais(-4.75)'),'−4,7 p.p.');assert.equal(c.run('pdfPontosPercentuais(0)'),'0,0 p.p.');
});
test('PDF respeita base/período solicitados sem mudar estado da tela',()=>{
 const c=app();c.run("dreUI.base='caixa'");const p=c.json("relatorioCFO({tipo:'mensal',base:'competencia',periodo:'Jan/2026'})");
 assert.match(p.titulo,/competência · Jan\/2026/);assert.ok(p.blocos[0].linhas[0][1].includes('22.000,00'));assert.equal(c.run('state.periodo'),'Set/2026');assert.equal(c.run('dreUI.base'),'caixa');
});
test('metadados registram fonte, corte, escopo, cobertura, versão e fuso explícito',()=>{
 const c=app(),m=c.json("dreMetadadosExportacao(['Set/2026'],{agora:new Date('2026-10-24T12:00:00Z')})");
 assert.equal(m.fuso,'America/Sao_Paulo');assert.match(m.emitidoEm,/24\/10\/2026,? 09:00:00.*America\/Sao_Paulo/);
 assert.equal(m.periodos[0].fonte,'erp');assert.equal(m.periodos[0].corte,'2026-09-30');assert.equal(m.periodos[0].escopo,'Empresa fictícia');assert.equal(m.periodos[0].versao,'v2');assert.match(m.periodos[0].cobertura,/não validado/);
 assert.match(m.gerais.find(x=>x[0]==='Conciliação bancária')[1],/Não verificada/);
 assert.match(csv(c),/Contexto da exportação/);assert.match(csv(c),/America\/Sao_Paulo/);
});
test('metadata ausente não vira corte, versão ou validação inventada',()=>{
 const c=app();c.run("state.records[0].qualidade={};delete state.records[0].origem;state.updated=null");
 const m=c.json("dreMetadadosExportacao(['Set/2025','Jun/2020'])");
 assert.equal(m.periodos[0].fonte,'Não informada');assert.equal(m.periodos[0].versao,'Não informada');assert.equal(m.periodos[0].corte,'Não informado');assert.match(m.periodos[0].cobertura,/não informada/);assert.equal(m.periodos[1].situacao,'Sem dados');
 assert.equal(m.gerais.find(x=>x[0]==='Leitura da nuvem')[1],'Não informada');
});
test('exportação anual conserva os 12 meses e não insere o ano comparado na matriz',()=>{
 const c=app();c.run("gestaoUI.dre='ano'");const s=csv(c).split('\n')[0];assert.match(s,/Jan\/2026/);assert.match(s,/Dez\/2026/);assert.doesNotMatch(s,/Set\/2025/);
 const p=c.json("relatorioCFO({tipo:'anual',base:'caixa'})");assert.equal(p.blocos.length,5);assert.equal(p.metadados.periodos.length,12);
});
function appComparacaoAnual(){
 const c=app();c.set('state.records',[
  reg('Jan/2025','2025-01-31',800),reg('Fev/2025','2025-02-15',850),reg('Mar/2025','2025-03-31',900),reg('Abr/2025','2025-04-30',950),
  reg('Jan/2026','2026-01-31',1100),reg('Fev/2026','2026-02-28',1200),reg('Mar/2026','2026-03-31',1300)
 ]);
 c.run("state.view='cfo';state.periodo='Mar/2026';state.anoTodo=true;state.anoComparar='2025';dfcHoje=()=>'2026-04-30'");
 return c;
}
test('PDF anual registra a origem dos dois anos somente nos meses efetivamente comparados',()=>{
 const c=appComparacaoAnual(),p=c.json("relatorioCFO({ano:true,tipo:'executivo'})");
 assert.deepEqual(c.json('comparacaoDoAno().indices'),[0,2]);
 assert.ok(p.blocos.some(b=>b.titulo==='Comparação com 2025 nos mesmos meses (Jan e Mar)'));
 assert.deepEqual(p.metadados.periodos.map(p=>p.periodo),['Jan/2026','Fev/2026','Mar/2026','Jan/2025','Mar/2025']);
 const anterior=p.metadados.periodos.find(p=>p.periodo==='Mar/2025');
 assert.equal(anterior.corte,'2025-03-31');assert.equal(anterior.fonte,'erp');assert.equal(anterior.escopo,'Empresa fictícia');assert.match(anterior.cobertura,/não validado/);
 const texto=[];
 class Doc{constructor(){this.lastAutoTable={finalY:50}}setFontSize(){}setTextColor(){}setFont(){}setFillColor(){}rect(){}addPage(){}setPage(){}getNumberOfPages(){return 1}splitTextToSize(s){return [s]}text(s){texto.push(String(s))}autoTable(o){for(const row of [...o.head,...o.body])texto.push(...row);this.lastAutoTable={finalY:50}}setProperties(){}}
 c.Doc=Doc;c.run("PDFCFO.montar(Doc,relatorioCFO({ano:true,tipo:'executivo'}))");
 assert.ok(texto.includes('Jan/2025'));assert.ok(texto.includes('Mar/2025'));assert.ok(texto.some(t=>t.includes('Corte: 2025-03-31')));
 assert.ok(!texto.includes('Fev/2025'));assert.ok(!texto.includes('Abr/2025'));
});
test('PDF anual sem comparação não acrescenta períodos de outro ano aos metadados',()=>{
 const c=appComparacaoAnual();c.run("state.anoComparar='nenhum'");const p=c.json("relatorioCFO({ano:true,tipo:'executivo'})");
 assert.deepEqual(p.metadados.periodos.map(p=>p.periodo),['Jan/2026','Fev/2026','Mar/2026']);
 assert.ok(!p.blocos.some(b=>b.titulo.startsWith('Comparação com')));
});
test('PDF anual com comparação suspensa não apresenta meses anteriores como fonte de valores',()=>{
 const c=appComparacaoAnual();c.run("state.records=state.records.map(r=>r.label.endsWith('/2025')?{...r,company:'Outro escopo fictício'}:r)");
 const p=c.json("relatorioCFO({ano:true,tipo:'executivo'})");
 assert.deepEqual(p.metadados.periodos.map(p=>p.periodo),['Jan/2026','Fev/2026','Mar/2026']);
 assert.ok(!p.blocos.some(b=>b.titulo.startsWith('Comparação com')));
});
test('PDF renderizado inclui contexto de exportação e cobertura, não apenas o objeto de relatório',()=>{
 const c=app(),texto=[];
 class Doc{constructor(){this.lastAutoTable={finalY:50}}setFontSize(){}setTextColor(){}setFont(){}setFillColor(){}rect(){}addPage(){}setPage(){}getNumberOfPages(){return 1}splitTextToSize(s){return [s]}text(s){texto.push(String(s))}autoTable(o){for(const r of [...o.head,...o.body])texto.push(...r);this.lastAutoTable={finalY:50}}setProperties(){}}
 c.Doc=Doc;c.run("PDFCFO.montar(Doc,relatorioCFO({tipo:'mensal',base:'caixa'}))");
 assert.ok(texto.includes('Contexto da exportação'));assert.ok(texto.some(t=>t.includes('Contrato da API não validado')));assert.ok(texto.some(t=>t.includes('America/Sao_Paulo')));
});
test('resolver, renderizar e exportar não alteram registros/configurações',()=>{
 const c=app(),antes=c.run('JSON.stringify([state.records,state.cfg])');c.run('dreResolverComparacao();dreSimplesCaixa();relatorioCFO({tipo:"mensal",base:"caixa"});exportarDRECSV()');assert.equal(c.run('JSON.stringify([state.records,state.cfg])'),antes);
});
