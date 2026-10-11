// Capital de giro (Fase 6.1): contas a pagar do Painel classificadas pelo número do
// centro de custo, projeções à parte, necessidade de giro sem inventar estoque.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
import {agregarPagar,consultarGiro,grupoDe,GRUPOS} from '../supabase/functions/dre-sync/giro.mjs';
import {consultarIndicadores} from '../supabase/functions/dre-sync/indicadores.mjs';

const EM='2026-10-11T01:49:08.839+00:00',AGORA=new Date('2026-10-11T02:09:08Z');// hoje em São Paulo: 10/10/2026
const dia=dias=>new Date(Date.parse('2026-10-10T00:00:00Z')-dias*86400000).toISOString().slice(0,10);
const c=(id,valor,dias,categoria,extra={})=>({id:String(id),fornecedor:'Credor '+id,descricao:'Conta '+id,categoria,tipo:'pagar',valor,valorTitulo:valor,pago:0,vencimento:dia(dias),...extra});
const prov=(id,valor,categoria,venc='')=>({id:String(id),fornecedor:categoria,descricao:categoria,categoria,valor,vencimento:venc,tipo:'provisao'});
const PAGAR=[c(1,1000,-10,'1.01 Impressão digital/UV'),c(2,500,5,'1.04 Serralheria'),c(3,800,40,'2.02 Administrativo e RH'),c(4,300,0,'3.02 Impostos e taxas'),c(5,2000,-20,'3.03 Prédio e infraestrutura'),
 c(6,700,-5,'3.01 Sócios (retiradas, arrendamento, benefícios)'),c(7,5000,-30,'3.04 Empréstimos e financiamentos'),c(8,150,95,'1.07 Acabamento'),prov(9,4000,'Despesa fixa',dia(-15)),prov(10,900,'Cartao')];
const ag=(lista,extra={})=>agregarPagar({lista,atualizadoEm:EM,corte:'2025-01-01',agora:AGORA,...extra});

