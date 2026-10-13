// Balanço gerencial (Fase 8): caixa da DFC, contas a receber e a pagar da posição do
// fim do mês (carteira inteira), saldos de Parâmetros; nada estimado sem marca e nada
// contado duas vezes (DAS e salários já são contas a pagar; empréstimo informado
// substitui as parcelas do Mubisys).
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
import {resumirHistorico} from '../supabase/functions/dre-sync/giro.mjs';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
// geração de caixa do mês = 3.000 × k (receitas 10.000 × k − despesas 7.000 × k); Simples pago (DAS + DARF) = 800 × k
const mes=(k=1,extra=[])=>[cel('1','Receitas',10000*k),cel('1.1','Comunicação Visual',10000*k),cel('1.1.1','Produtos',10000*k),
 cel('2','Despesas',7000*k+extra.reduce((t,x)=>t+x.value,0)),cel('2.1','Funcionários',2000*k),cel('2.1.4','Salário',2000*k),cel('2.4','Impostos',1000*k+extra.filter(x=>x.code.startsWith('2.4.')).reduce((t,x)=>t+x.value,0)),cel('2.4.1','DAS',600*k+extra.filter(x=>x.code.startsWith('2.4.1.')).reduce((t,x)=>t+x.value,0)),cel('2.4.1.2','Impresilk',600*k),cel('2.4.3','DARF',200*k),cel('2.4.3.1','Impresilk',200*k),cel('2.4.8','ISSQN',200*k),cel('2.12','Materiais',4000*k),cel('2.12.1','Impressão',4000*k),...extra];
const reg=(label,ate,cells)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells});
const REG=[reg('Ago/2026','2026-08-31',mes(1)),reg('Set/2026','2026-09-30',mes(1.5)),reg('Out/2026','2026-10-08',mes(0.2))];
const MES_PT=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const pos=(id,extra={})=>({id,mes:MES_PT[+id.slice(5)-1]+'/'+id.slice(0,4),fim:new Date(Date.UTC(+id.slice(0,4),+id.slice(5),0)).toISOString().slice(0,10),regra:'posicao-v1',modo:'reconstruido',corte:'2025-01-01',geradoEm:'2026-10-11T10:00:00Z',
 receber:{total:5000,quantidade:3,alemHorizonte:{quantidade:1,valor:1000},antigas:{quantidade:2,valor:900},semVencimento:{quantidade:0,valor:0},foraDRE:{quantidade:1,valor:300}},
 pagar:{total:4100,quantidade:5,alemHorizonte:{quantidade:2,valor:6200},antigas:{quantidade:1,valor:50},semVencimento:{quantidade:1,valor:70},porCentro:[{rotulo:'1.01 Impressão',valor:1000,quantidade:1},{rotulo:'2.02 Administrativo e RH',valor:800,quantidade:1},{rotulo:'3.02 Impostos e taxas',valor:300,quantidade:1},{rotulo:'3.04 Empréstimos',valor:1500,quantidade:1},{rotulo:'Materia Prima Serralheria',valor:500,quantidade:1}],alemPorCentro:[{rotulo:'1.01 Impressão',valor:200,quantidade:1},{rotulo:'3.04 Empréstimos',valor:6000,quantidade:1}]},
 cobertura:{titulos:10,semValor:0,semEmissao:0,pagamentoInvalido:0},...extra});
const HIST=()=>resumirHistorico([pos('2026-08'),pos('2026-09')]).meses;
const OP={'2026-08':{saldoInicial:20000},'2026-09':{estoque:7000}};
const BAL={'2026-08':{imobilizado:100000,revisadoEm:'2026-10-01T10:00:00Z'},'2026-09':{emprestimos:30000,parcelamentoDAS:4000,revisadoEm:'2026-10-02T10:00:00Z'}};
function tela({periodo='Set/2026',registros=REG,op=OP,balanco=BAL,hist=HIST(),dados,admin=true,api=null}={}){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout,Promise};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));
 const d=dados!==undefined?dados:{ok:true,fonte:'capitalGiro',disponivel:true,historico:{meses:hist,invalidos:0,corteAtual:'2025-01-01'}};
 c.__r=structuredClone(registros);c.__cfg={parametros:{operacao:op,balanco}};c.__d=d;c.__chamadas=0;c.__renders=0;c.__api=api||(async()=>{c.__chamadas++;return d;});
 c.run(`dfcHoje=()=>'2026-10-10';api=(...a)=>__api(...a);render=()=>{__renders++};state.records=__r;state.cfg=__cfg;state.view='balanco';state.periodo=${JSON.stringify(periodo)};state.permissoes={leitura:true,edicao:${admin},admin:${admin}}`);
 if(d)c.run('giroUI.dados=__d;giroUI.em=Date.now()');return c;
}
const cartoes=h=>[...h.matchAll(/<div class="metric metric-param"><span class="label">([^<]*)<\/span><strong class="([^"]*)">([^<]*)<\/strong><small>([^<]*)<\/small>/g)].map(m=>({rotulo:m[1],tom:m[2],valor:m[3].replace(/\s/g,' '),nota:m[4].replace(/\s/g,' ')}));
const linha=(h,nome)=>{const t=h.slice(h.indexOf('bal-tabela" style='));const m=new RegExp(`<tr class="dre-l-detalhe"><th scope="row">${nome.replace(/[()*]/g,'\\$&')}( ≈)?( †)?</th><td class="num( tom-entra| tom-sai)?">((?:(?!</td>).)*)</td><td>([^<]*)((?: <button [^>]*>[^<]*</button>)?)</td></tr>`).exec(t);return m?{valor:m[4].replace(/<[^>]*>/g,'').replace(/\s/g,' '),origem:m[5],marca:!!m[1],herdado:!!m[2],tom:(m[3]||'').trim(),ir:m[6]}:null;};

