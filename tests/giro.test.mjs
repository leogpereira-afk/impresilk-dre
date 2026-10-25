// Capital de giro (Fase 6.1): contas a pagar do Painel classificadas pelo número do
// centro de custo, projeções à parte, necessidade de giro sem inventar estoque.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
import {agregarPagar,consultarGiro,grupoDe,GRUPOS,validarPosicao,gravarPosicao,resumirHistorico} from '../supabase/functions/dre-sync/giro.mjs';
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

function banco({posicoes=[],erroPosicoes=false,rec={valor:[{id:'r1',cliente:'A',cnpj:'',nf:'1',os:'1',valor:3000,valorTitulo:3000,pago:0,emissao:dia(40),vencimento:dia(10),situacao:'aberto'},{id:'r2',cliente:'B',cnpj:'',nf:'2',os:'2',valor:2000,valorTitulo:2000,pago:0,emissao:dia(5),vencimento:dia(-20),situacao:'aberto'}],atualizado_em:EM},pag={valor:PAGAR,atualizado_em:EM},erros={}}={}){
 const lidos=[];return {lidos,from(t){const q={f:{},sel:'',select(s){q.sel=s;return q;},eq(k,v){q.f[k]=v;return q;},order(){lidos.push(t+'|'+(q.f.colecao||''));return Promise.resolve(erroPosicoes?{data:null,error:new Error('x')}:{data:posicoes.map(r=>({id:r.id,registro:r})),error:null});},maybeSingle(){const chave=t==='painel_cache'?q.f.chave:t;lidos.push(t+'|'+(q.f.chave||''));
  if(erros[chave])return Promise.resolve({data:null,error:new Error('x')});return Promise.resolve({data:t==='painel_config_global'?{corte:'2025-01-01'}:chave==='recebiveis'?rec:chave==='pagar'?pag:null,error:null});}};return q;}};}
