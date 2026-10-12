// Recebíveis e aging (Fase 5): a posição que o Painel grava em painel_cache, agregada
// com a régua da tela Contas Atrasadas do Painel; nada ausente vira zero, CNPJ não sai.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
import {agregarRecebiveis,consultarRecebiveis,diaSP,diasEntre,CORTE_PADRAO} from '../supabase/functions/dre-sync/recebiveis.mjs';
import {consultarIndicadores} from '../supabase/functions/dre-sync/indicadores.mjs';

// Posição gravada às 22:49 de São Paulo de 10/10 (01:49 UTC de 11/10): o dia base é 10/10.
const EM='2026-10-11T01:49:08.839+00:00',AGORA=new Date('2026-10-11T02:09:08Z');
const venc=dias=>new Date(Date.parse('2026-10-10T00:00:00Z')-dias*86400000).toISOString().slice(0,10);
const t=(id,valor,dias,extra={})=>({id:String(id),nf:'NF'+id,os:'OS'+id,cnpj:'11.222.333/0001-'+String(id%100).padStart(2,'0'),cliente:'Cliente '+id,valor,valorTitulo:valor,pago:0,emissao:venc(dias+30),vencimento:venc(dias),situacao:'aberto',...extra});
const BASE=[t(1,1000,0),t(2,2000,-80),t(3,100,1),t(4,200,30),t(5,300,31),t(6,400,60),t(7,500,61),t(8,600,90),t(9,700,91),t(10,800,400)];
const ag=(lista,extra={})=>agregarRecebiveis({lista,atualizadoEm:EM,dsoHist:[],corte:'2025-01-01',agora:AGORA,...extra});