test('servidor: cada classe do a pagar sem o corte de 60 dias, total do a pagar e o que fica fora, à parte',()=>{
 const m=resumirHistorico([pos('2026-09')]).meses[0];
 assert.deepEqual(m.pagar.gruposSemHorizonte,{producao:1200,apoio:800,impostos:300,predio:0,socios:0,emprestimos:7500,semClasse:500});
 assert.deepEqual(m.pagar.grupos,{producao:1000,apoio:800,impostos:300,predio:0,socios:0,emprestimos:1500,semClasse:500},'o corte de 60 dias continua igual para o capital de giro');
 assert.equal(m.pagar.totalSemHorizonte,10300);assert.equal(Object.values(m.pagar.gruposSemHorizonte).reduce((t,x)=>t+x,0),10300,'as classes somam a carteira inteira');
 assert.deepEqual([m.pagar.antigas,m.pagar.semVencimento,m.receber.semVencimento],[{quantidade:1,valor:50},{quantidade:1,valor:70},{quantidade:0,valor:0}]);
 const velho=pos('2026-09');delete velho.pagar.alemPorCentro;delete velho.pagar.alemHorizonte;delete velho.pagar.antigas;delete velho.pagar.semVencimento;
 const v=resumirHistorico([velho]).meses[0];assert.deepEqual([v.pagar.gruposSemHorizonte.emprestimos,v.pagar.totalSemHorizonte,v.pagar.antigas,v.pagar.semVencimento],[1500,4100,null,null],'sem o além do horizonte: só o que veio');
});

