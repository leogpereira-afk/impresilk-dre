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
const num=s=>{const t=String(s).replace(/<[^>]+>/g,'').replace(/\u2212/g,'-');return /\d/.test(t)?Number(t.replace(/[^\d,-]/g,'').replace(',','.')):null;};
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
 const grupos=[...q.matchAll(/<tbody data-dfc-bloco="(?:fco|fci|fcf)"><tr class="dre-composicao-grupo"><th scope="rowgroup" colspan="3">([^·]+)· (?:<span class="(?:tom-entra|tom-sai|)">)?([^<]+)(?:<\/span>)?<\/th><\/tr>([\s\S]*?)<\/tbody>/g)].map(m=>({nome:m[1].trim(),total:m[2],linhas:[...m[3].matchAll(/data-account="([^"]+)"[\s\S]*?<td class="num ([^"]*)">([^<]+)<\/td><td class="num">([^<]*)<\/td>/g)].map(x=>({code:x[1],tom:x[2],valor:num(x[3]),pct:x[4]}))}));
 for(const g of grupos)assert.equal(Math.round(g.linhas.reduce((t,x)=>t+x.valor,0)*100)/100,num(g.total),g.nome);
 assert.deepEqual(grupos.find(g=>g.nome.startsWith('Investimentos')).linhas.map(x=>x.code),['2.6.1']);
 const fcf=grupos.find(g=>g.nome.startsWith('Financiamentos')).linhas;assert.deepEqual(fcf.map(x=>x.code).sort(),['1.4.2','2.13.7','2.14.2','2.18','2.4.1.1']);
 assert.ok(fcf.every(x=>x.tom===(x.code.startsWith('1')?'tom-entra':'tom-sai')),'financiamento com a cor do sentido');assert.equal(fcf.find(x=>x.code==='2.14.2').pct,'10,0%','% sobre as vendas, com casa fixa (D16)');
 const fco=grupos.find(g=>g.nome.startsWith('Caixa da operação')).linhas;assert.equal(fco.find(x=>x.code==='1.1.1').tom,'tom-entra');assert.equal(fco.find(x=>x.code==='2.1.4').tom,'tom-sai');
 assert.equal((q.match(/origem-dado origem-padrao/g)||[]).length,2,'1.9 e 2.20 ainda a classificar');assert.match(q,/ · 2 a conferir<\/h2><\/summary>/);
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
test('tela: quatro cards, três gráficos (o saldo à parte), contas por bloco e tabela fechada, sem planilha dentro do cartão',()=>{
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
 // N25: a planilha sai pelo "↓ Planilha" do topo (dfcCSV), não de dentro do cartão fechado.
 assert.match(h,/<details class="card dfc-mensal"[^>]*><summary><h2 class="card-titulo">Fluxo de caixa mês a mês · 2026<\/h2><\/summary><div class="card-body"><div class="table-scroll">/);assert.doesNotMatch(h,/data-dfc-csv|Baixar planilha/);
 const t=tabela(h);for(const n of ['(+) Empréstimos recebidos'])assert.match(linha(t,n),/<td class="num selected-month tom-entra">/,n+' em azul');for(const n of ['Financiamentos (FCF)','(−) Parcelamento do DAS','(−) Empréstimos, antecipações e outras dívidas pagas','(−) Retiradas e arrendamento'])assert.match(linha(t,n),/<td class="num selected-month tom-sai">/,n+' em vermelho');
 assert.doesNotMatch(linha(t,'(±) Ajuste de saldo informado'),/tom-/,'ajuste sem cor');assert.doesNotMatch(linha(t,'(−) Transferências entre empresas'),/tom-/,'sem transferência, zero sem cor');
 assert.match(linha(t,'(−) Parcelamento do DAS'),/<td class="num selected-month tom-sai">[−-]R\$\s300,00<\/td>/);
 assert.match(linha(t,'(−) ISS fora do DAS'),/<td class="num selected-month ">R\$\s0,00<\/td>/,'zero sem sinal e sem cor');
 assert.match(linha(t,'Caixa da operação (FCO)'),/^<th scope="row">Caixa da operação \(FCO\)<\/th><td class="num  "><span class="muted"/,'janeiro sem dados é —');
 assert.ok(h.indexOf('metric-param')<h.indexOf('g-empilhadas')&&h.indexOf('g-empilhadas')<h.indexOf('De onde vem cada bloco')&&h.indexOf('De onde vem cada bloco')<h.indexOf('Fluxo de caixa mês a mês'));
});
// Decisão de 13/10 (C3 e C8): o mês parcial mantém a cor do sentido; só setas, Δ e ritmo ficam neutros.
test('mês em andamento ou incompleto: marcado, com a cor do sentido (também no acumulado), hachurado nos gráficos e com * na tabela',()=>{
 const out=context({periodo:'Out/2026',saldos:{'2026-09':1000}}).run('renderDFC()');
 assert.equal((out.match(/coletado até 08\/10 \(mês em andamento\)/g)||[]).length,5,'4 cards e o quadro de contas');
 assert.deepEqual([...out.matchAll(/<div class="metric metric-param"><span class="label">[^<]*<\/span><strong class="([^"]*)">([^<]*)/g)].map(m=>m[1]+'|'+m[2].replace(/\s/g,' ')),['tom-entra|R$ 2.200,00','tom-sai|−R$ 700,00','|R$ 0,00','tom-entra|R$ 3.870,00'],'FCI com valor em vermelho; FCF zero sem cor');
 assert.match(out,/data-dica="Out\*\nOperação \(FCO\): parcial, fora do gráfico\nInvestimento \(FCI\): parcial, fora do gráfico\nFinanciamento \(FCF\): parcial, fora do gráfico"/,'v135 (D11): mês parcial fora do gráfico, dito na dica');
 const g=(a,b)=>out.slice(out.indexOf(a),b?out.indexOf(b):undefined);for(const x of [g('A operação se paga','Quanto sobrou'),g('Quanto sobrou','De onde vem cada bloco')])assert.match(x,/data-dica="Out\*\nparcial, fora do gráfico"/,'v135 (D11): parcial é diferente de sem dado');
 const qo=out.slice(out.indexOf('dfc-contas'),out.indexOf('</details>',out.indexOf('dfc-contas')));assert.match(qo,/<td class="num tom-entra">R\$\s3\.000,00<\/td>/,'contas do mês parcial com cor');assert.match(qo,/<td class="num tom-sai">[−-]R\$\s800,00<\/td>/,'contas do mês parcial com cor');assert.match(qo,/contas do plano em Out\/2026 · coletado até 08\/10 \(mês em andamento\)/);
 const t=tabela(out);assert.match(t,/<th scope="col" class="num selected-month">Out\/2026 \*<\/th>/);assert.match(t,/<th scope="col" class="num">Acumulado até Out \*<\/th>/);
 assert.match(linha(t,'Caixa da operação (FCO)'),/<td class="num selected-month tom-entra"><button type="button" class="cfo-value" data-dfc-ir="fco" data-periodo="Out\/2026"[^>]*>R\$\s2\.200,00<\/button><\/td>/,'coluna do mês em andamento com cor');
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
 assert.match(h,/Caixa da operação \(FCO\) · <span class="tom-entra">R\$\s3\.305,00<\/span><\/th>/);assert.match(h,/Investimentos \(FCI\) · <span class="tom-sai">[−-]R\$\s700,00<\/span><\/th>/);assert.match(h,/Financiamentos \(FCF\) · <span class="tom-sai">[−-]R\$\s400,00<\/span><\/th>/);
 const g2=h.slice(h.indexOf('A operação se paga'),h.indexOf('Quanto sobrou'));assert.match(g2,/g-cor-resultado/);assert.doesNotMatch(g2,/g-cor-marca/);
 c.run('cardAttrs=undefined');assert.match(c.run('renderDFC()'),/<details class="card dfc-mensal"><summary>/,'sem cardAttrs (fora do app), o cartão continua fechado');
 c.run("cardAttrs=(t,aberto=true)=>`data-card=\"dfc:${t}\"`+(aberto?' open':'')");const k=c.run('renderDFC()');
 assert.match(k,/<details class="card dfc-mensal" data-card="dfc:Fluxo de caixa mês a mês"><summary>/);assert.match(k,/<details class="card dfc-contas" id="secao-dfc-contas" data-card="dfc:De onde vem cada bloco"><summary>/);
 c.run("cardAttrs=(t,aberto=true)=>`data-card=\"dfc:${t}\"`+(t==='Fluxo de caixa mês a mês'?' open':'')");assert.match(c.run('renderDFC()'),/<details class="card dfc-mensal" data-card="dfc:Fluxo de caixa mês a mês" open><summary>/,'aberto antes, aberto de novo');
});
// D1: ao abrir a tabela, a rolagem para no início de uma coluna; nenhuma fica pela metade atrás da coluna fixa.
test('rolagem da tabela: começa numa coluna inteira, também perto do fim do ano',()=>{
 const c=context(),h=[];c.document.addEventListener=(t,f)=>h.push([t,f]);c.run('wireDFC()');const toggle=h.find(x=>x[0]==='toggle')[1];
 // coluna fixa de 200 px e 13 colunas de 120 px; área visível de 700 px (rolagem máxima 1060)
 const ths=[{offsetLeft:0,offsetWidth:200},...Array.from({length:13},(_,i)=>({offsetLeft:200+i*120,offsetWidth:120}))];
 const abre=sel=>{const wrap={scrollLeft:-1,scrollWidth:200+13*120,clientWidth:700,querySelector:s=>s==='thead .selected-month'?ths[sel+1]:null,querySelectorAll:()=>ths};toggle({target:{open:true,matches:s=>s==='details.card',querySelector:()=>wrap}});return wrap.scrollLeft;};
 assert.equal(abre(4),480,'Mai: começa na coluna de maio');assert.equal(abre(0),0);
 const fim=abre(11);assert.ok(fim<=1060&&fim%120===0,`Dez: para no início de uma coluna (${fim})`);assert.equal(fim,960);
});
// v135 · N11: a célula do bloco (com contas no mês) leva às contas do bloco naquele mês.
test('célula de bloco com contas é um botão que vai ao mês e abre as contas do bloco',()=>{
 const c=context({saldos:{'2026-08':5000}}),h=c.run('renderDFC()'),t=tabela(h);
 assert.match(td(linha(t,'Caixa da operação (FCO)'),8)[2],/^<button type="button" class="cfo-value" data-dfc-ir="fco" data-periodo="Set\/2026" aria-label="Caixa da operação \(FCO\) em Set\/2026: R\$\s3\.140,00\. Ver as contas">R\$\s3\.140,00<\/button>$/);
 assert.match(td(linha(t,'Investimentos (FCI)'),7)[2],/data-dfc-ir="fci" data-periodo="Ago\/2026"/);assert.match(td(linha(t,'Financiamentos (FCF)'),8)[2],/data-dfc-ir="fcf" data-periodo="Set\/2026"/);
 assert.doesNotMatch(td(linha(t,'Caixa da operação (FCO)'),0)[2],/<button/,'mês sem dados não tem botão');assert.doesNotMatch(td(linha(t,'Caixa da operação (FCO)'),12)[2],/<button/,'acumulado não tem botão');
 assert.doesNotMatch(td(linha(t,'Financiamentos (FCF)'),9)[2],/<button/,'Out sem conta de financiamento: sem botão');
 assert.doesNotMatch(linha(t,'(+) Recebimentos de vendas')+linha(t,'(=) Saldo final'),/data-dfc-ir/,'só as linhas de bloco');
 for(const b of ['fco','fci','fcf'])assert.match(h,new RegExp(`<tbody data-dfc-bloco="${b}"><tr class="dre-composicao-grupo">`));
 // clique: selecionarPeriodo, abre "De onde vem cada bloco" e rola até o tbody do bloco
 const ev=[];c.document.addEventListener=(t,f)=>ev.push([t,f]);c.document.getElementById=()=>null;c.run('wireDFC()');const click=ev.find(x=>x[0]==='click')[1];
 const tb={scrollIntoView:o=>c.__rolou=o},det={open:false,querySelector:s=>{c.__sel=s;return tb;}};c.document.querySelector=s=>s==='.dfc-contas'?det:null;
 c.run("__ir=[];selecionarPeriodo=l=>__ir.push(l)");
 click({target:{closest:s=>s==='[data-dfc-ir]'?{dataset:{dfcIr:'fci',periodo:'Ago/2026'}}:null}});
 assert.deepEqual(c.json('__ir'),['Ago/2026']);assert.equal(det.open,true);assert.equal(c.__sel,'tbody[data-dfc-bloco="fci"]');assert.deepEqual({...c.__rolou},{block:'start'});
 click({target:{closest:()=>null}});click({target:{closest:s=>s==='[data-dfc-ir]'?{dataset:{dfcIr:'x"]',periodo:'Ago/2026'}}:null}});assert.deepEqual(c.json('__ir'),['Ago/2026'],'só bloco conhecido');
});
// v135 · N14: saldo inicial informado leva a Parâmetros no mês.
test('saldo inicial informado: link para Parâmetros no mês; calculado, sem link',()=>{
 assert.match(context({saldos:{'2026-09':1000}}).run('renderDFC()'),/<\/div><p class="hint"><button type="button" class="text-button" data-go="parametros" data-rec-mes="Set\/2026">Saldo inicial informado em Parâmetros →<\/button><\/p>/);
 assert.doesNotMatch(context({saldos:{'2026-08':5000}}).run('renderDFC()'),/data-rec-mes/,'Set calculado a partir de Ago');
});
// v135 · I16: o Ano diz até onde soma e qual mês está em andamento.
test('Ano: a nota diz "somado de janeiro a" e o mês em andamento',()=>{
 const c=context({periodo:'Out/2026'});c.run("state.anoTodo=true");const h=c.run('renderDFC()');
 assert.match(h,/2026 somado de janeiro a Out, com Out\/2026 em andamento\. As contas de cada bloco são mostradas por mês/);assert.doesNotMatch(h,/inteiro, de janeiro|inteiro: de janeiro/);
 const f=context({periodo:'Set/2026',registros:REGISTROS.slice(0,2)});f.run("state.anoTodo=true");assert.match(f.run('renderDFC()'),/2026 somado de janeiro a Set\. As contas/,'sem mês parcial, sem ressalva');
});
// v135 · N10: qualquer cartão de meses (DRE Simples, Balanço…) abre no mês escolhido, também quando já nasce aberto.
test('rolagem até o mês: vale para qualquer details.card com o mês no cabeçalho, também depois do render',()=>{
 const c=context(),ev=[];let obs=null;c.document.addEventListener=(t,f)=>ev.push([t,f]);
 const ths=[{offsetLeft:0,offsetWidth:200},...Array.from({length:13},(_,i)=>({offsetLeft:200+i*120,offsetWidth:120}))];
 const card=(sel,{open=true,ehCard=true,mes=true}={})=>{const wrap={scrollLeft:-1,scrollWidth:200+13*120,clientWidth:700,querySelector:s=>s==='thead .selected-month'&&mes?ths[sel+1]:null,querySelectorAll:()=>ths};return {wrap,open,matches:s=>ehCard&&s==='details.card',querySelector:s=>s==='.table-scroll'?wrap:null};};
 const pc={querySelectorAll:s=>s==='details.card[open]'?[c.__a,c.__b]:[]};c.document.getElementById=id=>id==='pageContent'?pc:null;
 c.MutationObserver=function(fn){this.observe=(alvo,o)=>{obs={fn,alvo,o};};};c.run('wireDFC()');
 const toggle=ev.find(x=>x[0]==='toggle')[1];
 const bal=card(4);toggle({target:bal});assert.equal(bal.wrap.scrollLeft,480,'Balanço mês a mês (sem dfc-mensal) também rola');
 for(const x of [card(4,{open:false}),card(4,{ehCard:false}),card(4,{mes:false})]){toggle({target:x});assert.equal(x.wrap.scrollLeft,-1);}
 assert.equal(obs.alvo,pc);assert.deepEqual({...obs.o},{childList:true});
 c.__a=card(11);c.__b=card(0);obs.fn();assert.equal(c.__a.wrap.scrollLeft,960,'cartão que nasce aberto rola depois do render');assert.equal(c.__b.wrap.scrollLeft,0);
 assert.equal(c.run('typeof rolarAteMesSelecionado'),'function');
});

// Contrato do Ano (PLANO-ANO §2), só quando o app ou graficos.js ainda não o trazem.
const STUB_ANO=`(()=>{const g=globalThis,T=['inicio','cfo','dre','caixa','resultado','custos','detalhe','conferencia','dfc','balanco','precos','parametros','indicadores'];
if(typeof telaNoAno!=='function')g.telaNoAno=()=>!!state.anoTodo&&T.includes(state.view);
if(typeof anoDaTela!=='function')g.anoDaTela=()=>Number(String(state.periodo).split('/')[1])||null;
if(typeof TEXTO_SEM_ANO_COMPARADO==='undefined')g.TEXTO_SEM_ANO_COMPARADO='Sem comparação: escolha um ano em “Comparar com”, no topo.';
if(typeof textoSemMesesComparaveis!=='function')g.textoSemMesesComparaveis=(a,b)=>'Sem meses completos, da mesma base e com plano de contas em '+a+' e '+b+' para comparar.';
if(typeof rotuloMesesAno!=='function')g.rotuloMesesAno=ix=>{if(ix.length===12)return 'ano inteiro';const f=[];for(const i of ix){const u=f[f.length-1];if(u&&i===u[1]+1)u[1]=i;else f.push([i,i]);}const t=f.map(([a,b])=>a===b?PT_MON[a]:PT_MON[a]+' a '+PT_MON[b]);return t.length>1?t.slice(0,-1).join(', ')+' e '+t[t.length-1]:t[0]||'';};
const regDe=l=>state.records.find(r=>monthSortKey(r.label)===monthSortKey(l))||null;
if(typeof rotuloAno!=='function')g.rotuloAno=(ano=anoDaTela())=>{const f=fimDoAno(ano),m=String(f).split('/')[0],r=regDe(f);return ano+' · '+(m==='Jan'?'Jan':'Jan a '+m)+(r&&F.qualidade(r).parcial?'*':'');};
if(typeof anosComparaveis!=='function')g.anosComparaveis=(ano=anoDaTela())=>[...new Set(state.records.map(r=>Number(String(r.label).split('/')[1])).filter(Boolean))].filter(y=>y!==Number(ano)).sort((a,b)=>b-a);
if(typeof anoPadraoComparado!=='function')g.anoPadraoComparado=(ano=anoDaTela())=>{const l=anosComparaveis(ano);return l.includes(ano-1)?ano-1:l.find(y=>y<ano)??null;};
if(typeof anoComparado!=='function')g.anoComparado=()=>{const v=state.anoComparar||'';if(v==='nenhum')return null;if(/^\\d{4}$/.test(v)&&anosComparaveis().includes(Number(v)))return Number(v);return anoPadraoComparado();};
if(typeof mesesComparaveisAno!=='function')g.mesesComparaveisAno=(a,b)=>PT_MON.map((m,i)=>i).filter(i=>{const x=regDe(PT_MON[i]+'/'+a),y=regDe(PT_MON[i]+'/'+b);if(!x||!y)return false;const ok=r=>F.periodo(r.label).ate<dfcHoje()&&!F.qualidade(r).parcial&&!((DRESimples.apurar(r)?.pctSemConta??0)>10);return ok(x)&&ok(y)&&F.comparavelComRessalva(x,y).pode;});
if(typeof registroDoAno!=='function')g.registroDoAno=(ano,ix=null)=>{const f=fimDoAno(ano),ate=PT_MON.indexOf(String(f).split('/')[0]),idx=ix||PT_MON.slice(0,ate+1).map((m,i)=>i),ls=idx.map(i=>PT_MON[i]+'/'+ano),regs=ls.map(regDe),faltam=ls.filter((l,i)=>!regs[i]);
 if(faltam.length)return {disponivel:false,faltam,motivo:faltam.join(', ')+' sem dados coletados: sem todos os meses, o acumulado de '+ano+' não é somado.',meses:ls,parcial:false};
 const cod=new Map();for(const r of regs)for(const c of r.cells||[]){const k=cod.get(c.code)||{code:c.code,name:c.name,v:0};k.v+=Math.round(Number(c.value)*100);k.name=c.name;cod.set(c.code,k);}
 const parcial=regs.some(r=>F.qualidade(r).parcial),r0=regs[regs.length-1];
 const reg={id:'ano_'+ano,label:String(ano),rotulo:ix?ano+' · '+rotuloMesesAno(ix):rotuloAno(ano),ano:{meses:ls,parcial,ressalva:false},company:r0.company,basis:r0.basis,origem:r0.origem,qualidade:{...r0.qualidade,estado:'ano'},cells:[...cod.values()].sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})).map(k=>({code:k.code,name:k.name,value:k.v/100})),pendencias:regs.flatMap(r=>(r.pendencias||[]).map(p=>({...p,mes:r.label}))),eventos:[]};
 return {disponivel:true,reg,motivo:'',faltam:[],meses:ls,parcial};};
if(typeof comparacaoDoAno!=='function')g.comparacaoDoAno=(ano=anoDaTela(),anoComp=anoComparado())=>{if(anoComp==null)return {ano,anoComp,indices:[],meses:'',atual:null,anterior:null,ressalva:false,motivo:TEXTO_SEM_ANO_COMPARADO};const indices=mesesComparaveisAno(ano,anoComp);if(!indices.length)return {ano,anoComp,indices,meses:'',atual:null,anterior:null,ressalva:false,motivo:textoSemMesesComparaveis(ano,anoComp)};return {ano,anoComp,indices,meses:rotuloMesesAno(indices),atual:registroDoAno(ano,indices).reg,anterior:registroDoAno(anoComp,indices).reg,ressalva:false,motivo:''};};
if(typeof compLinhaAno!=='function')g.compLinhaAno=(rotulo,anterior,delta,dir,{tomAnterior='',motivo='',atual=null,rotuloAtual='',formato=money,unidade=''}={})=>anterior==null?'<span class="comp-ano">'+esc(rotulo)+': '+esc(motivo)+'</span>':'<span class="comp-ano">'+esc(rotulo)+': <span class="'+tomAnterior+'">'+formato(anterior)+'</span>'+(rotuloAtual?' · '+esc(rotuloAtual)+': '+formato(atual):'')+' · <b class="'+(tomDelta(dir,delta)||'delta-neutro')+'">'+(delta>0?'▲':delta<0?'▼':'■')+' '+formato(Math.abs(delta))+unidade+(delta>0?' a mais':delta<0?' a menos':'')+'</b></span>';
})()`;
// Ano contra ano (PLANO-ANO §2.6 e §4.4): 2024 e 2025 completos, 2026 de Jan a Ago fechados e Set em andamento, hoje 22/09/2026.
function contextoAno({registros,saldos={},view='dfc',anoComparar=''}={}){
 const regs=registros||[...seq(12,[2024,0],SET),...seq(12,[2025,0],TODAS),...seq(8,[2026,0]),reg('Set/2026','2026-09-15',OUT)];
 const c=context({registros:regs,saldos,periodo:'Set/2026'});
 c.run(`dfcHoje=()=>'2026-09-22';state.view=${JSON.stringify(view)};state.anoTodo=true;state.anoComparar=${JSON.stringify(anoComparar)};`);c.run(STUB_ANO);return c;
}
const centavos=v=>Math.round(v*100);
test('Ano: dfcComparacaoAno soma em centavos os mesmos meses dos dois anos; mês sem dados deixa a linha sem valor',()=>{
 const c=contextoAno({saldos:{'2025-01':1000,'2026-01':5000}}),ix=[0,1,2,3,4,5,6,7];
 const r=c.json(`dfcComparacaoAno(2026,2025,${JSON.stringify(ix)})`);
 assert.deepEqual(Object.keys(r.linhas),c.json(`DFC_LINHAS.filter(l=>!['saldoInicial','ajustes','saldoFinal'].includes(l.id)).map(l=>l.id)`),'todas as linhas menos os saldos');
 for(const id of Object.keys(r.linhas)){
  const soma=y=>c.json(`${JSON.stringify(ix)}.reduce((t,i)=>t+Math.round(dfcValorLinha(dfcMes(PT_MON[i]+'/${y}'),null,'${id}')*100),0)`);
  assert.equal(centavos(r.linhas[id].atual),soma(2026),id+' 2026');assert.equal(centavos(r.linhas[id].anterior),soma(2025),id+' 2025');
  assert.equal(centavos(r.linhas[id].delta),soma(2026)-soma(2025),id+' Δ');
 }
 assert.equal(r.linhas.vendas.atual,80000);assert.equal(r.linhas.das.atual,-6400,'saída com o sinal do caixa');
 for(const k of ['atual','anterior'])assert.equal(centavos(r.linhas.geracao[k]),centavos(r.linhas.fco[k])+centavos(r.linhas.fci[k])+centavos(r.linhas.fcf[k]),'geração = FCO + FCI + FCF ('+k+')');
 assert.deepEqual(r.saldo,{mes:'Ago',atual:5000+8*1370,anterior:1000+8*2205,delta:5000+8*1370-(1000+8*2205)},'saldo final no fim de Ago dos dois anos');
 assert.deepEqual(c.json('dfcComparacaoAno(2026,2025,[])').saldo,null);
 // Mar/2025 sem registro: as linhas de 2025 ficam sem valor (nunca zero) e sem Δ
 const sem=contextoAno({registros:[...seq(2,[2025,0],TODAS),...seq(9,[2025,3],TODAS),...seq(8,[2026,0])]}),s=sem.json(`dfcComparacaoAno(2026,2025,${JSON.stringify(ix)})`);
 assert.equal(s.linhas.fco.anterior,null);assert.equal(s.linhas.fco.delta,null);assert.equal(s.linhas.fco.atual,8*3140);
 assert.equal(sem.json(`dfcComparacaoAno(2026,null,[0])`).linhas.fco.anterior,null,'sem ano comparado, sem valor anterior');
 assert.deepEqual(c.json('DFC_DIR_ANO'),{fco:1,vendas:1,receitasFinanceiras:1,aIdentificar:1,foraOutras:1,das:1,impostosVendas:1,devolucoes:1,variaveis:1,fixas:1,despesasFinanceiras:1,semDetalhamento:1,fci:0,investimentos:0,fcf:0,emprestimos:0,parcelamentoDAS:0,dividasOutras:0,socios:0,transferencias:0,geracao:1});
});
test('Ano: dfcBlocosAno soma os blocos de janeiro ao último mês, marca o mês em andamento e para quando falta mês',()=>{
 const c=contextoAno(),b=c.json('dfcBlocosAno(2026)'),h=b.operacao+b.outros;
 assert.equal(b.andamento,' · inclui Set/2026 (mês em andamento)');assert.equal(b.m.label,'Set/2026');
 const tela=id=>{const m=h.match(new RegExp(`data-dfc-linha="${id}"><span>([^<]*)</span><b class="([^"]*)">([^<]*)</b>`));return m&&{nome:m[1],tom:m[2],texto:m[3]};};
 for(const id of [...c.json('DFC_ITENS.map(i=>i.id)'),'fco','fci','fcf','geracao'])assert.equal(tela(id).texto,c.run(`money(dfcAcumulado(PT_MON.map(x=>dfcMes(x+'/2026')),[],8,'${id}'))`),id);
 assert.equal(tela('geracao').nome,'(=) Geração de caixa do ano');assert.equal(tela('geracao').texto,c.run(`money(${8*1370+1500})`));assert.equal(tela('fcf').tom,'tom-sai');assert.equal(tela('vendas').tom,'tom-entra');
 const g=c.json(`['fco','fci','fcf','geracao'].map(id=>dfcAcumulado(PT_MON.map(x=>dfcMes(x+'/2026')),[],8,id))`);assert.equal(centavos(g[3]),centavos(g[0])+centavos(g[1])+centavos(g[2]),'geração = FCO + FCI + FCF');
 assert.equal(b.vendas,8*10000+3000);assert.match(b.rodape,/igual a entradas menos saídas do ERP de janeiro a Set de 2026\./);assert.match(b.rodape,/data-go="dfc"/);
 const f=contextoAno({registros:[...seq(2,[2026,0]),...seq(4,[2026,3])]}).json('dfcBlocosAno(2026)');
 assert.deepEqual(f.faltam,['Mar/2026']);assert.equal(f.motivo,'Mar/2026 sem dados coletados: sem todos os meses, o acumulado de 2026 não é somado.');assert.equal(f.operacao,undefined);
});
test('Ano no Fluxo de caixa: cada cartão com o ano comparado nos mesmos meses e a tabela ano contra ano sem saldos',()=>{
 const c=contextoAno({saldos:{'2025-01':1000,'2026-01':5000}}),h=c.run('renderDFC()');
 const cards=[...h.matchAll(/<div class="metric metric-param"><span class="label">([^<]*)<\/span><strong[^>]*>[^<]*<\/strong><small>[^<]*<\/small>(<span class="comp-ano">[\s\S]*?<\/span>)?<\/div>/g)].map(m=>[m[1],m[2]||'']);
 assert.deepEqual(cards.map(x=>x[0]),['Caixa da operação (FCO) · 2026','Investimentos (FCI) · 2026','Financiamentos (FCF) · 2026','Saldo final · Set/2026'],'o que o cartão mostrava continua');
 assert.ok(cards.every(x=>x[1].startsWith('<span class="comp-ano">')),'linha de comparação depois do </small> em cada cartão');
 assert.match(cards[0][1],/^<span class="comp-ano">2025 · Jan a Ago: <span class="tom-entra">R\$\s26\.440,00<\/span> · 2026 nesses meses: <span class=\"tom-entra\">R\$\s25\.120,00<\/span> · <b class="delta-ruim">▼ R\$\s1\.320,00 a menos<\/b><\/span>$/,'FCO caiu: ruim');
 assert.match(cards[1][1],/<b class="delta-neutro">■ R\$\s0,00<\/b>/,'investimento sem cor de bom ou ruim');assert.match(cards[2][1],/<b class="delta-neutro">▼ R\$\s5\.360,00 a menos<\/b>/);
 assert.match(cards[3][1],/^<span class="comp-ano">Fim de Ago\/2025: <span class="tom-entra">R\$\s18\.640,00<\/span> · Fim de Ago\/2026: <span class=\"tom-entra\">R\$\s15\.960,00<\/span> · <b class="delta-ruim">▼ R\$\s2\.680,00 a menos<\/b><\/span>$/);
 const t=h.slice(h.indexOf('Fluxo de caixa · 2026 contra 2025 nos mesmos meses (Jan a Ago)'));assert.ok(t.length>0&&h.indexOf('Quanto sobrou')<h.indexOf('Fluxo de caixa · 2026 contra 2025'),'cartão depois dos gráficos');
 const tab=t.slice(0,t.indexOf('</table>'));assert.match(tab,/<table class="tabela-controle tabela-ano">/);assert.match(tab,/<th scope="col">Linha<\/th><th scope="col" class="num">2026<\/th><th scope="col" class="num">2025<\/th><th scope="col" class="num">Δ<\/th>/);
 assert.doesNotMatch(tab,/Saldo inicial|Saldo final|Ajuste de saldo/,'sem as linhas de saldo');
 const col=(n,i)=>num(td(linha(tab,n),i)[2]);assert.equal(centavos(col('(=) Geração de caixa do mês',0)),centavos(col('Caixa da operação (FCO)',0))+centavos(col('Investimentos (FCI)',0))+centavos(col('Financiamentos (FCF)',0)),'geração 2026 = FCO + FCI + FCF');
 assert.equal(td(linha(tab,'(−) Simples do mês (DAS e DARF)'),2)[1],'num delta-neutro','DAS igual nos dois anos: ■');assert.equal(td(linha(tab,'(+) Recebimentos de vendas'),0)[1],'num tom-entra');assert.equal(td(linha(tab,'(−) Retiradas e arrendamento'),1)[1],'num tom-sai');
 assert.equal(td(linha(tab,'Caixa da operação (FCO)'),2)[1],'num delta-ruim');assert.equal(td(linha(tab,'(−) Retiradas e arrendamento'),2)[1],'num delta-neutro','sócios: sem bom nem ruim');
 // outro ano escolhido em "Comparar com": todo rótulo diz 2024
 const c24=contextoAno({anoComparar:'2024'}).run('renderDFC()');assert.match(c24,/2024 · Jan a Ago: /);assert.match(c24,/Fluxo de caixa · 2026 contra 2024 nos mesmos meses \(Jan a Ago\)/);assert.doesNotMatch(c24,/2025 · Jan a Ago|contra 2025/);
 // Sem comparação: uma linha só, no primeiro cartão, e o cartão da tabela com o motivo
 const n=contextoAno({anoComparar:'nenhum'}).run('renderDFC()');
 assert.equal((n.match(/class="comp-ano"/g)||[]).length,1);assert.match(n,/Caixa da operação \(FCO\) · 2026[\s\S]*?<\/small><span class="comp-ano">Comparação: escolha um ano em “Comparar com”, no topo\.<\/span><\/div>/);
 assert.match(n,/<h2 class="card-titulo">Comparação · 2026<\/h2><\/summary><div class="card-body"><p class="hint">Sem comparação: escolha um ano em “Comparar com”, no topo\.<\/p>/);assert.doesNotMatch(n,/tabela-ano/);
 // Ano comparado sem meses completos em comum: o motivo do contrato
 const s=contextoAno({registros:[...seq(3,[2025,9],TODAS),...seq(8,[2026,0])]}).run('renderDFC()');assert.match(s,/Comparação: Sem meses completos, da mesma base e com plano de contas em 2026 e 2025 para comparar\./);
 // fora do Ano, nada muda
 const m=context({saldos:{'2026-08':5000}}).run('renderDFC()');assert.doesNotMatch(m,/comp-ano|tabela-ano/);
});
// Anos futuros entram sozinhos: na virada (15/01/2027, Jan/2027 parcial), o Ano de 2027 funciona e compara com 2026.
test('Ano na virada: 2027 com Jan em andamento, sem ano escrito no código',()=>{
 const c=contextoAno({registros:[...seq(12,[2025,0],TODAS),...seq(12,[2026,0]),reg('Jan/2027','2027-01-14',OUT)]});c.run("dfcHoje=()=>'2027-01-15';state.periodo='Jan/2027'");
 const b=c.json('dfcBlocosAno(2027)');assert.equal(b.andamento,' · inclui Jan/2027 (mês em andamento)');assert.match(b.outros,/data-dfc-linha="geracao"><span>\(=\) Geração de caixa do ano<\/span><b class="tom-entra">R\$\s1\.500,00<\/b>/);
 const h=c.run('renderDFC()');assert.match(h,/Caixa da operação \(FCO\) · 2027/);assert.match(h,/Comparação: Sem meses completos, da mesma base e com plano de contas em 2027 e 2026 para comparar\./,'Jan/2027 ainda corre: nada a comparar');
 c.run("dfcHoje=()=>'2027-02-10';state.records.find(r=>r.label==='Jan/2027').qualidade.ate='2027-01-31'");
 assert.match(c.run('renderDFC()'),/2026 · Jan: <span class="tom-entra">R\$\s3\.140,00<\/span> · <b class="delta-ruim">▼ R\$\s940,00 a menos<\/b>/,'Jan/2027 fechado: compara com Jan/2026');
 for(const f of ['dfcComparacaoAno','dfcBlocosAno','dfcCartoesAno','dfcTabelaAno','dfcComparacaoDoAno'])assert.doesNotMatch(c.run(`String(${f})`),/\b(19|20)\d\d\b/,f+' sem ano escrito');
});
