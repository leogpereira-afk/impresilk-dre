// Auditoria completa (Fase 10.2): todos os meses carregados, campo a campo, sem mudar
// nada; falha = número que não pode estar certo, atenção = conferir ou cadastrar.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
const mes=(k=1)=>[cel('1','Receitas',10000*k),cel('1.1','Comunicação Visual',10000*k),cel('1.1.1','Produtos',10000*k),cel('2','Despesas',7000*k),cel('2.1','Funcionários',2000*k),cel('2.1.4','Salário',2000*k),cel('2.4','Impostos',1000*k),cel('2.4.1','DAS',600*k),cel('2.4.1.2','Impresilk',600*k),cel('2.4.3','DARF',200*k),cel('2.4.3.1','Impresilk',200*k),cel('2.4.8','ISSQN',200*k),cel('2.12','Materiais',4000*k),cel('2.12.1','Impressão',4000*k)];
const reg=(label,ate,cells,extra={})=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells,eventos:[{valor:1}],...extra});
function app(registros,{simples={},op={}}={}){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout,Promise};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js','plano-contas.js','auditoria.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=structuredClone(registros);c.__cfg={parametros:{simples,operacao:op}};
 c.run(`dfcHoje=()=>'2026-04-12';render=()=>{};state.records=__r;state.cfg=__cfg;state.view='conferencia';state.periodo='Mar/2026';state.permissoes={leitura:true,edicao:true,admin:true}`);return c;
}
const BOM=[reg('Jan/2026','2026-01-31',mes(1)),reg('Fev/2026','2026-02-28',mes(1)),reg('Mar/2026','2026-03-31',mes(1))];
const aliquotas={'2026-01':{impresilk:{aliquota:6},universo:{aliquota:6}},'2026-02':{impresilk:{aliquota:6},universo:{aliquota:6}},'2026-03':{impresilk:{aliquota:6},universo:{aliquota:6}}};
const so=(r,nivel)=>r.achados.filter(x=>x.nivel===nivel);