test('balanço do mês: caixa da DFC, carteira inteira, cadastro; patrimônio = ativo − passivo, em centavos',()=>{
 const c=tela(),b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 const v=Object.fromEntries(Object.entries(b.linhas).map(([k,x])=>[k,x.valor]));
 // caixa: 20.000 informado em Ago + 3.000 (Ago) + 4.500 (Set) · a receber 5.000 + 1.000 depois dos 60 dias
 assert.deepEqual(v,{caixa:27500,bancoNegativo:0,receber:6000,fornecedores:2000,impostos:300,socios:0,semClasse:500,estoque:7000,imobilizado:100000,emprestimos:30000,parcelamento:4000});
 assert.deepEqual([b.apurado,b.parcial,b.ativo,b.passivo,b.pl,b.endiv],[true,false,140500,36800,103700,26.2]);
 assert.deepEqual(b.anteriores,['imobilizado'],'imobilizado de agosto vale em setembro, marcado');
 const h=c.run('renderBalanco()'),k=cartoes(h);
 assert.deepEqual(k.map(x=>[x.rotulo,x.tom,x.valor]),[['Ativo total','tom-entra','R$ 140.500,00'],['Passivo total','tom-sai','R$ 36.800,00'],['Patrimônio líquido','tom-entra','R$ 103.700,00'],['Endividamento','','26,2%']],'v134: ativo azul, passivo vermelho, patrimônio pelo sinal');
 assert.equal(k[0].nota,'Caixa R$ 27.500,00, a receber R$ 6.000,00, estoque R$ 7.000,00 e imobilizado R$ 100.000,00 · último informado: imobilizado de Ago/2026');assert.doesNotMatch(k[1].nota,/último informado/,'o passivo não herda nada');
 assert.equal(k[1].nota,'Contas a pagar no Mubisys R$ 2.800,00, empréstimos R$ 30.000,00 e parcelamento do DAS R$ 4.000,00');
 assert.match(k[3].nota,/^De cada R\$ 100,00 do ativo, R\$ 26,19 são de terceiros · último informado: imobilizado de Ago\/2026$/,'em reais, com centavos, das somas');
 assert.match(h,/Vale o último saldo informado para imobilizado \(Ago\/2026\): revise em Parâmetros\./);
 assert.equal((h.match(/<figure class="g-fig g-(barras|empilhadas)/g)||[]).length,3,'ativo, passivo e patrimônio por mês');assert.match(h,/g-cor-entrada/);assert.match(h,/g-cor-saida/);
 assert.doesNotMatch(h,/Faltam saldos em Parâmetros|Infinity|NaN|undefined/);
});

test('sem contar duas vezes: o saldo devedor informado substitui as parcelas do Mubisys; sem ele, as parcelas entram marcadas',()=>{
 const com=tela().json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.emprestimos");
 assert.equal(com.valor,30000);assert.match(com.nota,/as parcelas lançadas no Mubisys \(R\$\s7\.500,00\) já estão nele e não somam de novo/);
 const sem=tela({balanco:{'2026-08':{imobilizado:100000}}}),b=sem.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.linhas.emprestimos.valor,b.linhas.emprestimos.aproximado,b.parcial],[7500,true,true]);assert.deepEqual(b.aproximados,['emprestimos']);assert.deepEqual(b.semCadastro,['parcelamento']);
 assert.match(b.linhas.emprestimos.nota,/com vencimento até 10\/10\/2028 \(2 anos depois da remontagem\), com os juros a vencer: informe o saldo devedor em Parâmetros/);
 const h=sem.run('renderBalanco()');assert.equal(linha(h,'Empréstimos e financiamentos').marca,true,'aproximado leva ≈');
 assert.match(cartoes(h)[2].nota,/ · parcial: sem parcelamento do DAS; empréstimos aproximado · último informado: imobilizado de Ago\/2026$/);
 // sem parcelas no Mubisys e sem cadastro: não informado (nunca zero)
 const zero=pos('2026-09');zero.pagar.porCentro=zero.pagar.porCentro.filter(x=>!/Empr/.test(x.rotulo));zero.pagar.alemPorCentro=zero.pagar.alemPorCentro.filter(x=>!/Empr/.test(x.rotulo));
 const z=tela({balanco:{},hist:resumirHistorico([zero]).meses}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([z.linhas.emprestimos.valor,z.linhas.imobilizado.valor,z.semCadastro],[null,null,['imobilizado','emprestimos','parcelamento']]);
 assert.equal(z.passivo,2800,'só o que é conhecido, com a marca de parcial');
});

test('o imposto do mês vem dos títulos do Mubisys; se o DAS pago no mês seguinte for maior, avisa e não soma nada',()=>{
 const c=tela({registros:[...REG.slice(0,2),reg('Out/2026','2026-10-31',mes(1))]});
 // impostos a pagar no fim de setembro: 300; Simples da competência setembro pago em outubro: 800
 const b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");assert.equal(b.linhas.impostos.valor,300);
 assert.match(b.avisos[0],/Os impostos a pagar no fim de Set\/2026 \(R\$\s300,00\) são menores que o Simples da competência Set\/2026 pago em Out\/2026 \(R\$\s800,00\)/);
 assert.match(c.run('renderBalanco()'),/<div class="param-avisos bal-avisos"><ul><li>Os impostos a pagar/);
 const pouco=resumirHistorico([pos('2026-09',{pagar:{...pos('2026-09').pagar,porCentro:[{rotulo:'3.02 Impostos e taxas',valor:100,quantidade:1}]}})]).meses;
 const andando=tela({hist:pouco}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");assert.match(andando.avisos[0],/pago em Out\/2026 até agora \(R\$\s160,00\)/,'mês seguinte em andamento: dito');
 assert.deepEqual(tela().json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).avisos.filter(a=>!/fora da DRE/.test(a))"),[],'300 a pagar cobre os 160 pagos até agora');
 const ok=tela({hist:resumirHistorico([pos('2026-09',{pagar:{...pos('2026-09').pagar,porCentro:[{rotulo:'3.02 Impostos e taxas',valor:900,quantidade:2}]}})]).meses,registros:[...REG.slice(0,2),reg('Out/2026','2026-10-31',mes(1))]});
 assert.deepEqual(ok.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).avisos.filter(a=>!/fora da DRE/.test(a))"),[]);
 assert.doesNotMatch(ok.run("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.fornecedores.nota"),/DAS/,'nenhuma linha de "Simples a recolher" estimada');
});

test('sem caixa ou sem a posição do mês: nada é somado e a tela diz por quê; nunca zero',()=>{
 const semSaldo=tela({op:{'2026-09':{estoque:7000}}}),b=semSaldo.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.apurado,b.ativo,b.pl,b.faltaBase],[false,null,null,['caixa','bancoNegativo']]);
 const h=semSaldo.run('renderBalanco()'),k=cartoes(h);assert.deepEqual(k.map(x=>x.valor),['Não apurado','Não apurado','Não apurado','Não apurado']);
 assert.equal(k[0].nota,'Não somado: sem o saldo inicial no Fluxo de caixa.');assert.match(h,/<h2>Falta o caixa do fim de Set\/2026<\/h2>[\s\S]*data-go="dfc">Ver o Fluxo de caixa/);
 assert.match(h,/<tr class="dre-l-subtotal"><th scope="row">Total do ativo<\/th><td class="num"><span class="nao-apurado">Não apurado<\/span><\/td><td>Não somado: sem o saldo inicial no Fluxo de caixa\.<\/td>/);
 // mês em andamento, mês sem posição antes do histórico e depois dele
 const out=tela({periodo:'Out/2026'}).run('renderBalanco()');assert.equal(cartoes(out)[0].nota,'Não somado: Out/2026 ainda não fechou; sem a posição do fim de Out/2026.');
 assert.match(out,/<h2>O balanço é do fim do mês<\/h2><p>Out\/2026 ainda não fechou[^<]*O último fechamento é Set\/2026\.<\/p><\/div><button type="button" data-go="balanco" data-rec-mes="Set\/2026">Ver Set\/2026<\/button>/);
 const jul=tela({periodo:'Jul/2026'}).run('renderBalanco()');assert.match(jul,/<h2>Sem a posição de Jul\/2026<\/h2><p>O histórico de posições vai de Ago\/2026 a Set\/2026\. Jul\/2026 também não tem dados coletados/);
 assert.equal(cartoes(jul)[0].nota,'Não somado: sem a posição do fim de Jul/2026.','o caixa do fim de julho existe: é o saldo informado do início de agosto');
 const parcialColeta=tela({registros:[REG[0],reg('Set/2026','2026-09-20',mes(1.5)),REG[2]]}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.caixa");
 assert.deepEqual([parcialColeta.valor,parcialColeta.motivo],[null,'Set/2026 coletado só até 20/09'],'saldo de mês incompleto não é o do fim do mês');
});

test('estados da leitura: carregando, servidor sem o histórico, histórico vazio, erro de leitura',()=>{
 const lendo=tela({dados:null});lendo.run('giroUI.busy=true');assert.match(lendo.run('renderBalanco()'),/Lendo o histórico de posições…/);
 const velho=tela({dados:{ok:true,fonte:'capitalGiro',disponivel:true}}).run('renderBalanco()');assert.match(velho,/<h2>O servidor ainda não tem o histórico de posições<\/h2>/);
 const vazio=tela({hist:[]});assert.match(vazio.run('renderBalanco()'),/<h2>O histórico ainda não foi remontado<\/h2>/);
 const naoAdmin=tela({hist:[],admin:false});assert.match(naoAdmin.run('renderBalanco()'),/Peça a um administrador para rodar a remontagem/);
 const erro=tela({dados:{ok:true,fonte:'capitalGiro',disponivel:true,historico:{meses:[],erro:'leitura'}}}).run('renderBalanco()');assert.match(erro,/<h2>Histórico indisponível agora<\/h2>/);
 const falha=tela({dados:null});falha.run("giroUI.erro='O servidor demorou a responder.';giroUI.em=Date.now()");const hf=falha.run('renderBalanco()');assert.match(hf,/O servidor demorou a responder\. Nenhum zero foi assumido\./);assert.doesNotMatch(hf,/R\$/);
});

test('cadastro: vale o do mês ou o último antes dele (marcado), nunca um de depois; texto antigo numérico é lido',()=>{
 const c=tela({balanco:{'2026-07':{imobilizado:'90000'},'2026-10':{imobilizado:120000,emprestimos:1,parcelamentoDAS:1}}});
 const b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.linhas.imobilizado.valor,b.linhas.imobilizado.cadastro.mes,b.linhas.imobilizado.cadastro.proprio],[90000,'Jul/2026',false]);
 assert.deepEqual([b.linhas.parcelamento.valor,b.linhas.emprestimos.aproximado],[null,true],'outubro não vale para setembro');
 const h=c.run('renderBalanco()');assert.match(linha(h,'Imobilizado').origem,/^Parâmetros · último informado: Jul\/2026: máquinas/);
 const zero=tela({balanco:{'2026-09':{imobilizado:0,emprestimos:0,parcelamentoDAS:0}}}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([zero.linhas.emprestimos.valor,zero.linhas.parcelamento.valor,zero.semCadastro,zero.parcial],[0,0,[],false],'zero informado é zero; o Mubisys não soma por cima');
});

test('fora do balanço: vencidos antes do corte e sem vencimento aparecem à parte e não somam',()=>{
 const h=tela().run('renderBalanco()');
 assert.match(h,/<th scope="rowgroup" colspan="3">Fora do balanço · não somam<\/th><\/tr><tr class="dre-l-detalhe"><th scope="row">A receber vencido antes de 01\/01\/2025<\/th><td class="num">R\$\s900,00<\/td><td>2 título\(s\), fora da carteira/);
 assert.match(h,/A pagar vencido antes de 01\/01\/2025<\/th><td class="num">R\$\s50,00/);assert.match(h,/A pagar sem vencimento<\/th><td class="num">R\$\s70,00/);assert.doesNotMatch(h,/A receber sem vencimento/,'zero não aparece');
 assert.equal(cartoes(h)[0].valor,'R$ 140.500,00','900 antigos fora do ativo');
});

test('servidor anterior (só 60 dias): usa o que veio, marcado como aproximado',()=>{
 const m=resumirHistorico([pos('2026-09')]).meses[0];delete m.pagar.gruposSemHorizonte;delete m.receber.totalSemHorizonte;
 const c=tela({hist:[m]}),b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.linhas.receber.valor,b.linhas.fornecedores.valor,b.linhas.fornecedores.aproximado],[5000,1800,true]);
 assert.deepEqual(b.aproximados,['receber','fornecedores','impostos','socios','semClasse']);
 assert.match(b.linhas.fornecedores.nota,/só os que vencem até 60 dias do fechamento$/);
 const s=tela({hist:[m],balanco:{}}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.emprestimos.nota");assert.match(s,/que vencem até 60 dias do fechamento/);
});