test('dia da posição e dias entre datas no fuso de São Paulo, datas do ERP como estão',()=>{
 assert.equal(diaSP(EM),'2026-10-10');assert.equal(diaSP('2026-10-11 01:49:08.839+00'),'2026-10-10','formato do Postgres');
 assert.equal(diaSP('2026-10-11T03:00:00Z'),'2026-10-11');for(const s of ['2026-09-15','2026-09-15 00:00:00','2026-09-15T00:00:00'])assert.equal(diaSP(s),'2026-09-15');
 for(const s of ['','2026-02-30','15/09/2026',null,undefined,'abc'])assert.equal(diaSP(s),null,String(s));
 assert.equal(diasEntre('2026-09-30','2026-10-10'),10);assert.equal(diasEntre('2026-10-10','2026-10-10'),0);
});
test('faixas fechadas nas pontas, a vencer ≤ 0 dia, vencido a partir de 1 dia, como no Painel',()=>{
 const r=ag(BASE);assert.equal(r.disponivel,true);assert.equal(r.qualidade,'Apurado');
 assert.deepEqual(r.faixas.map(f=>[f.id,f.valor,f.quantidade]),[['avencer',3000,2],['d1_30',300,2],['d31_60',700,2],['d61_90',1100,2],['d91',1500,2]]);
 assert.deepEqual(r.totais,{aberto:6600,aVencer:3000,vencido:3600,titulos:10,vencidos:8,clientes:10});
 assert.equal(r.posicao.base,'2026-10-10');assert.equal(r.posicao.idadeMin,20);assert.deepEqual(r.corte,{data:'2025-01-01',origem:'painel'});
 assert.equal(r.titulosVencidos.length,8);assert.deepEqual(r.titulosVencidos[0],{cliente:'Cliente 10',nf:'NF10',os:'OS10',vencimento:venc(400),dias:400,faixa:'d91',valor:800});
});
test('dívida antes do corte, sem vencimento, sem saldo e repetida ficam fora e são contadas',()=>{
 const lista=[...BASE,t(11,5000,700,{vencimento:'2024-12-31'}),t(12,50,10,{vencimento:''}),t(13,0,5),t(14,-10,5),t(15,null,5),t(16,'abc',5),{...t(3,999,3)},null];
 const r=ag(lista);
 assert.equal(r.totais.vencido,3600,'nada disso entra no vencido');assert.deepEqual(r.antigas,{quantidade:1,valor:5000});assert.deepEqual(r.semVencimento,{quantidade:1,valor:50});
 assert.equal(r.ausentes,5);assert.equal(r.repetidos,1);assert.equal(r.qualidade,'Parcial');
 assert.ok(r.avisos.some(a=>/1 título\(s\) vencido\(s\) antes de 01\/01\/2025 ficam fora de todos os números, como na tela Contas Atrasadas do Painel/.test(a)));
 assert.ok(r.avisos.some(a=>/sem data de vencimento/.test(a)));assert.ok(r.avisos.some(a=>/sem saldo válido/.test(a)));assert.ok(r.avisos.some(a=>/repetido/.test(a)));
 const so=ag([t(1,100,5,{vencimento:'2024-06-01'})]);assert.equal(so.totais.vencido,0);assert.equal(so.totais.titulos,0);assert.equal(so.antigas.quantidade,1,'carteira só com dívida antiga: zero ativo, mas a antiga aparece');
});
test('o saldo é o "valor" do item (título − pago); pagamento parcial conta no termômetro de abatidos',()=>{
 const r=ag([t(1,300,10,{valorTitulo:1000,pago:700}),t(2,500,10)]);assert.equal(r.totais.vencido,800);assert.deepEqual(r.abatidos,{com:1,total:2});
});
test('concentração por devedor: a chave do "Quem deve" do Painel (o nome como vem); top 10, demais, top 5 e maior atraso',()=>{
 const xs=[t(1,600,10,{cnpj:'11222333000181',cliente:'ACME COMUNICACAO'}),t(2,600,60,{cnpj:'',cliente:'ACME COMUNICACAO'}),t(3,1000,5,{cnpj:'',cliente:'BETA'}),
  t(4,700,20,{cnpj:'',cliente:'José da Silva'}),t(5,700,25,{cnpj:'',cliente:'JOSE DA SILVA'}),t(6,900,-10,{cliente:'Só a vencer'})];
 const c=ag(xs).clientes;
 assert.deepEqual(c.itens.map(x=>[x.nome,x.vencido,x.quantidade,x.maiorAtraso]),[['ACME COMUNICACAO',1200,2,60],['BETA',1000,1,5],['JOSE DA SILVA',700,1,25],['José da Silva',700,1,20]],'mesmo nome com e sem CNPJ junta; grafias diferentes não, como no Painel (empate em ordem alfabética)');
 assert.equal(c.devedores,4,'quem só tem título a vencer não é devedor');assert.equal(ag(xs).totais.clientes,5);
 const doze=[...Array.from({length:10},(_,i)=>t(i+1,i===0?5000:250,5+i,{cliente:'C'+(i+1)})),t(11,200,3,{cliente:'C11'}),t(12,5000,-5,{cliente:'C11'}),t(13,100,2,{cliente:'C12'})];
 const d=ag(doze).clientes,venc=5000+9*250+200+100;
 assert.equal(d.itens.length,10);assert.deepEqual(d.demais,{quantidade:2,vencido:300},'demais somam só o vencido');
 assert.equal(d.top5Pct,Math.round((5000+4*250)/venc*1000)/10);assert.equal(d.top1Pct,Math.round(5000/venc*1000)/10);assert.equal(d.itens[0].participacao,d.top1Pct);
 assert.equal(ag([t(1,100,60,{cliente:'X'}),t(2,900,5,{cliente:'X'})]).clientes.itens[0].maiorAtraso,60,'o maior atraso, não o último lido');
 assert.ok(!JSON.stringify(ag(xs)).includes('11222333000181'),'CNPJ não sai do servidor');
});
test('maiores títulos vencidos: ordem por valor e teto de 200, marcado',()=>{
 const r=ag(Array.from({length:230},(_,i)=>t(i+1,i+1,5)));assert.equal(r.titulosVencidos.length,200);assert.equal(r.truncado,true);assert.equal(r.titulosVencidos[0].valor,230);
 assert.equal(ag(BASE).truncado,false);
});
test('prazo: concedido e idade ponderados pelo saldo, com cobertura; série do Painel limpa e ordenada',()=>{
 const xs=[t(1,100,10,{emissao:venc(40)}),t(2,300,-20,{emissao:venc(10)}),t(3,500,5,{emissao:''})];
 const r=ag(xs,{dsoHist:[{dia:'2026-10-09',dso:41},{dia:'2026-10-08',dso:40},{dia:'x',dso:1},{dia:'2026-10-10',dso:'42'},null,{dia:'2026-10-10T00:00:00Z',dso:43}]});
 assert.deepEqual(r.prazo.concedido,{dias:Math.round((100*30+300*30)/400),com:2,total:3});assert.deepEqual(r.prazo.idade,{dias:Math.round((100*40+300*10)/400),com:2,total:3});
 assert.deepEqual(r.prazo.serie,[{dia:'2026-10-08',dso:40},{dia:'2026-10-09',dso:41},{dia:'2026-10-10',dso:43}]);assert.deepEqual(r.prazo.painel,{dia:'2026-10-10',dso:43});
 assert.equal(ag(xs,{dsoHist:Array.from({length:120},(_,i)=>({dia:venc(120-i),dso:i}))}).prazo.serie.length,90);
 assert.deepEqual(ag([t(1,100,5,{emissao:''})]).prazo.idade,{dias:null,com:0,total:1},'sem emissão: não apurado, não zero');
});
test('sem carga, lista vazia ou sem data: indisponível e sem nenhum número',()=>{
 for(const [lista,em,re] of [[null,EM,/ainda não foram carregados/],[{},EM,/ainda não foram carregados/],[[],EM,/nenhum zero foi assumido/],[BASE,null,/não tem data de atualização/]]){
  const r=ag(lista,{atualizadoEm:em});assert.equal(r.disponivel,false);assert.equal(r.qualidade,'Indisponível');assert.equal(r.totais,null);assert.equal(r.faixas,null);assert.match(r.avisos[0],re);
 }
});
test('corte ilegível usa o padrão marcado; carga atrasada fica Parcial com aviso',()=>{
 for(const corte of [null,'','01/01/2025','2025-13-01']){const r=ag(BASE,{corte});assert.deepEqual(r.corte,{data:CORTE_PADRAO,origem:'padrao'});assert.equal(r.qualidade,'Parcial');assert.ok(r.avisos.some(a=>/foi usado o padrão 01\/01\/2025/.test(a)));}
 const velho=ag(BASE,{agora:new Date(Date.parse(EM)+91*60000)});assert.equal(velho.qualidade,'Parcial');assert.ok(velho.avisos.some(a=>/carga do Painel está atrasada/.test(a)));
 assert.ok(ag(BASE,{agora:new Date(Date.parse(EM)+27*3600000)}).avisos.some(a=>/há mais de um dia/.test(a)));
 assert.equal(ag(BASE,{corte:'2026-10-01'}).antigas.quantidade,7,'o corte vem do Painel: tudo que venceu antes dele sai (o de 1 dia, 09/10, fica)');
});

