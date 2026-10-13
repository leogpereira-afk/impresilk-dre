// Comparativos anuais (Fase 12): os anos lado a lado no Dashboard, da DRE Simples, em % das vendas.
// Dados sintéticos: 2020 e o começo de 2021 sem plano de contas (2.99), material político nos anos
// de eleição (2022 no produto, em 1.1.99; 2024 na conta 1.5; 2026 no produto e nas O.S. da campanha
// do Painel), Out/2026 coletado pela metade. Nada aqui vem da produção.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const MES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const SAZ=[.7,.68,.9,.95,1,1,1.02,1.05,1.3,1.35,1.05,1];
const CRESC={2020:.8,2021:.9,2022:1,2023:1.1,2024:1.2,2025:1.3,2026:1.36};
const cel=(code,name,value)=>({code,name,value:Math.round(value*100)/100});
// Mês com plano de contas: vendas = 100.000 × fator; materiais 40%, salário 15% (+ alta em 2026), aluguel 5%,
// retiradas 8%, parcela de empréstimo 3% (12% em 2026), empréstimo recebido 15% em 2026.
// Material político de cada eleição, em setembro e outubro: 2022 só como produto (o robô deixava
// em 1.1.99.66), 2024 na conta 1.5 (com o produto "Material Político 2024" em 1.5.51) e 2026 como
// produto em 1.1.99.51 (setembro).
const POL={2022:{9:20000,10:20000},2024:{9:20000,10:20000},2026:{9:10000}};
const PROD_POL={2022:'xMaterial Político 2022x',2024:'Material Político 2024',2026:'Material Político 2026'};
function mesClassificado(ano,m){
 const f=CRESC[ano]*SAZ[m-1],v=100000*f,pol=POL[ano]?.[m]||0;
 const lona=v*.3,adesivo=v*.2,sem=v-lona-adesivo,pessoal=v*(ano===2026?.2:.15),emp=ano===2026?v*.15:0,divida=v*(ano===2026?.12:.03);
 const saidas=v*.4+pessoal+v*.05+v*.08+divida+v*.01,em15=ano===2024;
 return [cel('1','Receitas',v+pol+emp),cel('1.1','Comunicação Visual',v+(em15?0:pol)),cel('1.1.1','Produtos',lona+adesivo),cel('1.1.1.51','Lona Front Brilho*',lona),cel('1.1.1.52','Adesivo Leitoso',adesivo),cel('1.1.98','Recebimentos operacionais sem O.S. completa',sem),
  ...(pol&&!em15?[cel('1.1.99','Produtos aguardando classificação',pol),cel(ano===2022?'1.1.99.66':'1.1.99.51',PROD_POL[ano],pol)]:[]),
  ...(pol&&em15?[cel('1.5','Material Político',pol),cel('1.5.51',PROD_POL[ano],pol)]:[]),...(emp?[cel('1.4','Empréstimos',emp),cel('1.4.2','Pronampe',emp)]:[]),
  cel('2','Despesas',saidas),cel('2.1','Despesas Funcionários',pessoal),cel('2.1.4','Salário',pessoal),cel('2.5','Despesas Fixas',v*.05),cel('2.5.2','Aluguel lote',v*.05),
  cel('2.12','Materiais e Insumos',v*.4),cel('2.12.1','Impressão',v*.4),cel('2.14','Despesas Societárias',v*.08),cel('2.14.2','Retiradas Leonardo',v*.08),
  cel('2.13','Despesas Bancárias',divida+v*.01),cel('2.13.1','Tarifa de boletos',v*.01),cel('2.13.7','Empréstimos Bancários',divida)];
}
// Mês sem plano de contas: quase tudo em 2.99.
function mesSemConta(ano,m){const v=100000*CRESC[ano]*SAZ[m-1];return [cel('1','Receitas',v),cel('1.1','Comunicação Visual',v),cel('2','Despesas',v*.7),cel('2.99','Sem plano de contas',v*.68),cel('2.1','Despesas Funcionários',v*.02),cel('2.1.4','Salário',v*.02)];}
const fim=(a,m)=>new Date(Date.UTC(a,m,0)).toISOString().slice(0,10);
// A prévia do robô guarda o rateio do recebido por produto, pelo nome (previaERP.receitaPorProduto).
const previa=cells=>{const p={};for(const c of cells)if(/^1\.(1\.(1|99)|5)\.\d+$/.test(c.code))p[c.name]=(p[c.name]||0)+c.value;return {receitaPorProduto:p};};
const reg=(ano,m,cells,ate=fim(ano,m))=>({id:`${MES[m-1]}_${ano}`,label:`${MES[m-1]}/${ano}`,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',atualizadoEm:'2026-10-10T10:00:00Z',qualidade:{ate,coletadoAte:ate,estado:'aguardando-conferencia',regra:'caixa-v2'},cells,previaERP:previa(cells),pendencias:[]});
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
const modelo=c=>c.json(`(()=>{const M=cmpModelo();return {refAno:M.refAno,refMes:M.refMes,porAno:M.porAno.map(p=>({ano:p.ano,meses:p.meses,mesesCls:p.mesesCls,pct:p.pct,politico:p.politico,vendas:p.vendas,vendasBase:p.vendasBase})),indice:M.indice,crescimento:M.crescimento,saz:M.saz,mesAMes:M.mesAMes,mix:M.mix,produtos:M.produtos,semOS:M.semOS,produtoPolitico:M.produtoPolitico,prodAnos:M.prodAnos,semPolitica:M.semPolitica,meses:M.meses.map(x=>({label:x.label,politico:x.politico,pol:x.pol}))}})()`);
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
 const p26=M.porAno[6];perto(p26.pct.pessoal,20,.3);perto(p26.pct.emprestimos,15,.3);perto(p26.pct.dividas,12,.3);// o político de set/2026 entra nas vendas
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
test('receita: mix por conta de 2º nível com o material político numa linha só; produtos pelo nome, da prévia do robô',()=>{
 const M=modelo(context()),pol=M.mix.find(l=>l.politico);assert.equal(M.mix.at(-1),M.mix.find(l=>l.politico),'a linha do material político fica no fim');
 assert.equal(pol.rotulo,'Material político (eleições)');assert.ok(!M.mix.some(l=>/^Material Político$/.test(l.rotulo)),'a conta 1.5 entra na linha do material político');
 // 2022: o produto estava em Comunicação Visual (1.1.99); sai de lá e vai para a linha do material político
 const i22=M.porAno.findIndex(p=>p.ano===2022),cv=M.mix.find(l=>l.rotulo==='Comunicação Visual');
 perto(pol.valores[i22]+cv.valores[i22],100,.01);perto(pol.valores[i22],40000/M.porAno[i22].vendas*100,.01);
 assert.equal(M.prodAnos.length,5);assert.deepEqual(M.produtos.map(p=>p.rotulo),['Lona Front Brilho','Adesivo Leitoso'],'sem a estrela da ficha viva');
 perto(M.produtos[0].valores.at(-1),30,.5);perto(M.semOS.valores.at(-1),50,.5);assert.equal(M.semOS.rotulo,'Recebido sem O.S. completa');
 assert.equal(M.produtoPolitico.rotulo,'Material político (produto)');assert.ok(M.produtoPolitico.valores.some(v=>v>0));
});
test('material político: produto com nome de eleição (1.1.99), conta 1.5 sem contar duas vezes, e as O.S. da campanha do Painel',()=>{
 const c=context(),M=modelo(c),mes=l=>M.meses.find(x=>x.label===l);
 assert.equal(mes('Set/2022').politico,20000,'xMaterial Político 2022x em 1.1.99.66');assert.equal(mes('Set/2022').pol.conta,0);
 assert.equal(mes('Set/2024').politico,20000,'conta 1.5 com o produto Material Político 2024 dentro: uma vez só');
 assert.equal(mes('Set/2026').politico,10000);assert.equal(mes('Set/2026').pol.porOS,null,'sem campanhas: só o produto');
 assert.equal(mes('Jan/2023').politico,0);
 // Set/2026 com a trilha: 30.000 de uma O.S. da campanha, 4.000 de um título com duas O.S. (uma da campanha, fica de
 // fora: sem o valor de cada O.S., repartir poderia contar a mais), 1.000 na conta 1.5.2 e 7.000 de empréstimo que cita a O.S.
 const d=context('Out/2026',base().map(r=>r.label!=='Set/2026'?r:{...r,eventos:[
  {natureza:'entrada',valor:30000,ordensServico:['5001']},{natureza:'entrada',valor:4000,ordensServico:['5002','7000']},
  {natureza:'entrada',valor:1000,ordensServico:[],contaGerencial:'1.5.2'},{natureza:'entrada',valor:50000,ordensServico:['7001']},{natureza:'saida',valor:999,ordensServico:['5001']},
  {natureza:'entrada',valor:7000,ordensServico:['5001'],contaGerencial:'1.4.2'}]}));
 d.__c={ok:true,fonte:'campanhas',atualizadoEm:'2026-10-12T10:00:00Z',campanhas:[{nome:'Política 2026 - Deputados',politica:true,os:['5001','5002']},{nome:'Expomontes 2026',politica:false,os:['7000','7001']}]};
 d.run('cmpUI.campanhas=__c');
 const N=modelo(d),s=N.meses.find(x=>x.label==='Set/2026');
 assert.equal(s.pol.porOS,30000+1000);assert.equal(s.politico,31000,'o maior dos dois');assert.equal(s.pol.excesso,21000);assert.equal(s.pol.fonte,'os');
 assert.equal(N.meses.find(x=>x.label==='Set/2022').pol.porOS,null,'mês sem a trilha: só produto e conta');
 // quando o produto pesa mais que as O.S. marcadas, fica o produto
 d.__c={...d.__c,atualizadoEm:'outra',campanhas:[{nome:'Política 2026',politica:true,os:['9999']},{nome:'Expomontes',politica:false,os:['5001']}]};d.run('cmpUI.campanhas=__c');
 const O=modelo(d).meses.find(x=>x.label==='Set/2026');assert.equal(O.politico,10000);assert.equal(O.pol.fonte,'produto');
 const h=d.run('renderComparativos()');assert.match(h,/as O\.S\. das campanhas de Política do Painel \(set\/2026\)/);
});
test('dinheiro da campanha em produto de nome comum: sem o marcador, mix e produtos perdem o mesmo que as vendas',()=>{
 const regs=base().map(r=>r.label!=='Set/2026'?r:{...r,eventos:[{natureza:'entrada',valor:40000,ordensServico:['5001']}]});
 const c=context('Out/2026',regs);c.__c={ok:true,fonte:'campanhas',atualizadoEm:'z',campanhas:[{nome:'Política 2026 - Deputados',politica:true,os:['5001']}]};c.run('cmpUI.campanhas=__c;cmpUI.semPolitica=true');
 const M=modelo(c),i26=M.porAno.findIndex(p=>p.ano===2026),set=M.meses.find(x=>x.label==='Set/2026');
 assert.equal(set.politico,40000);assert.equal(set.pol.excesso,30000,'10.000 já eram o produto Material Político 2026');
 for(let i=0;i<M.porAno.length;i++)perto(M.mix.reduce((t,l)=>t+(l.valores[i]||0),0),100,.01);
 const somaProd=M.produtos.reduce((t,l)=>t+(l.valores.at(-1)||0),0)+(M.semOS.valores.at(-1)||0);perto(somaProd,100,.01);
 c.run('cmpUI.semPolitica=false');const N=modelo(c);perto(N.mix.find(l=>l.politico).valores[i26],40000/N.porAno[i26].vendas*100,.01);
 for(let i=0;i<N.porAno.length;i++)perto(N.mix.reduce((t,l)=>t+(l.valores[i]||0),0),100,.01);
 // campanhas lidas, mas nenhuma de política: ausência, não medição zerada
 c.__c={ok:true,fonte:'campanhas',atualizadoEm:'y',campanhas:[{nome:'Expomontes 2026',politica:false,os:['5001']}]};c.run('cmpUI.campanhas=__c');
 const O=modelo(c);assert.equal(O.meses.find(x=>x.label==='Set/2026').pol.porOS,null);
});
test('marcador desmarcado: vendas, índice, sazonalidade, mix e produtos sem o material político; a DRE continua com ele',()=>{
 const c=context(),com=modelo(c);c.run('cmpUI.semPolitica=true');const sem=modelo(c);
 assert.equal(sem.semPolitica,true);
 const p22=sem.porAno.find(p=>p.ano===2022);perto(p22.vendasBase,p22.vendas-40000,.01);
 const i24c=com.indice.find(i=>i.ano===2024),i24s=sem.indice.find(i=>i.ano===2024);
 assert.ok(i24s.valor<i24c.valor);assert.equal(i24s.extra,0);perto(i24s.valor,i24s.semPolitico,.001);
 assert.ok(!sem.mix.some(l=>l.politico));for(let i=0;i<sem.porAno.length;i++)perto(sem.mix.reduce((t,l)=>t+(l.valores[i]||0),0),100,.01);
 assert.equal(sem.produtoPolitico,null);
 assert.ok(sem.saz[9].indice<com.saz[9].indice,'outubro sem eleição pesa menos');
 const h=c.run('renderComparativos()');
 assert.match(h,/data-cmp-politica>/,'caixa desmarcada');assert.match(h,/Vendas de janeiro a setembro sem material político/);
 assert.match(h,/Esta parte continua com o material político/);assert.match(h,/<b>Sem material político<\/b>/);
 assert.match(c.run("(cmpUI.semPolitica=false,renderComparativos())"),/data-cmp-politica checked>/);
 assert.match(h,/dos quais, material político/);
});
test('cartão aberto ou fechado pela pessoa continua assim depois de redesenhar',()=>{
 const c=context();assert.match(c.run('renderComparativos()'),/data-cmp-sec="receita">/);
 c.run("cmpUI.abertos={receita:true,vendas:false}");const h=c.run('renderComparativos()');
 assert.match(h,/data-cmp-sec="receita" open>/);assert.match(h,/data-cmp-sec="vendas">/);
});
test('campanhas do Painel: lidas uma vez, com o servidor antigo vira aviso e a tela redesenha',async()=>{
 const c=context();let pedidos=0,desenhos=0;c.render=()=>{desenhos++;};c.run("state.view='inicio'");
 c.api=async(a,b)=>{pedidos++;assert.equal(a,'indicadores');assert.equal(b.fonte,'campanhas');return {erro:'Fonte inválida.'};};
 c.run('renderComparativos()');c.run('renderComparativos()');await new Promise(r=>setTimeout(r,10));
 assert.equal(pedidos,1,'não pede de novo em laço');assert.equal(desenhos,1,'o erro novo muda o texto: redesenha');assert.match(c.run('cmpUI.campErro'),/ainda não tem a leitura das campanhas/);
 assert.match(c.run('renderComparativos()'),/as campanhas do Painel não puderam ser lidas/);
 c.run('cmpUI.campEm=0');c.api=async()=>({ok:true,fonte:'campanhas',campanhas:[{nome:'Política 2026',politica:true,os:['1']}],atualizadoEm:'x'});
 c.run('cmpCarregarCampanhas()');await new Promise(r=>setTimeout(r,10));assert.equal(c.run('cmpUI.campErro'),'');assert.equal(c.run('cmpUI.campanhas.campanhas.length'),1);assert.equal(desenhos,2);
 // a mesma resposta de novo: a tela não muda, então não redesenha (não tira o foco nem fecha nada)
 c.run('renderComparativos();cmpUI.campEm=0');c.run('cmpCarregarCampanhas()');await new Promise(r=>setTimeout(r,10));assert.equal(desenhos,2);
});
test('a seção no Dashboard: painéis, tabelas e a leitura, sem NaN, sem travessão e sem zero inventado',()=>{
 const c=context(),h=c.run('renderComparativos()');
 for(const t of ['Comparativos anuais','1. Vendas','2. De onde vem a receita','3. A DRE ano a ano','4. Margens, estrutura e crescimento','5. Custos variáveis','6. Despesas fixas','7. Depois do resultado','O que os números mostram','Limites desta comparação','Pontos a conferir no Mubisys','Próximos passos sugeridos'])assert.ok(h.includes(t),t);
 assert.doesNotMatch(h,/NaN|undefined|Infinity|\[object/);assert.doesNotMatch(h,/—/);assert.doesNotMatch(ler('comparativos.js'),/—/);
 assert.match(h,/mar\/2020 a mai\/2021/,'limite: meses sem plano de contas em faixa');
 assert.match(h,/Out\/2026<\/b> fica fora/);
 assert.match(h,/passou a girar dívida/);assert.match(h,/Pessoal<\/b>: definir um teto/);
 assert.ok((h.match(/class="g-fig/g)||[]).length>=6,'gráficos');
 // a seção continua no Dashboard, agora no fim (v135, D21): "O que mudou" e a Conferência ficam perto da Leitura CFO
 assert.match(ler('app.js'),/h\+=\(typeof renderComparativos==='function'\?renderComparativos\(\):''\)/);
 for(const f of ['index.html','sw.js','scripts/build_site.py'])assert.match(ler(f),/comparativos\.js/,f);
});
test('sem meses fechados: aviso, não gráfico vazio; cache refeito quando a base muda',()=>{
 const c=context('Out/2026',[reg(2026,10,mesClassificado(2026,10),'2026-10-08')]);
 assert.match(c.run('renderComparativos()'),/Ainda não há meses completos/);
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
test('servidor: campanhas do Painel só com nome, período e números das O.S.; a fonte nova passa antes do período',async()=>{
 const {resumirCampanhas,consultarCampanhas}=await import('../supabase/functions/dre-sync/campanhas.mjs');
 const {consultarIndicadores}=await import('../supabase/functions/dre-sync/indicadores.mjs');
 const linhas=[{id:'c1',atualizado_em:'2026-10-01T00:00:00Z',nome:'Política 2026 - Deputados',desde:'2026-01-02',ate:'2026-10-31',os:{a:{numero:'23208',cliente:'ELEICAO 2026 FULANO',cnpj:'1',valor:10},b:{numero:23100,valor:5},c:{numero:'x1'},d:null}},
  {id:'c2',atualizado_em:'2026-10-05T00:00:00Z',nome:'Expomontes 2026',desde:'2026-01-01',ate:null,os:{}},{id:'c3',nome:'  ',os:{}},{id:'c4',nome:'Politica 2020 - Prefeito',desde:'2020-03-02',ate:'data ruim',os:[]}];
 const r=resumirCampanhas(linhas);
 assert.deepEqual(r.map(x=>x.nome),['Politica 2020 - Prefeito','Expomontes 2026','Política 2026 - Deputados']);
 assert.deepEqual(r[2],{id:'c1',nome:'Política 2026 - Deputados',politica:true,desde:'2026-01-02',ate:'2026-10-31',os:['23100','23208']});
 assert.equal(r[1].politica,false);assert.equal(r[0].politica,true);assert.equal(r[0].ate,null);
 assert.doesNotMatch(JSON.stringify(r),/ELEICAO|cnpj|valor/,'sem cliente, CNPJ nem valor');
 let consulta=null;const sb={from:t=>({select:c=>({eq:(k,v)=>{consulta={t,c,k,v};return Promise.resolve({data:linhas,error:null});}})})};
 const s=await consultarCampanhas(sb);assert.equal(s.ok,true);assert.equal(s.fonte,'campanhas');assert.equal(s.campanhas.length,3);assert.equal(s.atualizadoEm,'2026-10-05T00:00:00Z');
 assert.deepEqual([consulta.t,consulta.k,consulta.v],['painel_registros','colecao','campanhas']);assert.doesNotMatch(consulta.c,/anexos|historico|\bregistro\b,|registro\)/);
 const viaIndicadores=await consultarIndicadores(sb,{fonte:'campanhas'});assert.equal(viaIndicadores.fonte,'campanhas','não passa pela validação de período');
 const ruim={from:()=>({select:()=>({eq:()=>Promise.resolve({data:null,error:{message:'x'}})})})};
 await assert.rejects(()=>consultarCampanhas(ruim),/Não foi possível ler as campanhas do Painel/);
});

// ── v133 ──
test('leitura com o ano atual como recorde: "até então o ano mais enxuto" e "até então o melhor ano", sem superlativo falso',()=>{
 // 2026 com pessoal de 5% e sem parcela de dívida: o ano mais enxuto e o de melhor resultado
 const recorde=r=>{if(!r.label.endsWith('/2026'))return r;const cells=r.cells.map(c=>({...c}));const k=code=>cells.find(c=>c.code===code);
  const p=k('2.1'),antes=p.value;for(const code of ['2.1','2.1.4'])k(code).value=Math.round(k(code).value/4*100)/100;k('2').value=Math.round((k('2').value-(antes-k('2.1').value))*100)/100;return {...r,cells};};
 const t=cmpPontos(context('Out/2026',base().map(recorde)));
 // v135 (I17): com 2026 pela metade, o veredito é contra 2025 nos mesmos meses; o recorde continua dito
 assert.match(t,/despesas fixas caíram<\/b>: 10% das vendas em 2026 até set; nos mesmos meses de 2025 \(jan a set\) eram 20%\. No ano inteiro de 2025, 20%; até então, o ano mais enxuto foi 2022, com /);
 assert.match(t,/resultado antes dos sócios subiu<\/b>: [^<]*; até então, o melhor ano foi 2022, com /);
 // na base padrão 2026 não bate os anteriores: o superlativo fica com o ano antigo
 const u=cmpPontos(context());
 assert.match(u,/; o ano mais enxuto foi 2022, com /);assert.match(u,/; o melhor ano foi 2022, com /);assert.doesNotMatch(u,/até então/);
 // ano de referência inteiro: a frase de antes, contra o ano mais enxuto e o melhor ano
 const d=cmpPontos(context('Dez/2025'));
 assert.match(d,/19% das vendas em 2022, o ano mais enxuto, e 20% em 2025/);assert.match(d,/, o melhor ano, e /);assert.doesNotMatch(d,/nos mesmos meses de/);
});
function cmpPontos(c){return c.json('cmpLeitura(cmpModelo())').pontos.join('\n');}
test('crescimento com seta e tom de bom ou ruim pela direção da linha; dívidas e sócios neutros; empréstimo azul e dívida vermelha no gráfico',()=>{
 const h=context().run('renderComparativos()'),cr=h.slice(h.indexOf('Crescimento de cada linha'));
 const linha=n=>cr.slice(cr.indexOf(`>${n}</th>`),cr.indexOf('</tr>',cr.indexOf(`>${n}</th>`)));
 assert.match(linha('Vendas'),/class="num delta-bom"[^>]*>▲ \d/,'vendas subiram: bom');
 assert.match(linha('Pessoal'),/class="num delta-ruim"[^>]*>▲ \d/,'pessoal subiu: ruim, sem a cor fixa do destaque');
 assert.doesNotMatch(linha('Pessoal'),/delta-ruim" style="[^"]*color/);
 assert.doesNotMatch(linha('Retiradas e arrendamento (sócios)')+linha('Dívidas pagas'),/delta-/,'financiamento e sócios sem bom ou ruim');
 assert.doesNotMatch(cr,/>[+−]\d/,'a seta substitui o sinal');
 const div=h.slice(h.indexOf('Empréstimos recebidos e dívidas pagas'));assert.match(div,/cmp-grupos[\s\S]*g-cor-entrada[\s\S]*g-cor-saida/);assert.doesNotMatch(div.slice(0,div.indexOf('</figure>')),/g-cor-serie-/);
 assert.match(h,/sem mês completo|Ano de referência/);assert.doesNotMatch(h,/meses fechados|mês fechado/);
});

// ── v135 ──
test('v135 (I17): o ano anterior nos mesmos meses, na tabela da DRE e no veredito da leitura',()=>{
 const c=context('Ago/2026'),M=c.json('(()=>{const M=cmpModelo();return {ref:[M.refAno,M.refMes],mp:M.mesmoPeriodo&&{ano:M.mesmoPeriodo.ano,meses:M.mesmoPeriodo.meses,cls:M.mesmoPeriodo.mesesCls,fixas:M.mesmoPeriodo.pct.fixas},p25:M.porAno.find(p=>p.ano===2025).meses.length}})()');
 assert.deepEqual(M.ref,[2026,8]);assert.equal(M.mp.ano,2025);assert.deepEqual(M.mp.meses,[1,2,3,4,5,6,7,8]);assert.deepEqual(M.mp.cls,[1,2,3,4,5,6,7,8]);
 assert.equal(M.p25,12,'a coluna do ano inteiro continua');perto(M.mp.fixas,20,.3);
 const h=c.run('renderComparativos()'),s3=h.slice(h.indexOf('data-cmp-sec="dre"'),h.indexOf('data-cmp-sec="margens"'));
 assert.match(s3,/<th scope="col" class="num">2025<\/th><th scope="col" class="num">2025<br><small>jan a ago<\/small><\/th><th scope="col" class="num">2026<br><small>jan a ago<\/small><\/th>/,'coluna 2025 jan a ago antes de 2026');
 const lin=s3.slice(s3.indexOf('>(−) Despesas fixas</th>'));assert.equal((lin.slice(0,lin.indexOf('</tr>')).match(/<td/g)||[]).length,7,'a linha ganha a célula da coluna nova');
 const t=c.json('cmpLeitura(cmpModelo())').pontos.join('\n');
 assert.match(t,/<b>As despesas fixas subiram<\/b>: 25% das vendas em 2026 até ago; nos mesmos meses de 2025 \(jan a ago\) eram 20%\. No ano inteiro de 2025, 20%/);
 assert.match(t,/<b>A margem de contribuição ficou estável<\/b>: [^<]*nos mesmos meses de 2025 \(jan a ago\) eram 60%/);
 assert.match(t,/<b>O resultado antes dos sócios caiu<\/b>: [^<]*nos mesmos meses de 2025 \(jan a ago\) eram 39%/);
 // ano de referência inteiro: sem a coluna e sem o mesmo período
 const d=context('Dez/2025');assert.equal(d.run('cmpModelo().mesmoPeriodo'),null);assert.doesNotMatch(d.run('renderComparativos()'),/jan a dez|o ano anterior só nos meses/);
});
test('v135 (D21, D23, D28, I30): só Vendas aberta, grupo zerado listado sem tabela, nota do "·" uma vez por seção, título sem eyebrow',()=>{
 const c=context('Ago/2026'),h=c.run('renderComparativos()');
 assert.deepEqual([...h.matchAll(/data-cmp-sec="(\w+)"( open)?>/g)].filter(m=>m[2]).map(m=>m[1]),['vendas']);
 c.run("cmpUI.abertos={dre:true,vendas:false}");const a=c.run('renderComparativos()');assert.match(a,/data-cmp-sec="dre" open>/);assert.match(a,/data-cmp-sec="vendas">/,'a escolha salva continua vencendo');
 assert.doesNotMatch(h,/COMPARATIVOS ANUAIS|class="eyebrow"/);assert.match(h,/<div class="section-heading" id="comparativos-anuais"><div><h2>Comparativos anuais<\/h2><\/div><\/div>/);
 const sec=k=>{const i=h.indexOf(`data-cmp-sec="${k}"`),j=h.indexOf('data-cmp-sec="',i+1);return h.slice(i,j<0?undefined:j);};
 for(const k of ['variaveis','fixas','depois'])assert.equal((sec(k).match(/· = nenhum lançamento na conta naquele ano\./g)||[]).length,1,k);
 assert.doesNotMatch(h,/<caption>· = /,'a nota saiu das tabelas');
 assert.match(sec('variaveis'),/^[^>]*><summary><h2 class="card-titulo">[^<]*<\/h2><\/summary><div class="card-body"><p class="hint">· = nenhum lançamento/,'a seção 5 começa pela nota');
 // Veículos e administrativas não têm lançamento nesta base: sem tabela, listados no fim
 const f=sec('fixas');assert.doesNotMatch(f,/<h3 class="cmp-h3">Veículos<\/h3>|<h3 class="cmp-h3">Administrativas e terceiros<\/h3>/);
 assert.match(f,/<p class="hint">Sem lançamento em nenhum ano: Administrativas e terceiros, Veículos\.<\/p>/);assert.match(f,/<h3 class="cmp-h3">Pessoal<\/h3><div class="table-scroll">/);
 assert.match(sec('depois'),/Sem lançamento em nenhum ano: Investimentos e parcelas de ativos, Saídas sem detalhamento\./);
 assert.equal(c.run("cmpDetalheTabela(cmpModelo(),'veiculos','Veículos')"),'');
 // I30: o resultado tem nome
 const m=sec('margens');assert.match(m,/Margem, despesas fixas e resultado antes dos sócios/);assert.match(m,/<th[^>]*>Resultado antes dos sócios<\/th>/);assert.doesNotMatch(m,/<th[^>]*>Resultado<\/th>/);
});