test('caixa negativo, ativo zero e patrimônio negativo: sinais certos, sem divisão impossível',()=>{
 const c=tela({op:{'2026-08':{saldoInicial:-60000},'2026-09':{estoque:0}},balanco:{'2026-09':{imobilizado:0,emprestimos:0,parcelamentoDAS:0}}});
 const b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 // banco no vermelho é dívida: caixa zero no ativo e 52.500 no passivo
 assert.deepEqual([b.linhas.caixa.valor,b.linhas.bancoNegativo.valor,b.ativo,b.passivo,b.pl,b.endiv],[0,52500,6000,55300,-49300,921.7]);assert.match(b.linhas.caixa.nota,/negativo: está no passivo, em "Banco no vermelho"/);
 const h=c.run('renderBalanco()'),k=cartoes(h);assert.deepEqual([k[2].tom,k[3].valor],['tom-sai','921,7%']);assert.match(k[3].nota,/^As dívidas passam do que a empresa tem: são 9,2 vezes o ativo e o patrimônio está negativo/);
 assert.match(k[1].nota,/mais R\$\s52\.500,00 de banco no vermelho/);assert.match(linha(h,'Banco no vermelho').valor,/R\$\s52\.500,00/);
 const g=h.slice(h.indexOf('Tem · ativo'),h.indexOf('Deve · passivo'));assert.doesNotMatch(g,/[-−]R\$/,'nenhuma barra negativa no ativo');
 const z=tela({op:{'2026-08':{saldoInicial:-30000}},balanco:{'2026-09':{imobilizado:0,emprestimos:0,parcelamentoDAS:0}},hist:resumirHistorico([pos('2026-09',{receber:{...pos('2026-09').receber,total:0,alemHorizonte:{quantidade:0,valor:0}}})]).meses}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([z.ativo,z.endiv],[0,null],'ativo zero: sem divisão');
 const n=cartoes(tela().run('renderBalanco()'))[3];assert.match(n.nota,/^De cada R\$\s100,00 do ativo, R\$\s26,19 são de terceiros/,'até 100%: em reais, com centavos');
});

test('ano mês a mês e planilha: mesmas regras, sem fórmula executável; rota e leitura a cada minuto',async()=>{
 const c=tela();c.run("download=(n,t)=>{globalThis.__dl=[n,t]}");
 const rows=c.json('balCSV()');assert.equal(c.run('__dl[0]'),'balanco-gerencial-2026.csv');assert.equal(c.run('__dl[1].charCodeAt(0)'),0xfeff);
 assert.deepEqual(rows[0].slice(8,10),['Ago/2026 (parcial)','Set/2026 (com saldo de mês anterior)']);
 const obs=rows.at(-1);assert.equal(obs[0],'Observações');assert.equal(obs[7],'Não somado: sem a posição do fim de Jul/2026.');
 assert.equal(obs[8],'Parcial: sem estoque e parcelamento do DAS; aproximado: empréstimos');assert.equal(obs[9],'último informado: imobilizado de Ago/2026');
 assert.ok(!rows.some(r=>r[0]==='Banco no vermelho'),'sem banco no vermelho no ano: a linha não aparece');
 // agosto: ativo 23.000 + 6.000 + 100.000; passivo 2.800 + 7.500 de parcelas (aproximado) · setembro completo
 assert.deepEqual(rows.find(r=>r[0]==='Patrimônio líquido').slice(7,10),['Não apurado','118700,00','103700,00']);
 assert.equal(rows.find(r=>r[0]==='Caixa e bancos')[8],'23000,00');
 const h=c.run('renderBalanco()');// N25: a planilha sai pelo "↓ Planilha" do topo (balCSV global), não de dentro do cartão; N10: rolagem com nome acessível.
 assert.match(h,/<summary><h2 class="card-titulo">Balanço mês a mês · 2026<\/h2><\/summary><div class="card-body"><div class="table-scroll" role="region" tabindex="0" aria-label="Balanço mês a mês"><table/);assert.doesNotMatch(h,/data-bal-csv/);assert.equal(c.run('typeof balCSV'),'function');
 assert.match(h,/<div class="table-scroll" role="region" tabindex="0" aria-label="Balanço por conta"><table class="tabela-controle dre-simples-meses bal-tabela"/);assert.match(h,/<th scope="col" class="num ">Ago\/2026 \*<\/th>/);assert.match(h,/<th scope="col" class="num selected-month">Set\/2026 †<\/th>/);
 assert.match(h,/<td class="num selected-month tom-entra">R\$\s100\.000,00 †<\/td>/,'célula herdada marcada (ativo em azul)');assert.match(h,/<td class="num  tom-sai">R\$\s7\.500,00 ≈<\/td>/,'célula aproximada marcada (passivo em vermelho)');assert.match(h,/class="tabela-controle dre-simples-meses bal-meses"/);
 // C10: PL mês a mês pelo sinal, como o cartão e o balanço por conta; v134: também no mês em andamento (regra do dono)
 const pl=h.match(/<tr class="dre-l-resultado"><th scope="row">Patrimônio líquido<\/th>.*?<\/tr>/)[0];
 assert.match(pl,/<td class="num  tom-entra">R\$\s118\.700,00<\/td>/,'PL do mês em andamento também pelo sinal');assert.match(pl,/<td class="num selected-month tom-entra">R\$\s103\.700,00<\/td>/,'PL positivo em azul');
 // I14: * só para mês em andamento ou incompleto; aproximado com ≈
 assert.match(h,/\* = mês em andamento ou incompleto · ≈ = aproximado · † = saldo de um mês anterior/);assert.doesNotMatch(h,/\* = aproximado/);
 assert.match(c.run('paginasDoApp().balanco()'),/Ativo total/);
 const x=tela({dados:null});x.run('renderBalanco()');x.run('renderBalanco()');await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));assert.equal(x.__chamadas,1,'uma leitura por minuto');assert.ok(x.__renders>=1,'redesenha o balanço quando a leitura chega');
});