test('classe do centro de custo: nome primeiro (o contador renumera), depois o grupo do número',()=>{
 const casos={'1.01 Impressão digital/UV':'producao','1.11 Expedição e entrega':'producao','2.02 Administrativo e RH':'apoio','2.08 TI e sistemas':'apoio','3.01 Sócios':'socios','3.02 Impostos e taxas':'impostos','3.03 Prédio':'predio','3.04 Empréstimos':'emprestimos',
  ' 1.04 Serralheria':'producao','1.04':'producao','3.05 Outra':'semClasse','4.01 X':'semClasse','1.010 X':'semClasse','Materia Prima Serralheria':'semClasse','Despesa fixa':'semClasse','':'semClasse',null:'semClasse','Fornecedor':'semClasse',
  '3.07 Empréstimos bancários':'emprestimos','Sócios':'socios','4.01 Impostos':'impostos','Taxa de Resíduos':'impostos','1.09 Retirada de material':'producao','Pró-labore':'socios','EMPRESTIMO':'emprestimos'};
 for(const [k,v] of Object.entries(casos))assert.equal(grupoDe(k==='null'?null:k),v,k);
 assert.deepEqual(GRUPOS.filter(g=>g.ncg).map(g=>g.id),['producao','apoio','impostos','predio'],'só fornecedores, impostos e prédio entram na necessidade de giro');
});
test('a pagar classificado: grupos somam o total, operacional sem sócios, empréstimos nem projeções; faixas na fronteira',()=>{
 const r=ag(PAGAR);assert.equal(r.disponivel,true);assert.equal(r.qualidade,'Apurado');
 const g=Object.fromEntries(r.grupos.map(x=>[x.id,[x.valor,x.quantidade,x.vencido,x.aVencer]]));
 assert.deepEqual(g,{producao:[1650,3,650,1000],apoio:[800,1,800,0],impostos:[300,1,0,300],predio:[2000,1,0,2000],socios:[700,1,0,700],emprestimos:[5000,1,0,5000],semClasse:[0,0,0,0]});
 assert.deepEqual(r.totais,{titulos:10450,operacional:4750,vencidoOperacional:1450,semClasse:0,quantidade:8});
 assert.equal(r.grupos.reduce((t,x)=>t+x.valor,0),r.totais.titulos);
 assert.deepEqual(r.faixas.map(f=>[f.id,f.valor,f.quantidade]),[['avencer',3300,3],['d1_30',500,1],['d31_60',800,1],['d61_90',0,0],['d91',150,1]],'vence hoje = a vencer; 95 dias = mais de 90');
 assert.equal(r.faixas.reduce((t,f)=>t+f.valor,0),r.totais.operacional);
 assert.deepEqual(r.projetado,{quantidade:2,valor:4900,categorias:[{rotulo:'Despesa fixa',valor:4000,quantidade:1},{rotulo:'Cartao',valor:900,quantidade:1}]},'projeção sem data também conta, à parte');
 assert.deepEqual(r.grupos.find(x=>x.id==='producao').categorias.map(k=>[k.rotulo,k.valor]),[['1.01 Impressão digital/UV',1000],['1.04 Serralheria',500],['1.07 Acabamento',150]]);
 assert.deepEqual(r.titulos.map(x=>x.valor),[5000,2000,1000,800,700,500,300,150],'da maior para a menor; projeções fora da lista');
});
test('sem classe no Mubisys: fora do operacional, à vista e marcando a leitura como parcial',()=>{
 const r=ag([...PAGAR,c(20,600,10,'Materia Prima Serralheria'),c(21,50,3,'Fornecedor')]);
 assert.deepEqual([r.totais.semClasse,r.totais.operacional,r.qualidade],[650,4750,'Parcial']);
 assert.deepEqual(r.grupos.find(x=>x.id==='semClasse').categorias.map(k=>k.rotulo),['Materia Prima Serralheria','Fornecedor']);
 assert.ok(r.avisos.some(a=>/2 conta\(s\) sem número de centro de custo no Mubisys ficam fora do a pagar operacional até serem reclassificadas/.test(a)));
});
test('antes do corte, sem vencimento, sem saldo e repetida: fora e contadas; mesmo id em título e projeção são coisas diferentes',()=>{
 const r=ag([...PAGAR,c(30,9000,700,'1.01 X',{vencimento:'2024-12-31'}),c(31,100,5,'1.01 X',{vencimento:'2025-01-01'}),c(32,80,5,'1.01 X',{vencimento:''}),c(33,0,5,'1.01 X'),c(34,'abc',5,'1.01 X'),{...c(1,999,3,'1.01 X')},prov(1,10,'Despesa fixa',dia(-3)),null]);
 assert.deepEqual(r.antigas,{quantidade:1,valor:9000});assert.equal(r.grupos.find(x=>x.id==='producao').quantidade,4,'vencida no dia do corte continua (como no Painel: venc < corte)');
 assert.deepEqual(r.semVencimento,{quantidade:1,valor:80});assert.equal(r.ausentes,3);assert.equal(r.repetidos,1);assert.equal(r.projetado.quantidade,3);assert.equal(r.qualidade,'Parcial');
 assert.equal(ag([c(1,0.29,5,'1.01 X'),c(2,1234.57,5,'1.01 X'),c(3,0.57,5,'1.01 X')]).totais.operacional,1235.43,'centavos arredondados');
});
test('sem carga, lista vazia ou nada legível: indisponível, nunca zero',()=>{
 for(const [lista,re] of [[null,/ainda não foram carregadas/],[{},/ainda não foram carregadas/],[[],/nenhum zero foi assumido/],[[c(1,100,5,'1.01',{vencimento:'01/09/2026'}),c(2,null,5,'1.01')],/Nenhuma das 2 contas da carga do Painel tem vencimento e saldo legíveis \(1 sem vencimento válido, 1 sem saldo válido\)/]]){
  const r=ag(lista);assert.equal(r.disponivel,false);assert.equal(r.totais,null);assert.match(r.avisos[0],re);
 }
 assert.equal(ag(PAGAR,{atualizadoEm:null}).disponivel,false);
 const so=ag([prov(1,100,'Despesa fixa',dia(-3))]);assert.equal(so.disponivel,true);assert.equal(so.totais.operacional,0);assert.equal(so.projetado.quantidade,1,'só projeção: a pagar zero de verdade, com a projeção à vista');
 assert.equal(ag(Array.from({length:230},(_,i)=>c(i+1,i+1,5,'1.01 X'))).truncado,true);
});
test('carga atrasada e corte ilegível ficam marcados',()=>{
 assert.ok(ag(PAGAR,{agora:new Date(Date.parse(EM)+91*60000)}).avisos.some(a=>/carga das contas a pagar está atrasada/.test(a)));
 const r=ag(PAGAR,{corte:'2025-13-01'});assert.deepEqual([r.corte.origem,r.qualidade],['padrao','Parcial']);
});

