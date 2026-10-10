// DRE Simples (Fase 3): classificação das contas, apuração que fecha com o caixa,
// margens sobre as vendas, DAS da guia por competência e a tela nas duas bases.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
const q=ate=>({ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'});
// Set completo: vendas 10.000; DAS 600 (+ parcelamento 300); ICMS 100; devolução 50; variáveis 4.000
// (materiais 3.000 com 200 sem subconta, frete 500, comissão 500); fixas 2.820; financeiro +20 −80;
// retiradas 1.000; máquina comprada 700; empréstimo pago 900 (+ 300 parcelamento); empréstimo recebido 2.000.
const SET=[cel('1','Receitas',12020),cel('1.1','Comunicação Visual',8000),cel('1.1.1','Produtos',8000),cel('1.2','Portas/Painéis',2000),cel('1.3','Rendimentos',20),cel('1.3.2','Juros',20),cel('1.4','Empréstimos',2000),cel('1.4.2','Pessoal',2000),
 cel('2','Despesas',10550),cel('2.1','Despesas Funcionários',2000),cel('2.1.4','Salário',1500),cel('2.1.12','Comissão Interna',500),cel('2.2','Despesas Administrativas',250),cel('2.2.1','Material de Escritório',200),cel('2.2.6','Devolução Cliente',50),
 cel('2.4','Despesas Impostos',1000),cel('2.4.1','DAS',900),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.2','Impresilk',500),cel('2.4.1.3','Universo',100),cel('2.4.2','ICMS',100),
 cel('2.5','Despesas Fixas',800),cel('2.5.2','Aluguel lote',800),cel('2.6','Despesas Máquinas/Equipamentos',700),cel('2.6.1','Aquisição',700),cel('2.11','Terceirização de Serviços',500),cel('2.11.4','Frete',500),
 cel('2.12','Materiais e Insumos',3000),cel('2.12.1','Impressão',2800),cel('2.13','Despesas Bancárias',980),cel('2.13.1','Tarifa de boletos',80),cel('2.13.7','Empréstimos Bancários',900),cel('2.14','Despesas Societárias',1000),cel('2.14.2','Retiradas Leonardo',1000),cel('2.15','Despesas Publicitárias',320),cel('2.15.7','Meta',320)];
const troca=(cells,mudancas,extras=[])=>[...cells.map(c=>c.code in mudancas?{...c,value:mudancas[c.code]}:{...c}),...extras];
// Ago: aluguel 1.000 (as fixas caem R$ 200 em Set, o resultado sobe R$ 200)
const AGO=troca(SET,{'2':10750,'2.5':1000,'2.5.2':1000});
const reg=(label,ate,cells,extra={})=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:q(ate),cells,...extra});
const REGISTROS=[reg('Ago/2026','2026-08-31',AGO),reg('Set/2026','2026-09-30',SET),
 reg('Out/2026','2026-10-08',[cel('1','Receitas',3000),cel('1.1','Comunicação Visual',3000),cel('2','Despesas',700),cel('2.4','Despesas Impostos',700),cel('2.4.1','DAS',700),cel('2.4.1.2','Impresilk',580),cel('2.4.1.3','Universo',120)])];
function context({periodo='Set/2026',cfg={},registros=REGISTROS,comparar=''}={}){
 const els={},campo={value:'',focus(){}};const doc={addEventListener(){},getElementById:id=>els[id]||(els[id]={onclick:null,elements:{namedItem:()=>campo}}),querySelector:()=>null,querySelectorAll:()=>[]};
 const c={structuredClone,document:doc,localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,crypto:{randomUUID:()=>'r'},confirm:()=>{c.confirmou=(c.confirmou||0)+1;return false;}};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.set=(k,v)=>{c.__v=v;c.run(`${k}=__v`);};c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.els=els;c.campo=campo;
 c.set('state.records',structuredClone(registros));c.set('state.cfg',structuredClone(cfg));c.set('state.periodo',periodo);c.set('state.comparar',comparar);c.set('state.permissoes',{leitura:true,edicao:true,admin:true});
 c.run("dreUI.base='caixa';gestaoUI.dre='mes';toast=()=>{}");return c;
}
const apurar=(c,label='Set/2026')=>c.json(`(()=>{const a=DRESimples.apurar(state.records.find(r=>r.label===${JSON.stringify(label)}));return a&&{...a,pct:undefined}})()`);
const linhaTabela=(h,nome)=>{const i=h.indexOf(`<th scope="row">${nome}</th>`);return i<0?'':h.slice(i,h.indexOf('</tr>',i));};
// só a tabela de comparação (a cascata também tem uma tabela com os mesmos nomes)
const comparacao=h=>{const i=h.indexOf('dre-comparacao');return i<0?'':h.slice(i,h.indexOf('</table>',i));};
const VALORES={produtos:20000,servicos:0,outrasVendas:0,devolucoes:0,descontos:0,tributosVendas:500,custos:8000,despesasVendas:1000,administrativas:2000,outrasDespesas:0,outrasReceitas:0,equivalencia:0,receitasFinanceiras:0,despesasFinanceiras:100,descontinuadas:0,da:0};
const comp=(label,valores=VALORES,company='Impresilk + Universo')=>({label,company,fonte:'balancete',valores,estado:'parcial'});