test('escapa o que vem do servidor e de Parâmetros',()=>{
 const m=resumirHistorico([pos('2026-09')]).meses[0];
 const c=tela({hist:[{...m,mes:'<img src=x onerror=1>',id:'2026-08'},m,{...m,id:'2026-12',mes:'<b>z</b>'}],periodo:'Out/2026'});
 const h=c.run('renderBalanco()');assert.doesNotMatch(h,/<img src=x|<b>z<\/b>/);assert.match(h,/&lt;b&gt;z&lt;\/b&gt;/);
 const s=tela({hist:[{...m,pagar:{...m.pagar,gruposSemHorizonte:{producao:'<i>1</i>',apoio:1,impostos:1,predio:1,socios:1,emprestimos:1,semClasse:1}}}]}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.equal(s.linhas.fornecedores.valor,null,'texto no lugar de número: não apurado');
});

test('Parâmetros: saldos do balanço com validação, caminho próprio, "Trazer de" e histórico legível',()=>{
 const c=tela();const h=c.run('renderParametros()');
 assert.match(h,/<h2 id="param-balanco-titulo">Saldos do balanço · Set\/2026<\/h2>/);assert.match(h,/Não repita aqui o que já é conta a pagar no Mubisys/);
 assert.match(h,/name="emprestimos" type="text" inputmode="decimal" autocomplete="off" value="30\.000,00"/);assert.match(h,/data-param-copiar="balanco">Trazer de Ago\/2026/);
 assert.deepEqual(c.json("paramValidarBalanco({imobilizado:'1.200.000,00',emprestimos:'',parcelamentoDAS:'0'})"),{imobilizado:1200000,emprestimos:null,parcelamentoDAS:0});
 assert.equal(c.json("paramValidarBalanco({imobilizado:'',emprestimos:'',parcelamentoDAS:''})"),null);
 assert.throws(()=>c.run("paramValidarBalanco({imobilizado:'-1'})"),/Imobilizado: valor fora do intervalo/);assert.throws(()=>c.run("paramValidarBalanco({emprestimos:'abc'})"),/número não reconhecido/);
 assert.equal(c.run("paramDescreveCaminho(['balanco','2026-09'])"),'Saldos do balanço · Set/2026');
 assert.deepEqual(c.json("paramMudancas({caminho:['balanco','2026-09'],anterior:{emprestimos:30000},novo:{emprestimos:25000}})").map(x=>x.replace(/\s/g,' ')),['Empréstimos e financiamentos: R$ 30.000,00 → R$ 25.000,00']);
 const n=tela({admin:false}).run('renderParametros()');assert.match(n,/name="imobilizado" type="text" inputmode="decimal" autocomplete="off" value="" disabled/);assert.doesNotMatch(n,/Salvar saldos do balanço/);
});

test('Parâmetros: gravar envia só o caminho do balanço do mês; "Trazer de" preenche sem gravar',async()=>{
 const c=tela();const enviados=[];c.__enviados=enviados;
 c.run(`api=async(acao,p)=>{if(acao==='getCfg')return {ok:true,cfg:structuredClone(state.cfg),atualizadoEm:'t0'};__enviados.push(p);return {ok:true,atualizadoEm:'t1'};};toast=()=>{};`);
 const campos={imobilizado:'110.000,00',emprestimos:'28.000,00',parcelamentoDAS:''};
 const form={dataset:{paramForm:'balanco',mes:'Set/2026',original:JSON.stringify(c.json("state.cfg.parametros.balanco['2026-09']"))},querySelector:()=>null,querySelectorAll:()=>[],isConnected:true,elements:[]};
 c.__form=form;c.__campos=campos;c.run('paramFormDados=()=>__campos');await c.run('paramSalvarForm(__form)');
 assert.equal(enviados.length,1);const p=JSON.parse(JSON.stringify(enviados[0].cfg.parametros));
 assert.deepEqual({...p.balanco['2026-09'],revisadoEm:'x'},{imobilizado:110000,emprestimos:28000,parcelamentoDAS:null,revisadoEm:'x'});assert.deepEqual(p.balanco['2026-08'],BAL['2026-08'],'outro mês intacto');
 assert.deepEqual(p.historico.at(-1).caminho,['balanco','2026-09']);assert.deepEqual(p.operacao,OP,'prazos, estoque e metas intactos');
});

test('patrimônio por mês: barras dos meses completos; parcial (*) e sem dados hachurados; † para saldo herdado',()=>{
 const c=tela(),serie=c.json("balAno('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).map(b=>[b.label,b.pl,b.semCadastro,b.parcial])");
 assert.deepEqual(serie.slice(7,9),[['Ago/2026',118700,['estoque','parcelamento'],true],['Set/2026',103700,[],false]]);
 const h=c.run('renderBalanco()'),fig=h.slice(h.indexOf('O patrimônio cresce?'),h.indexOf('Balanço por conta'));
 assert.match(fig,/Hachurado: mês sem caixa ou sem a posição, ou parcial \(\*\); o valor parcial está na tabela/);assert.match(fig,/<figure class="g-fig g-empilhadas/);
 assert.match(fig,/>Ago\*</);assert.match(fig,/>Set†</);assert.match(fig,/Patrimônio líquido: R\$\s103\.700,00/);assert.doesNotMatch(fig,/Patrimônio líquido: R\$\s118\.700,00/,'agosto parcial fica hachurado');
});
test('estoque também vale o último informado, marcado; mês que ainda não chegou não herda cadastro',()=>{
 const c=tela({op:{'2026-08':{saldoInicial:20000,estoque:6500}}});
 const b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.linhas.estoque.valor,b.linhas.estoque.cadastro.mes,b.anteriores],[6500,'Ago/2026',['estoque','imobilizado']]);
 assert.match(c.run('renderBalanco()'),/Vale o último saldo informado para estoque \(Ago\/2026\) e imobilizado \(Ago\/2026\): revise em Parâmetros\./);
 const nov=c.json("balApurar('Nov/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas");
 assert.deepEqual([nov.estoque.valor,nov.imobilizado.valor,nov.emprestimos.valor,nov.parcelamento.valor],[null,null,null,null],'novembro ainda não chegou (hoje é 10/10/2026)');
 assert.equal(c.json("balApurar('Out/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.imobilizado.valor"),100000,'o mês de hoje herda');
});
test('só aproximado também é parcial; número do servidor em texto não é aceito',()=>{
 const c=tela({balanco:{'2026-08':{imobilizado:100000},'2026-09':{parcelamentoDAS:4000}}}),b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.semCadastro,b.aproximados,b.parcial],[[],['emprestimos'],true]);
 const k=cartoes(c.run('renderBalanco()'));assert.match(k[2].nota,/ · parcial: empréstimos aproximado · último informado: imobilizado de Ago\/2026$/);
 const m=resumirHistorico([pos('2026-09')]).meses[0];m.pagar.gruposSemHorizonte={...m.pagar.gruposSemHorizonte,impostos:'300'};m.receber.totalSemHorizonte='6000';
 const t=tela({hist:[m]}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([t.linhas.impostos.valor,t.linhas.receber.valor,t.linhas.receber.aproximado,t.apurado],[null,5000,true,false],'texto não vira número; o a receber cai no total de 60 dias, marcado');
});