test('meses sãos: nenhuma falha nem atenção além do saldo inicial que falta; tudo conferido',()=>{
 const r=app(BOM,{simples:aliquotas,op:{'2026-01':{saldoInicial:1000}}}).json('auditarTudo()');
 assert.deepEqual([r.meses.length,r.de,r.ate,r.total.falha,r.total.atencao],[3,'Jan/2026','Mar/2026',0,0]);assert.equal(r.limpos,3);
 const cad=app(BOM).json('auditarTudo()');assert.equal(cad.limpos,0,'sem saldo inicial em nenhum mês');
 const sem=app(BOM,{simples:aliquotas}).json('auditarTudo()');assert.equal(so(sem,'atencao').filter(x=>x.grupo==='dfc').length,3,'sem saldo inicial: dito em cada mês fechado');
});
test('estrutura: mãe menor que as filhas, total que não fecha, código repetido e valor que não é número são falhas',()=>{
 const ruim=mes(1).map(c=>c.code==='2.4'?{...c,value:900}:c.code==='1'?{...c,value:12000}:c);ruim.push(cel('2.12.1','Impressão',1),cel('2.5','Fixas','abc'));
 const r=app([reg('Jan/2026','2026-01-31',ruim)],{simples:aliquotas}).json('auditarTudo()'),f=so(r,'falha').map(x=>x.texto).join(' | ');
 assert.match(f,/conta\(s\)-mãe não fecham com as filhas: .*2\.4: R\$\s900,00 contra R\$\s1\.000,00 nas filhas/);assert.match(f,/1: R\$\s12\.000,00 contra R\$\s10\.000,00 nas filhas/);
 assert.match(f,/1 código\(s\) de conta repetido\(s\)/);assert.match(f,/1 conta\(s\) com valor que não é número/);
 const sem2=app([reg('Jan/2026','2026-01-31',mes(1).filter(c=>c.code!=='2'))],{simples:aliquotas}).json('auditarTudo()');assert.ok(so(sem2,'falha').some(x=>x.texto==='sem o total de saídas (2)'));
 const direta=app([reg('Jan/2026','2026-01-31',mes(1).map(c=>c.code==='2.12'?{...c,value:4500}:c.code==='2'?{...c,value:7500}:c))],{simples:aliquotas}).json('auditarTudo()');
 assert.ok(so(direta,'info').some(x=>/1 conta\(s\)-mãe com lançamento direto/.test(x.texto)),'mãe maior que as filhas: lançamento direto, informação');assert.equal(so(direta,'falha').length,0);
});
test('DRE × caixa, contas a conferir e pendências do robô',()=>{
 const fora=[...mes(1).map(c=>c.code==='2'?{...c,value:7300}:c),cel('2.6','Máquinas',300),cel('2.6.55','Máquina nova',300)];
 const r=app([reg('Jan/2026','2026-01-31',fora,{pendencias:[{tipo:'conta-renomeada-no-erp'},{tipo:'sem-classe'}]})],{simples:aliquotas}).json('auditarTudo()');
 assert.ok(so(r,'atencao').some(x=>x.grupo==='classificacao'&&/conta\(s\) a conferir na DRE: 2\.6\.55 Máquina nova \(/.test(x.texto)));
 assert.ok(so(r,'atencao').some(x=>/2 pendência\(s\) do robô \(conta-renomeada-no-erp; sem-classe\)/.test(x.texto)));
});
test('coleta: mês fechado pela metade é atenção; mês em andamento e sem trilha são informação',()=>{
 const r=app([reg('Jan/2026','2026-01-20',mes(1)),reg('Fev/2026','2026-02-28',mes(1),{eventos:[],origem:'planilha'}),reg('Abr/2026','2026-04-12',mes(0.4))],{simples:aliquotas}).json('auditarTudo()');
 assert.ok(so(r,'atencao').some(x=>x.mes==='Jan/2026'&&/coletado só até 20\/01/.test(x.texto)));
 assert.ok(so(r,'info').some(x=>x.mes==='Abr/2026'&&x.texto==='mês em andamento'));assert.ok(so(r,'info').some(x=>x.mes==='Fev/2026'&&/mês de planilha: sem a trilha/.test(x.texto)));
});
test('sequência: meses faltando em faixa, empresa trocada; cadastros somados no ano, sem repetir mês a mês',()=>{
 const r=app([reg('Out/2025','2025-10-31',mes(1)),reg('Jan/2026','2026-01-31',mes(1)),reg('Fev/2026','2026-02-28',mes(1),{company:'Impresilk'})]).json('auditarTudo()');
 assert.ok(so(r,'falha').some(x=>x.grupo==='sequencia'&&x.texto==='Nov/2025 a Dez/2025 sem registro: o ano não fecha sem esse(s) mês(es)'));
 assert.ok(so(r,'atencao').some(x=>x.mes==='Fev/2026'&&/empresa diferente de Jan\/2026/.test(x.texto)));
 const cad=so(r,'atencao').filter(x=>x.grupo==='cadastros');assert.equal(cad.length,2,'uma linha por empresa');assert.ok(cad.every(x=>x.mes==='Vários meses'),'aviso de vários meses não prende um mês');assert.match(cad[0].texto,/alíquota do PGDAS da Impresilk provisória em 3 mês\(es\): Out\/2025; Jan\/2026 a Fev\/2026/);
});
test('tela: cartões, dois gráficos, filtro, tabela e planilha sem fórmula executável',()=>{
 const c=app([...BOM,reg('Mai/2026','2026-05-31',mes(1))],{simples:aliquotas});assert.match(c.run('renderAuditoria()'),/Rodar auditoria/);
 c.run('audUI.resultado=auditarTudo()');const h=c.run('renderAuditoria()');
 assert.match(h,/Auditoria completa · 4 meses/);assert.equal((h.match(/<figure class="g-fig g-(barras|heat)/g)||[]).length,2);assert.match(h,/Abr\/2026 sem registro/);
 assert.match(h,/<span class="label">Falhas<\/span><strong class="tom-sai">1<\/strong>/);
 c.run("download=(n,t)=>{globalThis.__dl=[n,t]}");const rows=c.json('audCSV()');assert.equal(c.run('__dl[0]'),'auditoria-dre.csv');assert.equal(rows[6].join('|'),'Mês|Verificação|Nível|O que foi achado');
 c.run("audUI.resultado.achados.push({mes:'Jan/2026',grupo:'estrutura',nivel:'falha',texto:'=HYPERLINK(1)'})");c.run('audCSV()');assert.doesNotMatch(c.run('__dl[1]'),/;"=HYPERLINK/,'célula com fórmula vira texto');
 assert.match(c.run('renderConferencia(state.records[0],F.qualidade(state.records[0]))'),/Auditoria completa/);
});
