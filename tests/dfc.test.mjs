// Fluxo de caixa (Fase 4): FCO, FCI e FCF a partir das linhas da DRE Simples, fechando com
// o caixa do ERP; saldo informado ou calculado, sequência que para com motivo, ajustes
// visíveis e que fecham; nada inventado.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
const q=ate=>({ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'});
// SET: vendas 10.000; rendimentos 20; Simples 800 (DAS 600 + DARF 200); parcelamento do DAS 300; salário 2.000;
// materiais 4.000; tarifas 80; empréstimo pago 1.770; máquina comprada 700; retiradas 1.000; empréstimo recebido 2.000.
const SET=[cel('1','Receitas',12020),cel('1.1','Comunicação Visual',10000),cel('1.1.1','Produtos',10000),cel('1.3','Rendimentos',20),cel('1.3.2','Juros',20),cel('1.4','Empréstimos',2000),cel('1.4.2','Pessoal',2000),
 cel('2','Despesas',10650),cel('2.1','Despesas Funcionários',2000),cel('2.1.4','Salário',2000),cel('2.4','Despesas Impostos',1100),cel('2.4.1','DAS',900),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.2','Impresilk',600),cel('2.4.3','DARF',200),cel('2.4.3.1','Impresilk',200),
 cel('2.6','Despesas Máquinas/Equipamentos',700),cel('2.6.1','Aquisição',700),cel('2.12','Materiais e Insumos',4000),cel('2.12.1','Impressão',4000),cel('2.13','Despesas Bancárias',1850),cel('2.13.1','Tarifa de boletos',80),cel('2.13.7','Empréstimos Bancários',1770),cel('2.14','Despesas Societárias',1000),cel('2.14.2','Retiradas Leonardo',1000)];
// TODAS: as 22 linhas da DRE Simples com valor, para nenhum sinal ou bloco passar por zero.
const TODAS=[cel('1','Receitas',12100),cel('1.1.1','Produtos',10000),cel('1.3.2','Juros',20),cel('1.4.2','Empréstimo',2000),cel('1.7','A identificar',50),cel('1.9','Entrada nova',30),
 cel('2','Despesas',9895),cel('2.4.1.2','DAS',600),cel('2.4.3.1','DARF',200),cel('2.4.1.1','Parcelamento',300),cel('2.4.8','ISSQN',40),cel('2.2.6','Devolução Cliente',50),cel('2.12.1','Impressão',3000),
 cel('2.1.4','Salário',1500),cel('2.5.2','Aluguel lote',800),cel('2.2.1','Material de Escritório',100),cel('2.7.2','Combustível',150),cel('2.15.7','Meta',120),cel('2.4.5.1','IPTU',60),cel('2.20','Nova',25),
 cel('2.13.1','Tarifa de boletos',80),cel('2.99','Fatura sem detalhamento',70),cel('2.6.1','Aquisição',700),cel('2.13.7','Empréstimos Bancários',900),cel('2.14.2','Retiradas',1000),cel('2.18','Transferência',200)];
const OUT=[cel('1','Receitas',3000),cel('1.1','Comunicação Visual',3000),cel('2','Despesas',1500),cel('2.4','Despesas Impostos',800),cel('2.4.1','DAS',800),cel('2.4.1.2','Impresilk',800),cel('2.6','Máquinas',700),cel('2.6.1','Aquisição',700)];
const reg=(label,ate,cells,origem='erp')=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem,qualidade:q(ate),cells});
const REGISTROS=[reg('Ago/2026','2026-08-31',SET),reg('Set/2026','2026-09-30',SET),reg('Out/2026','2026-10-08',OUT)];
function context({periodo='Set/2026',saldos={},registros=REGISTROS,admin=true,edicao=admin}={}){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=structuredClone(registros);
 c.__cfg={parametros:{operacao:Object.fromEntries(Object.entries(saldos).map(([k,v])=>[k,{saldoInicial:v}]))}};
 c.run(`dfcHoje=()=>'2026-10-10';state.records=__r;state.cfg=__cfg;state.periodo=${JSON.stringify(periodo)};state.permissoes={leitura:true,edicao:${edicao},admin:${admin}}`);return c;
}
const linha=(h,nome)=>{const i=h.indexOf(`<th scope="row">${nome}</th>`);return i<0?'':h.slice(i,h.indexOf('</tr>',i));};
const tabela=h=>h.slice(h.indexOf('dfc-tabela'));
const td=(l,i)=>[...l.matchAll(/<td class="([^"]*)">((?:(?!<\/td>).)*)<\/td>/g)][i]||[];// i: 0–11 meses, 12 acumulado
const num=s=>{const t=String(s).replace(/<[^>]+>/g,'');return /\d/.test(t)?Number(t.replace(/[^\d,-]/g,'').replace(',','.')):null;};
const meses=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const seq=(n,ini=[2026,0],cells=SET)=>Array.from({length:n},(_,i)=>{const t=ini[0]*12+ini[1]+i,a=Math.floor(t/12),fim=new Date(Date.UTC(a,t%12+1,0)).toISOString().slice(0,10);return reg(`${meses[t%12]}/${a}`,fim,cells);});
// Em cada coluna e no acumulado: saldo inicial + ajuste + geração = saldo final.
function fecha(h,cols){const t=tabela(h),v=n=>cols.map(i=>num(td(linha(t,n),i)[2]));const [ini,aj,ger,fim]=['Saldo inicial','(±) Ajuste de saldo informado','(=) Geração de caixa do mês','(=) Saldo final'].map(v);
 cols.forEach((c,k)=>assert.equal(Math.round(((ini[k]??NaN)+(aj[k]??0)+(ger[k]??NaN))*100)/100,fim[k],`coluna ${c}: ${ini[k]} + ${aj[k]} + ${ger[k]} ≠ ${fim[k]}`));return {ini,aj,ger,fim};}