// ── Casos da revisão da Fase 8 ─────────────────────────────────────────────
test('caixa: o saldo bancário do início do mês seguinte, quando informado, é o caixa do fim do mês (mesmo com coleta incompleta)',()=>{
 const c=tela({op:{...OP,'2026-10':{saldoInicial:31000}}}),b=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.linhas.caixa.valor,b.linhas.caixa.origem],[31000,'Parâmetros']);assert.match(b.linhas.caixa.nota,/saldo bancário do início de Out\/2026 informado em Parâmetros: o saldo real do banco no fim de Set\/2026/);
 assert.ok(!b.avisos.some(a=>/fora da DRE/.test(a)),'com o saldo real, o aviso de títulos fora da DRE some');
 const sem=tela().json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");assert.match(sem.avisos.find(a=>/fora da DRE/.test(a)),/pelo menos R\$\s300,00[\s\S]*Informe em Parâmetros o saldo bancário do início de Out\/2026/);
 const inc=tela({registros:[REG[0],reg('Set/2026','2026-09-20',mes(1.5)),REG[2]],op:{...OP,'2026-10':{saldoInicial:31000}}}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.caixa.valor");assert.equal(inc,31000);
 const futuro=tela({periodo:'Out/2026',op:{...OP,'2026-11':{saldoInicial:1}}}).json("balApurar('Out/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.caixa.valor");assert.equal(futuro,null,'mês que não acabou não usa saldo informado adiante');
});
test('parcelamento do DAS: com evidência de parcela lançada no Mubisys, impostos marcados e avisados; sem evidência, nada',()=>{
 const alem=pos('2026-09');alem.pagar.alemPorCentro=[...alem.pagar.alemPorCentro,{rotulo:'3.02 Impostos e taxas',valor:12000,quantidade:10}];
 const b=tela({hist:resumirHistorico([alem]).meses}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.linhas.impostos.valor,b.linhas.impostos.aproximado,b.parcial],[12300,true,true]);assert.match(b.avisos.join(' '),/podem incluir parcelas do parcelamento do DAS já lançadas no Mubisys[\s\S]*R\$\s4\.000,00/);
 const paga=tela({registros:[...REG.slice(0,2),reg('Out/2026','2026-10-08',mes(0.2,[cel('2.4.1.1','Parcelamento',500)]))]}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.impostos.aproximado");assert.equal(paga,true,'parcela paga no mês seguinte também é evidência');
 assert.equal(tela().json("!!balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.impostos.aproximado"),false,'sem evidência, sem marca');
 assert.equal(tela({balanco:{'2026-09':{parcelamentoDAS:0}},hist:resumirHistorico([alem]).meses}).json("!!balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).linhas.impostos.aproximado"),false,'sem saldo de parcelamento, nada a duplicar');
});
test('ilegíveis e entradas a identificar: marcados e avisados; marca de parcial só no lado que falta',()=>{
 const il=tela({hist:resumirHistorico([pos('2026-09',{cobertura:{titulos:10,semValor:3,semEmissao:0,pagamentoInvalido:0}})]).meses}),b=il.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.ilegiveis,b.parcial],[3,true]);const h=il.run('renderBalanco()');assert.match(cartoes(h)[0].nota,/ · parcial: 3 título\(s\) ilegíveis fora/);assert.doesNotMatch(h,/>Completo</);
 const ai=tela({registros:[REG[0],reg('Set/2026','2026-09-30',mes(1.5,[cel('1.7','Entradas a identificar',5000)])),REG[2]]}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos()).avisos");
 assert.ok(ai.some(a=>/R\$\s5\.000,00 entraram em Set\/2026 como Entradas a identificar/.test(a)));
 const lado=tela({balanco:{'2026-09':{emprestimos:30000,parcelamentoDAS:4000}}}),k=cartoes(lado.run('renderBalanco()'));
 assert.match(k[0].nota,/ · parcial: sem imobilizado$/);assert.doesNotMatch(k[1].nota,/parcial/,'o passivo está completo');
 assert.match(lado.run('renderBalanco()'),/<tr class="dre-l-subtotal"><th scope="row">Total do passivo<\/th><td class="num tom-sai">R\$\s36\.800,00<\/td><td>Completo<\/td>/);
});
test('mês encerrado sem dados nem posição não é "ainda não fechou"; subtítulos h3; dica do imobilizado',()=>{
 const c=tela({registros:[REG[0],REG[2]],hist:resumirHistorico([pos('2026-08')]).meses}),h=c.run('renderBalanco()');
 assert.match(h,/<h2>Sem a posição de Set\/2026<\/h2><p>O histórico de posições vai de Ago\/2026 a Ago\/2026: a remontagem de domingo inclui os meses que fecharem até lá\. Set\/2026 também não tem dados coletados/);assert.doesNotMatch(h,/ainda não fechou/);
 const t=tela().run('renderBalanco()');assert.match(t,/<h3 style="margin:0 0 2px;font-size:13px">Tem · ativo<\/h3>/);assert.doesNotMatch(t,/<h4>/);
 assert.match(tela().run('renderParametros()'),/pelo valor no fim do mês \(de mercado, não o preço de compra\)/);
});
test('servidor: o fora da DRE do a pagar chega à tela',()=>{
 const m=resumirHistorico([pos('2026-09',{pagar:{...pos('2026-09').pagar,foraDRE:{quantidade:2,valor:700}}})]).meses[0];assert.deepEqual(m.pagar.foraDRE,{quantidade:2,valor:700});
 assert.equal(resumirHistorico([pos('2026-09')]).meses[0].pagar.foraDRE,null);
});