function banco({rec={valor:[{id:'r1',cliente:'A',cnpj:'',nf:'1',os:'1',valor:3000,valorTitulo:3000,pago:0,emissao:dia(40),vencimento:dia(10),situacao:'aberto'},{id:'r2',cliente:'B',cnpj:'',nf:'2',os:'2',valor:2000,valorTitulo:2000,pago:0,emissao:dia(5),vencimento:dia(-20),situacao:'aberto'}],atualizado_em:EM},pag={valor:PAGAR,atualizado_em:EM},erros={}}={}){
 const lidos=[];return {lidos,from(t){const q={f:{},sel:'',select(s){q.sel=s;return q;},eq(k,v){q.f[k]=v;return q;},maybeSingle(){const chave=t==='painel_cache'?q.f.chave:t;lidos.push(t+'|'+(q.f.chave||''));
  if(erros[chave])return Promise.resolve({data:null,error:new Error('x')});return Promise.resolve({data:t==='painel_config_global'?{corte:'2025-01-01'}:chave==='recebiveis'?rec:chave==='pagar'?pag:null,error:null});}};return q;}};}
test('servidor: necessidade de giro sem estoque = a receber − a pagar operacional; rota dos indicadores sem período',async()=>{
 const sb=banco(),r=await consultarGiro(sb,{},AGORA);
 assert.deepEqual([r.ok,r.fonte,r.disponivel,r.qualidade],[true,'capitalGiro',true,'Apurado']);
 assert.deepEqual(r.ncg,{semEstoque:5000-4750,receber:5000,pagarOperacional:4750});assert.equal(r.receber.corte.data,'2025-01-01');
 assert.deepEqual(sb.lidos.sort(),['painel_cache|pagar','painel_cache|recebiveis','painel_config_global|']);
 assert.equal((await consultarIndicadores(banco(),{fonte:'capitalGiro'})).fonte,'capitalGiro');
 await assert.rejects(()=>consultarGiro(banco({erros:{pagar:1}}),{}),/Não foi possível ler as contas a receber e a pagar do Painel/);
 const semRec=await consultarGiro(banco({rec:null}),{},AGORA);assert.deepEqual([semRec.disponivel,semRec.ncg.semEstoque,semRec.receber.disponivel,semRec.qualidade],[true,null,false,'Indisponível']);
 const nada=await consultarGiro(banco({rec:null,pag:null}),{},AGORA);assert.equal(nada.disponivel,false);
});

