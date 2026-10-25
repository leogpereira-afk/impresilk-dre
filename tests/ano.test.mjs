// Chip "Ano" (Fase 9.1): o ano inteiro nas telas que somam período, sem mudar o
// período do app (que continua sendo um mês) nem o que as outras telas usam.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
// geração de caixa do mês = 3.000 × k
const mes=(k=1)=>[cel('1','Receitas',10000*k),cel('1.1','Comunicação Visual',10000*k),cel('1.1.1','Produtos',10000*k),cel('2','Despesas',7000*k),cel('2.1','Funcionários',2000*k),cel('2.1.4','Salário',2000*k),cel('2.4','Impostos',1000*k),cel('2.4.1','DAS',600*k),cel('2.4.1.2','Impresilk',600*k),cel('2.4.3','DARF',200*k),cel('2.4.3.1','Impresilk',200*k),cel('2.4.8','ISSQN',200*k),cel('2.12','Materiais',4000*k),cel('2.12.1','Impressão',4000*k)];
const reg=(label,ate,cells)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells});
const ANO=[reg('Jan/2026','2026-01-31',mes(1)),reg('Fev/2026','2026-02-28',mes(1)),reg('Mar/2026','2026-03-31',mes(2)),reg('Abr/2026','2026-04-12',mes(0.5))];
function app({registros=ANO,op={'2026-01':{saldoInicial:10000}},periodo='Mar/2026',view='dfc',hoje='2026-04-12'}={}){
 const c={structuredClone,document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=structuredClone(registros);c.__cfg={parametros:{operacao:op}};c.__ind=[];
 c.run(`dfcHoje=()=>${JSON.stringify(hoje)};__renders=0;render=()=>{__renders++};window={DREIndicadores:{ano:l=>__ind.push(['ano',l]),periodo:l=>__ind.push(['mes',l])}};state.records=__r;state.cfg=__cfg;state.view=${JSON.stringify(view)};state.periodo=${JSON.stringify(periodo)};state.permissoes={leitura:true,edicao:true,admin:true}`);
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
 assert.deepEqual(d.json('ANO_TELAS'),['inicio','cfo','dre','caixa','resultado','custos','detalhe','conferencia','dfc','balanco','precos','parametros','indicadores'],'toda tela com a barra de meses tem o Ano');
 assert.deepEqual(d.json('ANO_TELAS_COMPARAM'),['inicio','cfo','dre','caixa','resultado','custos','detalhe','dfc','balanco','precos','indicadores'],'Conferência e Parâmetros não comparam com outro ano');
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
 assert.match(h,/2026 somado de janeiro a Abr[^.]*em andamento[^.]*\. As contas de cada bloco são mostradas por mês/,'v135 (I16): o texto do Ano diz o mês em andamento');assert.doesNotMatch(h,/De onde vem cada bloco/);
 const m=app();m.run("selecionarPeriodo('Mar/2026')");assert.equal(cartoes(m.run('renderDFC()'))[0].rotulo,'Caixa da operação (FCO) · Mar/2026','no mês, tudo como antes');
});
test('DFC no ano com mês faltando no caminho: acumulado não somado, dito qual falta; nunca zero',()=>{
 const c=app({registros:[ANO[0],ANO[2],ANO[3]]});c.run("selecionarAno('2026')");const k=cartoes(c.run('renderDFC()'));
 const v=app({registros:[ANO[3]]});v.run("selecionarAno('2026')");assert.match(cartoes(v.run('renderDFC()'))[0].nota,/^Jan\/2026 a Mar\/2026 sem dados coletados/,'meses seguidos em faixa');
 assert.deepEqual(k.slice(0,3).map(x=>x.valor),['Não apurado','Não apurado','Não apurado']);assert.match(k[0].nota,/^Fev\/2026 sem dados coletados: sem todos os meses, o acumulado de 2026 não é somado\.$/);
 assert.doesNotMatch(c.run('renderDFC()'),/Infinity|NaN|undefined/);
});
test('atalho de conferência mantém as pendências do ano mesmo sem acumulado financeiro disponível',()=>{
 const registros=[{...ANO[0],pendencias:[{id:'p1'}]},{...ANO[2],pendencias:[{id:'p2'}]}];
 const c=app({registros,view:'inicio'});c.run("selecionarAno('2026')");
 assert.equal(c.run("registroDoAno('2026').reg"),null,'fevereiro ausente bloqueia a soma financeira');
 assert.match(c.run('acoesDashboard(null)'),/>2 pendências a conferir</);
 c.run("selecionarPeriodo('Mar/2026')");
 assert.match(c.run("acoesDashboard(regDoMes('Mar/2026'))"),/>1 pendência a conferir</);
});
test('o lugar do chip é criado ao lado da barra de meses (que continua com 12 botões); index.html sem marcação nova',()=>{
 assert.doesNotMatch(ler('index.html'),/anoChip/);assert.match(ler('app.js'),/chipAno\.id='anoChip'/);
 assert.match(ler('indicadores.js'),/ano\(label\)\{anoDoRotulo\(label\);\}/);
});
test('DRE no ano: cartões e cascata com o ano somado de janeiro ao último mês; mês faltando, ano não somado',()=>{
 const c=app({view:'dre'});c.run("selecionarAno('2026')");const s=c.json('dreSimplesCaixa()'),k=cartoes(s.cards);
 // vendas 10.000 + 10.000 + 20.000 + 5.000; resultado = 3.000 × (1 + 1 + 2 + 0,5)
 assert.deepEqual(k.map(x=>[x.rotulo,x.valor]),[['Vendas · 2026','R$ 45.000,00'],['Margem de contribuição','R$ 22.500,00'],['Resultado operacional (EBITDA de caixa)','R$ 13.500,00'],['Resultado de 2026','R$ 13.500,00']]);
 assert.match(k[0].nota,/de janeiro a Abr de 2026 · inclui Abr\/2026 \(parcial\)$/);assert.match(s.resto,/Da venda ao resultado · 2026/);assert.match(s.resto,/2026 somado de janeiro a Abr, com Abr\/2026 em andamento/,'v135 (I16)');assert.doesNotMatch(s.resto,/De onde vem cada linha/);
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
// v133 (N5): ligar o Ano não troca o mês das telas sem o chip (Capital de giro, Glossário...) nem da competência;
// elas voltam ao mês de onde se ligou. Desde o Plano Ano, o Dashboard e a Análise CFO também têm o Ano.
test('Ano ligado em Ago: tela sem o chip e competência voltam ao mês escolhido; tela do Ano vai ao fim do ano',()=>{
 const c=app({view:'dre',periodo:'Fev/2026'});c.run("selecionarAno('2026')");assert.equal(c.run('state.periodo'),'Abr/2026');
 c.run("state.view='giro'");assert.equal(c.run('alinharAno()'),'Fev/2026','tela sem o chip volta ao mês de antes do Ano');
 c.run("state.view='inicio'");assert.equal(c.run('alinharAno()'),'Abr/2026','o Dashboard no Ano vai ao último mês com dados');
 c.run("state.view='dfc'");assert.equal(c.run('alinharAno()'),'Abr/2026','a DFC no Ano vai ao último mês com dados');
 c.run("state.view='dre';dreUI.base='competencia'");assert.equal(c.run('alinharAno()'),'Fev/2026','competência não cai no mês sem apuração');
 c.run("dreUI.base='caixa';selecionarAno('2026')");c.run("state.view='glossario'");assert.equal(c.run('alinharAno()'),'Fev/2026','ligar de novo não perde o mês guardado');
 c.run("selecionarPeriodo('Mar/2026');state.view='giro'");assert.deepEqual(c.json('[alinharAno(),state.mesBase,state.anoTodo]'),['Mar/2026','',false],'clicar num mês esquece o mês guardado');
});
test('v133 (N5): o mês guardado ao ligar o Ano não vale em outro ano (Voltar entre anos)',()=>{
 const c=app({view:'dre',periodo:'Fev/2026'});c.run("selecionarAno('2026')");assert.equal(c.run('state.mesBase'),'Fev/2026');
 // o Voltar restaura a DRE de 2025 com o Ano; o mês guardado continua sendo de 2026
 c.run("state.periodo='Dez/2025';state.anoTodo=true;state.view='giro'");assert.equal(c.run('alinharAno()'),'Dez/2025','a tela sem o chip fica no ano da rota');
 c.run("state.view='dre';dreUI.base='competencia'");assert.equal(c.run('alinharAno()'),'Dez/2025','a competência também');
 c.run("dreUI.base='caixa';state.periodo='Abr/2026';state.view='giro'");assert.equal(c.run('alinharAno()'),'Fev/2026','no mesmo ano o mês guardado continua valendo');
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
 const sem=[...r.matchAll(/<tr><td>1 · 28\/09 a 04\/10<\/td>((?:<td class="num [^"]*">[^<]*<\/td>){3})/g)][0][1];assert.deepEqual([...sem.matchAll(/class="num ([^"]*)"/g)].map(x=>x[1]),['tom-entra','tom-sai','tom-sai']);
});

// v135 (D22, I24): o planejamento vem antes da planilha, as semanas dizem as datas e o saldo da DFC
// é oferecido (botão Usar), sem preencher sozinho e sem salvar na nuvem.
test('planejamento antes da planilha, semanas com data e saldo do Fluxo de caixa pelo botão Usar',()=>{
 const c=app({view:'caixa',periodo:'Abr/2026'});
 c.run("plano={saldo:'',reserva:0,inicio:'2026-09-28',cenario:1,movimentos:[]}");
 let h=c.run('renderCaixa(regAtual())');
 const iPlano=h.indexOf('Planejar as próximas 13 semanas'),iPlanilha=h.indexOf('Planilha de caixa · evolução mensal e acumulado');
 assert.ok(iPlano>0&&iPlanilha>iPlano,'o planejamento vem antes da planilha');
 assert.match(h,/<details class="card" id="secao-caixa-plano" data-card="caixa:Planejar as próximas 13 semanas"><summary>/,'sem saldo, o planejamento começa fechado; id estável para o "Ver em" do Glossário (N24)');
 assert.match(h,/<details class="card" data-card="caixa:Planilha de caixa · evolução mensal e acumulado"><summary>/,'a planilha continua acessível, recolhida inicialmente');
 const ref=c.json('saldoReferenciaPlano()');assert.equal(ref.label,'Abr/2026');assert.equal(ref.parcial,true);
 assert.match(h,new RegExp(`<p class="hint" id="planSaldoRef">Fluxo de caixa: <b>${c.run('money(saldoReferenciaPlano().final)').replace(/[$.]/g,'\\$&')}</b> \\(Abr/2026, mês em andamento ou incompleto, não conciliado\\) <button type="button" class="text-button" id="planUsarSaldo">Usar</button></p>`));
 assert.equal(c.run('plano.saldo'),'','nada é preenchido sozinho');
 c.run("plano.saldo=5000");assert.match(c.run('renderCaixa(regAtual())'),/data-card="caixa:Planejar as próximas 13 semanas" open>/,'com saldo, abre');
 c.run("dfcSaldos=()=>new Map()");assert.doesNotMatch(c.run('renderCaixa(regAtual())'),/planSaldoRef/,'sem saldo na DFC, sem a dica');
 // Semanas com o intervalo de datas a partir do início; a marca * de semana incompleta continua.
 const els={planMovimentos:{innerHTML:''},planResultado:{innerHTML:''}};c.__els=els;
 c.run("document.getElementById=id=>__els[id]||null;plano={saldo:1000,reserva:0,inicio:'2026-09-28',cenario:1,movimentos:[],carteira:{incompletas:[13]}};mostrarPlano()");
 const r=els.planResultado.innerHTML;
 assert.match(r,/<tr><td>2 · 05\/10 a 11\/10<\/td>/);assert.match(r,/<tr><td>13 · 21\/12 a 27\/12 \*<\/td>/);
});
test('botão Usar: grava o saldo da DFC no campo e no rascunho, sem chamar a nuvem',()=>{
 const c=app({view:'caixa',periodo:'Abr/2026'});
 const el=()=>({value:'',innerHTML:'',textContent:'',onclick:null,oninput:null,addEventListener(){}});
 const els={pageContent:{innerHTML:''},planSaldo:el(),planReserva:el(),planData:el(),planCenario:el(),planCalcular:el(),planUsarSaldo:el(),planEstado:el(),planMovimentos:el(),planResultado:el()};c.__els=els;
 c.run("document.getElementById=id=>__els[id]||null;api=()=>{throw new Error('não deve chamar a nuvem')};plano={saldo:'',reserva:0,inicio:'2026-09-28',cenario:1,movimentos:[]};planoSujo=false;wireGraficos=()=>{};wireDRE=()=>{};wireGlossario=()=>{};wireCFO=()=>{};wireGestao=()=>{};wireContent()");
 assert.equal(typeof els.planUsarSaldo.onclick,'function');
 els.planUsarSaldo.onclick();
 const final=c.run('saldoReferenciaPlano().final');
 assert.equal(c.run('plano.saldo'),final);assert.equal(els.planSaldo.value,final);assert.equal(c.run('planoSujo'),true);assert.equal(els.planEstado.textContent,'Alterações não salvas');
 assert.match(els.planResultado.innerHTML,/Menor saldo projetado/,'o cenário é recalculado com o saldo');
});
// v135 (D21): no Dashboard, o mês primeiro e os Comparativos anuais no fim; a planilha mês a mês fica em Caixa.
test('Dashboard: O que mudou e Conferência antes dos Comparativos; a planilha vira link para Caixa',()=>{
 const c=app({view:'inicio',periodo:'Mar/2026'});c.run("renderComparativos=()=>'<section class=\"cmp\"><h2>Comparativos anuais</h2></section>'");
 const h=c.run('renderInicio(regAtual(),F.qualidade(regAtual()))');
 const iConf=h.indexOf('Conferência e próximos passos'),iCmp=h.indexOf('Comparativos anuais');
 assert.ok(iConf>0&&iCmp>iConf,'Conferência antes dos Comparativos');
 assert.ok(h.trimEnd().endsWith('</section></div></details>'),'Comparativos no fim');
 assert.doesNotMatch(h,/Planilha do Dashboard/);
 assert.match(h,/data-go="caixa"><b>Planejar o caixa<\/b><span>Histórico e próximas 13 semanas →<\/span><\/button>/);assert.doesNotMatch(h,/class="cfo-intro"/);
 const iMudou=h.indexOf('O que mudou</h2>');assert.ok(iMudou>0&&iMudou<iConf,'O que mudou (gestão) antes da Conferência e dos Comparativos');
});

// ── Plano Ano: o Ano em toda tela com meses e a escolha do ano de comparação ──────────────
// Três anos: 2024 e 2025 completos, 2026 de Jan a Ago fechados e Set em andamento (hoje 22/09/2026).
const fimMes=(y,i)=>new Date(Date.UTC(y,i+1,0)).toISOString().slice(0,10);
const PT=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const anoDe=(y,n=12,k=1)=>Array.from({length:n},(_,i)=>reg(`${PT[i]}/${y}`,fimMes(y,i),mes(k+i/10)));
function tres(){const rs=[...anoDe(2024,12,0.8),...anoDe(2025,12,1),...anoDe(2026,8,1.2),reg('Set/2026','2026-09-21',mes(0.6))];rs.find(r=>r.label==='Jan/2026').pendencias=[{tipo:'a'}];rs.find(r=>r.label==='Set/2026').pendencias=[{tipo:'b'},{tipo:'c'}];return rs;}
const appAno=(o={})=>app({registros:tres(),periodo:'Set/2026',view:'inicio',hoje:'2026-09-22',op:{'2026-01':{saldoInicial:10000}},...o});
const temSoma=c=>c.run("typeof F.somarMeses==='function'");
// Harness com os elementos do topo, para o seletor de ano e de comparação (periodoOptions).
function comTopo(c){const els={};c.__els=els;c.document.getElementById=id=>els[id]||(els[id]={id,innerHTML:'',textContent:'',hidden:false,open:true,style:{},dataset:{},setAttribute(){},querySelector:()=>null,focus(){els[id].focado=true;}});c.document.createElement=()=>({style:{},setAttribute(){},addEventListener(){},innerHTML:''});return els;}
const opcoes=h=>[...h.matchAll(/<option(?: value="([^"]*)")?\s*(selected)?\s*>([^<]*)<\/option>/g)].map(m=>({valor:m[1]??m[3],sel:!!m[2],texto:m[3]}));

test('contrato do Ano: rótulos, anos comparáveis e ano comparado saem dos dados',()=>{
 const c=appAno();c.run("selecionarAno('2026')");
 assert.deepEqual(c.json('[state.periodo,anoDaTela(),anoDeHoje(),telaNoAno(),rotuloAno(),rotuloAno(2025)]'),['Set/2026',2026,2026,true,'2026 · Jan a Set*','2025 · Jan a Dez']);
 for(const [xs,t] of [[[0,1,2,3,4,5,6,7,8,9,10,11],'ano inteiro'],[[0,1,2,3,4,5,6,7],'Jan a Ago'],[[3],'Abr'],[[0,1,2,4],'Jan a Mar e Mai'],[[0,1,3,5,6],'Jan a Fev, Abr e Jun a Jul'],[[],'']])assert.equal(c.run(`rotuloMesesAno(${JSON.stringify(xs)})`),t);
 assert.deepEqual(c.json('[anosComparaveis(),anoPadraoComparado(),anoComparado()]'),[[2025,2024],2025,2025]);
 for(const [v,esperado] of [['nenhum',null],['2024',2024],['1999',2025],['2026',2025],['',2025]]){c.run(`state.anoComparar=${JSON.stringify(v)}`);assert.equal(c.json('anoComparado()'),esperado,'anoComparar='+v);}
 // sem o ano anterior nos dados, o padrão é o maior ano antes; sem nenhum antes, sem comparação
 const s=app({registros:tres().filter(r=>!r.label.endsWith('/2025')),periodo:'Set/2026',view:'inicio',hoje:'2026-09-22'});s.run("selecionarAno('2026')");assert.deepEqual(s.json('[anosComparaveis(),anoComparado()]'),[[2024],2024]);
 const so=app({registros:tres().filter(r=>r.label.endsWith('/2026')),periodo:'Set/2026',view:'inicio',hoje:'2026-09-22'});so.run("selecionarAno('2026')");assert.deepEqual(so.json('[anosComparaveis(),anoComparado()]'),[[],null]);
 assert.equal(so.json('comparacaoDoAno().motivo'),'Sem outro ano com dados para comparar.','sem outro ano nos dados, não pede para escolher');
 assert.equal(c.run('TEXTO_SEM_ANO_COMPARADO'),'Sem comparação: escolha um ano em “Comparar com”, no topo.','com outros anos, pede para escolher');
 assert.equal(c.run('textoSemMesesComparaveis(2027,2026)'),'Sem meses completos, da mesma base e com plano de contas em 2027 e 2026 para comparar.');
 c.run("state.anoComparar='nenhum'");assert.deepEqual(c.json('comparacaoDoAno()'),{ano:2026,anoComp:null,indices:[],meses:'',atual:null,anterior:null,ressalva:false,motivo:c.run('TEXTO_SEM_ANO_COMPARADO')});
});
test('meses comparáveis: só os completos nos dois anos, da mesma base e com plano de contas',()=>{
 const rs=tres();rs.find(r=>r.label==='Mar/2026').qualidade.escopo='outro escopo';rs.find(r=>r.label==='Mai/2025').cells.push(cel('2.99','Sem plano de contas',2000));rs.find(r=>r.label==='Jul/2026').qualidade.ate='2026-07-20';
 const c=app({registros:rs,periodo:'Set/2026',view:'inicio',hoje:'2026-09-22'});c.run("selecionarAno('2026')");
 assert.deepEqual(c.json('mesesComparaveisAno(2026,2025)'),[0,1,3,5,7],'Mar (escopo), Mai (2.99 acima de 10%), Jul (incompleto) e Set (em andamento) ficam de fora');
 assert.equal(c.run('rotuloMesesAno(mesesComparaveisAno(2026,2025))'),'Jan a Fev, Abr, Jun e Ago');
 c.run('mesesComparaveisAno(2026,2025).push(11)');assert.deepEqual(c.json('mesesComparaveisAno(2026,2025)'),[0,1,3,5,7],'o cache não é alterado por quem recebe a lista');
 assert.deepEqual(c.json('mesesComparaveisAno(2025,2024)'),[0,1,2,3,5,6,7,8,9,10,11]);assert.deepEqual(c.json('[mesesComparaveisAno(2026,null),mesesComparaveisAno(null,2025)]'),[[],[]]);
 c.run("state.records=state.records.filter(r=>r.label!=='Jan/2025')");assert.deepEqual(c.json('mesesComparaveisAno(2026,2025)'),[1,3,5,7],'nova base, nova conta (cache por state.records)');
});
test('registro do ano: mês faltando não vira zero e diz qual falta; com a soma, o ano e os meses comparados',()=>{
 const c=app({registros:tres().filter(r=>!['Fev/2026','Mar/2026','Mai/2026'].includes(r.label)),periodo:'Set/2026',view:'inicio',hoje:'2026-09-22'});c.run("selecionarAno('2026')");
 const r=c.json('registroDoAno(2026)');assert.equal(r.disponivel,false);assert.equal(r.reg,null);assert.deepEqual(r.faltam,['Fev/2026','Mar/2026','Mai/2026']);assert.equal(r.parcial,true);
 assert.equal(r.motivo,'Fev/2026 a Mar/2026 e Mai/2026 sem dados coletados: sem todos os meses, o acumulado de 2026 não é somado.');
 if(!temSoma(c))return;// F.somarMeses vem da frente graficos (financeiro.js)
 const a=appAno();a.run("selecionarAno('2026')");const ra=a.json('registroDoAno(2026)');
 const soma=(y,n,k)=>Array.from({length:n},(_,i)=>Math.round(10000*(k+i/10)*100)).reduce((t,v)=>t+v,0)/100;
 assert.equal(ra.disponivel,true);assert.equal(ra.reg.rotulo,'2026 · Jan a Set*');assert.equal(a.json("F.valorConta(registroDoAno(2026).reg,'1')"),soma(2026,8,1.2)+6000);
 const cmp=a.json('comparacaoDoAno()');assert.deepEqual([cmp.ano,cmp.anoComp,cmp.indices,cmp.meses,cmp.motivo],[2026,2025,[0,1,2,3,4,5,6,7],'Jan a Ago','']);
 assert.equal(a.json("F.valorConta(comparacaoDoAno().atual,'1')"),soma(2026,8,1.2));assert.equal(a.json("F.valorConta(comparacaoDoAno().anterior,'1')"),soma(2025,8,1));
 a.run("state.anoComparar='2024'");assert.equal(a.json("F.valorConta(comparacaoDoAno().anterior,'1')"),soma(2024,8,0.8),'o ano escolhido em Comparar com');
});
test('seletor do topo no Ano: anos com dados, padrão no ano anterior, "Sem comparação" e escolha guardada',()=>{
 const c=appAno();const els=comTopo(c);c.run("selecionarAno('2026');periodoOptions()");
 assert.deepEqual(opcoes(els.yearSelect.innerHTML).map(o=>o.texto),['2026','2025','2024']);
 assert.deepEqual(opcoes(els.compareSelect.innerHTML),[{valor:'nenhum',sel:false,texto:'Sem comparação'},{valor:'2025',sel:true,texto:'2025'},{valor:'2024',sel:false,texto:'2024'}]);
 assert.equal(els.compareSummary.textContent,'Comparar: 2025');
 c.run("__renders=0;selecionarAnoComparado('2024')");assert.deepEqual(c.json('[state.anoComparar,anoComparado(),__renders]'),['2024',2024,1]);assert.equal(els.periodCompare.open,false);assert.equal(els.compareSummary.focado,true);
 c.run('periodoOptions()');assert.equal(els.compareSummary.textContent,'Comparar: 2024');assert.equal(opcoes(els.compareSelect.innerHTML).find(o=>o.sel).valor,'2024');
 c.run("selecionarAnoComparado('2025')");assert.equal(c.run('state.anoComparar'),'','voltar ao ano anterior grava o padrão (fora do link)');
 c.run("selecionarAnoComparado('nenhum');periodoOptions()");assert.equal(c.run('state.anoComparar'),'nenhum');assert.equal(els.compareSummary.textContent,'Comparação');assert.equal(opcoes(els.compareSelect.innerHTML).find(o=>o.sel).valor,'nenhum');
 c.run("selecionarAnoComparado('xyz')");assert.equal(c.run('state.anoComparar'),'nenhum','valor estranho é ignorado');
 c.run("state.anoComparar='2025';selecionarAno('2025')");assert.deepEqual(c.json('[state.anoComparar,anoComparado()]'),['',2024],'o ano da tela não compara consigo: volta ao padrão');
 // Fora do Ano, os meses de sempre
 c.run("selecionarPeriodo('Ago/2026');state.comparar='Jul/2026';periodoOptions()");const m=opcoes(els.compareSelect.innerHTML);
 assert.equal(m[0].texto,'Sem comparação');assert.equal(m[0].valor,'');assert.ok(m.slice(1).every(o=>/^[A-Z][a-z]{2}\/\d{4}$/.test(o.texto)));assert.equal(m.find(o=>o.sel).texto,'Jul/2026');assert.equal(els.compareSummary.textContent,'Comparar: Jul/2026');
 assert.match(ler('app.js'),/\$\$\('compareSelect'\)\.onchange=e=>\{if\(telaNoAno\(\)\)return selecionarAnoComparado\(e\.target\.value\);/,'o onchange escolhe ano no Ano e mês fora dele');
});
test('Indicadores: sair do Ano pelo intervalo redesenha o topo e o "Comparar com" volta aos meses; voltar ao ano religa o ano escolhido (v136, RC-2)',()=>{
 const c=appAno({view:'indicadores'});const els=comTopo(c);c.run("selecionarAno('2026');state.anoComparar='2024';periodoOptions()");
 assert.equal(els.compareSummary.textContent,'Comparar: 2024');c.document.getElementById('periodCompare').open=true;
 assert.equal(c.run("atualizarChipsPeriodo({de:'2026-07-01',ate:'2026-09-30'})"),false,'trimestre não é o ano');
 assert.equal(c.run('state.anoTodo'),false);assert.equal(els.periodCompare.hidden,true,'nos Indicadores, fora do Ano, o Comparar fica escondido');assert.equal(els.periodCompare.open,false);
 const m=opcoes(els.compareSelect.innerHTML);assert.equal(m[0].valor,'');assert.ok(m.slice(1).every(o=>/^[A-Z][a-z]{2}\/\d{4}$/.test(o.texto)),'o seletor lista meses, nunca anos');assert.equal(els.compareSummary.textContent,'Comparação');
 assert.equal(c.run("atualizarChipsPeriodo({de:'2026-01-01',ate:'2026-09-30'})"),true,'o ano do app');
 assert.equal(c.run('state.anoTodo'),true);assert.equal(els.periodCompare.hidden,false);assert.equal(els.compareSummary.textContent,'Comparar: 2024','o ano escolhido continua guardado');
 assert.equal(opcoes(els.compareSelect.innerHTML).find(o=>o.sel).valor,'2024');assert.deepEqual(c.json('[state.comparar,state.anoComparar]'),['','2024']);
 assert.match(ler('app.js'),/if\(!e\.target\.value\|\|F\.periodo\(e\.target\.value\)\)state\.comparar=e\.target\.value;/,'fora do Ano, um ano nunca vai para state.comparar');
 // Os Indicadores leem o ano comparado na hora (o intervalo liga o Ano depois do mount).
 assert.match(ler('app.js'),/get anoComparado\(\)\{return state\.anoTodo\?anoComparado\(\):null;\},get mesesComparaveis\(\)\{/);
});
test('anos futuros: na virada (15/01/2027) o 2027 entra sozinho, com Jan/2027* e comparação com 2026 e 2025',()=>{
 const rs=[...anoDe(2025,12,1),...anoDe(2026,12,1.2),reg('Jan/2027','2027-01-14',mes(0.5))];
 const c=app({registros:rs,periodo:'Jan/2027',view:'inicio',hoje:'2027-01-15',op:{'2025-01':{saldoInicial:10000}}});
 c.run("{const D=Date;Date=class extends D{constructor(...a){super(...(a.length?a:['2027-01-15T12:00:00-03:00']));}static now(){return new D('2027-01-15T12:00:00-03:00').getTime();}}}");
 const els=comTopo(c);c.run("selecionarAno('2027');periodoOptions()");
 assert.deepEqual(opcoes(els.yearSelect.innerHTML).map(o=>o.texto),['2027','2026','2025']);
 assert.deepEqual(c.json('[state.periodo,rotuloAno(),anosComparaveis(),anoComparado()]'),['Jan/2027','2027 · Jan*',[2026,2025],2026]);
 assert.deepEqual(opcoes(els.compareSelect.innerHTML).map(o=>o.texto),['Sem comparação','2026','2025']);
 assert.equal(c.json('comparacaoDoAno().motivo'),c.run('textoSemMesesComparaveis(2027,2026)'),'Jan/2027 está em andamento');
 for(const [tela,f] of [['inicio','renderInicio'],['caixa','renderCaixa'],['resultado','renderResultado'],['conferencia','renderConferencia']]){
  c.run(`state.view=${JSON.stringify(tela)}`);const h=c.run(`${f}(regAtual(),F.qualidade(regAtual()))`);
  assert.match(h,/2027/,tela);assert.doesNotMatch(h,/NaN|undefined|Infinity/,tela);
 }
 // Todo janeiro, um mês só: sem "de Jan/2027 a Jan/2027", "0 de 1 meses" nem "de janeiro a Jan" (v136, AF-1 a AF-3).
 c.run("state.view='inicio'");assert.match(c.run('renderInicio(regAtual(),F.qualidade(regAtual()))'),/0 de 1 mês coletado até o último dia/);
 if(c.run("typeof dfcBlocosAno==='function'")){const ro=c.run('dfcBlocosAno(2027).rodape||""');assert.match(ro,/ERP em Jan\/2027[.:]/);assert.doesNotMatch(ro,/de janeiro a Jan/);}
 if(c.run("typeof paramCardsAno==='function'")){const pc=c.run("paramCardsAno('2027','Jan/2027')");assert.doesNotMatch(pc,/de Jan\/2027 a Jan\/2027/);if(/pagos /.test(pc))assert.match(pc,/pagos em Jan\/2027/);}
 c.run("state.view='inicio';selecionarAno('2026')");assert.deepEqual(c.json('[anoComparado(),mesesComparaveisAno(2026,2025).length,rotuloMesesAno(mesesComparaveisAno(2026,2025))]'),[2025,12,'ano inteiro']);
 // Nada de ano escrito nas regras do contrato nem relógio direto no seletor
 const src=ler('app.js'),corpo=n=>{const i=src.indexOf('function '+n+'(');assert.ok(i>=0,n);let d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'&&--d===0)return src.slice(i,k+1);}};
 for(const n of ['periodoOptions','anosComparaveis','anoPadraoComparado','anoComparado','mesesComparaveisAno','registroDoAno','comparacaoDoAno','rotuloAno'])assert.doesNotMatch(corpo(n),/\b(19|20)\d\d\b/,n+' sem ano escrito');
 assert.doesNotMatch(corpo('periodoOptions'),/new Date\(|mesHoje\(/);
});
test('Dashboard no Ano: ranking, cobertura, pendências e saldo do ano; ano sem dados avisa sem inventar',()=>{
 const c=appAno();c.run("selecionarAno('2026')");const h=c.run('renderInicio(regAtual(),F.qualidade(regAtual()))');
 assert.match(h,/<h2>Para onde foi o dinheiro<\/h2>[\s\S]*?2026 · Jan a Set\* · principais grupos de saídas/);
 assert.match(h,/<span class="label">Cobertura da base<\/span><b>8 de 9 meses coletados até o último dia<\/b>/);
 assert.match(h,/data-go="conferencia" aria-label="3 pendência\(s\) a conferir em 2026: abrir a Conferência">3<\/button>/);
 assert.match(h,/data-go="dfc">Saldo no fim de Set\/2026 \(Fluxo de caixa\)<\/button><\/span><b><span class="tom-entra">/);
 assert.doesNotMatch(h,/NaN|undefined|Infinity/);
 const v=appAno({periodo:'Mar/2023'});v.run("state.anoTodo=true;state.periodo='Dez/2023'");assert.match(v.run('renderInicio(regAtual(),F.qualidade(regAtual()))'),/<div class="month-empty"><div><b>2023 ainda não tem dados\.<\/b><span>O histórico abaixo continua disponível para consulta\.<\/span><\/div><button data-period="Set\/2026">Abrir Set\/2026 →<\/button><\/div>/);
 const m=appAno({periodo:'Ago/2026'});const hm=m.run('renderInicio(regAtual(),F.qualidade(regAtual()))');assert.doesNotMatch(hm,/meses coletados até o último dia|Saldo no fim de /,'no mês, como antes');assert.match(hm,/Ago\/2026 · principais grupos de saídas/);
});
test('Caixa no Ano: vendas do ano, saldo do fim, blocos e comparação; o planejamento é o mesmo do mês',()=>{
 const c=appAno({view:'caixa'});c.run("plano={saldo:'',reserva:0,inicio:'2026-09-28',cenario:1,movimentos:[]};selecionarAno('2026')");const h=c.run('renderCaixa(regAtual())');
 const vendas=c.run("money(PT_MON.slice(0,9).reduce((t,m)=>t+Math.round(dfcMes(m+'/2026').d.valores.vendas*100),0)/100)");
 assert.ok(h.includes(`Recebimentos de vendas · 2026 · Jan a Set*: <b class="tom-entra">${vendas}</b>`));
 assert.match(h,/data-go="dfc">Saldo no fim de Set\/2026 \(Fluxo de caixa\)<\/button>: <b>/);assert.match(h,/Saldo no fim do ano: /);
 if(c.run("typeof dfcBlocosAno==='function'"))assert.match(h,/Operação · 2026 · Jan a Set\*/);else assert.match(h,/não apurados em 2026/);
 if(c.run("typeof dfcComparacaoAno==='function'")&&temSoma(c)){assert.match(h,/<h2 class="card-titulo">Blocos do caixa · 2026 contra 2025<\/h2>/);assert.match(h,/<table class="tabela-controle tabela-ano"><thead><tr><th scope="col">Bloco<\/th><th scope="col" class="num">2026 · Jan a Ago<\/th><th scope="col" class="num">2025 · Jan a Ago<\/th><th scope="col" class="num">Δ<\/th>/);}
 const plano=x=>x.match(/<details class="card" id="secao-caixa-plano"[\s\S]*?<\/details>/)[0];
 const m=appAno({view:'caixa',periodo:'Ago/2026'});m.run("plano={saldo:'',reserva:0,inicio:'2026-09-28',cenario:1,movimentos:[]}");assert.equal(plano(h),plano(m.run('renderCaixa(regAtual())')),'planejamento das 13 semanas idêntico ao do mês');
 c.run("state.anoComparar='nenhum'");const n=c.run('renderCaixa(regAtual())');assert.match(n,/<h2 class="card-titulo">Blocos do caixa · 2026<\/h2><\/summary><div class="card-body"><p class="hint">Sem comparação: escolha um ano em “Comparar com”, no topo\.<\/p>/);
 assert.doesNotMatch(h+n,/NaN|undefined|Infinity/);
});
test('Composição do caixa e Conferência no Ano: ano somado, saúde mês a mês e movimentos por mês',()=>{
 const r=appAno({view:'resultado'});r.run("selecionarAno('2026')");const h=r.run('renderResultado(regAtual())');
 assert.match(h,/Demonstrativo gerencial de caixa[\s\S]*<p>2026 · Jan a Set\* · /);assert.doesNotMatch(h,/NaN|undefined|Infinity/);
 const c=appAno({view:'conferencia'});c.run("selecionarAno('2026')");const k=c.run('renderConferencia(regAtual(),F.qualidade(regAtual()))');
 assert.match(k,/<h2 class="card-titulo">Saúde da informação · 2026<\/h2>/);
 const linhas=[...k.matchAll(/<tr><th scope="row"><button type="button" class="text-button" data-period="([^"]+)"[^>]*>([^<]+)<\/button><\/th><td>([^<]*)<\/td><td>[^<]*<\/td><td>([^<]*)<\/td><td class="num">([^<]*)<\/td><\/tr>/g)].map(m=>[m[1],m[2],m[3],m[4],m[5]]);
 assert.equal(linhas.length,9);assert.deepEqual(linhas[0],['Jan/2026','Jan/2026','Aguardando conferência','Não comprovada','1']);assert.deepEqual(linhas[8],['Set/2026','Set/2026 *','Período parcial','Não comprovada','2']);
 assert.match(k,/<h2 class="card-titulo">Movimentos e conferência com o Mubisys<\/h2><\/summary><div class="card-body"><p>São por mês: escolha um mês na barra para consultar os movimentos e conferir com o Mubisys\.<\/p>/);
 assert.doesNotMatch(k,/id="auditMubi"|id="originEvents"|Movimentos na origem/);
 const m=appAno({view:'conferencia',periodo:'Ago/2026'});const km=m.run('renderConferencia(regAtual(),F.qualidade(regAtual()))');assert.match(km,/id="auditMubi"/);assert.doesNotMatch(km,/Saúde da informação · 2026/,'no mês, como antes');
});