test('cada conta cai na linha certa pela regra mais específica; o que não é despesa fica abaixo do resultado',()=>{
 const c=context(),k=code=>c.run(`DRESimples.classificar(${JSON.stringify(code)}).linha`),conf=code=>c.run(`DRESimples.classificar(${JSON.stringify(code)}).conferir`);
 const esperado={'1.1.1':'vendas','1.2.51':'vendas','1.5.2':'vendas','1.6.2':'vendas','1.3.2':'receitasFinanceiras','1.4.2':'emprestimos','1.7':'aIdentificar',
  '2.1.4':'pessoal','2.1.12':'variaveis','2.9.2':'pessoal','2.2.1':'administrativas','2.2.6':'devolucoes','2.8.3':'administrativas','2.8.5':'variaveis',
  '2.4.1.2':'das','2.4.1.3':'das','2.4.1.51':'das','2.4.1.1':'dividas','2.4.2':'impostosVendas','2.4.8':'impostosVendas','2.4.5.1':'taxas','2.4.6.2':'taxas','2.4.7':'despesasFinanceiras',
  '2.5.3':'ocupacao','2.3.2':'ocupacao','2.6.9':'maquinas','2.6.1':'investimentos','2.7.2':'veiculos','2.7.1':'investimentos','2.10.1':'variaveis','2.11.4':'variaveis','2.12.1':'variaveis',
  '2.12.11':'marketing','2.12.12':'marketing','2.12.51':'marketing','2.12.52':'marketing',
  '2.13.1':'despesasFinanceiras','2.13.5':'despesasFinanceiras','2.13.6':'dividas','2.13.7.1.3':'dividas','2.13.7.1.1':'investimentos','2.13.7.1.2':'investimentos','2.13.52':'semDetalhamento','2.13':'semDetalhamento','2.13.8':'semDetalhamento',
  '2.14.1.1':'socios','2.14.2':'socios','2.14.3':'dividas','2.14.3.4':'investimentos','2.15.7':'marketing','2.16.3':'investimentos','2.16.51':'dividas','2.17.3':'dividas','2.18':'transferencias','2.99':'semDetalhamento','2.20':'fixasOutras','1.8':'foraOutras'};
 for(const [code,linha] of Object.entries(esperado))assert.equal(k(code),linha,code);
 assert.equal(conf('2.4.1.51'),'DAS fora das subcontas da Impresilk e da Universo');assert.equal(conf('2.16.51'),'Empréstimo de terceiros dentro de Investimentos');
 for(const x of ['2.12.11','2.12.12','2.12.51','2.12.52'])assert.equal(conf(x),'Conta de marketing dentro de Materiais',x);
 assert.equal(conf('2.4'),'Imposto lançado sem subconta');assert.equal(conf('2.4.5.1'),'','IPTU não acende alarme');
 assert.match(conf('2.13.8'),/Bancária fora das subcontas de tarifa e juros/,'bancária nova não vira juros sem aviso');
 assert.match(conf('2.6.51'),/Conta nova ou renomeada no ERP/);assert.match(conf('2.7.51'),/Conta nova ou renomeada no ERP/);
 assert.equal(conf('2.1.51'),'','renomeada em Funcionários continua pessoal sem alarme');assert.equal(conf('2.6.3'),'','dúvida de todo mês vai em nota');
 assert.equal(conf('2.20'),'Saída sem linha na DRE');assert.match(conf('3.1'),/fora do plano/);
});
test('apuração: subtotais, resíduo da conta mãe e percentual sobre as vendas',()=>{
 const a=apurar(context()),l=a.linhas;
 assert.equal(l.vendas,10000);assert.equal(l.das,600);assert.equal(l.impostosVendas,100);assert.equal(l.devolucoes,50);assert.equal(l.receitaLiquida,9250);
 assert.equal(l.variaveis,4000,'materiais 3.000 (com 200 sem subconta) + frete 500 + comissão 500');assert.equal(l.margemContribuicao,5250);
 assert.equal(l.fixas,2820);assert.equal(l.ebitda,2430);assert.equal(l.receitasFinanceiras,20);assert.equal(l.despesasFinanceiras,80);assert.equal(l.resultado,2370);
 assert.equal(a.margens.margemContribuicao,52.5);assert.equal(a.margens.resultado,23.7);
 const mat=a.composicao.variaveis.find(x=>x.code==='2.12');assert.deepEqual([mat.valor,mat.residuo],[200,true]);
});
test('a DRE fecha com entradas menos saídas, e cada linha da ponte entra com o sinal certo',()=>{
 const a=apurar(context()),l=a.linhas;
 assert.equal(l.socios,1000);assert.equal(l.investimentos,700);assert.equal(l.dividas,1200);assert.equal(l.emprestimos,2000);assert.equal(a.caixa,1470);assert.equal(l.variacao,1470);assert.equal(a.diferenca,0);
 const extra=troca(SET,{'1':12210,'2':11550,'2.4':1050,'2.6':820},[cel('2.7','Despesas Veículos',300),cel('2.7.2','Combustível',300),cel('2.4.5','IPTU',50),cel('2.6.9','U.V',120),cel('2.20','Nova',30),cel('1.7','A identificar',150),cel('1.8','Nova entrada',40),cel('2.18','Transferência',500)]);
 const b=apurar(context({registros:[reg('Set/2026','2026-09-30',extra)]})),m=b.linhas;
 assert.deepEqual([m.veiculos,m.taxas,m.maquinas,m.fixasOutras],[300,50,120,30]);assert.equal(m.fixas,3320);assert.equal(m.ebitda,1930);
 assert.deepEqual([m.aIdentificar,m.foraOutras,m.transferencias],[150,40,500]);assert.equal(b.caixa,660);assert.equal(b.diferenca,0);
 const pulo=troca(SET,{},[cel('2.13.7.1.1','Máquina financiada',400)]);
 const p=apurar(context({registros:[reg('Set/2026','2026-09-30',pulo)]}));assert.equal(p.diferenca,0,'filha sem o nível do meio desconta da avó');assert.equal(p.linhas.investimentos,1100);assert.equal(p.linhas.dividas,800);
});
test('mês sem dados é null (nunca zero); valor estranho não vira NaN; registro sem as contas raiz fecha',()=>{
 const c=context();assert.equal(c.run('DRESimples.apurar(null)'),null);assert.equal(c.run('DRESimples.apurar({cells:[]})'),null);
 c.__r={cells:[cel('1','R',null),cel('1.1','V',null),cel('2','D',null)]};assert.equal(c.run('DRESimples.apurar(__r)'),null);
 c.__r={cells:[cel('1','R',100),cel('1.1','V',100),cel('2','D','abc')]};assert.equal(c.run('DRESimples.apurar(__r).linhas.variacao'),100);assert.equal(c.run('DRESimples.apurar(__r).caixa'),100);
 c.__r={cells:[cel('1.1','V',1000),cel('1.1.1','P',1000),cel('2.1','F',400),cel('2.1.4','S',400)]};assert.equal(c.run('DRESimples.apurar(__r).caixa'),600);assert.equal(c.run('DRESimples.apurar(__r).diferenca'),0);
 const est=troca(SET,{'2':10530,'2.13':960},[cel('2.13.5','Juros cartão',-20)]);
 const a=apurar(context({registros:[reg('Set/2026','2026-09-30',est)]}));assert.equal(a.linhas.despesasFinanceiras,60);assert.equal(a.diferenca,0);
});
test('DAS da competência: tudo o que saiu no DAS menos o parcelamento, com o resto à vista',()=>{
 const c=context();
 assert.deepEqual(c.json('DRESimples.dasDaGuia(state.records[1])'),{impresilk:500,universo:100,guias:600,resto:0,total:600,temGuia:true});
 c.__r={cells:[cel('2.4.1','DAS',1700),cel('2.4.1.1','Parcelamento',300),cel('2.4.1.3','Universo',200),cel('2.4.1.51','DAS Impresilk',1200)]};
 assert.deepEqual(c.json('DRESimples.dasDaGuia(__r)'),{impresilk:null,universo:200,guias:200,resto:1200,total:1400,temGuia:true},'conta renomeada não some');
 c.__r={cells:[cel('2.4.1','DAS',1400)]};assert.deepEqual(c.json('DRESimples.dasDaGuia(__r)'),{impresilk:null,universo:null,guias:0,resto:1400,total:1400,temGuia:true},'só o total: há DAS pago');
 c.__r={cells:[cel('2.4.1','DAS',null),cel('2.4.1.2','Impresilk',null),cel('2.4.1.3','Universo',null)]};assert.deepEqual(c.json('DRESimples.dasDaGuia(__r)'),{impresilk:null,universo:null,guias:0,resto:0,total:0,temGuia:false});
 assert.equal(c.run('DRESimples.dasDaGuia(null)'),null);
});
test('no Simples, IRPJ e CSLL vazios valem zero fora do DAS e não deixam o mês "parcial"',()=>{
 const c=context(),v=JSON.stringify(VALORES);
 assert.equal(c.run(`DREModelo.calcular(${v}).liquido`),8400);assert.equal(c.run(`DREModelo.calcular(${v}).tributosLucro`),0,'a parcela aparece como zero, a conta fecha no CFO e no PDF');
 assert.equal(c.run(`DREModelo.calcular({...${v},tributosLucro:300}).liquido`),8100);
 assert.equal(c.run(`DREModelo.calcular(${v},{regime:'lucro'}).liquido`),null,'fora do Simples, vazio continua bloqueando');
 assert.equal(c.run(`DREModelo.pendentes(${v}).length`),0);assert.equal(c.run(`DREModelo.pendentes({...${v},custos:null}).map(x=>x.id).join()`),'custos');
 assert.match(c.run("DREModelo.linhas.find(l=>l.id==='tributosLucro').nome"),/no Simples, dentro do DAS/);
});
test('tela de caixa: cards clicáveis com a cor certa, cascata com o DAS em vermelho e percentuais sobre as vendas',()=>{
 const h=context().run('renderDRE()');
 const cards=[...h.matchAll(/<button type="button" class="metric metric-param" data-dre-origem><span class="label">([^<]*)<\/span><strong class="([^"]*)">([^<]*)<\/strong>/g)].map(m=>[m[1],m[2],m[3]]);
 assert.deepEqual(cards.map(x=>x[0]),['Vendas · Set/2026','Margem de contribuição','Resultado operacional (EBITDA de caixa)','Resultado do mês']);
 assert.deepEqual(cards.map(x=>x[1]),['tom-entra','tom-entra','tom-entra','tom-entra']);assert.match(cards[1][2],/R\$\s5\.250,00/);
 assert.match(h,/class="g-marca-dado g-cor-saida"[^>]*data-dica="\(−\) DAS do mês\n-R\$\s600,00 · -6% da base"/);
 assert.match(h,/Margem de contribuição: R\$\s5\.250,00 \(52,5%\)/);
 const prej=context({registros:[reg('Set/2026','2026-09-30',troca(SET,{'2':14750,'2.5':5000,'2.5.2':5000}))]}).run('renderDRE()');
 assert.match(prej,/<span class="label">Resultado do mês<\/span><strong class="tom-sai">/,'prejuízo em vermelho');
 assert.match(h,/data-account="2\.1\.12">Comissão Interna<\/button>[^]*?<\/th><td class="num tom-sai">R\$\s500,00<\/td><td class="num">5%<\/td>/,'composição sobre as vendas');
 assert.match(h,/<caption>Contas do plano por linha da DRE · Set\/2026 · % sobre as vendas<\/caption>/);assert.match(h,/A DRE inteira fecha com o caixa do ERP: entradas menos saídas de Set\/2026 = R\$\s1\.470,00/);
 assert.ok(h.indexOf('metric-param')<h.indexOf('g-cascata')&&h.indexOf('g-cascata')<h.indexOf('Comparação ·'),'cards, gráficos, depois tabelas');
 assert.match(h,/<details class="card dre-movimento"><summary>Movimento de caixa · entradas e saídas<\/summary>/,'a matriz antiga fica recolhida');
 assert.equal((h.match(/class="dre-compact"/g)||[]).length,1,'as tabelas novas não se passam pela matriz antiga');
});
test('comparação: direção certa, detalhe zerado some e a ponte aparece sem cor (empréstimo não é "bom")',()=>{
 const h=comparacao(context().run('renderDRE()'));
 assert.match(linhaTabela(h,'(−) Despesas fixas'),/<span class="delta-bom">▼ -R\$\s200,00<\/span>/);
 assert.match(linhaTabela(h,'(=) Resultado do mês, antes dos sócios'),/<span class="delta-bom">▲ R\$\s200,00<\/span>/);
 assert.match(linhaTabela(h,'Pessoal'),/<td class="num tom-sai">R\$\s1\.500,00<\/td>/);assert.match(linhaTabela(h,'(=) Margem de contribuição'),/<td class="num tom-entra">R\$\s5\.250,00<\/td>/);
 assert.equal(linhaTabela(h,'Veículos'),'','linha zerada nos dois meses não aparece');
 const emp=REGISTROS.map(r=>r.label!=='Ago/2026'?r:{...r,cells:troca(AGO,{'1':10020,'1.4':0,'1.4.2':0})});
 const e=comparacao(context({registros:emp}).run('renderDRE()'));
 assert.match(linhaTabela(e,'(+) Empréstimos recebidos'),/<span class="">▲ R\$\s2\.000,00<\/span>/,'empréstimo aparece, sem cor');
 assert.match(linhaTabela(e,'(=) Variação do caixa no mês'),/<span class="">▲/,'a variação que veio de empréstimo não é pintada de bom');
});
test('mês em andamento é marcado nos quatro cards, sem cor de resultado, e não entra na tendência',()=>{
 const out=context({periodo:'Out/2026'}).run('renderDRE()');
 assert.equal((out.match(/coletado até 08\/10 \(mês em andamento\)<\/small>/g)||[]).length,4);
 assert.match(out,/<span class="label">Resultado do mês<\/span><strong class="">/,'resultado parcial sem azul nem vermelho');
 assert.match(out,/Out\/2026 contra Set\/2026 · % sobre as vendas · sem comparação: Out\/2026 tem lançamentos só até/);
 assert.match(out,/data-dica="Out\nsem dado"/);assert.match(out,/<th scope="col" class="num selected-month">Out\/2026 \*<\/th>/);
});
test('mês sem dados: cards dizem o que fazer, o ano continua visível e nada vira zero',()=>{
 const h=context({periodo:'Jul/2026'}).run('renderDRE()');
 assert.equal((h.match(/<strong class="">Não apurado<\/strong>/g)||[]).length,4);assert.match(h,/Jul\/2026 sem dados coletados\. Use “Atualizar Mubisys”/);
 assert.match(h,/A margem de contribuição está melhorando\?/);assert.match(h,/DRE Simples mês a mês · 2026/);
 const set=context().run('renderDRE()'),meses=set.slice(set.indexOf('dre-simples-meses'),set.indexOf('</table>',set.indexOf('dre-simples-meses')));
 assert.match(linhaTabela(meses,'Receita bruta de vendas'),/^<th scope="row">Receita bruta de vendas<\/th><td class="num  "><span class="muted"[^>]*>—/,'Jan sem dados é —');
 assert.equal((linhaTabela(meses,'Receita bruta de vendas').match(/<span class="muted"/g)||[]).length,10,'Jan a Jul, Nov, Dez e o acumulado: —, nunca R$ 0,00');
});
test('o mês de comparação escolhido vale, inclusive de outro ano; sem dados, avisa em vez de trocar',()=>{
 assert.match(context({comparar:'Out/2026'}).run('renderDRE()'),/Comparação · Set\/2026 contra Out\/2026/);
 assert.match(context({comparar:'Jul/2026'}).run('renderDRE()'),/Jul\/2026 sem dados coletados: escolha outro mês em “Comparação”/);
 const c=context();assert.equal(c.run("dreMesDesloca('Dez/2026',1)"),'Jan/2027');assert.equal(c.run("dreMesDesloca('Jan/2027',-1)"),'Dez/2026');assert.equal(c.run("dreMesDesloca('set/2026',1)"),'Out/2026');
 const baixo=REGISTROS.map(r=>({...r,label:r.label.toLowerCase()}));assert.match(context({periodo:'set/2026',registros:baixo}).run('renderDRE()'),/Vendas · set\/2026<\/span><strong class="tom-entra">R\$\s10\.000,00/,'rótulo em minúsculas casa o mês');
});
test('competência: DAS pago ao lado do informado, comparação de outro ano, percentuais sobre a receita bruta',()=>{
 const cfg={demonstrativosCompetencia:{versao:1,meses:{Ago_2026:comp('Ago/2026'),Jul_2026:comp('Jul/2026',{...VALORES,produtos:18000}),Ago_2025:comp('Ago/2025',{...VALORES,produtos:16000})}}};
 const c=context({periodo:'Ago/2026',cfg});c.run("dreUI.base='competencia'");const h=c.run('renderDRE()');
 assert.match(h,/DAS da competência Ago\/2026 pago em Set\/2026: R\$\s600,00 \(Impresilk R\$\s500,00 · Universo R\$\s100,00\)\. Informado em “Tributos sobre vendas”: R\$\s500,00 — menor que o DAS pago: confira\./);
 assert.match(linhaTabela(h,'(=) Lucro / prejuízo líquido'),/R\$\s8\.400,00<\/td><td class="num">42%<\/td><td class="num tom-entra">R\$\s6\.400,00<\/td><td class="num">35,6%<\/td>/);
 assert.match(h,/data-dica="Ago\n42%"/);
 const c2=context({periodo:'Ago/2026',cfg,comparar:'Ago/2025'});c2.run("dreUI.base='competencia'");assert.match(c2.run('renderDRE()'),/Comparação · Ago\/2026 contra Ago\/2025/);
 const outra={demonstrativosCompetencia:{versao:1,meses:{Ago_2026:comp('Ago/2026'),Jul_2026:comp('Jul/2026',VALORES,'Só Impresilk')}}};
 const c3=context({periodo:'Ago/2026',cfg:outra});c3.run("dreUI.base='competencia'");assert.match(c3.run('renderDRE()'),/sem comparação: empresas diferentes/);
 const ren=REGISTROS.map(r=>r.label!=='Set/2026'?r:{...r,cells:troca(SET,{'2.4.1':1100,'2.4':1200,'2':10750},[cel('2.4.1.51','DAS Impresilk',200)])});
 const c4=context({periodo:'Ago/2026',cfg,registros:ren});c4.run("dreUI.base='competencia'");assert.match(c4.run('renderDRE()'),/· R\$\s200,00 no DAS fora das subcontas, a conferir\)/);
 const ir={demonstrativosCompetencia:{versao:1,meses:{Ago_2026:comp('Ago/2026',{...VALORES,tributosLucro:300})}}};
 const c5=context({periodo:'Ago/2026',cfg:ir});c5.run("dreUI.base='competencia'");assert.match(c5.run('renderDRE()'),/\(−\) IRPJ e CSLL fora do Simples\n-R\$\s300,00/,'IRPJ informado aparece como degrau');
 const sem={demonstrativosCompetencia:{versao:1,meses:{Ago_2026:comp('Ago/2026',{...VALORES,tributosVendas:null})}}};
 const c6=context({periodo:'Ago/2026',cfg:sem});c6.run("dreUI.base='competencia'");const h6=c6.run('renderDRE()');
 assert.match(h6,/Informado em “Tributos sobre vendas”: não informado\./);assert.match(h6,/<th scope="row">\(−\) Tributos sobre vendas \(DAS e fora dele\)<\/th><td class="num">Não apurado<\/td>/,'tributo vazio não vira zero na cascata');
 const set=context({periodo:'Set/2026',cfg:{demonstrativosCompetencia:{versao:1,meses:{Set_2026:comp('Set/2026')}}}});set.run("dreUI.base='competencia'");
 const hs=set.run('renderDRE()');assert.match(hs,/DAS da competência Set\/2026 pago em Out\/2026: R\$\s700,00 [^.]*, até 08\/10 \(mês em andamento\)\./);assert.doesNotMatch(hs,/menor que o DAS pago/,'mês de pagamento incompleto não acusa diferença');
});
test('formulário da competência: oferece o DAS pago só com o mês fechado, e não apaga o que foi digitado',()=>{
 const abrir=(label,registros=REGISTROS)=>{const c=context({periodo:label,registros});c.run('dialog=(t,h)=>{__dlg={t,h}}');c.run(`abrirCompetencia(${JSON.stringify(label)})`);return c;};
 const c=abrir('Ago/2026'),h=c.run('__dlg.h');
 assert.match(h,/DAS da competência Ago\/2026 pago em Set\/2026: R\$\s600,00[^<]*<button type="button" id="competenciaUsarDAS">Usar em “Tributos sobre vendas”<\/button>/);
 assert.match(h,/<input name="tributosVendas" type="text" inputmode="decimal" value=""/,'nada é preenchido sem a pessoa pedir');
 c.els.competenciaUsarDAS.onclick();assert.equal(c.campo.value,'600,00');
 c.campo.value='1.100,00';c.els.competenciaUsarDAS.onclick();assert.equal(c.confirmou,1,'pede confirmação antes de trocar');assert.equal(c.campo.value,'1.100,00','sem confirmação, o valor digitado fica');
 const parcial=abrir('Set/2026').run('__dlg.h');assert.doesNotMatch(parcial,/competenciaUsarDAS/,'mês de pagamento em andamento não oferece o botão');assert.match(parcial,/até 08\/10 \(mês em andamento\)/);
 const neg=abrir('Ago/2026',REGISTROS.map(r=>r.label!=='Set/2026'?r:{...r,cells:troca(SET,{'2.4.1.2':-50,'2.4.1.3':0,'2.4.1':250,'2.4':350})})).run('__dlg.h');assert.doesNotMatch(neg,/competenciaUsarDAS/,'estorno não vira sugestão');
 const total=abrir('Ago/2026',REGISTROS.map(r=>r.label!=='Set/2026'?r:{...r,cells:[cel('1','R',100),cel('2','D',1400),cel('2.4','Impostos',1400),cel('2.4.1','DAS',1400)]})).run('__dlg.h');
 assert.match(total,/pago em Set\/2026: R\$\s1\.400,00 \(Impresilk sem guia · Universo sem guia · R\$\s1\.400,00 no DAS fora das subcontas, a conferir\)/);assert.match(total,/competenciaUsarDAS/);
});
test('planilha da base de caixa leva a DRE Simples; composição escapa nomes do ERP; apuração não se repete a cada render',()=>{
 const c=context();c.run('download=(n,t)=>{__csv=t}');c.run('exportarDRECSV()');const csv=c.run('__csv');
 assert.match(csv,/DRE Simples \(base de caixa\)/);assert.match(csv,/"\(=\) Margem de contribuição";"5250,00";"52,50%"/);
 const x=REGISTROS.map(r=>r.label!=='Set/2026'?r:{...r,cells:troca(SET,{'2':10650,'2.13':1080},[cel('2.13.52','<img src=x onerror=alert(1)>',100)])});
 const h=context({registros:x}).run('renderDRE()');assert.match(h,/· 1 a conferir<\/summary>/);assert.doesNotMatch(h,/<img src=x/);assert.match(h,/&lt;img src=x onerror=alert\(1\)&gt;/);
 const p=context();p.run('const __a=DRESimples.apurar;__n=0;DRESimples.apurar=r=>{__n++;return __a(r)}');p.run('renderDRE()');const primeira=p.run('__n');p.run('renderDRE()');
 assert.ok(primeira<=3,'um por mês com dados, não 26');assert.equal(p.run('__n'),primeira,'o segundo render reaproveita');
});