// ── Tela ──────────────────────────────────────────────────────────────────
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
async function payload(extra={}){return consultarGiro(banco(extra),{},AGORA);}
function tela({dados=null,op={},admin=true,api=null}={}){
 const ctx={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout,Promise};vm.createContext(ctx);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),ctx,{filename:f});
 ctx.run=s=>vm.runInContext(s,ctx);ctx.__cfg={parametros:{operacao:op}};ctx.__chamadas=0;ctx.__renders=0;ctx.__api=api||(async()=>{ctx.__chamadas++;return dados;});
 ctx.run(`api=(...a)=>__api(...a);render=()=>{__renders++};state.records=[];state.cfg=__cfg;state.view='giro';state.periodo='Out/2026';state.permissoes={leitura:true,edicao:${admin},admin:${admin}}`);
 if(dados)ctx.run(`giroUI.dados=${JSON.stringify(dados)};giroUI.em=Date.now()`);return ctx;
}
const cartoes=h=>[...h.matchAll(/<div class="metric metric-param"><span class="label">([^<]*)<\/span><strong class="([^"]*)">([^<]*)<\/strong><small>([^<]*)<\/small>/g)].map(m=>({rotulo:m[1],tom:m[2],valor:m[3].replace(/\s/g,' '),nota:m[4]}));
test('tela: quatro cards, estoque de Parâmetros do mês de hoje, cascata, classes e vencimentos',async()=>{
 const d=await payload(),h=tela({dados:d,op:{'2026-10':{estoque:1200,prazoRecebimento:30,prazoPagamento:45}}}).run('renderGiro()'),k=cartoes(h);
 assert.deepEqual(k.map(x=>[x.rotulo,x.tom,x.valor]),[['Necessidade de capital de giro','','R$ 1.450,00'],['A receber','','R$ 5.000,00'],['A pagar operacional','','R$ 4.750,00'],['Estoque','','R$ 1.200,00']]);
 assert.match(k[0].nota,/^A receber R\$\s5\.000,00 \+ estoque R\$\s1\.200,00 − a pagar operacional R\$\s4\.750,00$/);assert.match(k[2].nota,/R\$\s1\.450,00 já vencido$/);
 assert.equal((h.match(/<figure class="g-fig g-(cascata|barras|cem)/g)||[]).length,3);assert.match(h,/g-cor-saida/,'o que se deve não usa o azul de entrada');
 assert.match(h,/<tr class=""><th scope="row">Fornecedores de produção \(1\.xx\)<\/th><td>Sim<\/td><td class="num">3<\/td><td class="num">R\$\s650,00<\/td><td class="num">R\$\s1\.000,00<\/td><td class="num">R\$\s1\.650,00<\/td><\/tr>/);
 assert.match(h,/<tr class="giro-fora"><th scope="row">Empréstimos e financiamentos \(3\.04\)<\/th><td>Não<\/td>/);assert.match(h,/Projetado no Mubisys \(ainda não é título\)<\/th><td>Não<\/td><td class="num">2<\/td>/);
 assert.match(h,/Prazos em Parâmetros \(Out\/2026\): recebimento <b>30 dias<\/b>, pagamento <b>45 dias<\/b>/);assert.match(h,/vence em 10 dias/);
 assert.doesNotMatch(h,/Falta o estoque/);assert.match(tela({dados:d}).run("paginasDoApp().giro()"),/Necessidade/);
});
test('sem estoque: necessidade "sem estoque", rotulada, e o caminho para Parâmetros no mês de hoje',async()=>{
 const d=await payload(),h=tela({dados:d}).run('renderGiro()'),k=cartoes(h);
 assert.deepEqual([k[0].rotulo,k[0].valor],['Necessidade de giro sem estoque','R$ 250,00']);assert.match(k[0].nota,/falta o estoque de Out\/2026 em Parâmetros/);
 assert.deepEqual([k[3].valor,k[3].tom],['Não informado','']);assert.match(h,/<h2>Falta o estoque<\/h2>[\s\S]*data-go="parametros" data-rec-mes="Out\/2026">Informar em Parâmetros/);
 assert.match(tela({dados:d,admin:false}).run('renderGiro()'),/Peça a um administrador[\s\S]*>Ver Parâmetros/);
 assert.match(h,/Prazos em Parâmetros \(Out\/2026\): recebimento <b>não informado<\/b>/);
});
test('servidor anterior a esta fase e leitura com erro: dito com clareza, uma leitura por minuto',async()=>{
 const c1=tela({api:async()=>({erro:'Escolha um intervalo válido de até 12 meses.'})});c1.run('renderGiro()');await new Promise(r=>setTimeout(r,5));
 const h=c1.run('renderGiro()');assert.match(h,/O servidor ainda não tem a leitura do capital de giro/);assert.deepEqual(cartoes(h).map(x=>x.valor),['Não apurado','Não apurado','Não apurado','Não apurado']);
 const c2=tela({api:async()=>{c2.__chamadas++;throw new Error('rede');}});c2.run('renderGiro();renderGiro()');await new Promise(r=>setTimeout(r,5));c2.run('renderGiro()');await new Promise(r=>setTimeout(r,5));assert.equal(c2.__chamadas,1);assert.equal(c2.__renders,1);
});
test('credor, descrição e centro de custo escapados; planilha sem fórmula executável',async()=>{
 const d=await payload();d.pagar.titulos[0].fornecedor='<img src=x onerror=alert(1)>';d.pagar.titulos[0].descricao='=HYPERLINK("x")';d.pagar.titulos[0].categoria='<b>cc</b>';
 const c=tela({dados:d}),h=c.run('renderGiro()');for(const re of [/<img src=x/,/<b>cc<\/b>/])assert.doesNotMatch(h,re);
 c.run('download=(n,t)=>{__csv={n,t}}');const rows=JSON.parse(c.run('JSON.stringify(giroCSV())'));
 assert.equal(c.run('__csv.n'),'contas-a-pagar-2026-10-10.csv');assert.deepEqual(rows[3],['Credor','Descrição','Centro de custo','Classe','Entra na necessidade de giro','Vencimento','Dias (positivo = vencido)','Valor (R$)']);
 assert.deepEqual(rows[4].slice(3),['Empréstimos e financiamentos (3.04)','Não',dia(-30).split('-').reverse().join('/'),'-30','5000,00']);assert.match(c.run('__csv.t'),/"'=HYPERLINK\(""x""\)"/);
});

// ── Casos da revisão da 6.1 ───────────────────────────────────────────────
const REC=[{id:'r1',cliente:'A',cnpj:'',nf:'1',os:'1',valor:3000,valorTitulo:3000,pago:0,emissao:dia(40),vencimento:dia(10),situacao:'aberto'},{id:'r2',cliente:'B',cnpj:'',nf:'2',os:'2',valor:2000,valorTitulo:2000,pago:0,emissao:dia(5),vencimento:dia(-20),situacao:'aberto'}];
const rects=(h,tipo)=>[...(h.match(new RegExp(`<figure class="g-fig g-${tipo}[\\s\\S]*?</figure>`))||[''])[0].matchAll(/<rect class="g-marca-dado (g-cor-[\w-]+)"[^>]*data-dica="([^"]*)"/g)].map(m=>[m[1],m[2].split('\n')[0],m[2].split('\n')[1]]);
test('horizonte comum: a receber cortado em 60 dias da carga, como o a pagar; o resto é contado e dito',async()=>{
 const d=await payload({rec:{valor:[...REC,{...REC[0],id:'r3',valor:7000,valorTitulo:7000,vencimento:dia(-75)}],atualizado_em:EM}});
 assert.deepEqual(d.horizonte,{dias:60,ate:'2026-12-09',receberFora:{quantidade:1,valor:7000}});assert.equal(d.ncg.receber,5000,'o título de +75 dias não entra');
 const h=tela({dados:d}).run('renderGiro()'),k=cartoes(h);assert.match(k[1].nota,/^Vencidos e a vencer até 09\/12\/2026 \(60 dias da carga, o mesmo horizonte das contas a pagar\)/);assert.match(k[2].nota,/vencidas e a vencer até 09\/12\/2026/);
 assert.match(h,/1 título\(s\) a receber que vencem depois de 09\/12\/2026 \(R\$\s7\.000,00\) ficam fora da necessidade de giro e estão na tela Recebíveis\./);
});
test('cargas de horários diferentes: aviso, as duas horas e leitura parcial',async()=>{
 const d=await payload({rec:{valor:REC,atualizado_em:'2026-10-08T01:00:00Z'}});
 assert.equal(d.qualidade,'Parcial');assert.match(d.avisos[0],/As cargas do Painel são de horários diferentes/);assert.ok(d.avisos.some(a=>/^A receber: A carga do Painel não roda há mais de um dia/.test(a)));
 const h=tela({dados:d}).run('renderGiro()');assert.match(h,/Posição do Painel: a receber de 07\/10\/2026,? 22:00, a pagar de 10\/10\/2026,? 22:49/);assert.match(h,/<b>Leitura parcial\.<\/b>/);
});
test('sem as contas a pagar: gráficos dizem "Não apurado", nunca "nenhuma conta"',async()=>{
 const h=tela({dados:await payload({pag:null})}).run('renderGiro()');assert.equal((h.match(/Não apurado: faltam as contas a pagar do Painel\./g)||[]).length,2);assert.doesNotMatch(h,/Nenhuma conta/);
});
test('cores: na cascata, a pagar desconta em vermelho e o estoque soma em azul; barras do que se deve em vermelho',async()=>{
 const d=await payload(),h=tela({dados:d,op:{'2026-10':{estoque:1200}}}).run('renderGiro()');
 const cas=rects(h,'cascata');assert.deepEqual(cas.map(x=>[x[0],x[1]]),[['g-cor-resultado','A receber'],['g-cor-entrada','Estoque'],['g-cor-saida','A pagar operacional'],['g-cor-resultado','Necessidade de giro']]);
 assert.match(cas[2][2],/^-R\$/);const bar=rects(h,'barras');assert.ok(bar.length>0&&bar.every(x=>x[0]==='g-cor-saida'),JSON.stringify(bar));
 assert.deepEqual(rects(tela({dados:d}).run('renderGiro()'),'cascata').map(x=>x[1]),['A receber','A pagar operacional','Sem estoque']);
});
test('lado ausente sai null, nunca zero, e a tela diz "Não apurado"',async()=>{
 const semPag=await payload({pag:null}),semRec=await payload({rec:null});assert.equal(semPag.ncg.pagarOperacional,null);assert.equal(semRec.ncg.receber,null);
 assert.deepEqual(cartoes(tela({dados:semPag}).run('renderGiro()')).map(x=>x.valor).slice(0,3),['Não apurado','R$ 5.000,00','Não apurado']);
 assert.deepEqual(cartoes(tela({dados:semRec}).run('renderGiro()')).map(x=>x.valor).slice(0,3),['Não apurado','Não apurado','R$ 4.750,00']);
 await assert.rejects(()=>consultarGiro(banco({erros:{recebiveis:1}}),{}),/Não foi possível ler/);
});
test('dias contados até hoje, não até a carga; fronteiras 30, 60 e 90',()=>{
 const r=ag([c(1,100,5,'1.01 X')],{agora:new Date(Date.parse(EM)+3*86400000)});assert.equal(r.titulos[0].dias,8);assert.equal(r.posicao.base,'2026-10-13');
 assert.deepEqual(ag([30,31,60,61,90,91].map((d,i)=>c(i+1,10*(i+1),d,'1.01 X'))).faixas.map(f=>[f.id,f.valor]),[['avencer',0],['d1_30',10],['d31_60',50],['d61_90',90],['d91',60]]);
});
test('o que fica fora é dito, no servidor e na tela',async()=>{
 const r=ag([...PAGAR,c(30,9000,700,'1.01 X',{vencimento:'2024-12-31'}),c(32,80,5,'1.01 X',{vencimento:''}),c(33,0,5,'1.01 X'),{...c(1,999,3,'1.01 X')}],{corte:null});
 for(const re of [/1 conta\(s\) vencida\(s\) antes de 01\/01\/2025 ficam fora/,/1 conta\(s\) sem data de vencimento válida/,/1 conta\(s\) sem saldo válido/,/1 conta\(s\) repetida\(s\)/,/foi usado o padrão 01\/01\/2025/])assert.ok(r.avisos.some(a=>re.test(a)),String(re));
 const d=await payload({pag:{valor:[...PAGAR,c(20,600,10,'Materia Prima'),c(30,9000,700,'1.01 X',{vencimento:'2024-12-31'})],atualizado_em:EM}}),h=tela({dados:d}).run('renderGiro()');
 assert.match(h,/<li>A pagar: 1 conta\(s\) sem número de centro de custo no Mubisys/);
 assert.match(h,/<tr class="giro-fora"><th scope="row">Vencidas antes de 01\/01\/2025<\/th><td>Não<\/td><td class="num">1<\/td><td class="num">R\$\s9\.000,00<\/td>/);
 assert.match(h,new RegExp(`prazo concedido médio <b>${d.receber.prazo.concedido.dias} dias</b> e idade média <b>${d.receber.prazo.idade.dias} dias</b>`));
});
test('escapa tudo que vem do Mubisys e do servidor',async()=>{
 const X='<img src=x onerror=alert(1)>',d=await payload();d.pagar.grupos[0].categorias[0].rotulo=X;d.pagar.projetado.categorias[0].rotulo=X;d.avisos.push(X);
 assert.doesNotMatch(tela({dados:d}).run('renderGiro()'),/<img src=x/);
 const nd={ok:true,fonte:'capitalGiro',disponivel:false,pagar:{disponivel:false,avisos:[X]},receber:{disponivel:false,avisos:[]}};assert.doesNotMatch(tela({dados:nd}).run('renderGiro()'),/<img src=x/);
 const c1=tela({api:async()=>({ok:false,erro:X})});c1.run('renderGiro()');await new Promise(r=>setTimeout(r,5));assert.doesNotMatch(c1.run('renderGiro()'),/<img src=x/);
});
test('reler com erro mostra a última leitura; lista cortada em 200 é dita; "Ler de novo" devolve o foco e a seção aberta continua aberta',async()=>{
 const d=await payload(),c1=tela({dados:d,api:async()=>{throw new Error('rede');}});c1.run('carregarGiro(true)');await new Promise(r=>setTimeout(r,5));assert.match(c1.run('renderGiro()'),/rede Mostrando a última leitura\./);
 const g=await payload({pag:{valor:Array.from({length:230},(_,i)=>c(i+1,i+1,5,'1.01 X')),atualizado_em:EM}});assert.equal(g.pagar.titulos.length,200);
 const t=tela({dados:g});assert.match(t.run('renderGiro()'),/as 200 maiores de 230/);t.run('download=()=>{}');assert.deepEqual(JSON.parse(t.run('JSON.stringify(giroCSV())')).at(-1),['Lista com as 200 maiores de 230 contas.']);
 const ls={},doc={addEventListener(tp,f){(ls[tp]||=[]).push(f);},querySelector(){return {focus(){doc.focado=true;}};}};const w=tela({dados:d});w.__doc=doc;w.run('document=__doc;wireGiro()');
 ls.toggle.forEach(f=>f({target:{classList:{contains:k=>k==='giro-detalhe'},open:true}}));assert.match(w.run('renderGiro()'),/<details class="card giro-detalhe" open>/);
 ls.click.forEach(f=>f({target:{closest:()=>({hasAttribute:()=>false})}}));assert.equal(w.run('giroUI.foco'),true);assert.equal(doc.focado,true);
});
