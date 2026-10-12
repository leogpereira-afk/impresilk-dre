// Fase 11 (v119): uma regra só para o caixa. As rubricas antigas (F.resumo: "pagamentos da
// operação", "parcelas de ativos"…) saíram da tela, do PDF e da planilha; as linhas vêm da
// DRE Simples, que põe o parcelamento do DAS em dívidas e a compra de máquina em investimentos.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
// Mês com parcelamento do DAS (2.4.1.1) e compra de máquina (2.6.1): a regra antiga os
// punha nos "pagamentos da operação"; a DRE Simples, em dívidas e investimentos.
const mes=[cel('1','Receitas',10000),cel('1.1','Comunicação Visual',10000),cel('2','Despesas',9000),cel('2.4','Impostos',1500),cel('2.4.1','DAS',1500),cel('2.4.1.1','Parcelamento',500),cel('2.4.1.2','Impresilk',1000),cel('2.6','Máquinas',3000),cel('2.6.1','Compra de máquina',3000),cel('2.12','Materiais',4500)];
const reg=(label,ate)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:mes});
function app(){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout,Promise};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js','plano-contas.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=[reg('Jan/2026','2026-01-31'),reg('Fev/2026','2026-02-28')];
 c.run(`dfcHoje=()=>'2026-04-12';render=()=>{};state.records=__r;state.cfg={parametros:{}};state.view='dre';state.periodo='Fev/2026';state.comparar='Jan/2026';state.permissoes={leitura:true,edicao:true,admin:true};dreUI.base='caixa'`);return c;
}
const linha=(bloco,nome)=>bloco.linhas.find(l=>l[0]===nome);
test('PDF mensal e anual de caixa: as linhas da DRE Simples, com parcelamento em dívidas e máquina em investimentos',()=>{
 const c=app(),mensal=c.json(`relatorioCFO({tipo:'mensal',periodo:'Fev/2026',base:'caixa'})`);
 const comp=mensal.blocos.find(b=>b.titulo==='Mês e comparação · DRE Simples');assert.ok(comp,'tabela da DRE Simples');
 assert.match(linha(comp,'(−) Dívidas, parcelamento do DAS e antecipações')[1],/500,00/);
 assert.match(linha(comp,'(−) Investimentos e parcelas de ativos')[1],/3\.000,00/);
 assert.match(linha(comp,'(=) Variação do caixa no mês')[1],/1\.000,00/);
 assert.equal(JSON.stringify(mensal).includes('Pagamentos classificados na operação'),false,'sem rubrica antiga');
 const acum=mensal.blocos.find(b=>b.titulo==='Acumulado até Fev/2026');assert.match(linha(acum,'Receita bruta de vendas')[1],/20\.000,00/);
 const anual=c.json(`relatorioCFO({tipo:'anual',periodo:'Fev/2026',base:'caixa'})`),t1=anual.blocos.find(b=>b.titulo==='1º trimestre');
 assert.equal(t1.colunas[0],'Linha');assert.match(linha(t1,'(−) Simples do mês (DAS e DARF)')[1],/1\.000,00/);
 assert.match(linha(anual.blocos.find(b=>b.titulo==='Acumulado de janeiro até Fev/2026'),'(=) Resultado do mês, antes dos sócios')[1],/9\.000,00/);
});
test('PDF executivo: "DRE Simples, linha por linha"; tela: só entradas, saídas e variação no movimento de caixa',()=>{
 const c=app(),ex=c.json(`relatorioCFO({tipo:'executivo',periodo:'Fev/2026',base:'caixa'})`);
 const t=ex.blocos.find(b=>b.titulo==='DRE Simples, linha por linha');assert.ok(t);assert.equal(t.linhas.length,c.json('DRESimples.LINHAS.length'));
 assert.equal(ex.blocos.some(b=>b.titulo==='Regra gerencial, linha por linha'),false);
 const d=c.json('dadosDRE()');assert.deepEqual(d.linhas.map(x=>x.id),['entradas','saidas','variacao']);assert.equal(d.soma.variacao,2000);
 const tela=c.run('renderDRE()');assert.doesNotMatch(tela,/Abrir rubricas detalhadas/,'caixa não tem rubricas para abrir');assert.doesNotMatch(tela,/Entrou, saiu, sobrou/,'cascata antiga retirada');
});