// Banco simulado por tabela e chave, como o PostgREST.
function banco({rec={valor:BASE,atualizado_em:EM},dso={valor:[{dia:'2026-10-10',dso:40}]},cfg={corte:'2025-01-01'},erros={}}={}){
 const lidos=[];return {lidos,from(tabela){const q={f:{},sel:'',select(s){q.sel=s;return q;},eq(k,v){q.f[k]=v;return q;},maybeSingle(){
  const chave=tabela==='painel_cache'?q.f.chave:tabela;lidos.push([tabela,q.sel,JSON.stringify(q.f)]);
  if(erros[chave])return Promise.resolve({data:null,error:new Error('falha')});
  const data=tabela==='painel_config_global'?cfg:chave==='recebiveis'?rec:chave==='dso_hist'?dso:null;return Promise.resolve({data,error:null});}};return q;}};}
test('servidor: lê só recebíveis, histórico de prazo e o corte; passa pela rota dos indicadores sem período',async()=>{
 const sb=banco(),r=await consultarIndicadores(sb,{fonte:'recebiveis'});
 assert.equal(r.ok,true);assert.equal(r.fonte,'recebiveis');assert.equal(r.disponivel,true);
 assert.deepEqual(sb.lidos.map(x=>x[0]+'|'+x[2]).sort(),['painel_cache|{"chave":"dso_hist"}','painel_cache|{"chave":"recebiveis"}','painel_config_global|{"id":true}']);
 assert.equal(sb.lidos.find(x=>x[0]==='painel_config_global')[1],'corte:config->parametros->>dataCorteAtrasados','da configuração do Painel, só o corte');
 await assert.rejects(()=>consultarRecebiveis(banco({erros:{recebiveis:1}}),{}),/Não foi possível ler os recebíveis do Painel/);
 const semDso=await consultarRecebiveis(banco({erros:{dso_hist:1}}),{},AGORA);assert.equal(semDso.disponivel,true);assert.equal(semDso.prazo.painel,null);assert.ok(semDso.avisos.some(a=>/histórico de prazo/.test(a)));
 const semCfg=await consultarRecebiveis(banco({erros:{painel_config_global:1}}),{},AGORA);assert.equal(semCfg.corte.origem,'padrao');
 const vazio=await consultarRecebiveis(banco({rec:null}),{},AGORA);assert.equal(vazio.disponivel,false);assert.equal(vazio.totais,null);
 await assert.rejects(()=>consultarIndicadores(banco(),{fonte:'comercial'}),/intervalo válido/,'as outras fontes continuam exigindo período');
});
test('a função empacota o módulo novo: imports relativos da dre-sync existem',()=>{
 const pasta=new URL('../supabase/functions/dre-sync/',import.meta.url);
 for(const f of fs.readdirSync(pasta).filter(f=>/\.(m?js|ts)$/.test(f)))for(const [,rel] of fs.readFileSync(new URL(f,pasta),'utf8').matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g))assert.ok(fs.existsSync(new URL(rel,new URL(f,pasta))),`${f} importa ${rel}`);
});

