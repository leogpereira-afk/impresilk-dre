// Telas antigas de caixa (v109): os blocos de operação, investimento e financiamento
// do Caixa, da Composição do caixa e do gráfico blocosDoCaixa saem da DFC (dfcApurar,
// que sai da DRE Simples). No mesmo registro, os números têm de ser os mesmos da DFC.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
const q=ate=>({ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'});
const reg=(label,ate,cells)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:q(ate),cells});
// SET, com as contas que a regra antiga (F.resumo) classificava diferente da DFC:
// vendas 10.000; rendimentos 20; empréstimo recebido 2.000; a identificar 50;
// parcelamento do DAS 300 (financiamento); DAS 600 e DARF 200 (Simples do mês, operação);
// ICMS/DIFAL 100 e manutenção de máquina 150 (custo variável); compra de máquina 700 e
// investimento 500 (investimento); tarifa 80 (operação); antecipação 400, empréstimo
// bancário 900 e empréstimo de terceiros dentro de Investimentos 250 (financiamento);
// retiradas 1.000 e transferência 200 (financiamento); sem detalhamento 70 (operação).
const SET=[cel('1','Receitas',12070),cel('1.1.1','Produtos',10000),cel('1.3.2','Juros',20),cel('1.4.2','Empréstimo',2000),cel('1.7','A identificar',50),
 cel('2','Despesas',6950),cel('2.1.4','Salário',1500),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.2','DAS Impresilk',600),cel('2.4.2','ICMS',100),cel('2.4.3.1','DARF Impresilk',200),
 cel('2.6.1','Aquisição',700),cel('2.6.3','Manutenção',150),cel('2.13.1','Tarifa de boletos',80),cel('2.13.6','Antecipação',400),cel('2.13.7','Empréstimos Bancários',900),
 cel('2.14.2','Retiradas',1000),cel('2.16.1','Investimento',500),cel('2.16.51','Empréstimo de terceiros',250),cel('2.18','Transferência',200),cel('2.99','Sem detalhamento',70)];
