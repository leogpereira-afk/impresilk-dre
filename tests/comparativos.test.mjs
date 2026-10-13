// Comparativos anuais (Fase 12): os anos lado a lado no Dashboard, da DRE Simples, em % das vendas.
// Dados sintéticos: 2020 e o começo de 2021 sem plano de contas (2.99), material político nos anos
// de eleição, Out/2026 coletado pela metade. Nada aqui vem da produção.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const MES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const SAZ=[.7,.68,.9,.95,1,1,1.02,1.05,1.3,1.35,1.05,1];
const CRESC={2020:.8,2021:.9,2022:1,2023:1.1,2024:1.2,2025:1.3,2026:1.36};
const cel=(code,name,value)=>({code,name,value:Math.round(value*100)/100});
// Mês com plano de contas: vendas = 100.000 × fator; materiais 40%, salário 15% (+ alta em 2026), aluguel 5%,
// retiradas 8%, parcela de empréstimo 3% (12% em 2026), empréstimo recebido 15% em 2026.
function mesClassificado(ano,m){
 const f=CRESC[ano]*SAZ[m-1],v=100000*f,pol=(ano===2022||ano===2024)&&(m===9||m===10)?20000:0;
 const lona=v*.3,adesivo=v*.2,sem=v-lona-adesivo,pessoal=v*(ano===2026?.2:.15),emp=ano===2026?v*.15:0,divida=v*(ano===2026?.12:.03);
 const saidas=v*.4+pessoal+v*.05+v*.08+divida+v*.01;
 return [cel('1','Receitas',v+pol+emp),cel('1.1','Comunicação Visual',v),cel('1.1.1','Produtos',lona+adesivo),cel('1.1.1.1','Lona',lona),cel('1.1.1.2','Adesivo',adesivo),cel('1.1.99','Sem produto',sem),
  ...(pol?[cel('1.5','Material Político',pol)]:[]),...(emp?[cel('1.4','Empréstimos',emp),cel('1.4.2','Pronampe',emp)]:[]),
  cel('2','Despesas',saidas),cel('2.1','Despesas Funcionários',pessoal),cel('2.1.4','Salário',pessoal),cel('2.5','Despesas Fixas',v*.05),cel('2.5.2','Aluguel lote',v*.05),
  cel('2.12','Materiais e Insumos',v*.4),cel('2.12.1','Impressão',v*.4),cel('2.14','Despesas Societárias',v*.08),cel('2.14.2','Retiradas Leonardo',v*.08),
  cel('2.13','Despesas Bancárias',divida+v*.01),cel('2.13.1','Tarifa de boletos',v*.01),cel('2.13.7','Empréstimos Bancários',divida)];
}
// Mês sem plano de contas: quase tudo em 2.99.
function mesSemConta(ano,m){const v=100000*CRESC[ano]*SAZ[m-1];return [cel('1','Receitas',v),cel('1.1','Comunicação Visual',v),cel('2','Despesas',v*.7),cel('2.99','Sem plano de contas',v*.68),cel('2.1','Despesas Funcionários',v*.02),cel('2.1.4','Salário',v*.02)];}
const fim=(a,m)=>new Date(Date.UTC(a,m,0)).toISOString().slice(0,10);
const reg=(ano,m,cells,ate=fim(ano,m))=>({id:`${MES[m-1]}_${ano}`,label:`${MES[m-1]}/${ano}`,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',atualizadoEm:'2026-10-10T10:00:00Z',qualidade:{ate,coletadoAte:ate,estado:'aguardando-conferencia',regra:'caixa-v2'},cells,pendencias:[]});
function base(){
 const r=[];for(let a=2020;a<=2026;a++)for(let m=1;m<=12;m++){
  if(a===2020&&m<3)continue;if(a===2026&&m>10)break;
  if(a===2026&&m===10){r.push(reg(a,m,mesClassificado(a,m).map(c=>({...c,value:c.value/3})),'2026-10-08'));continue;}
  r.push(reg(a,m,a===2020||(a===2021&&m<=5)?mesSemConta(a,m):mesClassificado(a,m)));
 }return r;}
function context(periodo='Out/2026',registros=base()){
 const els={};const doc={addEventListener(){},getElementById:id=>els[id]||(els[id]={}),querySelector:()=>null,querySelectorAll:()=>[]};
 const c={structuredClone,document:doc,localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,crypto:{randomUUID:()=>'r'}};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','comparativos.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.__v=registros;c.run('state.records=__v');c.run(`state.periodo=${JSON.stringify(periodo)};var dfcHoje=()=>'2026-10-12'`);
 c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));return c;
}
const modelo=c=>c.json(`(()=>{const M=cmpModelo();return {refAno:M.refAno,refMes:M.refMes,porAno:M.porAno.map(p=>({ano:p.ano,meses:p.meses,mesesCls:p.mesesCls,pct:p.pct,politico:p.politico,vendas:p.vendas})),indice:M.indice,crescimento:M.crescimento,saz:M.saz,mesAMes:M.mesAMes,mix:M.mix,produtos:M.produtos,semProduto:M.semProduto,prodAnos:M.prodAnos}})()`);
const perto=(a,b,tol=.05)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≠ ${b}`);

test('ano de referência: o do mês escolhido, até o último mês fechado; mês coletado pela metade fica fora',()=>{
 const M=modelo(context());
 assert.equal(M.refAno,2026);assert.equal(M.refMes,9);
 assert.deepEqual(M.porAno.map(p=>p.ano),[2020,2021,2022,2023,2024,2025,2026]);
 assert.deepEqual(M.porAno.at(-1).meses,[1,2,3,4,5,6,7,8,9]);
 const M24=modelo(context('Dez/2024'));assert.equal(M24.refAno,2024);assert.equal(M24.refMes,12);assert.equal(M24.porAno.at(-1).ano,2024);
});
test('custos e despesas só dos meses com plano de contas; vendas de todos os meses fechados',()=>{
 const M=modelo(context()),p20=M.porAno[0],p21=M.porAno[1];
 assert.deepEqual(p20.mesesCls,[]);assert.equal(p20.pct.margemContribuicao,null);assert.ok(p20.vendas>0);
 assert.deepEqual(p21.mesesCls,[6,7,8,9,10,11,12]);assert.equal(p21.meses.length,12);
 // 2022: materiais 40%, pessoal 15%, aluguel 5%, tarifas 1% → margem 60%, fixas 20%, resultado 39% (sem o material político)
 const p22=M.porAno[2];
 assert.ok(p22.pct.margemContribuicao>60&&p22.pct.margemContribuicao<70,'o político entra nas vendas e dilui os custos');
 const p23=M.porAno[3];perto(p23.pct.variaveis,40);perto(p23.pct.margemContribuicao,60);perto(p23.pct.pessoal,15);perto(p23.pct.resultado,39);perto(p23.pct.socios,8);perto(p23.pct.dividas,3);
 perto(p23.pct.pe,20/60*100);perto(p23.pct.sociosResultado,8/39*100);
 const p26=M.porAno[6];perto(p26.pct.pessoal,20);perto(p26.pct.emprestimos,15);perto(p26.pct.dividas,12);
});
test('índice de vendas nos mesmos meses em todos os anos; crescimento contra os mesmos meses; sazonalidade dos anos inteiros',()=>{
 const M=modelo(context());
 assert.equal(M.indice[0].ano,2021,'2020 não tem jan e fev: fica fora do índice');perto(M.indice[0].valor,100);
 perto(M.indice.find(i=>i.ano===2023).valor,110/90*100,.1);
 const i24=M.indice.find(i=>i.ano===2024);perto(i24.semPolitico,120/90*100,.1);assert.ok(i24.extra>0,'eleição destacada');
 const v=M.crescimento.linhas.find(l=>l.chave==='vendasSemPolitico'),k=M.crescimento.pares.findIndex(p=>p.a1===2026);
 perto(v.valores[k].valor,(1.36/1.3-1)*100,.1);assert.deepEqual(M.crescimento.pares[k].meses,[1,2,3,4,5,6,7,8,9]);
 const pes=M.crescimento.linhas.find(l=>l.chave==='pessoal'),k22=M.crescimento.pares.findIndex(p=>p.a1===2022);
 assert.deepEqual(pes.valores[k22].meses,[6,7,8,9,10,11,12],'2021 só tem plano de contas de jun a dez');
 // a média dos SAZ é 1: sem eleição, outubro dá 135; com o político de 2022 e 2024, um pouco mais
 const ord=[...M.saz].sort((a,b)=>b.indice-a.indice);assert.equal(ord[0].mes,10);assert.equal(ord.at(-1).mes,2);assert.ok(M.saz[9].indice>135&&M.saz[9].indice<145);
 assert.equal(M.mesAMes[9].valor,null,'out/2026 em andamento: sem comparação');perto(M.mesAMes[0].valor,(1.36/1.3-1)*100,.1);
});
test('receita: mix por conta de 2º nível e produtos, com o que está sem produto na O.S.',()=>{
 const M=modelo(context());
 assert.ok(M.mix.some(l=>l.rotulo==='Material Político'));
 assert.equal(M.prodAnos.length,5);assert.deepEqual(M.produtos.map(p=>p.rotulo),['Lona','Adesivo']);
 perto(M.produtos[0].valores.at(-1),30);perto(M.semProduto.valores.at(-1),50);
});
test('a seção no Dashboard: painéis, tabelas e a leitura, sem NaN, sem travessão e sem zero inventado',()=>{
 const c=context(),h=c.run('renderComparativos()');
 for(const t of ['Comparativos anuais','1. Vendas','2. De onde vem a receita','3. A DRE ano a ano','4. Margens, estrutura e crescimento','5. Custos variáveis','6. Despesas fixas','7. Depois do resultado','O que os números mostram','Limites desta comparação','Pontos a conferir no Mubisys','Próximos passos sugeridos'])assert.ok(h.includes(t),t);
 assert.doesNotMatch(h,/NaN|undefined|Infinity|\[object/);assert.doesNotMatch(h,/—/);assert.doesNotMatch(ler('comparativos.js'),/—/);
 assert.match(h,/mar\/2020 a mai\/2021/,'limite: meses sem plano de contas em faixa');
 assert.match(h,/Out\/2026<\/b> fica fora/);
 assert.match(h,/passou a girar dívida/);assert.match(h,/Pessoal<\/b>: definir um teto/);
 assert.ok((h.match(/class="g-fig/g)||[]).length>=6,'gráficos');
 // a seção entra no Dashboard, logo depois do resumo do CFO
 assert.match(ler('app.js'),/cfoResumo\(reg\)\+\(typeof renderComparativos==='function'\?renderComparativos\(\):''\)/);
 for(const f of ['index.html','sw.js','scripts/build_site.py'])assert.match(ler(f),/comparativos\.js/,f);
});
test('sem meses fechados: aviso, não gráfico vazio; cache refeito quando a base muda',()=>{
 const c=context('Out/2026',[reg(2026,10,mesClassificado(2026,10),'2026-10-08')]);
 assert.match(c.run('renderComparativos()'),/Ainda não há meses fechados/);
 const d=context();const a=d.run('renderComparativos()');d.run("state.periodo='Dez/2023'");const b=d.run('renderComparativos()');
 assert.notEqual(a,b);assert.match(b,/Ano de referência: <b>2023<\/b>/);
});
test('pontos a conferir: conta que sumiu, o mesmo nome em grupos diferentes, devolução como despesa e marketing em conta de material',()=>{
 const ajusta=r=>{const [m,a]=r.label.split('/'),ano=Number(a);if(ano<2022)return r;const v=r.cells.find(c=>c.code==='1.1').value,cells=r.cells.filter(c=>!(ano===2026&&c.code==='2.5.2'));
  if(ano>=2025)cells.push({code:'2.2',name:'Despesas Administrativas',value:v*.01},{code:'2.2.54',name:'Devolução Cliente',value:v*.005},{code:'2.2.2',name:'Contribuição Sindical',value:v*.005});
  if(ano===2026)cells.push({code:'2.1.3',name:'Contribuição Sindical',value:v*.004},{code:'2.12.9',name:'Agência de publicidade',value:v*.01});
  return {...r,cells};};
 const c=context('Out/2026',base().map(ajusta)),L=c.json('cmpLeitura(cmpModelo())'),t=L.conferir.join('\n');
 assert.match(t,/Aluguel lote<\/b> aparecia em todos os anos anteriores e não aparece em 2026 até set/);
 assert.match(t,/Contribuição Sindical<\/b> em 2026 até set está em 2 grupos de contas diferentes \(2\.1\.3, 2\.2\.2\)/);
 assert.match(t,/Devolução Cliente<\/b> lançada em conta administrativa \(2\.2\.54\): o certo é descontar da receita/);
 assert.match(t,/Agência de publicidade<\/b> lançada em conta de material \(2\.12\.9\): é marketing/);
 assert.match(c.run('renderComparativos()'),/Pontos a conferir no Mubisys<\/h3><ul class="cmp-lista"><li>/);
});