// ── Tela (gestao.js) com o servidor simulado ──────────────────────────────
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function tela({payload=null,pdd={},admin=true,api=null}={}){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout,Promise};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.__cfg={parametros:{operacao:Object.fromEntries(Object.entries(pdd).map(([k,v])=>[k,{pdd90:v,prazoRecebimento:28}]))}};
 c.__chamadas=0;c.__renders=0;c.__api=api||(async()=>{c.__chamadas++;return payload;});
 c.run(`api=(...a)=>__api(...a);render=()=>{__renders++};state.records=[];state.cfg=__cfg;state.view='recebiveis';state.periodo='Out/2026';state.permissoes={leitura:true,edicao:${admin},admin:${admin}}`);
 if(payload)c.run(`recUI.dados=${JSON.stringify(payload)};recUI.em=Date.now()`);
 return c;
}
const P=()=>({ok:true,versao:1,fonte:'recebiveis',...ag([...BASE,t(11,5000,700,{vencimento:'2024-12-31'})],{dsoHist:[{dia:'2026-10-01',dso:40},{dia:'2026-10-10',dso:42}]})});
const cartoes=h=>[...h.matchAll(/<div class="metric metric-param"><span class="label">([^<]*)<\/span><strong class="([^"]*)">([^<]*)<\/strong><small>([^<]*)<\/small>/g)].map(m=>({rotulo:m[1],tom:m[2],valor:m[3].replace(/\s/g,' '),nota:m[4]}));
test('tela: quatro cards, provisão pelo % de Parâmetros do mês da posição, três gráficos e a data da posição',()=>{
 const h=tela({payload:P(),pdd:{'2026-10':50}}).run('renderRecebiveis()'),k=cartoes(h);
 assert.deepEqual(k.map(x=>[x.rotulo,x.tom,x.valor]),[['A receber','','R$ 6.600,00'],['Vencido','tom-sai','R$ 3.600,00'],['Provisão estimada (PDD)','tom-sai','R$ 750,00'],['Maior devedor','tom-sai','R$ 800,00']]);
 assert.match(k[1].nota,/^54,5% do que há a receber · 8 títulos$/);assert.match(k[2].nota,/^Estimativa: 50% de Out\/2026 \(Parâmetros\) sobre R\$\s1\.500,00 vencidos há mais de 90 dias; não entra no caixa nem na DRE$/);
 assert.match(k[3].nota,/^Cliente 10 · 22,2% do vencido · atraso de até 400 dias$/);
 assert.equal((h.match(/<figure class="g-fig g-(cem|barras|linha-area)/g)||[]).length,3);
 assert.match(h,/Posição do Painel de 10\/10\/2026,? 22:49 \(a carga roda a cada 20 minutos\); dias de atraso contados até hoje, como no Painel\. Esta tela é uma foto da carteira: não muda com o mês escolhido\. Vencidos antes de 01\/01\/2025 \(1 título, R\$\s5\.000,00\) ficam fora dos números/);
 assert.match(h,/Prazo concedido médio da carteira: <b>30 dias<\/b>.*Em Parâmetros \(Out\/2026\): <b>28 dias<\/b>.*Idade média da carteira: <b>83 dias<\/b>/s,"Σ saldo × dias desde a emissão ÷ Σ saldo = 545.600 ÷ 6.600");
 assert.match(h,/<summary>Faixas e títulos vencidos · 8<\/summary>/);assert.match(h,/<tr><th scope="row">Acima de 90 dias<\/th><td class="num">2<\/td><td class="num">R\$\s1\.500,00<\/td><td class="num">22,7%<\/td><\/tr>/);
 assert.doesNotMatch(h,/data-go="parametros">Informar em Parâmetros/);
 assert.equal((h.match(/ficam fora/g)||[]).length,1,'a dívida antiga é dita uma vez');assert.doesNotMatch(h,/rec-avisos/,'sem aviso a repetir');
 const parc=P();parc.avisos.push('A carga do Painel está atrasada: confira a data da posição.');assert.match(tela({payload:parc}).run('renderRecebiveis()'),/<ul class="param-avisos rec-avisos"><li>A carga do Painel está atrasada: confira a data da posição\.<\/li><\/ul>/);assert.equal(tela({payload:P()}).run("paginasDoApp().recebiveis()").includes('Posição do Painel'),true);
});
test('sem o % de provisão: "Não informado", nunca zero, e o caminho conforme a permissão',()=>{
 const h=tela({payload:P()}).run('renderRecebiveis()'),k=cartoes(h);
 assert.deepEqual([k[2].tom,k[2].valor],['','Não informado']);assert.match(k[2].nota,/Falta o % de provisão acima de 90 dias de Out\/2026 em Parâmetros; vencido há mais de 90 dias: R\$\s1\.500,00/);
 assert.match(h,/<h2>Falta a política de provisão<\/h2>[\s\S]*data-go="parametros" data-rec-mes="Out\/2026">Informar em Parâmetros/);
 assert.match(tela({payload:P(),admin:false}).run('renderRecebiveis()'),/Peça a um administrador[\s\S]*data-go="parametros" data-rec-mes="Out\/2026">Ver Parâmetros/);
 assert.equal(cartoes(tela({payload:P(),pdd:{'2026-09':50}}).run('renderRecebiveis()'))[2].valor,'Não informado','o % é do mês da posição, sem herdar outro mês');
});
test('sem posição do Painel: nada apurado; conector ainda não publicado é dito com clareza',async()=>{
 const ind={ok:true,versao:1,fonte:'recebiveis',...ag([],{})};const h=tela({payload:ind}).run('renderRecebiveis()');
 assert.deepEqual(cartoes(h).map(x=>x.valor),['Não apurado','Não apurado','Não apurado','Não apurado']);assert.match(h,/nenhum zero foi assumido/);assert.doesNotMatch(h,/data-rec-csv/);
 const c=tela({api:async()=>({erro:'Ação desconhecida: indicadores'})});c.run('renderRecebiveis()');await new Promise(r=>setTimeout(r,5));
 assert.match(c.run('renderRecebiveis()'),/O servidor ainda não tem a leitura dos recebíveis: ela é publicada sozinha pelo Painel, que roda de hora em hora mas costuma atrasar algumas horas\.[\s\S]*Nenhum zero foi assumido\./);
 const f=tela({api:async()=>{throw new Error('Fonte inválida.');}});f.run('renderRecebiveis()');await new Promise(r=>setTimeout(r,5));assert.match(f.run('renderRecebiveis()'),/ainda não tem a leitura dos recebíveis/);
});
test('uma leitura por minuto: o redesenho depois da resposta não pede de novo, nem depois de erro',async()=>{
 const c=tela({api:async()=>{c.__chamadas++;throw new Error('falha de rede');}});
 c.run('renderRecebiveis();renderRecebiveis()');await new Promise(r=>setTimeout(r,5));assert.equal(c.__chamadas,1);assert.equal(c.__renders,1,'redesenha uma vez ao chegar');
 c.run('renderRecebiveis();renderRecebiveis()');await new Promise(r=>setTimeout(r,5));assert.equal(c.__chamadas,1,'sem laço depois do erro');
 c.run('carregarRecebiveis(true)');await new Promise(r=>setTimeout(r,5));assert.equal(c.__chamadas,2,'"Ler de novo" força');
 const ok=tela({api:async()=>{ok.__chamadas++;return P();}});ok.run('renderRecebiveis()');await new Promise(r=>setTimeout(r,5));assert.match(ok.run('renderRecebiveis()'),/Posição do Painel/);assert.equal(ok.__chamadas,1);
});
test('planilha e nomes do ERP escapados; fórmula não executa no CSV',()=>{
 const p=P();p.titulosVencidos[0].cliente='<img src=x onerror=alert(1)>';p.clientes.itens[0].nome='=HYPERLINK("x")';
 const c=tela({payload:p,pdd:{'2026-10':50}}),h=c.run('renderRecebiveis()');assert.doesNotMatch(h,/<img src=x/);assert.match(h,/&lt;img src=x/);
 c.run('download=(n,t)=>{__csv={n,t}}');const rows=JSON.parse(c.run('JSON.stringify(recCSV())'));
 assert.equal(c.run('__csv.n'),'recebiveis-vencidos-2026-10-10.csv');assert.deepEqual(rows[3],['Cliente','NF','O.S.','Vencimento','Dias de atraso','Faixa','Valor (R$)']);
 assert.deepEqual(rows[4],['<img src=x onerror=alert(1)>','NF10','OS10',venc(400).split('-').reverse().join('/'),'400','Acima de 90 dias','800,00']);
 const p2=P();p2.titulosVencidos[0].cliente='=HYPERLINK("x")';const c2=tela({payload:p2});c2.run('download=(n,t)=>{__csv={n,t}}');c2.run('recCSV()');assert.match(c2.run('__csv.t'),/"'=HYPERLINK\(""x""\)"/);
});
test('versão publicada e a tela está no menu certo',()=>{
 assert.match(ler('sw.js'),/dre-shell-v122/);assert.equal((ler('index.html').match(/\?v=(\d+)/g)||[]).every(v=>v==='?v=122'),true);
 assert.match(ler('app.js'),/recebiveis:\['Recebíveis e aging','Quem deve, há quanto tempo e quanto está em risco, na posição que o Painel atualiza a cada 20 minutos\.'\]/);
});

// ── Casos que a revisão mostrou soltos ─────────────────────────────────────
test('fronteiras: corte exato, centavos, ordem por valor e média com zero dia',()=>{
 const c=ag([t(1,100,5,{vencimento:'2025-01-01'}),t(2,50,5,{vencimento:'2024-12-31'})]);assert.deepEqual([c.totais.vencido,c.antigas.quantidade],[100,1],'vencido no dia do corte não é antigo (como no Painel: venc < corte)');
 assert.equal(ag([t(1,0.29,5),t(2,1234.57,5),t(3,0.57,5)]).totais.vencido,1235.43,'centavos arredondados, não truncados');
 assert.deepEqual(ag([t(1,100,300),t(2,5000,3)]).titulosVencidos.map(x=>x.valor),[5000,100],'do maior valor para o menor, não do mais velho');
 const muitos=ag([...Array.from({length:200},(_,i)=>t(i+1,10,400)),t(999,9999,1)]);assert.equal(muitos.titulosVencidos[0].valor,9999);assert.equal(muitos.truncado,true);
 const z=ag([t(1,100,10,{emissao:venc(50)}),t(2,900,0,{emissao:venc(0)}),t(3,500,-30,{emissao:venc(-30)})]);
 assert.deepEqual(z.prazo.idade,{dias:Math.round((100*50+900*0+500*-30)/1500),com:3,total:3},'título emitido hoje entra com 0 dia');
 assert.deepEqual(z.prazo.concedido,{dias:Math.round((100*40+900*0+500*0)/1500),com:3,total:3},'título à vista entra com prazo 0');
});
test('dias contados até hoje, como no Painel; carga de ontem continua valendo como posição',()=>{
 const r=ag(BASE,{atualizadoEm:'2026-10-10T02:00:00Z',agora:new Date('2026-10-11T13:00:00Z')});
 assert.deepEqual([r.posicao.carga,r.posicao.base],['2026-10-09','2026-10-11']);assert.equal(r.titulosVencidos.find(x=>x.cliente==='Cliente 1').dias,1,'o título que vencia 10/10 já está vencido em 11/10');
 assert.ok(r.avisos.some(a=>/atrasada|mais de um dia/.test(a)));assert.equal(r.qualidade,'Parcial');
});
test('nenhum título legível: indisponível, não carteira zerada; só dívida antiga continua valendo',()=>{
 const r=ag([t(1,5000,5,{vencimento:'01/09/2026'}),t(2,3000,5,{valor:null})]);assert.equal(r.disponivel,false);assert.equal(r.totais,null);
 assert.match(r.avisos[0],/Nenhum dos 2 títulos da carga do Painel tem vencimento e saldo legíveis \(1 sem vencimento válido, 1 sem saldo válido\)/);
 assert.equal(ag([t(1,100,5,{vencimento:'2024-06-01'})]).disponivel,true);
});
test('série do Painel: os 90 pontos mais recentes, não os mais antigos',()=>{
 const r=ag(BASE,{dsoHist:Array.from({length:120},(_,i)=>({dia:venc(119-i),dso:i}))});
 assert.equal(r.prazo.serie.length,90);assert.deepEqual(r.prazo.serie.at(-1),{dia:'2026-10-10',dso:119});assert.equal(r.prazo.serie[0].dso,30);assert.deepEqual(r.prazo.painel,{dia:'2026-10-10',dso:119});
});
test('tela sem vencido: zeros confirmados sem vermelho e gráfico de concentração que diz isso',()=>{
 const p={ok:true,versao:1,fonte:'recebiveis',...ag([t(1,100,-5),t(2,700,-20)])};const h=tela({payload:p,pdd:{'2026-10':50}}).run('renderRecebiveis()');
 assert.deepEqual(cartoes(h).map(x=>[x.rotulo,x.tom,x.valor]),[['A receber','','R$ 800,00'],['Vencido','','R$ 0,00'],['Provisão estimada (PDD)','','R$ 0,00'],['Maior devedor','','R$ 0,00']]);
 assert.match(h,/Nenhum título vencido na posição\./);assert.doesNotMatch(h,/os cinco primeiros somam|Não apurado: nenhum item/);
});
test('tela: textos de prazo sem dado, concentração com demais, série por semana e barras de dívida em vermelho',()=>{
 const sem={ok:true,versao:1,fonte:'recebiveis',...ag([t(1,100,5,{emissao:''})])};const h=tela({payload:sem}).run('renderRecebiveis()');
 assert.match(h,/Prazo concedido médio da carteira: <b>Não apurado<\/b> \(vencimento − emissão, ponderado pelo saldo; 0 de 1 títulos com emissão\)/);assert.match(h,/Idade média da carteira: <b>Não apurado<\/b>/);
 const doze=[...Array.from({length:10},(_,i)=>t(i+1,i===0?5000:250,5,{cliente:'C'+(i+1)})),t(11,200,3,{cliente:'C11'}),t(13,100,2,{cliente:'C12'})];
 const p={ok:true,versao:1,fonte:'recebiveis',...ag(doze,{dsoHist:Array.from({length:120},(_,i)=>({dia:venc(119-i),dso:i}))})},c=tela({payload:p}),h2=c.run('renderRecebiveis()');
 assert.equal(Math.round(6000/7550*1000)/10,79.5);assert.match(h2,/os cinco primeiros somam 79,5% do vencido\. Os demais 2 devedores somam R\$\s300,00\./);assert.match(h2,/g-cor-saida/,'dívida vencida não usa o azul de dinheiro que entra');
 const sem13=JSON.parse(c.run('JSON.stringify(recSemanas(recUI.dados.prazo.serie))'));assert.equal(sem13.length,13);assert.deepEqual(sem13.at(-1),{rotulo:'10/10',valor:119});assert.deepEqual(sem13.at(-2),{rotulo:'04/10',valor:113},'um ponto por semana: o domingo anterior');
 assert.match(h2,/Idade média da carteira: de \d+ dias em \d\d\/\d\d para 119 dias em 10\/10\./);
});
test('nomes, NF e O.S. do ERP escapados em card, gráfico e tabela',()=>{
 const p=P();p.clientes.itens[0].nome='<img src=x onerror=alert(1)>';p.titulosVencidos[0].nf='<svg onload=alert(2)>';p.titulosVencidos[0].os='<b>OS</b>';
 const h=tela({payload:p}).run('renderRecebiveis()');for(const re of [/<img src=x/,/<svg onload/,/<b>OS<\/b>/])assert.doesNotMatch(h,re);assert.match(h,/&lt;svg onload=alert\(2\)&gt;/);
});
test('servidor anterior à Fase 5: a mensagem de período vira "ainda não publicado"; resposta de outra fonte não é aceita',async()=>{
 const c=tela({api:async()=>({erro:'Escolha um intervalo válido de até 12 meses.'})});c.run('renderRecebiveis()');await new Promise(r=>setTimeout(r,5));
 const h=c.run('renderRecebiveis()');assert.match(h,/O servidor ainda não tem a leitura dos recebíveis/);assert.doesNotMatch(h,/intervalo válido/);
 const o=tela({api:async()=>({ok:true,fonte:'comercial',disponivel:true})});o.run('renderRecebiveis()');await new Promise(r=>setTimeout(r,5));assert.match(o.run('renderRecebiveis()'),/ainda não tem a leitura dos recebíveis/);
});
test('"Ler de novo" fica fora da seção recolhida, avisa a leitura e volta o foco; Parâmetros abre no mês da posição',async()=>{
 const ev={},doc={addEventListener:(t,fn,cap)=>{(ev[t+(cap?':cap':'')]=ev[t+(cap?':cap':'')]||[]).push(fn);},querySelector:s=>s==='[data-rec-recarregar]'?{focus(){doc.focado=true;}}:null};
 const c=tela({payload:P(),api:async()=>{c.__chamadas++;return P();}});c.__doc=doc;c.run('document=__doc;wireRecebiveis()');
 const h=c.run('renderRecebiveis()');assert.ok(h.indexOf('data-rec-recarregar')<h.indexOf('rec-detalhe'),'o botão não fica dentro do details');
 const botao={hasAttribute:a=>a==='data-rec-recarregar',dataset:{}};for(const fn of ev.click)fn({target:{closest:s=>s.includes('data-rec-recarregar')?botao:null}});
 assert.match(c.run('renderRecebiveis()'),/<span class="hint" role="status">Lendo o Painel…<\/span>/);assert.equal(doc.focado,true);
 await new Promise(r=>setTimeout(r,5));assert.equal(c.__chamadas,1);assert.match(c.run('renderRecebiveis()'),/role="status"><\/span>/);
 for(const fn of ev['toggle:cap'])fn({target:{classList:{contains:x=>x==='rec-detalhe'},open:true}});assert.match(c.run('renderRecebiveis()'),/<details class="card rec-detalhe" open>/,'a seção aberta continua aberta no redesenho');
 c.run("state.periodo='Set/2026'");for(const fn of ev['click:cap'])fn({target:{closest:s=>s==='[data-rec-mes]'?{dataset:{recMes:'Out/2026'}}:null}});assert.equal(c.run('state.periodo'),'Out/2026');
});
