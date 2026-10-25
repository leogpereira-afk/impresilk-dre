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
 const sem=app(BOM,{simples:aliquotas}).json('auditarTudo()'),d=so(sem,'atencao').filter(x=>x.grupo==='dfc');
 assert.deepEqual(d.map(x=>[x.mes,x.texto]),[['Jan/2026','Jan/2026 a Mar/2026 sem saldo inicial no Fluxo de caixa (3 meses): nenhum saldo bancário informado antes: informe em Parâmetros o saldo do início de um mês']],'uma causa, um achado, com a faixa');assert.equal(sem.limpos,0,'os meses do trecho continuam com problema');
});
test('estrutura: mãe menor que as filhas, total menor que as contas, código repetido e valor que não é número são falhas',()=>{
 const ruim=mes(1).map(c=>c.code==='2.4'?{...c,value:900}:c.code==='1'?{...c,value:12000}:c);ruim.push(cel('2.12.1','Impressão',1),cel('2.5','Fixas','abc'));
 const r=app([reg('Jan/2026','2026-01-31',ruim)],{simples:aliquotas}).json('auditarTudo()'),f=so(r,'falha').map(x=>x.texto).join(' | ');
 assert.match(f,/conta\(s\)-mãe não fecham com as filhas: .*2\.4: R\$\s900,00 contra R\$\s1\.000,00 nas filhas/);assert.doesNotMatch(f,/1: R\$\s12\.000,00/,'total maior que as contas não é falha');
 assert.ok(so(r,'atencao').some(x=>x.grupo==='classificacao'&&/^recebimentos sem conta no Mubisys: R\$\s2\.000,00 \(16,7% das entradas\)/.test(x.texto)),'é cadastro: atenção com a %');
 const menor=app([reg('Jan/2026','2026-01-31',mes(1).map(c=>c.code==='1'?{...c,value:9000}:c))],{simples:aliquotas}).json('auditarTudo()');
 assert.ok(so(menor,'falha').some(x=>/1: R\$\s9\.000,00 contra R\$\s10\.000,00 nas filhas/.test(x.texto)),'total MENOR que as contas continua falha');
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
 assert.ok(so(r,'info').some(x=>x.mes==='Abr/2026'&&x.texto==='mês em andamento'));assert.ok(so(r,'info').some(x=>x.mes==='Vários meses'&&x.texto==='1 mês(es) de planilha, sem a trilha por pagamento: Fev/2026'));
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

test('revisão 12/10: saldo que parou no meio, trilha e API somadas, planilha ↔ ERP, período repetido e O.S. não lidas',()=>{
 const regs=[reg('Jan/2026','2026-01-31',mes(1)),reg('Fev/2026','2026-02-20',mes(1)),reg('Mar/2026','2026-03-31',mes(1),{eventos:[],qualidade:{ate:'2026-03-31',estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE',apiContratoValidado:false,trilha:'resumida'},previaERP:{diagOS:{osFaltando:['101','102']}}}),reg('Abr/2026','2026-04-12',mes(0.4))];
 const r=app(regs,{simples:aliquotas,op:{'2026-01':{saldoInicial:1000}}}).json('auditarTudo()');
 const d=so(r,'atencao').filter(x=>x.grupo==='dfc');
 assert.deepEqual(d.map(x=>x.texto),['Mar/2026 sem saldo inicial no Fluxo de caixa: o saldo vinha de Jan/2026 e parou: Fev/2026 tem dados só até 20/02'],'a causa de onde parou, uma vez');
 assert.ok(so(r,'atencao').some(x=>x.mes==='Mar/2026'&&/^2 O\.S\. citada\(s\) não lida\(s\)/.test(x.texto)));
 assert.ok(so(r,'info').some(x=>x.mes==='Vários meses'&&/^1 mês\(es\) do ERP sem a trilha por pagamento .*: Mar\/2026$/.test(x.texto)));
 assert.ok(so(r,'info').some(x=>x.mes==='Vários meses'&&/limites da API do Mubisys ainda não validados em 1 mês\(es\): Mar\/2026/.test(x.texto)));
 // Planilha ao lado de mês do ERP: origem diferente não é "regra diferente".
 const misto=app([reg('Jan/2026','2026-01-31',mes(1),{origem:'planilha',qualidade:{ate:'2026-01-31',estado:'cobertura-nao-validada'}}),reg('Fev/2026','2026-02-28',mes(1))],{simples:aliquotas}).json('auditarTudo()');
 assert.equal(misto.achados.filter(x=>x.grupo==='sequencia').length,0);
 // Período repetido: conferido uma vez, dito como falha.
 const dup=app([reg('Jan/2026','2026-01-31',mes(1),{atualizadoEm:'2026-02-01'}),{...reg('Jan/2026','2026-01-31',mes(1)),id:'Jan_2026_b',atualizadoEm:'2026-02-05'}],{simples:aliquotas}).json('auditarTudo()');
 assert.equal(dup.meses.length,1);assert.equal(so(dup,'falha').filter(x=>x.texto==='período com mais de um registro').length,1);
});
test('revisão 12/10: gráficos em contagem e vermelho; aviso de dados mudados; posições com erro não contam como lidas',()=>{
 const c=app(BOM,{simples:aliquotas});
 const barras=c.run(`gBarrasOrdenadas([{rotulo:'Estrutura',valor:3}],{cor:'saida',formato:v=>v+' achado(s)',curto:v=>String(v),coluna:'Achados'})`);
 assert.doesNotMatch(barras,/R\$/);assert.match(barras,/3 achado\(s\)/);
 const heat=c.run(`gHeatmap([{rotulo:'A',valores:[0,2,5,null]}],['Jan','Fev','Mar','Abr'],{escala:'risco',normalizar:'global',formato:v=>v+''})`);
 assert.doesNotMatch(heat,/g-cor-seq-/,'problema não é azul');assert.match(heat,/background:var\(--g-faixa-1\)/,'zero fica neutro');assert.match(heat,/g-cor-risco-1/);assert.match(heat,/g-cor-risco-4/);
 c.run(`giroUI.dados={historico:{meses:[],erro:'leitura'}};audUI.resultado=auditarTudo()`);assert.equal(c.json('audUI.resultado.posicoes'),false);
 assert.doesNotMatch(c.run('renderAuditoria()'),/Os dados mudaram/);
 c.run(`state.records.push(${JSON.stringify(reg('Abr/2026','2026-04-12',mes(0.4)))})`);assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/);
});
// C14: "Meses sem problema" é status (verde), não dinheiro; falha continua em vermelho.
test('cartões da auditoria: meses sem problema em verde de status, falhas em vermelho',()=>{
 const c=app(BOM,{simples:aliquotas,op:{'2026-01':{saldoInicial:1000}}});c.run('audUI.resultado=auditarTudo();audUI.resultado.limpos=audUI.resultado.meses.length');
 const h=c.run('renderAuditoria()');assert.match(h,/<span class="label">Meses sem problema<\/span><strong class="st-ok">3<\/strong>/);assert.doesNotMatch(h,/Meses sem problema<\/span><strong class="tom-/);
 c.run('audUI.resultado.limpos=1');assert.match(c.run('renderAuditoria()'),/<span class="label">Meses sem problema<\/span><strong class="">1<\/strong>/);
});
test('auditoria invalida parâmetros e versões confirmadas; CSV antigo não é exportado',()=>{
 const c=app(BOM,{simples:structuredClone(aliquotas),op:{'2026-01':{saldoInicial:1000}}});
 c.run("toast=()=>{};download=()=>{globalThis.__baixou=true};state.cfgVersion='v1';audUI.resultado=auditarTudo()");
 c.run('delete state.cfg.parametros.simples');
 assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/);
 assert.match(c.run('renderAuditoria()'),/data-aud-csv disabled/);
 assert.equal(c.run('audCSV()'),null);assert.notEqual(c.run('globalThis.__baixou'),true);
 assert.ok(c.json('auditarTudo().total.atencao')>c.json('audUI.resultado.total.atencao'));
 c.run("audUI.resultado=auditarTudo();state.cfgVersion='v2'");
 assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/,'atualização remota da configuração invalida a análise');
});
test('auditoria acompanha conteúdo de todo mês e histórico de posições, não só o maior timestamp',()=>{
 const c=app(BOM,{simples:aliquotas});
 c.run("state.records[0].atualizadoEm='2026-02-01';state.records[1].atualizadoEm='2026-04-01';audUI.resultado=auditarTudo();state.records[0].cells[0].value=1");
 assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/);
 c.run('audUI.resultado=auditarTudo();giroUI.dados={historico:{meses:[]}}');
 assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/);
 c.run("audUI.resultado=auditarTudo();giroUI.dados.historico.meses.push({id:'2026-01'})");
 assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/);
 c.run("audUI.resultado=auditarTudo();giroUI.dados.historico.meses[0].receber={total:100}");
 assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/,'conteúdo da mesma posição também invalida');
 c.run("audUI.resultado=auditarTudo();state.records[0].previaERP={geradoEm:'2026-02-01T12:00:00Z'}");
 assert.match(c.run('renderAuditoria()'),/Os dados mudaram depois desta auditoria/,'versão da coleta usada como fallback de qualidade também invalida');
});
test('recalcular auditoria não reutiliza apuração de contas modificadas no mesmo objeto',()=>{
 const c=app(BOM,{simples:aliquotas});
 c.run("globalThis.__apurou=0;globalThis.__ctx={hoje:'2026-10-24',saldos:new Map()};DRESimples.apurar=r=>{__apurou++;return {diferenca:r.cells[0].value===1?20:0,caixa:1,conferir:[],linhas:{}}};audMes(state.records[0],__ctx)");
 assert.equal(c.run('__apurou'),1);c.run('state.records[0].cells[0].value=1;globalThis.__achados=audMes(state.records[0],__ctx)');
 assert.equal(c.run('__apurou'),2);assert.ok(c.json('__achados').some(x=>x.grupo==='caixa'&&x.nivel==='falha'));
});
