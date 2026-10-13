// Chip "Ano" (Fase 9.1): o ano inteiro nas telas que somam período, sem mudar o
// período do app (que continua sendo um mês) nem o que as outras telas usam.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
// geração de caixa do mês = 3.000 × k
const mes=(k=1)=>[cel('1','Receitas',10000*k),cel('1.1','Comunicação Visual',10000*k),cel('1.1.1','Produtos',10000*k),cel('2','Despesas',7000*k),cel('2.1','Funcionários',2000*k),cel('2.1.4','Salário',2000*k),cel('2.4','Impostos',1000*k),cel('2.4.1','DAS',600*k),cel('2.4.1.2','Impresilk',600*k),cel('2.4.3','DARF',200*k),cel('2.4.3.1','Impresilk',200*k),cel('2.4.8','ISSQN',200*k),cel('2.12','Materiais',4000*k),cel('2.12.1','Impressão',4000*k)];
const reg=(label,ate,cells)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells});
const ANO=[reg('Jan/2026','2026-01-31',mes(1)),reg('Fev/2026','2026-02-28',mes(1)),reg('Mar/2026','2026-03-31',mes(2)),reg('Abr/2026','2026-04-12',mes(0.5))];
function app({registros=ANO,op={'2026-01':{saldoInicial:10000}},periodo='Mar/2026',view='dfc'}={}){
 const c={structuredClone,document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=structuredClone(registros);c.__cfg={parametros:{operacao:op}};c.__ind=[];
 c.run(`dfcHoje=()=>'2026-04-12';__renders=0;render=()=>{__renders++};window={DREIndicadores:{ano:l=>__ind.push(['ano',l]),periodo:l=>__ind.push(['mes',l])}};state.records=__r;state.cfg=__cfg;state.view=${JSON.stringify(view)};state.periodo=${JSON.stringify(periodo)};state.permissoes={leitura:true,edicao:true,admin:true}`);
 return c;
}
const cartoes=h=>[...h.matchAll(/<(?:div|button type="button") class="metric metric-param"(?: data-dre-origem)?><span class="label">([^<]*)<\/span><strong class="([^"]*)">([^<]*)<\/strong><small>([^<]*)<\/small>/g)].map(m=>({rotulo:m[1],tom:m[2],valor:m[3].replace(/\s/g,' '),nota:m[4].replace(/\s/g,' ')}));

test('chip "Ano": vai ao último mês com dados do ano (até hoje) e liga o ano; clicar num mês volta ao mês',()=>{
 const c=app();c.run("selecionarAno('2026')");
 assert.deepEqual(c.json('[state.periodo,state.anoTodo,gestaoUI.dre,anoAtivo()]'),['Abr/2026',true,'ano',true]);
 c.run("selecionarPeriodo('Fev/2026')");assert.deepEqual(c.json('[state.periodo,state.anoTodo,gestaoUI.dre,anoAtivo()]'),['Fev/2026',false,'mes',false]);
 const p=app({periodo:'Fev/2026'});p.run("selecionarAno('2025')");assert.equal(p.run('state.periodo'),'Dez/2025','ano sem dados: dezembro, sem inventar mês');
 const f=app({registros:[...ANO,reg('Mai/2026','2026-05-31',mes(1))]});f.run("selecionarAno('2026')");assert.equal(f.run('state.periodo'),'Abr/2026','mês que ainda não chegou não vira o mês do ano');
 const i=app({view:'indicadores'});i.run("selecionarAno('2026')");assert.deepEqual(i.json('__ind'),[['ano','Abr/2026']],'os Indicadores recebem o ano');
});
test('uma fonte só: a "Matriz do ano" segue o chip; clicar num mês tira os Indicadores do ano em qualquer tela',()=>{
 const d=app({view:'dre'});d.run("selecionarAno('2026')");assert.deepEqual(d.json('[state.anoTodo,gestaoUI.dre,anoAtivo()]'),[true,'ano',true]);
 d.run("selecionarPeriodo('Mar/2026')");assert.deepEqual(d.json('[state.anoTodo,gestaoUI.dre,anoAtivo()]'),[false,'mes',false]);
 assert.deepEqual(d.json('ANO_TELAS'),['dre','dfc','indicadores','precos','detalhe']);
 const x=app({view:'dfc'});x.run("selecionarAno('2026')");x.run("selecionarPeriodo('Abr/2026')");assert.deepEqual(x.json('__ind'),[['ano','Abr/2026'],['mes','Abr/2026']],'os Indicadores saem do ano mesmo com o mês clicado na DFC');
});
test('Indicadores: o ano do app (até o último mês com dados) ou o ano civil acendem o chip; outro ano ou recorte apagam',()=>{
 const x=app();x.run("state.periodo='Abr/2026'");
 x.run("atualizarChipsPeriodo({de:'2026-01-01',ate:'2026-04-30'})");assert.equal(x.run('state.anoTodo'),true,'janeiro ao fim do último mês com dados');
 x.run("atualizarChipsPeriodo({de:'2026-01-01',ate:'2026-12-31'})");assert.equal(x.run('state.anoTodo'),true,'ano civil inteiro');
 x.run("atualizarChipsPeriodo({de:'2026-01-01',ate:'2026-03-31'})");assert.equal(x.run('state.anoTodo'),false,'trimestre não é o ano');
 x.run("atualizarChipsPeriodo({de:'2025-01-01',ate:'2025-12-31'})");assert.equal(x.run('state.anoTodo'),false,'outro ano não acende o chip deste');
});
test('fim do ano calculado: mês guardado antigo (Voltar, link) não encurta o ano; comparação preservada no mesmo ano',()=>{
 const c=app();c.run("state.anoTodo=true;state.periodo='Fev/2026'");assert.equal(c.run("fimDoAno('2026')"),'Abr/2026');
 const k=cartoes(c.run('renderDFC()'));assert.deepEqual([k[0].valor,k[3].rotulo],['R$ 13.500,00','Saldo final · Abr/2026'],'de janeiro a abril, não só até fevereiro');
 const d=app({view:'dre'});d.run("state.anoTodo=true;state.periodo='Fev/2026'");assert.equal(cartoes(d.json('dreSimplesCaixa()').cards)[0].valor,'R$ 45.000,00');
 const m=app({periodo:'Mar/2026'});m.run("state.comparar='Jan/2026';selecionarAno('2026')");assert.equal(m.run('state.comparar'),'Jan/2026','mesmo ano: a comparação fica');
 m.run("selecionarAno('2025')");assert.equal(m.run('state.comparar'),'','outro ano: a comparação sai');
});
test('rota: o Ano vai para o endereço e volta com Voltar, recarga ou link; a rota antiga da DRE também liga',()=>{
 const c=app();c.run("location={hash:'#tela=dfc&mes=Fev%2F2026&ano=1'};restaurarRota()");assert.deepEqual(c.json('[state.view,state.anoTodo,gestaoUI.dre]'),['dfc',true,'ano']);
 c.run("location={hash:'#tela=dre&mes=Fev%2F2026&visao=ano'};restaurarRota()");assert.equal(c.run('state.anoTodo'),true);
 c.run("location={hash:'#tela=dfc&mes=Fev%2F2026'};restaurarRota()");assert.deepEqual(c.json('[state.anoTodo,gestaoUI.dre]'),[false,'mes']);
 c.run("rotaLida=true;rotaAtual='';__hist=[];history={replaceState:(a,b,h)=>__hist.push(h),pushState:(a,b,h)=>__hist.push(h)};location={hash:''};state.view='dfc';state.anoTodo=true;gravarRota()");
 assert.match(c.run('__hist.at(-1)'),/ano=1/);c.run("state.view='recebiveis';gravarRota()");assert.doesNotMatch(c.run('__hist.at(-1)'),/ano=1/,'tela sem o chip não grava o ano');
});
test('DFC no ano: cartões com o acumulado de janeiro ao último mês, saldo do fim dele e mês parcial marcado',()=>{
 const c=app();c.run("selecionarAno('2026')");const h=c.run('renderDFC()'),k=cartoes(h);
 // FCO de cada mês = geração (só operação): 3.000 + 3.000 + 6.000 + 1.500 = 13.500; saldo 10.000 + 13.500
 assert.deepEqual(k.map(x=>[x.rotulo,x.valor]),[['Caixa da operação (FCO) · 2026','R$ 13.500,00'],['Investimentos (FCI) · 2026','R$ 0,00'],['Financiamentos (FCF) · 2026','R$ 0,00'],['Saldo final · Abr/2026','R$ 23.500,00']]);
 assert.match(k[0].nota,/de janeiro a Abr de 2026 · inclui Abr\/2026 \(mês em andamento\)$/);assert.equal(k[0].tom,'tom-entra','com mês em andamento, a cor segue o sinal (v133, C3): só setas e Δ ficam neutros');
 assert.match(h,/Ano 2026 inteiro, de janeiro a Abr\. As contas de cada bloco são mostradas por mês/);assert.doesNotMatch(h,/De onde vem cada bloco/);
 const m=app();m.run("selecionarPeriodo('Mar/2026')");assert.equal(cartoes(m.run('renderDFC()'))[0].rotulo,'Caixa da operação (FCO) · Mar/2026','no mês, tudo como antes');
});
test('DFC no ano com mês faltando no caminho: acumulado não somado, dito qual falta; nunca zero',()=>{
 const c=app({registros:[ANO[0],ANO[2],ANO[3]]});c.run("selecionarAno('2026')");const k=cartoes(c.run('renderDFC()'));
 const v=app({registros:[ANO[3]]});v.run("selecionarAno('2026')");assert.match(cartoes(v.run('renderDFC()'))[0].nota,/^Jan\/2026 a Mar\/2026 sem dados coletados/,'meses seguidos em faixa');
 assert.deepEqual(k.slice(0,3).map(x=>x.valor),['Não apurado','Não apurado','Não apurado']);assert.match(k[0].nota,/^Fev\/2026 sem dados coletados: sem todos os meses, o acumulado de 2026 não é somado\.$/);
 assert.doesNotMatch(c.run('renderDFC()'),/Infinity|NaN|undefined/);
});
test('o lugar do chip é criado ao lado da barra de meses (que continua com 12 botões); index.html sem marcação nova',()=>{
 assert.doesNotMatch(ler('index.html'),/anoChip/);assert.match(ler('app.js'),/chipAno\.id='anoChip'/);
 assert.match(ler('indicadores.js'),/ano\(label\)\{anoDoRotulo\(label\);\}/);
});
test('DRE no ano: cartões e cascata com o ano somado de janeiro ao último mês; mês faltando, ano não somado',()=>{
 const c=app({view:'dre'});c.run("selecionarAno('2026')");const s=c.json('dreSimplesCaixa()'),k=cartoes(s.cards);
 // vendas 10.000 + 10.000 + 20.000 + 5.000; resultado = 3.000 × (1 + 1 + 2 + 0,5)
 assert.deepEqual(k.map(x=>[x.rotulo,x.valor]),[['Vendas · 2026','R$ 45.000,00'],['Margem de contribuição','R$ 22.500,00'],['Resultado operacional (EBITDA de caixa)','R$ 13.500,00'],['Resultado de 2026','R$ 13.500,00']]);
 assert.match(k[0].nota,/de janeiro a Abr de 2026 · inclui Abr\/2026 \(parcial\)$/);assert.match(s.resto,/Da venda ao resultado · 2026/);assert.match(s.resto,/Ano 2026 inteiro, de janeiro a Abr/);assert.doesNotMatch(s.resto,/De onde vem cada linha/);
 const f=app({view:'dre',registros:[ANO[0],ANO[2],ANO[3]]});f.run("selecionarAno('2026')");const kf=cartoes(f.json('dreSimplesCaixa()').cards);
 assert.equal(kf[0].valor,'Não apurado');assert.match(kf[0].nota,/^Fev\/2026 sem dados coletados: sem todos os meses, o ano de 2026 não é somado/);
 const m=app({view:'dre'});m.run("selecionarPeriodo('Mar/2026')");assert.equal(cartoes(m.json('dreSimplesCaixa()').cards)[0].rotulo,'Vendas · Mar/2026','no mês, tudo como antes');
});

test('textos do ano: cada mês parcial com seu estado; saldo sem o mês diz isso; cascata e percentual do ano',()=>{
 const inc=[ANO[0],reg('Fev/2026','2026-02-20',mes(1)),ANO[2],ANO[3]];const c=app({registros:inc});c.run("selecionarAno('2026')");
 assert.match(cartoes(c.run('renderDFC()'))[0].nota,/inclui Fev\/2026 \(mês incompleto\) e Abr\/2026 \(mês em andamento\)$/);
 const d=app({view:'dre'});d.run("selecionarAno('2026')");const s=d.json('dreSimplesCaixa()');
 const cascata=s.resto.slice(0,s.resto.indexOf('A margem de contribuição está melhorando?'));assert.match(cascata,/\(=\) Resultado de 2026/);assert.doesNotMatch(cascata,/Resultado do mês/);assert.doesNotMatch(cascata,/Simples do mês/);
 assert.equal(d.json("dreAnoCaixa(dreMesesDoAno('Abr/2026').map(dreMesCaixa),3).margens.margemContribuicao"),50,'percentual guardado sem arredondar');
});

// ── Rechecagem da revisão da Fase 9 ─────────────────────────────────────────
test('o mês do app acompanha o fim do ano: cartões e tabela somam até o mesmo mês; competência fica de fora',()=>{
 const c=app();c.run("state.anoTodo=true;state.periodo='Fev/2026'");assert.equal(c.run('alinharAno()'),'Abr/2026');
 const h=c.run('renderDFC()');assert.match(h,/Acumulado até Abr/);assert.equal(cartoes(h)[0].valor,'R$ 13.500,00');
 const d=app({view:'dre'});d.run("dreUI.base='competencia';state.anoTodo=true;state.periodo='Fev/2026'");assert.equal(d.run('alinharAno()'),'Fev/2026','na competência o mês não é mexido');
 const r=app({view:'recebiveis'});r.run("state.anoTodo=true;state.periodo='Fev/2026'");assert.equal(r.run('alinharAno()'),'Fev/2026','tela sem o chip não é mexida');
});
test('os Indicadores ligar ou desligar o Ano grava a rota na hora',()=>{
 const c=app({view:'indicadores'});c.run("rotaLida=true;rotaAtual='';__hist=[];history={replaceState:(a,b,h)=>__hist.push(h),pushState:(a,b,h)=>__hist.push(h)};location={hash:''};state.periodo='Abr/2026';state.anoTodo=true");
 c.run("atualizarChipsPeriodo({de:'2026-01-01',ate:'2026-03-31'})");assert.equal(c.run('state.anoTodo'),false);assert.doesNotMatch(c.run('__hist.at(-1)'),/ano=1/);
 c.run("atualizarChipsPeriodo({de:'2026-01-01',ate:'2026-04-30'})");assert.match(c.run('__hist.at(-1)'),/ano=1/);
});
// v133 (N5): ligar o Ano não troca o mês das outras telas; elas voltam ao mês de onde se ligou.
test('Ano ligado em Ago: Dashboard e competência voltam ao mês escolhido; tela do Ano vai ao fim do ano',()=>{
 const c=app({view:'dre',periodo:'Fev/2026'});c.run("selecionarAno('2026')");assert.equal(c.run('state.periodo'),'Abr/2026');
 c.run("state.view='inicio'");assert.equal(c.run('alinharAno()'),'Fev/2026','o Dashboard volta ao mês de antes do Ano');
 c.run("state.view='dfc'");assert.equal(c.run('alinharAno()'),'Abr/2026','a DFC no Ano vai ao último mês com dados');
 c.run("state.view='dre';dreUI.base='competencia'");assert.equal(c.run('alinharAno()'),'Fev/2026','competência não cai no mês sem apuração');
 c.run("dreUI.base='caixa';selecionarAno('2026')");c.run("state.view='cfo'");assert.equal(c.run('alinharAno()'),'Fev/2026','ligar de novo não perde o mês guardado');
 c.run("selecionarPeriodo('Mar/2026');state.view='inicio'");assert.deepEqual(c.json('[alinharAno(),state.mesBase,state.anoTodo]'),['Mar/2026','',false],'clicar num mês esquece o mês guardado');
});
test('v133 (N5): o mês guardado ao ligar o Ano não vale em outro ano (Voltar entre anos)',()=>{
 const c=app({view:'dre',periodo:'Fev/2026'});c.run("selecionarAno('2026')");assert.equal(c.run('state.mesBase'),'Fev/2026');
 // o Voltar restaura a DRE de 2025 com o Ano; o mês guardado continua sendo de 2026
 c.run("state.periodo='Dez/2025';state.anoTodo=true;state.view='inicio'");assert.equal(c.run('alinharAno()'),'Dez/2025','o Dashboard fica no ano da rota');
 c.run("state.view='dre';dreUI.base='competencia'");assert.equal(c.run('alinharAno()'),'Dez/2025','a competência também');
 c.run("dreUI.base='caixa';state.periodo='Abr/2026';state.view='inicio'");assert.equal(c.run('alinharAno()'),'Fev/2026','no mesmo ano o mês guardado continua valendo');
});
// v133 (I2, I21, C3, C10): o Dashboard e o Caixa mostram o saldo da DFC, o termo único das
// pendências com caminho para a Conferência, a cor no mês em andamento e o acumulado colorido.
test('saldo do fim do mês igual ao da DFC; sem saldo, Não apurado com caminho para Parâmetros',()=>{
 const c=app({periodo:'Jan/2026',view:'inicio'});
 assert.equal(c.run('saldoFimDoMes(regAtual())'),`<span class="tom-entra">${c.run('money(13000)')}</span>`,'10.000 informado + 3.000 de geração, saldo positivo em azul');
 c.run("state.periodo='Abr/2026'");assert.match(c.run('saldoFimDoMes(regAtual())'),/^<span class="tom-entra">R\$\s23\.500,00<\/span> <span title="Mês em andamento: [^"]*">\*<\/span>$/,'mês em andamento com *');
 const h=c.run('renderInicio(regAtual(),F.qualidade(regAtual()))');
 assert.match(h,/<span class="label">Pendências a conferir<\/span><b><button type="button" class="text-button" data-go="conferencia"[^>]*>0<\/button>/);
 assert.match(h,/data-go="dfc">Saldo no fim do mês \(Fluxo de caixa\)<\/button><\/span><b><span class="tom-entra">R\$\s23\.500,00<\/span> /);assert.doesNotMatch(h,/Saldo bancário disponível|Pendências de classificação/);
 const k=c.run('renderCaixa(regAtual())');assert.match(k,/Saldo no fim do mês \(Fluxo de caixa\)<\/button>: <b><span class="tom-entra">R\$\s23\.500,00<\/span> /);
 assert.match(k,/Recebimentos de vendas: <b class="tom-entra">/,'mês em andamento com a cor do sentido (C3)');assert.doesNotMatch(k,/sem cor/);
 const s=app({op:{},periodo:'Mar/2026',view:'inicio'});assert.match(s.run('saldoFimDoMes(regAtual())'),/^Não apurado · <button type="button" class="text-button" data-go="parametros">informe em Parâmetros<\/button>$/);
});
test('acumulado da planilha de caixa com a cor dos meses (C10)',()=>{
 const c=app({periodo:'Abr/2026',view:'caixa'});const t=c.run('historicoTabela()').match(/<tr class="total">.*?<\/tr>/)[0];
 assert.deepEqual([...t.matchAll(/<td class="num ([^"]*)">/g)].map(m=>m[1]),['tom-entra','tom-sai','tom-entra']);
});

// v133 (C9, D22): no planejamento de 13 semanas, saída vermelha, entrada azul, saldo pelo sinal e data dd/mm/aaaa.
test('planejamento: compromissos, semanas e cartões com a cor do sentido; data no formato do app',()=>{
 const c=app({view:'caixa'});const els={planMovimentos:{innerHTML:''},planResultado:{innerHTML:''}};c.__els=els;
 c.run("document.getElementById=id=>__els[id]||null;plano={saldo:'-1000',reserva:0,inicio:'2026-09-28',cenario:1,movimentos:[{id:'a',descricao:'Folha',data:'2026-09-28',tipo:'saida',valor:500},{id:'b',descricao:'Cliente',data:'2026-09-30',tipo:'entrada',valor:800}]};mostrarPlano()");
 const m=els.planMovimentos.innerHTML,r=els.planResultado.innerHTML;
 assert.match(m,/<td>Folha<\/td><td>28\/09\/2026<\/td><td>Saída<\/td><td class="num tom-sai">/);assert.match(m,/<td>Cliente<\/td><td>30\/09\/2026<\/td><td>Entrada<\/td><td class="num tom-entra">/);
 assert.match(r,/<span class="label">Menor saldo projetado<\/span><strong class="tom-sai">/,'saldo projetado negativo em vermelho');
 const sem=[...r.matchAll(/<tr><td>1<\/td>((?:<td class="num [^"]*">[^<]*<\/td>){3})/g)][0][1];assert.deepEqual([...sem.matchAll(/class="num ([^"]*)"/g)].map(x=>x[1]),['tom-entra','tom-sai','tom-sai']);
});