test('servidor: necessidade de giro sem estoque = a receber − a pagar operacional; rota dos indicadores sem período',async()=>{
 const sb=banco(),r=await consultarGiro(sb,{},AGORA);
 assert.deepEqual([r.ok,r.fonte,r.disponivel,r.qualidade],[true,'capitalGiro',true,'Apurado']);
 assert.deepEqual(r.ncg,{semEstoque:5000-4750,receber:5000,pagarOperacional:4750});assert.equal(r.receber.corte.data,'2025-01-01');
 assert.deepEqual(sb.lidos.sort(),['dre_registros|posicoes','painel_cache|pagar','painel_cache|recebiveis','painel_config_global|']);
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
// N27: o "?" do Glossário fica dentro do rótulo; termo = data-term do botão.
const cartoes=h=>[...h.matchAll(/<div class="metric metric-param"(?: id="secao-[\w-]+")?><span class="label">([^<]*)(?: <button type="button" class="term-help" data-term="([^"]*)" aria-label="Entender [^"]*">\?<\/button>)?<\/span><strong class="([^"]*)">([^<]*)<\/strong><small>([^<]*)<\/small>/g)].map(m=>({rotulo:m[1],termo:m[2]||'',tom:m[3],valor:m[4].replace(/\s/g,' '),nota:m[5]}));
test('tela: quatro cards, estoque de Parâmetros do mês de hoje, cascata, classes e vencimentos',async()=>{
 const d=await payload(),h=tela({dados:d,op:{'2026-10':{estoque:1200,prazoRecebimento:30,prazoPagamento:45}}}).run('renderGiro()'),k=cartoes(h);
 assert.deepEqual(k.map(x=>[x.rotulo,x.tom,x.valor]),[['Necessidade de capital de giro','tom-entra','R$ 1.450,00'],['A receber · 60 dias','tom-entra','R$ 5.000,00'],['A pagar operacional','tom-sai','R$ 4.750,00'],['Estoque','tom-entra','R$ 1.200,00']],'v134: a receber e estoque azul, a pagar vermelho, necessidade de giro pelo sinal');
 assert.match(k[0].nota,/^A receber R\$\s5\.000,00 \+ estoque R\$\s1\.200,00 − a pagar operacional R\$\s4\.750,00$/);assert.match(k[2].nota,/R\$\s1\.450,00 já vencido$/);
 assert.equal((h.match(/<figure class="g-fig g-(cascata|barras|cem)/g)||[]).length,3);assert.match(h,/g-cor-saida/,'o que se deve não usa o azul de entrada');
 assert.match(h,/<tr class=""><th scope="row">Fornecedores de produção \(1\.xx\)<\/th><td>Sim<\/td><td class="num">3<\/td><td class="num tom-sai">R\$\s650,00<\/td><td class="num tom-sai">R\$\s1\.000,00<\/td><td class="num tom-sai">R\$\s1\.650,00<\/td><\/tr>/,'a pagar em vermelho');
 assert.match(h,/<tr class="giro-fora"><th scope="row">Empréstimos e financiamentos \(3\.04\)<\/th><td>Não<\/td>/);assert.match(h,/Projetado no Mubisys \(ainda não é título\)<\/th><td>Não<\/td><td class="num">2<\/td>/);
 // I25 e N14: prazos de Parâmetros são premissa e levam ao mês; o ciclo usa os prazos medidos nos títulos.
 assert.match(h,/<button type="button" class="text-button" data-go="parametros" data-rec-mes="Out\/2026">Prazos negociados em Parâmetros \(Out\/2026\)<\/button> \(premissa\): recebimento <b>30 dias<\/b>, pagamento <b>45 dias<\/b>/);assert.match(h,/O ciclo financeiro usa os prazos medidos nos títulos dos três meses até cada fechamento \(histórico abaixo\)\./);assert.match(h,/vence em 10 dias/);
 // I25: classe fora do giro marcada na barra, com a cor de a pagar; subtotal dentro do giro igual ao cartão "A pagar operacional".
 assert.match(h,/title="Sócios \(3\.01\) · fora do giro"/);assert.doesNotMatch(h,/title="Fornecedores de produção \(1\.xx\) · fora do giro"/);
 const sub=h.match(/Entram no giro: (R\$\s[\d.,]+); fora do giro: (R\$\s[\d.,]+)\./);assert.ok(sub,'subtítulo com os dois subtotais');assert.equal(sub[1].replace(/\s/g,' '),k[2].valor,'"Entram no giro" = cartão A pagar operacional');assert.equal(sub[2].replace(/\s/g,' '),'R$ 5.700,00','sócios 700 + empréstimos 5.000');
 // D24: atraso de conta vencida em âmbar; a vencer e vence hoje sem a marca.
 assert.match(h,/<td class="num giro-vencido">5 dias<\/td>/);assert.match(h,/<td class="num giro-vencido">95 dias<\/td>/);assert.match(h,/<td class="num">vence em 10 dias<\/td>/);assert.match(h,/<td class="num">vence hoje<\/td>/);
 assert.equal((h.match(/giro-vencido/g)||[]).length,3,'só as três contas com dias > 0 (5, 40 e 95 dias)');
 // N27: "?" do Glossário na necessidade de giro; N10: histórico com nome acessível.
 assert.equal(k[0].termo,'Necessidade de capital de giro');assert.equal(k[1].termo,'');
 assert.doesNotMatch(h,/Falta o estoque/);assert.match(tela({dados:d}).run("paginasDoApp().giro()"),/Necessidade/);
});
test('sem estoque: necessidade "sem estoque", rotulada, e o caminho para Parâmetros no mês de hoje',async()=>{
 const d=await payload(),h=tela({dados:d}).run('renderGiro()'),k=cartoes(h);
 assert.deepEqual([k[0].rotulo,k[0].valor],['Necessidade de giro sem estoque','R$ 250,00']);assert.match(k[0].nota,/falta o estoque de Out\/2026 em Parâmetros/);
 assert.deepEqual([k[3].valor,k[3].tom],['Não informado','']);assert.match(h,/<h2>Falta o estoque<\/h2>[\s\S]*data-go="parametros" data-rec-mes="Out\/2026">Informar em Parâmetros/);
 assert.match(tela({dados:d,admin:false}).run('renderGiro()'),/Peça a um administrador[\s\S]*>Ver Parâmetros/);
 assert.match(h,/Prazos negociados em Parâmetros \(Out\/2026\)<\/button> \(premissa\): recebimento <b>não informado<\/b>/);assert.equal(k[0].termo,'Necessidade de capital de giro','sem estoque, o "?" leva ao mesmo verbete');
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
test('cores: na cascata, a receber (primeiro degrau) e o estoque em azul, a pagar desconta em vermelho; barras do que se deve em vermelho',async()=>{
 const d=await payload(),h=tela({dados:d,op:{'2026-10':{estoque:1200}}}).run('renderGiro()');
 const cas=rects(h,'cascata');assert.deepEqual(cas.map(x=>[x[0],x[1]]),[['g-cor-entrada','A receber'],['g-cor-entrada','Estoque'],['g-cor-saida','A pagar operacional'],['g-cor-resultado','Necessidade de giro']]);
 assert.match(cas[2][2],/^[-−]R\$/);const bar=rects(h,'barras');assert.ok(bar.length>0&&bar.every(x=>x[0]==='g-cor-saida'),JSON.stringify(bar));
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
 assert.match(h,/<tr class="giro-fora"><th scope="row">Vencidas antes de 01\/01\/2025<\/th><td>Não<\/td><td class="num">1<\/td><td class="num tom-sai">R\$\s9\.000,00<\/td>/);
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

// ── Histórico (Fase 6.2) ───────────────────────────────────────────────────
const MES_PT=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],mesDe=id=>/^\d{4}-\d{2}$/.test(id)?MES_PT[Number(id.slice(5))-1]+'/'+id.slice(0,4):'Nov/2025',fimDe=id=>/^\d{4}-\d{2}$/.test(id)&&Number(id.slice(5))>=1&&Number(id.slice(5))<=12?new Date(Date.UTC(+id.slice(0,4),+id.slice(5),0)).toISOString().slice(0,10):'2025-11-30';
const posicao=(id,extra={})=>({id,mes:mesDe(id),fim:fimDe(id),regra:'posicao-v1',modo:'reconstruido',corte:'2025-01-01',geradoEm:'2026-10-11T10:00:00Z',execucaoId:'e1',
 receber:{total:5000,quantidade:3,faixas:{avencer:3000,d1_30:2000,d31_60:0,d61_90:0,d91:0},antigas:{quantidade:1,valor:900},foraDRE:{quantidade:0,valor:0}},
 pagar:{total:4100,quantidade:5,faixas:{avencer:4100,d1_30:0,d31_60:0,d61_90:0,d91:0},porCentro:[{rotulo:'1.01 Impressão',valor:1000,quantidade:1},{rotulo:'2.02 Administrativo e RH',valor:800,quantidade:1},{rotulo:'3.02 Impostos e taxas',valor:300,quantidade:1},{rotulo:'3.04 Empréstimos',valor:1500,quantidade:1},{rotulo:'Materia Prima Serralheria',valor:500,quantidade:1}]},
 fluxos:{receber:{emitido:6000,pago:4000,prazoConcedido:30,prazoReal:34},pagar:{emitido:3000,pago:2500,prazoConcedido:28,prazoReal:25,emitidoPorCentro:[{rotulo:'1.01 Impressão',valor:2000},{rotulo:'3.04 Empréstimos',valor:1000}]}},
 fluxos3m:{receber:{emitido:18000,pago:12000,prazoConcedido:30,prazoReal:33},pagar:{emitido:9000,pago:7000,prazoConcedido:28,prazoReal:26,emitidoPorCentro:[{rotulo:'1.01 Impressão',valor:6000},{rotulo:'2.02 Administrativo e RH',valor:1500},{rotulo:'3.04 Empréstimos',valor:1500}]}},
 cobertura:{titulos:10,semValor:0,semEmissao:0,pagamentoInvalido:0},...extra});
test('histórico: só posição válida entra; números finitos, textos curtos, mês e regra conhecidos',()=>{
 assert.equal(validarPosicao(posicao('2025-11')).id,'2025-11');
 for(const [reg,re] of [[null,/inválida/],[posicao('2025-13'),/Mês/],[posicao('11/2025'),/Mês/],[posicao('2025-11',{regra:'x'}),/Regra/],[posicao('2025-11',{receber:{total:Infinity}}),/Número/],
  [posicao('2025-11',{mes:'x'.repeat(201)}),/Texto/],[posicao('2025-11',{pagar:{total:1}}),/totais/],[posicao('2025-11',{pagar:{total:1,porCentro:Array.from({length:401},()=>({rotulo:'a',valor:1}))}}),/Lista/],[posicao('2025-11',{x:()=>1}),/Tipo/]])
  assert.throws(()=>validarPosicao(reg),re);
});
test('histórico: gravação na coleção à parte, com a hora; falha do banco não passa calada',async()=>{
 const feitos=[];const sb={from(t){return {upsert(v,o){feitos.push([t,v,o]);return Promise.resolve({error:null});}};}};
 assert.deepEqual(await gravarPosicao(sb,{registro:posicao('2025-11')},new Date('2026-10-11T10:00:00Z')),{ok:true,id:'2025-11'});
 assert.deepEqual([feitos[0][0],feitos[0][1].colecao,feitos[0][1].id,feitos[0][1].registro.gravadoEm,feitos[0][2].onConflict],['dre_registros','posicoes','2025-11','2026-10-11T10:00:00.000Z','colecao,id']);
 await assert.rejects(()=>gravarPosicao({from:()=>({upsert:()=>Promise.resolve({error:new Error('x')})})},{registro:posicao('2025-11')}),/Posição não gravada/);
 await assert.rejects(()=>gravarPosicao(sb,{registro:posicao('2025-00')}),/Mês/);
});
test('histórico: a pagar por classe com a mesma regra de hoje, necessidade de giro e fluxos; inválido fica de fora e é contado',()=>{
 const h=resumirHistorico([posicao('2025-12',{mes:'Dez/2025'}),posicao('2025-11'),{id:'2025-10',regra:'posicao-v1'}]);
 assert.deepEqual(h.meses.map(m=>m.id),['2025-11','2025-12']);assert.deepEqual(h.invalidos,['2025-10']);
 const m=h.meses[0];assert.deepEqual(m.pagar.grupos,{producao:1000,apoio:800,impostos:300,predio:0,socios:0,emprestimos:1500,semClasse:500});
 assert.equal(m.pagar.operacional,2100,'1.xx + 2.xx + impostos; empréstimos e sem classe fora');assert.equal(m.ncgSemEstoque,5000-2100);
 assert.deepEqual([m.fluxos.pagar.emitidoOperacional,m.fluxos.pagar.emitidoProducao,m.fluxos.receber.prazoReal],[2000,2000,34]);
 assert.deepEqual([m.fluxos3m.receber.emitido,m.fluxos3m.pagar.emitidoOperacional,m.fluxos3m.pagar.emitidoProducao],[18000,7500,6000],'três meses: base dos prazos médios');const semTres=posicao('2025-11');delete semTres.fluxos3m;assert.equal(resumirHistorico([semTres]).meses[0].fluxos3m,null,'gravado antes dos três meses: não apurado');
});
test('histórico na leitura do capital de giro; falha de leitura avisa sem derrubar a posição de hoje',async()=>{
 const d=await consultarGiro(banco({posicoes:[posicao('2025-11')]}),{},AGORA);assert.deepEqual(d.historico.meses.map(m=>m.id),['2025-11']);assert.equal(d.historico.corteAtual,'2025-01-01');
 const e=await consultarGiro(banco({erroPosicoes:true}),{},AGORA);assert.deepEqual([e.historico.meses,e.historico.erro],[[],'leitura']);assert.equal(e.disponivel,true);assert.ok(e.avisos.some(a=>/^Histórico: Não foi possível ler o histórico de posições/.test(a)));
 const v=await consultarGiro(banco({posicoes:[{id:'x'}]}),{},AGORA);assert.ok(v.avisos.some(a=>/1 mês\(es\) gravado\(s\) com formato inválido/.test(a)));
});
test('tela do histórico: necessidade de giro por mês, ciclo do último fechamento e prazos; sem estoque, sem ciclo',async()=>{
 const d=await consultarGiro(banco({posicoes:[posicao('2025-11'),posicao('2025-12',{mes:'Dez/2025',fim:'2025-12-31'})]}),{},AGORA);
 const h=tela({dados:d,op:{'2025-12':{estoque:1200}}}).run('renderGiro()');
 assert.match(h,/A necessidade de giro está crescendo\?/);assert.match(h,/data-dica="Dez\/25\nR\$\s2\.900,00"/,'5.000 − 2.100 sem estoque');
 assert.match(h,/Quantos dias o dinheiro fica preso\? · Dez\/2025/);assert.match(h,/Ciclo operacional 43 dias · ciclo financeiro 18 dias/,'estoque 18 (1.200 ÷ 6.000 × 90) + recebimento 25 (5.000 ÷ 18.000 × 90) − pagamento 25 (2.100 ÷ 7.500 × 90)');
 assert.match(h,/<tr class="giro-parcial"><th scope="row">Dez\/2025 \*<\/th><td class="num tom-entra">R\$\s5\.000,00<\/td><td class="num tom-sai">R\$\s2\.100,00<\/td><td class="num tom-entra">R\$\s1\.200,00<\/td><td class="num tom-entra">R\$\s4\.100,00<\/td><td class="num">25<\/td><td class="num">25<\/td><td class="num">18<\/td><td class="num">18<\/td><td class="num">34<\/td><td class="num">25<\/td><\/tr>/);
 assert.match(h,/<tr class="giro-parcial"><th scope="row">Nov\/2025 \*<\/th><td class="num tom-entra">R\$\s5\.000,00<\/td><td class="num tom-sai">R\$\s2\.100,00<\/td><td class="num"><span class="muted" title="Não apurado">—<\/span><\/td><td class="num tom-entra">R\$\s2\.900,00 <small>sem estoque<\/small><\/td><td class="num">25<\/td><td class="num">25<\/td><td class="num">—<\/td><td class="num">—<\/td>/,'sem estoque: estoque e ciclo não apurados, nunca zero');
 assert.match(h,/<summary><h2 class="card-titulo">Prazos e saldos por mês · 2 fechamentos<\/h2><\/summary>/);assert.doesNotMatch(h,/O histórico usou o corte/);
 // C12: a necessidade de giro pode ser negativa, então a linha sai na cor de resultado, não no azul da marca
 assert.match(h.slice(h.indexOf('A necessidade de giro está crescendo?'),h.indexOf('Quantos dias o dinheiro fica preso?')),/g-cor-resultado/);assert.doesNotMatch(h.slice(h.indexOf('A necessidade de giro está crescendo?'),h.indexOf('Quantos dias o dinheiro fica preso?')),/g-cor-marca/);
 // I31: a remontagem usa os títulos como estavam no Mubisys na data dela
 assert.match(h,/com os títulos como estavam no Mubisys nessa data:/);assert.doesNotMatch(h,/Mubisys de hoje/);
 const sem=tela({dados:await consultarGiro(banco({posicoes:[posicao('2025-12',{mes:'Dez/2025'})]}),{},AGORA)}).run('renderGiro()');assert.match(sem,/Não apurado: falta o prazo de estoque/);
 const outro=await consultarGiro(banco({posicoes:[posicao('2025-11',{corte:'2024-01-01'})]}),{},AGORA);assert.match(tela({dados:outro}).run('renderGiro()'),/O histórico usou o corte de dívida antiga 01\/01\/2024; o Painel hoje usa 01\/01\/2025\./);
});
test('sem histórico remontado: a tela diz como rodar, conforme quem vê',async()=>{
 const d=await payload();assert.match(tela({dados:d}).run('renderGiro()'),/<h2>O histórico ainda não foi remontado<\/h2><p>No GitHub do DRE, em Actions, rode &quot;Histórico de posições \(Mubisys\)&quot;/);
 assert.match(tela({dados:d,admin:false}).run('renderGiro()'),/Peça a um administrador para rodar a remontagem/);
 const x=await payload();x.historico={meses:[{...(resumirHistorico([posicao('2025-11')]).meses[0]),mes:'<img src=x onerror=alert(1)>'}],corteAtual:null};assert.doesNotMatch(tela({dados:x}).run('renderGiro()'),/<img src=x/);
});

// ── Casos da revisão da 6.2 ───────────────────────────────────────────────
test('validação estrita: tamanho, profundidade, campo, mês e fim coerentes, números onde a tela imprime número',()=>{
 const base=posicao('2025-11');
 for(const [reg,re] of [[{...base,lixo:'x'.repeat(199).repeat(1)+'',grande:Array.from({length:399},()=>'y'.repeat(199)).concat(Array.from({length:0}))},null],
  [{...base,grande:Array.from({length:399},()=>({a:'y'.repeat(199),b:'z'.repeat(199),c:'w'.repeat(199)}))},/grande demais/],[{...base,x:{a:{b:{c:{d:{e:{f:1}}}}}}},/aninhada/],[{...base,['k'.repeat(61)]:1},/Campo inválido/],
  [{...base,receber:{quantidade:1}},/a receber numérico/],[{...base,id:'x2025-11'},/Mês da posição inválido/],[{...base,id:'2025-11x'},/Mês da posição inválido/],[{...base,mes:'Dez/2025'},/não confere/],[{...base,mes:7},/não confere/],
  [{...base,fim:'2025-12-31'},/Fim do mês/],[{...base,fluxos:{receber:{prazoReal:'<a href=x>entre</a>'}}},/prazoReal/],[{...base,pagar:{...base.pagar,porCentro:[{valor:1,quantidade:1}]}},/sem rótulo/],
  [{...base,pagar:{...base.pagar,alemPorCentro:[{rotulo:'1.01',valor:'9',quantidade:1}]}},/numérico/],[{...base,receber:{...base.receber,alemHorizonte:{valor:'1'}}},/alemHorizonte/]]){
  if(re===null)assert.equal(validarPosicao(reg).id,'2025-11');else assert.throws(()=>validarPosicao(reg),re);
 }
});
test('gravação: a hora é a do servidor, não a que veio no registro',async()=>{
 const feitos=[];const sb={from(){return {upsert(v){feitos.push(v);return Promise.resolve({error:null});}};}};
 await gravarPosicao(sb,{registro:{...posicao('2025-11'),gravadoEm:'2000-01-01T00:00:00Z'}},new Date('2026-10-11T10:00:00Z'));assert.equal(feitos[0].registro.gravadoEm,'2026-10-11T10:00:00.000Z');
});
test('prazos sobre a carteira inteira e mês parcial com o motivo',()=>{
 const p=posicao('2025-11',{receber:{...posicao('x').receber,total:6000,alemHorizonte:{quantidade:2,valor:3000},semVencimento:{quantidade:1,valor:50}},pagar:{...posicao('x').pagar,porCentro:[{rotulo:'1.01 Impressão',valor:2000,quantidade:1}],alemPorCentro:[{rotulo:'1.01 Impressão',valor:1000,quantidade:1},{rotulo:'3.04 Empréstimos',valor:9000,quantidade:1}]},cobertura:{titulos:10,semValor:1,semEmissao:0,pagamentoInvalido:2}});
 const m=resumirHistorico([p]).meses[0];
 assert.deepEqual([m.receber.totalSemHorizonte,m.pagar.operacional,m.pagar.operacionalSemHorizonte,m.ncgSemEstoque],[9000,2000,3000,4000],'a necessidade de giro fica em 60 dias; os prazos usam tudo, sem empréstimos');
 assert.equal(m.parcial,true);assert.deepEqual(m.motivos,['1 título(s) sem vencimento fora da conta','3 título(s) do Mubisys ilegíveis na remontagem (sem valor, emissão ou pagamento legível)']);
 const limpo=resumirHistorico([posicao('2025-11',{pagar:{...posicao('x').pagar,porCentro:[{rotulo:'1.01 Impressão',valor:2000,quantidade:1}]}})]).meses[0];assert.deepEqual([limpo.parcial,limpo.motivos],[false,[]]);
});
test('tela: prazos sobre a carteira inteira, mês parcial marcado e os três estados do histórico',async()=>{
 const p=posicao('2025-11',{receber:{...posicao('x').receber,total:6000,alemHorizonte:{quantidade:2,valor:3000}},pagar:{...posicao('x').pagar,porCentro:[{rotulo:'1.01 Impressão',valor:2100,quantidade:1}]}});
 const h=tela({dados:await consultarGiro(banco({posicoes:[p]}),{},AGORA)}).run('renderGiro()');
 assert.match(h,/<tr><th scope="row">Nov\/2025<\/th><td class="num tom-entra">R\$\s6\.000,00<\/td><td class="num tom-sai">R\$\s2\.100,00<\/td><td class="num"><span class="muted" title="Não apurado">—<\/span><\/td><td class="num tom-entra">R\$\s3\.900,00 <small>sem estoque<\/small><\/td><td class="num">45<\/td><td class="num">25<\/td>/,'recebimento 9.000 ÷ 18.000 × 90 = 45');
 assert.match(h,/Prazos de recebimento e de pagamento sobre a carteira inteira; a necessidade de giro, só até 60 dias de cada fechamento/);
 const parc=tela({dados:await consultarGiro(banco({posicoes:[posicao('2025-11')]}),{},AGORA)}).run('renderGiro()');assert.match(parc,/<b>1 fechamentos parciais \(\*\)\.<\/b><ul><li><b>a pagar sem classificação \(R\$\s500,00\) fora do operacional<\/b><small>Nov\/2025<\/small><\/li><\/ul>/);
 assert.match(tela({dados:await consultarGiro(banco({erroPosicoes:true}),{},AGORA)}).run('renderGiro()'),/<h2>Histórico indisponível agora<\/h2>[\s\S]*não foram perdidos/);
 assert.match(tela({dados:await consultarGiro(banco({posicoes:[{id:'2025-11',regra:'posicao-v1'}]}),{},AGORA)}).run('renderGiro()'),/<h2>Histórico em formato antigo<\/h2><p>1 fechamento\(s\) gravado\(s\) num formato que esta versão não lê/);
 assert.match(tela({dados:await consultarGiro(banco(),{},AGORA)}).run('renderGiro()'),/<h2>O histórico ainda não foi remontado<\/h2>/);
 const x=await consultarGiro(banco({posicoes:[posicao('2025-11')]}),{},AGORA);x.historico.meses[0].fluxos.receber.prazoReal='<b>x</b>';assert.doesNotMatch(tela({dados:x}).run('renderGiro()'),/<b>x<\/b>/,'o que não é número sai —');
});
test('prazos distintos, ciclo com sinal certo, 90 dias e arredondamento; ordem cronológica; rótulo no último mês',async()=>{
 const rec={...posicao('x').receber,total:9000};
 const d=await consultarGiro(banco({posicoes:[posicao('2025-11'),posicao('2025-12',{receber:rec})]}),{},AGORA);
 const h=tela({dados:d,op:{'2025-12':{estoque:1300}}}).run('renderGiro()');
 // recebimento 9.000 ÷ 18.000 × 90 = 45; pagamento 2.100 ÷ 7.500 × 90 = 25,2 → 25; estoque 1.300 ÷ 6.000 × 90 = 19,5 → 20; ciclo 20 + 45 − 25 = 40
 assert.match(h,/<th scope="row">Dez\/2025( \*)?<\/th>(<td[^>]*>[^<]*(<small>[^<]*<\/small>)?<\/td>){4}<td class="num">45<\/td><td class="num">25<\/td><td class="num">20<\/td><td class="num">40<\/td>/);
 assert.match(h,/Ciclo operacional 65 dias · ciclo financeiro 40 dias/);
 assert.ok(h.indexOf('<th scope="row">Nov/2025')<h.indexOf('<th scope="row">Dez/2025'),'mais antigo primeiro');
 assert.match(h,/g-rot-forte"[^>]*>R\$\s6\.900,00</,'valor marcado é o do último fechamento');
});
test('sem emitido no período, prazo não apurado (nunca infinito nem zero); cortes misturados são ditos',async()=>{
 const p=posicao('2025-11',{fluxos3m:{receber:{emitido:0},pagar:{emitido:0,emitidoPorCentro:[]}}});
 const h=tela({dados:await consultarGiro(banco({posicoes:[p]}),{},AGORA)}).run('renderGiro()');
 assert.match(h,/<th scope="row">Nov\/2025( \*)?<\/th>(<td[^>]*>[\s\S]*?<\/td>){4}<td class="num">—<\/td><td class="num">—<\/td>/);assert.doesNotMatch(h,/Infinity|NaN/);
 const d=await consultarGiro(banco({posicoes:[posicao('2025-11',{corte:'2024-01-01'}),posicao('2025-12')]}),{},AGORA);
 assert.match(tela({dados:d}).run('renderGiro()'),/O histórico usou o corte de dívida antiga/);
});