// ── Fase 9.4: parcelas do parcelamento do DAS separadas pelo robô ───────────
const comParcelas=(valor=2400,porCentro=[{rotulo:'3.02 Impostos e taxas',valor:2400,quantidade:2}])=>{const p=pos('2026-09');p.pagar.porCentro=[...p.pagar.porCentro.filter(x=>!/3\.02/.test(x.rotulo)),{rotulo:'3.02 Impostos e taxas',valor:1500,quantidade:3}];p.pagar.alemPorCentro=[...p.pagar.alemPorCentro,{rotulo:'3.02 Impostos e taxas',valor:1200,quantidade:1}];p.pagar.parcelamentoDAS={quantidade:2,valor,porCentro};return resumirHistorico([p]).meses;};
test('9.4: com o saldo informado, as parcelas saem dos impostos e não somam de novo; sem marca de aproximado',()=>{
 // impostos no Mubisys: 1.500 + 1.200 (além dos 60 dias) = 2.700, dos quais 2.400 são parcelas do parcelamento
 const b=tela({hist:comParcelas()}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([b.linhas.impostos.valor,b.linhas.parcelamento.valor,!!b.linhas.impostos.aproximado,b.aproximados],[300,4000,false,[]]);
 assert.match(b.linhas.impostos.nota,/sem as parcelas do parcelamento do DAS, que ficam na linha do parcelamento/);assert.match(b.linhas.parcelamento.nota,/as parcelas lançadas no Mubisys \(R\$\s2\.400,00\) já estão nele e não somam de novo/);
 assert.ok(!b.avisos.some(a=>/contada duas vezes/.test(a)),'separado pelo robô: sem o aviso de dupla contagem');
});
test('9.4: sem o saldo informado, as parcelas do Mubisys viram a linha do parcelamento, aproximada; o passivo não muda',()=>{
 const sem=tela({hist:comParcelas(),balanco:{'2026-08':{imobilizado:100000},'2026-09':{emprestimos:30000}}}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([sem.linhas.impostos.valor,sem.linhas.parcelamento.valor,sem.linhas.parcelamento.aproximado],[300,2400,true]);
 assert.match(sem.linhas.parcelamento.nota,/parcelas do parcelamento lançadas no Mubisys com vencimento até .* informe em Parâmetros o saldo do extrato da Receita/);
 const antigo=tela({hist:comParcelas(2400,[]),balanco:{'2026-08':{imobilizado:100000},'2026-09':{emprestimos:30000}}}).json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 assert.deepEqual([antigo.linhas.impostos.valor,antigo.linhas.parcelamento.valor],[2700,null],'classes que não fecham com o total: nada é movido');
});
test('9.4 servidor: parcelamento por classe na leitura; formato inválido recusado',async()=>{
 const m=comParcelas()[0];assert.deepEqual(m.pagar.parcelamentoDAS,{valor:2400,quantidade:2,porGrupo:{producao:0,apoio:0,impostos:2400,predio:0,socios:0,emprestimos:0,semClasse:0}});
 assert.equal(resumirHistorico([pos('2026-09')]).meses[0].pagar.parcelamentoDAS,null,'posição antiga: sem o campo');
 const {validarPosicao}=await import('../supabase/functions/dre-sync/giro.mjs');
 for(const ruim of [{valor:'1'},[1],{valor:1,porCentro:[{valor:1}]}]){const p=pos('2026-09');p.pagar.parcelamentoDAS=ruim;assert.throws(()=>validarPosicao(p),/parcelamento/);}
});

// ── Fase 9.2: rentabilidade sobre o capital do balanço ─────────────────────
const rent=(c,de,ate)=>c.json(`balRentabilidade({de:'${de}',ate:'${ate}'},giroUI.dados.historico.meses,dfcSaldos())`);
test('9.2: ROE e ROA de setembro com o resultado de caixa (gerencial, marcado) e o capital médio de agosto e setembro',()=>{
 const c=tela(),r=rent(c,'2026-09-01','2026-09-30'),ago=c.json("balApurar('Ago/2026',giroUI.dados.historico.meses,dfcSaldos())"),set=c.json("balApurar('Set/2026',giroUI.dados.historico.meses,dfcSaldos())");
 const res=c.json("DRESimples.apurar(state.records.find(r=>r.label==='Set/2026')).linhas.resultado");
 assert.deepEqual([r.base,r.resultado,r.ini.label,r.fim.label],['caixa',res,'Ago/2026','Set/2026']);
 assert.equal(r.plMedio,Math.round((ago.pl+set.pl)/2*100)/100);assert.equal(r.roe,Math.round(res/r.plMedio*10000)/100);assert.equal(r.roa,Math.round(res/r.ativoMedio*10000)/100);
 assert.ok(r.marcas.some(m=>/resultado de caixa \(gerencial\)/.test(m)));assert.ok(r.marcas.some(m=>/balanço de Ago\/2026 parcial/.test(m)),'agosto parcial: dito');assert.equal(r.disponivel,true);
});
test('9.2: competência apurada em todos os meses vale no lugar do caixa; mês aberto fica de fora; falta dita',()=>{
 const c=tela();c.run("state.cfg.demonstrativosCompetencia={meses:{Set_2026:{label:'Set/2026',company:'Impresilk + Universo',valores:{produtos:40000,servicos:0,outrasVendas:0,devolucoes:100,descontos:0,tributosVendas:2800,custos:16000,despesasVendas:1500,administrativas:12000,outrasDespesas:0,outrasReceitas:0,equivalencia:0,receitasFinanceiras:200,despesasFinanceiras:150,descontinuadas:0,da:500}}}}");
 const r=rent(c,'2026-09-01','2026-09-30');assert.notEqual(c.json("DREModelo.acumulado([state.cfg.demonstrativosCompetencia.meses.Set_2026]).liquido"),null,'apuração completa');assert.equal(r.base,'competencia');assert.equal(r.resultado,c.json("DREModelo.acumulado([state.cfg.demonstrativosCompetencia.meses.Set_2026]).liquido"));assert.ok(!r.marcas.some(m=>/gerencial/.test(m)));
 const ano=rent(tela(),'2026-01-01','2026-12-31');assert.deepEqual([ano.disponivel,ano.meses.at(-1),ano.fora],[false,'Set/2026',['Out/2026','Nov/2026','Dez/2026']]);
 assert.ok(ano.motivos.some(m=>/resultado sem Jan\/2026, Fev\/2026/.test(m)));assert.ok(ano.marcas.some(m=>/até Set\/2026: Out\/2026 a Dez\/2026 ainda não fecharam/.test(m)));
 assert.match(rent(tela(),'2026-10-01','2026-10-31').motivos[0],/Out\/2026 ainda não fechou/);
 assert.match(rent(tela(),'2026-09-05','2026-09-30').motivos[0],/meses inteiros/);
});
test('9.2: patrimônio médio negativo ou balanço faltando: sem taxa, nunca infinito',()=>{
 const neg=rent(tela({balanco:{'2026-08':{imobilizado:0,emprestimos:900000,parcelamentoDAS:0},'2026-09':{emprestimos:900000}}}),'2026-09-01','2026-09-30');
 assert.equal(neg.roe,null);assert.ok(neg.motivos.some(m=>/patrimônio médio zero ou negativo/.test(m)));assert.notEqual(neg.roa,null,'o ativo continua positivo');
 const semIni=rent(tela(),'2026-08-01','2026-08-31');assert.deepEqual([semIni.roe,semIni.roa,semIni.disponivel],[null,null,false]);assert.ok(semIni.motivos.some(m=>/balanço do fim de Jul\/2026 não somado/.test(m)));
 assert.doesNotMatch(JSON.stringify(neg),/Infinity|NaN/);
});

test('9.2 revisão: retorno antecipado com o formato inteiro; competência de outro escopo não vale; marcas do balanço no resumo',()=>{
 for(const [de,ate] of [['2026-10-01','2026-10-31'],['2026-09-05','2026-09-30'],['2026-11-01','2026-12-31']]){const r=rent(tela(),de,ate);assert.ok(Array.isArray(r.marcas)&&Array.isArray(r.motivos)&&Array.isArray(r.meses),de);assert.equal(r.roe,null);}
 assert.deepEqual(rent(tela(),'2026-11-01','2026-12-31').fora,['Nov/2026','Dez/2026']);
 const c=tela();c.run("state.cfg.demonstrativosCompetencia={meses:{Set_2026:{label:'Set/2026',company:'Impresilk',valores:{produtos:40000,servicos:0,outrasVendas:0,devolucoes:100,descontos:0,tributosVendas:2800,custos:16000,despesasVendas:1500,administrativas:12000,outrasDespesas:0,outrasReceitas:0,equivalencia:0,receitasFinanceiras:200,despesasFinanceiras:150,descontinuadas:0,da:500}}}}");
 const r=rent(c,'2026-09-01','2026-09-30');assert.equal(r.base,'caixa');assert.ok(r.marcas.some(m=>/competência de outro escopo \(Impresilk\)/.test(m)));
 assert.deepEqual([r.ini.parcial,!!r.ini.marca,r.fim.herdado],[true,true,true]);assert.match(r.ini.marca,/^parcial: sem estoque e parcelamento do DAS/);
});

// ── v135 ──────────────────────────────────────────────────────────────────
test('origem em Parâmetros vira link para o mês de onde o valor veio (N14)',()=>{
 const c=tela({op:{...OP,'2026-10':{saldoInicial:31000}}}),h=c.run('renderBalanco()');
 const ir=nome=>(linha(h,nome)?.ir||'').match(/data-go="parametros" data-rec-mes="([^"]+)">Ver em Parâmetros →/)?.[1]||null;
 assert.equal(ir('Imobilizado'),'Ago/2026','herdado: abre o mês do cadastro');assert.equal(ir('Empréstimos e financiamentos'),'Set/2026');assert.equal(ir('Estoques'),'Set/2026');
 assert.equal(ir('Caixa e bancos'),'Out/2026','saldo bancário do início do mês seguinte: abre esse mês');
 assert.equal(ir('Contas a receber'),null,'valor do Mubisys não leva a Parâmetros');
 const sem=tela().run('renderBalanco()');assert.equal((linha(sem,'Caixa e bancos')?.ir||''),'','caixa do Fluxo de caixa: sem link');
});