const OUT=[cel('1','Receitas',3000),cel('1.1.1','Produtos',3000),cel('2','Despesas',1100),cel('2.4.1.2','DAS Impresilk',800),cel('2.14.2','Retiradas',300)];
const REGISTROS=[reg('Ago/2026','2026-08-31',SET),reg('Set/2026','2026-09-30',SET),reg('Out/2026','2026-10-08',OUT)];
function context({periodo='Set/2026',registros=REGISTROS}={}){
 const c={structuredClone,document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,getElementById:()=>null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=structuredClone(registros);
 c.run(`state.records=__r;state.cfg={};state.periodo=${JSON.stringify(periodo)};state.permissoes={leitura:true,edicao:true,admin:true}`);return c;
}
// Valor e cor de uma linha do quadro (data-dfc-linha), como a tela mostra.
const linhaTela=(h,id)=>{const m=h.match(new RegExp(`data-dfc-linha="${id}"><span>[^<]*</span><b class="([^"]*)">([^<]*)</b>`));return m?{tom:m[1],texto:m[2]}:null;};
const ITENS=c=>c.json('DFC_ITENS.map(i=>i.id)');
const BLOCOS=['fco','fci','fcf','geracao'];
const FCF=c=>c.json(`DFC_ITENS.filter(i=>i.bloco==='fcf').map(i=>i.id).concat('fcf')`);
// Linhas da tabela do gráfico: {Jan:[fco,fci,fcf], ...}
const tabelaGrafico=h=>Object.fromEntries([...h.matchAll(/<tr><th scope="row">([^<]+)<\/th>((?:<td[^>]*>[^<]*<\/td>)+)<\/tr>/g)].map(m=>[m[1],[...m[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(x=>x[1])]));

test('Caixa e Composição do caixa mostram os mesmos blocos e linhas da DFC, no centavo',()=>{
 const c=context(),d=c.json("dfcApurar(state.records.find(r=>r.label==='Set/2026'))");
 // trava a regra: parcelamento do DAS, dívidas, retiradas e transferências no financiamento;
 // máquina e investimento no investimento; DARF, ICMS, manutenção, tarifas e 2.99 na operação
 assert.equal(d.fco,7370,'10.070 de entradas − Simples 800 − variáveis 250 − salário 1.500 − tarifa 80 − sem detalhamento 70');
 assert.equal(d.fci,-1200,'máquina 700 + investimento 500');
 assert.equal(d.fcf,-1050,'+2.000 − parcelamento 300 − antecipação 400 − empréstimo 900 − terceiros 250 − retiradas 1.000 − transferência 200');
 assert.equal(d.geracao,5120);assert.equal(d.diferenca,0);
 for(const tela of ["renderCaixa(regAtual())","renderResultado(regAtual())"]){
  const h=c.run(tela);
  for(const id of [...ITENS(c),...BLOCOS]){
   const l=linhaTela(h,id),esperado=c.run(`money(dfcValorLinha(dfcMes('Set/2026'),null,${JSON.stringify(id)}))`);
   assert.ok(l,`${tela}: falta a linha ${id}`);assert.equal(l.texto,esperado,`${tela}: ${id} diferente da DFC`);
  }
  assert.match(h,/igual a entradas menos saídas do ERP em Set\/2026/);
  assert.match(h,/data-go="dfc"/,'leva às contas de cada bloco na DFC');
  // a regra antiga não aparece mais, nem o link para a decomposição antiga do CFO
  assert.doesNotMatch(h,/Pagamentos (da operação|classificados na operação)|Parcelas de ativos|Saldo antes dos demais grupos|Cartão \/ saídas sem detalhe/);
  assert.doesNotMatch(h.slice(h.indexOf('data-dfc-linha')),/data-cfo-account="(socios|dividas|investimentos|pagamentosOperacionais|parcelasAtivos)"/);
 }
});

test('o gráfico dos blocos de cada mês é o da DFC (FCO, FCI e FCF iguais a dfcApurar)',()=>{
 const c=context(),t=tabelaGrafico(c.run('blocosDoCaixa()'));
 for(const label of ['Ago/2026','Set/2026']){
  const esperado=c.json(`(()=>{const d=dfcApurar(state.records.find(r=>r.label===${JSON.stringify(label)}));return [d.fco,d.fci,d.fcf].map(GX.moeda);})()`);
  assert.deepEqual(t[label.slice(0,3)],esperado,`${label}: blocos do gráfico diferentes da DFC`);
 }
 // mês sem dado e mês em andamento: hachurados, nunca zero
 assert.deepEqual(t.Jul,['Não apurado','Não apurado','Não apurado']);
 assert.deepEqual(t['Out*'],['Não apurado','Não apurado','Não apurado'],'mês parcial com dado: hachurado e com *, como na DFC');
});

test('cada conta sensível cai no mesmo bloco na tela Caixa e na DFC',()=>{
 const casos={'2.4.1.1':'fcf','2.4.1.2':'fco','2.4.3':'fco','2.4.3.1':'fco','2.4.2':'fco','2.6.3':'fco','2.6.1':'fci','2.7.1':'fci',
  '2.13.1':'fco','2.13.5':'fco','2.13.6':'fcf','2.13.7':'fcf','2.13.7.1.1':'fci','2.14.2':'fcf','2.14.3':'fcf','2.16':'fci','2.16.51':'fcf','2.18':'fcf','2.99':'fco'};
 for(const [code,bloco] of Object.entries(casos)){
  const c=context({registros:[reg('Set/2026','2026-09-30',[cel('1','Receitas',1000),cel('1.1.1','Produtos',1000),cel('2','Despesas',100),cel(code,'Conta '+code,100)])]});
  const h=c.run('renderCaixa(regAtual())'),d=c.json('dfcApurar(regAtual())');
  const esperado={fco:bloco==='fco'?900:1000,fci:bloco==='fci'?-100:0,fcf:bloco==='fcf'?-100:0};
  assert.deepEqual({fco:d.fco,fci:d.fci,fcf:d.fcf},esperado,`${code}: bloco ${bloco} na DFC`);
  for(const b of ['fco','fci','fcf'])assert.equal(linhaTela(h,b).texto,c.run(`money(${esperado[b]})`),`${code}: ${b} na tela Caixa`);
 }
});

// Decisão de 13/10 (C3 e C8): a cor segue o sentido também no financiamento e no mês em andamento.
test('cores: entrada azul e saída vermelha, também no financiamento e no mês em andamento, que segue marcado',()=>{
 const c=context(),h=c.run('renderCaixa(regAtual())');
 assert.equal(linhaTela(h,'vendas').tom,'tom-entra');assert.equal(linhaTela(h,'das').tom,'tom-sai');
 assert.equal(linhaTela(h,'fco').tom,'tom-entra');assert.equal(linhaTela(h,'fci').tom,'tom-sai');
 for(const id of FCF(c))assert.equal(linhaTela(h,id).tom,id==='emprestimos'?'tom-entra':'tom-sai',`${id} é financiamento: cor pelo sentido`);
 assert.equal(linhaTela(h,'emprestimos').texto,c.run('money(2000)'),'empréstimo recebido aparece, em azul');
 // Out/2026 coletado até 08/10: mês em andamento
 c.run("state.periodo='Out/2026'");
 for(const tela of ["renderCaixa(regAtual())","renderResultado(regAtual())"]){
  const o=c.run(tela),blocos=o.slice(o.indexOf('data-dfc-linha'),o.lastIndexOf('data-dfc-linha')+200);
  // a mesma marca da DFC; vira "incompleto" quando o calendário passa de 31/10
  assert.match(o,/coletado (só )?até 08\/10 \(mês (em andamento|incompleto)\)/);
  assert.match(blocos,/tom-entra/,`${tela}: mês em andamento com cor`);assert.match(blocos,/tom-sai/,`${tela}: mês em andamento com cor`);
  assert.equal(linhaTela(o,'fco').texto,c.run('money(2200)'),'os valores aparecem com a cor do sentido');assert.equal(linhaTela(o,'fco').tom,'tom-entra');assert.equal(linhaTela(o,'socios').tom,'tom-sai','retiradas em vermelho no mês em andamento');
 }
 assert.match(c.run('renderCaixa(regAtual())').match(/Recebimentos de vendas: <b class="([^"]*)"/)[1],/tom-entra/,'v133: recebimento do mês em andamento também em azul');
});

test('mês sem dado nunca vira zero',()=>{
 const c=context();c.run("state.periodo='Jul/2026'");
 const h=c.run('renderCaixa(regAtual())');
 assert.doesNotMatch(h,/data-dfc-linha/);assert.match(h,/Este mês ainda não foi coletado/);
 assert.match(c.run('renderResultado(regAtual())'),/Selecione um período com dados/);
 // registro sem nenhuma conta válida: "não apurados", nunca R$ 0,00 nos blocos
 const v=context({registros:[reg('Set/2026','2026-09-30',[cel('1','Receitas',null),cel('2','Despesas','')])]});
 const hv=v.run('renderCaixa(regAtual())');
 assert.doesNotMatch(hv,/data-dfc-linha/);assert.match(hv,/não apurados em Set\/2026/);
 assert.match(v.run('renderResultado(regAtual())'),/não apurados em Set\/2026/);
 assert.match(context({registros:[]}).run('blocosDoCaixa()'),/Não há meses apurados neste ano/);
});