test('cada linha cai no bloco certo, com o sinal certo, e a geração fecha com o ERP',()=>{
 const d=context({registros:[reg('Set/2026','2026-09-30',TODAS)]}).json('dfcApurar(state.records[0])');
 assert.equal(d.fco,3305,'10.100 de entradas − 6.795 (Simples 800, ISS 40, devolução 50, variáveis 3.000, fixas 2.755, juros 80, sem detalhamento 70)');
 assert.equal(d.fci,-700);assert.equal(d.fcf,-400,'+2.000 − 300 parcelamento − 900 dívida − 1.000 retiradas − 200 transferência');
 assert.equal(d.geracao,2205);assert.equal(d.caixa,2205);assert.equal(d.diferenca,0);
 assert.deepEqual(d.valores,{vendas:10000,receitasFinanceiras:20,aIdentificar:50,foraOutras:30,das:800,impostosVendas:40,devolucoes:50,variaveis:3000,fixas:2755,despesasFinanceiras:80,semDetalhamento:70,investimentos:700,emprestimos:2000,parcelamentoDAS:300,dividasOutras:900,socios:1000,transferencias:200});
 const c=context();for(const r of c.json('state.records.map(r=>[dfcApurar(r).geracao,DRESimples.apurar(r).linhas.variacao])'))assert.equal(r[0],r[1],'mesma conta da DRE Simples');
 assert.equal(c.run('dfcApurar(null)'),null);
 assert.equal(context({registros:[reg('Set/2026','2026-09-30',[...SET,cel('2.4.1.1.1','Parcelamento 2025',300)].map(x=>x.code==='2'?{...x,value:10950}:x.code==='2.4'?{...x,value:1400}:x.code==='2.4.1'?{...x,value:1200}:x.code==='2.4.1.1'?{...x,value:600}:x))]}).json('dfcApurar(state.records[0])').valores.parcelamentoDAS,600,'subconta do parcelamento também é financiamento');
});
test('contas por bloco: soma de cada grupo = total do bloco, contas no bloco certo, financiamento com a cor do sentido, a conferir marcado',()=>{
 const h=context({registros:[reg('Set/2026','2026-09-30',TODAS)]}).run('renderDFC()'),q=h.slice(h.indexOf('dfc-contas'),h.indexOf('</details>',h.indexOf('dfc-contas')));
 const grupos=[...q.matchAll(/<tbody><tr class="dre-composicao-grupo"><th scope="rowgroup" colspan="3">([^·]+)· (?:<span class="(?:tom-entra|tom-sai|)">)?([^<]+)(?:<\/span>)?<\/th><\/tr>([\s\S]*?)<\/tbody>/g)].map(m=>({nome:m[1].trim(),total:m[2],linhas:[...m[3].matchAll(/data-account="([^"]+)"[\s\S]*?<td class="num ([^"]*)">([^<]+)<\/td><td class="num">([^<]*)<\/td>/g)].map(x=>({code:x[1],tom:x[2],valor:num(x[3]),pct:x[4]}))}));
 for(const g of grupos)assert.equal(Math.round(g.linhas.reduce((t,x)=>t+x.valor,0)*100)/100,num(g.total),g.nome);
 assert.deepEqual(grupos.find(g=>g.nome.startsWith('Investimentos')).linhas.map(x=>x.code),['2.6.1']);
 const fcf=grupos.find(g=>g.nome.startsWith('Financiamentos')).linhas;assert.deepEqual(fcf.map(x=>x.code).sort(),['1.4.2','2.13.7','2.14.2','2.18','2.4.1.1']);
 assert.ok(fcf.every(x=>x.tom===(x.code.startsWith('1')?'tom-entra':'tom-sai')),'financiamento com a cor do sentido');assert.equal(fcf.find(x=>x.code==='2.14.2').pct,'10%','% sobre as vendas');
 const fco=grupos.find(g=>g.nome.startsWith('Caixa da operação')).linhas;assert.equal(fco.find(x=>x.code==='1.1.1').tom,'tom-entra');assert.equal(fco.find(x=>x.code==='2.1.4').tom,'tom-sai');
 assert.equal((q.match(/origem-dado origem-padrao/g)||[]).length,2,'1.9 e 2.20 ainda a classificar');assert.match(q,/ · 2 a conferir<\/summary>/);
 assert.match(context().run('renderDFC()'),/parcelamento do DAS: financiamento, não imposto do mês/);
});
test('saldo: informado vale; sem ele, o final do mês anterior; ausente nunca vira zero',()=>{
 assert.deepEqual(context({saldos:{'2026-08':5000}}).json("(({inicial,origem,final})=>({inicial,origem,final}))(dfcSaldo('Set/2026'))"),{inicial:6370,origem:'calculado',final:7740});
 for(const vazio of [null,''])assert.deepEqual(context({saldos:{'2026-08':5000,'2026-09':vazio}}).json("(({inicial,origem,divergencia})=>({inicial,origem,divergencia}))(dfcSaldo('Set/2026'))"),{inicial:6370,origem:'calculado',divergencia:null});
 assert.equal(context({saldos:{'2026-09':1000}}).json("dfcSaldo('Out/2026')").final,3870,'Out parcial: 1.000 + 1.370 (Set) + 1.500 (Out até agora)');
 const h=context().run('renderDFC()'),t=tabela(h);
 for(const n of ['Saldo inicial','(±) Ajuste de saldo informado','(=) Saldo final'])assert.match(td(linha(t,n),8)[2],/—/,n+' de Set sem saldo');
 assert.match(td(linha(t,'Saldo inicial'),12)[2],/—/);assert.match(h,/<span class="label">Saldo final<\/span><strong class="">Não apurado<\/strong>/);
 assert.match(td(linha(tabela(context({saldos:{'2026-08':5000}}).run('renderDFC()')),'Caixa da operação (FCO)'),12)[2],/—/,'acumulado com Jan–Jul sem dados');
 const jul=context({periodo:'Jul/2026',saldos:{'2026-07':1000}});assert.equal(jul.json("dfcSaldo('Jul/2026')"),null,'mês sem registro não tem saldo');assert.equal((jul.run('renderDFC()').match(/<strong class="">Não apurado<\/strong>/g)||[]).length,4);
 // registro sem apuração (sem contas): o saldo informado não vira saldo final
 const vazio=context({registros:[reg('Jul/2026','2026-07-31',[]),reg('Ago/2026','2026-08-31',SET)],saldos:{'2026-07':1000},periodo:'Ago/2026'});
 assert.equal(vazio.json("dfcSaldo('Jul/2026')").final,null);assert.match(vazio.run('renderDFC()'),/O saldo inicial de Jul\/2026 foi informado, mas Jul\/2026 não tem dados para calcular o saldo final\. Para seguir, importe a planilha de Jul\/2026 ou informe o saldo inicial de Ago\/2026 em Parâmetros\./,'Jul está fora do alcance da coleta');
 assert.match(context({saldos:{'2026-09':1000}}).run('renderDFC()'),/Saldo inicial R\$\s1\.000,00 \(informado em Parâmetros\) \+ geração/);
});
test('a sequência atravessa meses e anos sem limite',()=>{
 const regs=seq(18,[2026,7]);// Ago/2026 a Jan/2028
 assert.equal(context({registros:regs,saldos:{'2026-08':5000},periodo:'Jan/2028'}).json("dfcSaldo('Jan/2028')").final,5000+18*1370);
 const h=context({registros:regs,saldos:{'2026-08':5000},periodo:'Jan/2027'}).run('renderDFC()');assert.match(h,/<span class="label">Saldo final<\/span><strong class="tom-entra">R\$\s13\.220,00<\/strong>/,'5.000 + 6 × 1.370 (Ago a Jan)');
 assert.deepEqual(context({saldos:{'2026-08':5000}}).json("(({inicial,final})=>({inicial,final}))(dfcSaldo('Out/2026'))"),{inicial:7740,final:9240},'dois meses de sequência');
});
test('quando a sequência para, a tela diz onde, por quê e o que fazer, conforme quem está vendo',()=>{
 const parc=[reg('Jul/2026','2026-07-31',SET),reg('Ago/2026','2026-08-20',SET),reg('Set/2026','2026-09-30',SET),reg('Out/2026','2026-10-31',SET)];
 assert.match(context({registros:parc,saldos:{'2026-07':5000}}).run('renderDFC()'),/<h2>O saldo calculado parou<\/h2><p>O saldo vinha de Jul\/2026 \(informado\) e parou porque Ago\/2026 foi coletado só até 20\/08\. Para seguir, atualize o Mubisys de Ago\/2026 ou informe o saldo inicial de Set\/2026 em Parâmetros\.<\/p>/);
 assert.match(context({registros:parc,saldos:{'2026-07':5000},periodo:'Out/2026'}).run('renderDFC()'),/parou porque Ago\/2026 foi coletado só até 20\/08/,'o motivo segue para os meses seguintes');
 assert.match(context({registros:parc,saldos:{'2026-07':5000},admin:false}).run('renderDFC()'),/Para seguir, peça para atualizar o Mubisys de Ago\/2026 ou para informar o saldo inicial de Set\/2026 em Parâmetros\./,'quem não coleta não recebe tarefa impossível');
 assert.match(context({registros:parc,saldos:{'2026-07':5000},periodo:'Ago/2026'}).run('renderDFC()'),/coletado só até 20\/08 \(mês incompleto\)/,'mês que já acabou não é "em andamento"');
 const planilha=[reg('Jul/2026','2026-07-31',SET),reg('Ago/2026','2026-08-20',SET,'planilha'),reg('Set/2026','2026-09-30',SET)];
 assert.match(context({registros:planilha,saldos:{'2026-07':5000}}).run('renderDFC()'),/parou porque a planilha de Ago\/2026 tem dados só até 20\/08\. Para seguir, importe de novo a planilha completa de Ago\/2026 ou informe/);
 assert.match(context({registros:planilha,saldos:{'2026-07':5000},periodo:'Ago/2026'}).run('renderDFC()'),/planilha com dados até 20\/08 \(mês incompleto\)/);
 assert.match(context({registros:[reg('Jul/2026','2026-07-31',SET),reg('Set/2026','2026-09-30',SET)],saldos:{'2026-07':5000}}).run('renderDFC()'),/parou porque Ago\/2026 não tem dados\. Para seguir, importe a planilha de Ago\/2026 ou/,'mês sem registro antes do anterior: só planilha');
 assert.match(context({registros:[...seq(2),reg('Jun/2026','2026-06-30',SET)],saldos:{'2026-01':1000},periodo:'Jun/2026'}).run('renderDFC()'),/parou porque Mar\/2026 a Mai\/2026 não têm dados\. Para seguir, importe as planilhas de Mar\/2026 a Mai\/2026/,'buraco inteiro, não um mês por vez');
 assert.match(context({registros:[reg('Ago/2026','2026-08-31',SET),reg('Out/2026','2026-10-31',SET)],saldos:{'2026-09':8000},periodo:'Out/2026'}).run('renderDFC()'),/O saldo inicial de Set\/2026 foi informado, mas Set\/2026 não tem dados para calcular o saldo final\. Para seguir, colete Set\/2026/);
 // a causa mais antiga vem primeiro, e os buracos depois dela também; seguir a instrução destrava
 const dois=[reg('Jul/2026','2026-07-31',SET),reg('Ago/2026','2026-08-20',SET),reg('Out/2026','2026-10-31',SET)];
 assert.match(context({registros:dois,saldos:{'2026-07':5000},periodo:'Out/2026'}).run('renderDFC()'),/parou porque Ago\/2026 foi coletado só até 20\/08; Set\/2026 também não tem dados\. Para seguir, atualize o Mubisys de Ago\/2026 e colete Set\/2026, ou informe o saldo inicial de Out\/2026 em Parâmetros\./);
 assert.equal(context({registros:[reg('Jul/2026','2026-07-31',SET),reg('Ago/2026','2026-08-31',SET),reg('Set/2026','2026-09-30',SET),reg('Out/2026','2026-10-31',SET)],saldos:{'2026-07':5000},periodo:'Out/2026'}).json("dfcSaldo('Out/2026')").final,10480,'feito o que o aviso pede, o saldo segue');
 assert.match(context({registros:[reg('Jan/2026','2026-01-31',SET),reg('Mar/2026','2026-03-31',SET),reg('Mai/2026','2026-05-31',SET)],saldos:{'2026-01':1000},periodo:'Mai/2026'}).run('renderDFC()'),/parou porque Fev\/2026 não tem dados; Abr\/2026 também não tem dados\. Para seguir, importe a planilha de Fev\/2026 e importe a planilha de Abr\/2026, ou informe/);
 assert.match(context({registros:[reg('Mar/2026','2026-03-31',SET),reg('Ago/2026','2026-08-31',SET)],saldos:{'2026-01':1000},periodo:'Ago/2026'}).run('renderDFC()'),/O saldo inicial de Jan\/2026 foi informado, mas Jan\/2026 a Fev\/2026 não têm dados para calcular o saldo final; Abr\/2026 a Jul\/2026 também não têm dados\./);
 assert.match(context({registros:[reg('Jan/2026','2026-01-31',SET),reg('Jun/2026','2026-06-30',SET)],saldos:{'2026-01':1000,'2026-05':5000},periodo:'Jun/2026'}).run('renderDFC()'),/O saldo inicial de Mai\/2026 foi informado, mas Mai\/2026 não tem dados para calcular o saldo final\. Para seguir, importe a planilha de Mai\/2026 ou/,'a faixa começa no saldo informado');
 assert.match(context({registros:[reg('Abr/2026','2026-04-30',SET),reg('Mai/2026','2026-05-20',SET),...seq(4,[2026,5])],saldos:{'2026-04':1000},periodo:'Set/2026'}).run('renderDFC()'),/parou porque Mai\/2026 foi coletado só até 20\/05\. Para seguir, importe de novo a planilha completa de Mai\/2026 ou/,'a rotina não relê meses tão antigos');
 assert.match(context({registros:[reg('Ago/2026','2026-08-31',SET),reg('Out/2026','2026-10-31',SET)],saldos:{'2026-08':1000},periodo:'Out/2026'}).run('renderDFC()'),/parou porque Set\/2026 não tem dados\. Para seguir, colete Set\/2026 ou/,'mês anterior ao atual: o botão coleta');
 const naoFecha=[reg('Ago/2026','2026-08-31',[...SET,cel('3','Conta fora do plano',50)]),reg('Set/2026','2026-09-30',SET)];
 const nf=context({registros:naoFecha,saldos:{'2026-08':5000}});assert.equal(nf.json("dfcApurar(state.records[0])").diferenca,-50);
 assert.match(nf.run('renderDFC()'),/parou porque a geração de Ago\/2026 ficou R\$\s50,00 abaixo do caixa do ERP\. Para seguir, confira as contas de Ago\/2026 no Plano de contas/);
 nf.run("state.periodo='Ago/2026'");assert.match(nf.run('renderDFC()'),/A geração ficou R\$\s50,00 abaixo do caixa do ERP \(entradas menos saídas de Ago\/2026 = /);
 assert.match(context().run('renderDFC()'),/<h2>Falta o saldo inicial<\/h2>[\s\S]*data-go="parametros">Informar em Parâmetros/);
 assert.match(context({admin:false}).run('renderDFC()'),/Peça a um administrador para informar o saldo bancário[\s\S]*data-go="parametros">Ver Parâmetros/);
});
test('saldo informado diferente: o aviso diz quanto e para que lado, e cada coluna e o acumulado fecham com o ajuste',()=>{
 assert.match(context({saldos:{'2026-08':5000,'2026-09':6000}}).run('renderDFC()'),/informado em Parâmetros \(R\$\s6\.000,00\) é R\$\s370,00 menor que o saldo final calculado de Ago\/2026 \(R\$\s6\.370,00\)/);
 assert.match(context({saldos:{'2026-08':5000,'2026-09':7000}}).run('renderDFC()'),/é R\$\s630,00 maior que o saldo final calculado/);
 const igual=context({saldos:{'2026-08':5000,'2026-09':6370}});assert.equal(igual.json("dfcSaldo('Set/2026')").divergencia,null);assert.doesNotMatch(igual.run('renderDFC()'),/menor que|maior que/);
 // ajuste em março: a coluna mostra o final de fevereiro e a diferença
 const h=context({registros:seq(4),saldos:{'2026-01':1000,'2026-03':5000},periodo:'Abr/2026'}).run('renderDFC()');
 const r=fecha(h,[0,1,2,3,12]);assert.deepEqual(r.aj,[null,0,1260,0,1260],'Jan sem mês anterior: — ; acumulado parte do saldo de janeiro');assert.deepEqual([r.ini[2],r.fim[2],r.ini[4],r.fim[4]],[3740,6370,1000,7740]);
 assert.match(td(linha(tabela(h),'(±) Ajuste de saldo informado'),2)[1],/^num\s+$/,'ajuste sem cor');
 assert.match(h,/O saldo segue o saldo inicial informado em Mar\/2026, que ficou R\$\s1\.260,00 acima do saldo final mostrado de Fev\/2026; a diferença está na linha de ajuste da tabela\./);
 // ajuste em janeiro, com dezembro no ano anterior
 const jan=context({registros:seq(5,[2025,11]),saldos:{'2025-12':1000,'2026-01':5000},periodo:'Abr/2026'}).run('renderDFC()');
 const rj=fecha(jan,[0,1,2,3,12]);assert.deepEqual([rj.ini[0],rj.aj[0],rj.fim[4]],[2370,2630,10480]);
 assert.match(context({registros:seq(4,[2025,10]),saldos:{'2025-11':1000,'2025-12':5000},periodo:'Fev/2026'}).run('renderDFC()'),/informado em Dez\/2025, que ficou R\$\s2\.630,00 acima do saldo final mostrado de Nov\/2025; a diferença está na tabela de 2025\./);
 // retomada depois de mês parcial: o ajuste compara com o final mostrado de fevereiro
 const ret=context({registros:[reg('Jan/2026','2026-01-31',SET),reg('Fev/2026','2026-02-20',SET),...seq(2,[2026,2])],saldos:{'2026-01':1000,'2026-03':5000},periodo:'Abr/2026'}).run('renderDFC()');
 const rr=fecha(ret,[0,1,2,3,12]);assert.deepEqual([rr.aj[2],rr.fim[4]],[1260,7740]);
 assert.match(context({registros:seq(4),saldos:{'2026-01':1000},periodo:'Abr/2026'}).run('renderDFC()'),/O saldo é calculado a partir do saldo inicial informado em Jan\/2026\./);
 // retomada com a sequência já parada: a coluna fecha, o acumulado de saldo não tem como e fica —
 const quebrado=context({registros:[reg('Jan/2026','2026-01-31',SET),reg('Fev/2026','2026-02-20',SET),...seq(2,[2026,2])],saldos:{'2026-01':1000,'2026-04':20000},periodo:'Abr/2026'}).run('renderDFC()'),tq=tabela(quebrado);
 fecha(quebrado,[3]);for(const n of ['Saldo inicial','(±) Ajuste de saldo informado','(=) Saldo final'])assert.match(td(linha(tq,n),12)[2],/—/,n+' do acumulado');
 // saldo inicial que vem de um dezembro incompleto: cor pelo sinal (decisão de 13/10), com * e explicado
 const dez=[reg('Nov/2025','2025-11-30',SET),reg('Dez/2025','2025-12-20',SET),...seq(3)],sd={'2025-11':1000,'2026-01':5000};
 const hd=context({registros:dez,saldos:sd,periodo:'Mar/2026'}).run('renderDFC()'),cj=td(linha(tabela(hd),'Saldo inicial'),0),ca=td(linha(tabela(hd),'Saldo inicial'),12);
 assert.match(cj[1],/^num\s+tom-entra$/);assert.match(cj[2],/R\$\s3\.740,00 \*$/);assert.match(ca[1],/^num\s*tom-entra$/);assert.match(ca[2],/R\$\s3\.740,00 \*$/);
 assert.match(hd,/O saldo segue o saldo inicial informado em Jan\/2026, que ficou R\$\s1\.260,00 acima do saldo final mostrado de Dez\/2025, que tem dados só até 20\/12 \(mês incompleto\); a diferença está na linha de ajuste da tabela\./);
 assert.match(context({registros:dez,saldos:sd,periodo:'Jan/2026'}).run('renderDFC()'),/O saldo inicial informado ficou R\$\s1\.260,00 acima do saldo final mostrado de Dez\/2025, que tem dados só até 20\/12 \(mês incompleto\); a diferença está na linha de ajuste da tabela\./);
});
test('tela: quatro cards, três gráficos (o saldo à parte), contas por bloco e tabela fechada com planilha',()=>{
 const h=context({saldos:{'2026-08':5000}}).run('renderDFC()');
 const cards=[...h.matchAll(/<div class="metric metric-param"><span class="label">([^<]*)<\/span><strong class="([^"]*)">([^<]*)<\/strong>/g)].map(m=>[m[1],m[2],m[3]]);
 assert.deepEqual(cards.map(x=>x[0]),['Caixa da operação (FCO) · Set/2026','Investimentos (FCI)','Financiamentos (FCF)','Saldo final']);
 assert.deepEqual(cards.map(x=>x[1]),['tom-entra','tom-sai','tom-sai','tom-entra'],'FCF negativo em vermelho');assert.match(cards[0][2],/R\$\s3\.140,00/);
 assert.match(h,/Saldo inicial R\$\s6\.370,00 \(final de Ago\/2026\) \+ geração R\$\s1\.370,00/);assert.match(h,/retiradas, arrendamento e transferências entre as empresas/);
 assert.equal((h.match(/<figure class="g-fig g-(empilhadas|linha-area)/g)||[]).length,3);
 const g=(a,b)=>h.slice(h.indexOf(a),b?h.indexOf(b):undefined),g1=g('Para onde foi o caixa','A operação se paga'),g2=g('A operação se paga','Quanto sobrou'),g3=g('Quanto sobrou','De onde vem cada bloco');
 assert.doesNotMatch(g1,/g-chave-linha/,'o saldo não divide o eixo com as barras');
 for(const x of [g2,g3])assert.match(x,/data-dica="Jan\nsem dado"/,'mês sem dados não vira zero');
 assert.match(g2,/data-dica="Set\nR\$\s3\.140,00"/);assert.match(g3,/data-dica="Set\nR\$\s7\.740,00"/,'saldo final no gráfico próprio');
 assert.match(h,/<details class="card dfc-mensal"[^>]*><summary>Fluxo de caixa mês a mês · 2026<\/summary><div class="card-body"><div class="actions"><button type="button" data-dfc-csv>/);
 const t=tabela(h);for(const n of ['(+) Empréstimos recebidos'])assert.match(linha(t,n),/<td class="num selected-month tom-entra">/,n+' em azul');for(const n of ['Financiamentos (FCF)','(−) Parcelamento do DAS','(−) Empréstimos, antecipações e outras dívidas pagas','(−) Retiradas e arrendamento'])assert.match(linha(t,n),/<td class="num selected-month tom-sai">/,n+' em vermelho');
 assert.doesNotMatch(linha(t,'(±) Ajuste de saldo informado'),/tom-/,'ajuste sem cor');assert.doesNotMatch(linha(t,'(−) Transferências entre empresas'),/tom-/,'sem transferência, zero sem cor');
 assert.match(linha(t,'(−) Parcelamento do DAS'),/<td class="num selected-month tom-sai">-R\$\s300,00<\/td>/);
 assert.match(linha(t,'(−) ISS fora do DAS'),/<td class="num selected-month ">R\$\s0,00<\/td>/,'zero sem sinal e sem cor');
 assert.match(linha(t,'Caixa da operação (FCO)'),/^<th scope="row">Caixa da operação \(FCO\)<\/th><td class="num  "><span class="muted"/,'janeiro sem dados é —');
 assert.ok(h.indexOf('metric-param')<h.indexOf('g-empilhadas')&&h.indexOf('g-empilhadas')<h.indexOf('De onde vem cada bloco')&&h.indexOf('De onde vem cada bloco')<h.indexOf('Fluxo de caixa mês a mês'));
});
// Decisão de 13/10 (C3 e C8): o mês parcial mantém a cor do sentido; só setas, Δ e ritmo ficam neutros.
test('mês em andamento ou incompleto: marcado, com a cor do sentido (também no acumulado), hachurado nos gráficos e com * na tabela',()=>{
 const out=context({periodo:'Out/2026',saldos:{'2026-09':1000}}).run('renderDFC()');
 assert.equal((out.match(/coletado até 08\/10 \(mês em andamento\)/g)||[]).length,5,'4 cards e o quadro de contas');
 assert.deepEqual([...out.matchAll(/<div class="metric metric-param"><span class="label">[^<]*<\/span><strong class="([^"]*)">([^<]*)/g)].map(m=>m[1]+'|'+m[2].replace(/\s/g,' ')),['tom-entra|R$ 2.200,00','tom-sai|-R$ 700,00','|R$ 0,00','tom-entra|R$ 3.870,00'],'FCI com valor em vermelho; FCF zero sem cor');
 assert.match(out,/data-dica="Out\*\nOperação \(FCO\): Não apurado\nInvestimento \(FCI\): Não apurado\nFinanciamento \(FCF\): Não apurado"/);
 const g=(a,b)=>out.slice(out.indexOf(a),b?out.indexOf(b):undefined);for(const x of [g('A operação se paga','Quanto sobrou'),g('Quanto sobrou','De onde vem cada bloco')])assert.match(x,/data-dica="Out\*\nsem dado"/);
 const qo=out.slice(out.indexOf('dfc-contas'),out.indexOf('</details>',out.indexOf('dfc-contas')));assert.match(qo,/<td class="num tom-entra">R\$\s3\.000,00<\/td>/,'contas do mês parcial com cor');assert.match(qo,/<td class="num tom-sai">-R\$\s800,00<\/td>/,'contas do mês parcial com cor');assert.match(qo,/contas do plano em Out\/2026 · coletado até 08\/10 \(mês em andamento\)/);
 const t=tabela(out);assert.match(t,/<th scope="col" class="num selected-month">Out\/2026 \*<\/th>/);assert.match(t,/<th scope="col" class="num">Acumulado até Out \*<\/th>/);
 assert.match(linha(t,'Caixa da operação (FCO)'),/<td class="num selected-month tom-entra">R\$\s2\.200,00<\/td>/,'coluna do mês em andamento com cor');
 const ano=context({registros:seq(9).concat([reg('Out/2026','2026-10-08',OUT)]),saldos:{'2026-01':1000},periodo:'Out/2026'}).run('renderDFC()'),ta=tabela(ano);
 for(const n of ['Caixa da operação (FCO)','(=) Geração de caixa do mês','(=) Saldo final'])assert.equal(td(linha(ta,n),12)[1],'num tom-entra',n+': acumulado com mês em andamento com cor');
 assert.match(td(linha(ta,'(=) Saldo final'),12)[2],/R\$\s14\.830,00/);
 const pl=context({periodo:'Out/2026',saldos:{'2026-09':1000},registros:[REGISTROS[0],REGISTROS[1],{...REGISTROS[2],origem:'planilha'}]}).run('renderDFC()');
 assert.deepEqual([...pl.matchAll(/<div class="metric metric-param"><span class="label">[^<]*<\/span><strong class="([^"]*)">/g)].map(m=>m[1]),['tom-entra','tom-sai','','tom-entra'],'planilha importada no meio do mês também é parcial, com a mesma cor');
 assert.equal((pl.match(/planilha com dados até 08\/10 \(mês em andamento\)/g)||[]).length,5);
});
test('planilha CSV: mesmos valores e marcas da tabela; "Trazer de" não copia nem oferece só o saldo bancário',()=>{
 const c=context({saldos:{'2026-08':5000}});c.run('download=(n,t)=>{__csv={n,t}}');const rows=c.json('dfcCSV()');
 assert.equal(c.run('__csv.n'),'fluxo-de-caixa-2026.csv');assert.equal(rows[0][13],'Acumulado até Set/2026');assert.equal(rows[0][10],'Out/2026 (em andamento)');
 assert.deepEqual(rows.find(r=>r[0]==='(=) Saldo final').slice(8,10),['6370,00','7740,00']);assert.ok(rows.some(r=>r[0]==='(±) Ajuste de saldo informado'));
 assert.equal(rows.find(r=>r[0]==='Caixa da operação (FCO)')[1],'Não apurado');assert.equal(rows.find(r=>r[0]==='(−) Parcelamento do DAS')[9],'-300,00');
 const c4=context({registros:seq(4),saldos:{'2026-01':1000},periodo:'Abr/2026'});c4.run('download=()=>{}');assert.equal(c4.json('dfcCSV()').find(r=>r[0]==='(=) Geração de caixa do mês')[13],'5480,00');
 const co=context({periodo:'Out/2026'});co.run('download=()=>{}');assert.equal(co.json('dfcCSV()')[0][13],'Acumulado até Out/2026 (inclui mês em andamento)');
 // "Trazer de Ago/2026" em Parâmetros: prazos e metas sim, saldo bancário não
 const p=context({saldos:{'2026-08':5000}});assert.doesNotMatch(p.run('renderParametros()'),/data-param-copiar="operacao"/,'mês anterior só com o saldo: nada para trazer');
 p.run("state.cfg.parametros.operacao['2026-08'].prazoRecebimento=30");assert.match(p.run('renderParametros()'),/data-param-copiar="operacao">Trazer de Ago\/2026/);
 const handlers={};p.__doc={addEventListener:(t,fn)=>{(handlers[t]=handlers[t]||[]).push(fn);},querySelector:()=>null};p.run('document=__doc;wireParametros()');
 const campos={};const els=['prazoRecebimento','saldoInicial','estoque'].map(n=>(campos[n]={name:n,value:'',disabled:false}));els.namedItem=n=>campos[n]||null;
 const erro={textContent:'',classList:{add(){},remove(){}}},form={dataset:{paramForm:'operacao',mes:'Set/2026'},elements:els,classList:{add(){}},querySelector:s=>s==='.param-erro'?erro:null};
 const botao={dataset:{paramCopiar:'operacao'},closest:()=>form,hasAttribute:()=>false};
 for(const fn of handlers.click)fn({target:{closest:s=>s==='button'?botao:null}});
 assert.equal(campos.prazoRecebimento.value,'30');assert.equal(campos.saldoInicial.value,'','o saldo bancário é de cada mês: não é trazido');
});
test('a tela de Fluxo de caixa usa o cálculo, escapa nomes e está publicada',()=>{
 const c=context();assert.match(c.run('paginasDoApp().dfc()'),/Caixa da operação \(FCO\) · Set\/2026/);
 const html=ler('index.html');assert.ok(html.indexOf('parametros.js?v=')<html.indexOf('dfc.js?v=')&&html.indexOf('demonstrativos.js?v=')<html.indexOf('dfc.js?v='));
 assert.match(ler('sw.js'),/`\.\/dfc\.js\?v=\$\{V\}`/);assert.match(ler('scripts/build_site.py'),/'dfc\.js'/);
 const x=REGISTROS.map(r=>r.label!=='Set/2026'?r:{...r,cells:[...SET.map(y=>y.code==='2'?{...y,value:10750}:y.code==='2.13'?{...y,value:1950}:y),cel('2.13.52','<img src=x onerror=alert(1)>',100)]});
 const h=context({registros:x}).run('renderDFC()');assert.doesNotMatch(h,/<img src=x/);assert.match(h,/&lt;img src=x/);
 const rot=[reg('Jul/2026','2026-07-31',SET),reg('Ago/2026<img src=x onerror=alert(1)>','2026-08-31',[...SET,cel('3','x',50)]),reg('Set/2026','2026-09-30',SET)];
 const h2=context({registros:rot,saldos:{'2026-07':5000}}).run('renderDFC()');assert.doesNotMatch(h2,/<img src=x/);assert.match(h2,/parou porque a geração de Ago\/2026&lt;img/,'rótulo do registro no aviso');
});
// C25, C12 e N9: subtotal do grupo com a cor do bloco; FCO em linha de resultado; cartões lembram se estavam abertos.
test('subtotal de cada bloco com cor, FCO como resultado e cartões com a chave de memória do app',()=>{
 const c=context({registros:[reg('Set/2026','2026-09-30',TODAS)]}),h=c.run('renderDFC()');
 assert.match(h,/Caixa da operação \(FCO\) · <span class="tom-entra">R\$\s3\.305,00<\/span><\/th>/);assert.match(h,/Investimentos \(FCI\) · <span class="tom-sai">-R\$\s700,00<\/span><\/th>/);assert.match(h,/Financiamentos \(FCF\) · <span class="tom-sai">-R\$\s400,00<\/span><\/th>/);
 const g2=h.slice(h.indexOf('A operação se paga'),h.indexOf('Quanto sobrou'));assert.match(g2,/g-cor-resultado/);assert.doesNotMatch(g2,/g-cor-marca/);
 c.run('cardAttrs=undefined');assert.match(c.run('renderDFC()'),/<details class="card dfc-mensal"><summary>/,'sem cardAttrs (fora do app), o cartão continua fechado');
 c.run("cardAttrs=(t,aberto=true)=>`data-card=\"dfc:${t}\"`+(aberto?' open':'')");const k=c.run('renderDFC()');
 assert.match(k,/<details class="card dfc-mensal" data-card="dfc:Fluxo de caixa mês a mês"><summary>/);assert.match(k,/<details class="card dfc-contas" data-card="dfc:De onde vem cada bloco"><summary>/);
 c.run("cardAttrs=(t,aberto=true)=>`data-card=\"dfc:${t}\"`+(t==='Fluxo de caixa mês a mês'?' open':'')");assert.match(c.run('renderDFC()'),/<details class="card dfc-mensal" data-card="dfc:Fluxo de caixa mês a mês" open><summary>/,'aberto antes, aberto de novo');
});
// D1: ao abrir a tabela, a rolagem para no início de uma coluna; nenhuma fica pela metade atrás da coluna fixa.
test('rolagem da tabela: começa numa coluna inteira, também perto do fim do ano',()=>{
 const c=context(),h=[];c.document.addEventListener=(t,f)=>h.push([t,f]);c.run('wireDFC()');const toggle=h.find(x=>x[0]==='toggle')[1];
 // coluna fixa de 200 px e 13 colunas de 120 px; área visível de 700 px (rolagem máxima 1060)
 const ths=[{offsetLeft:0,offsetWidth:200},...Array.from({length:13},(_,i)=>({offsetLeft:200+i*120,offsetWidth:120}))];
 const abre=sel=>{const wrap={scrollLeft:-1,scrollWidth:200+13*120,clientWidth:700,querySelector:s=>s==='thead .selected-month'?ths[sel+1]:null,querySelectorAll:()=>ths};toggle({target:{open:true,classList:{contains:k=>k==='dfc-mensal'},querySelector:()=>wrap}});return wrap.scrollLeft;};
 assert.equal(abre(4),480,'Mai: começa na coluna de maio');assert.equal(abre(0),0);
 const fim=abre(11);assert.ok(fim<=1060&&fim%120===0,`Dez: para no início de uma coluna (${fim})`);assert.equal(fim,960);
});
