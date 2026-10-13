// Glossário (Fase 12.4): "Como este painel calcula", termos do Simples e de gestão, link para a tela
// onde o número aparece, seções por assunto e busca sem acento.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function ctx(){
 const c={structuredClone,document:{addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};
 vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));return c;
}
test('"Como este painel calcula": termos da casa, cada um com a tela onde aparece',()=>{
 const c=ctx(),painel=c.json("GlossarioFinanceiro.termos.filter(t=>t.grupo==='painel')");
 assert.ok(painel.length>=20,`${painel.length} termos`);assert.equal(c.json('Object.keys(GlossarioFinanceiro.grupos)[0]'),'painel');
 for(const n of ['DRE de caixa (DRE Simples)','Material político','Saídas sem detalhamento (2.99)','Mês completo, em andamento e pela metade','Trilha por pagamento','Retiradas e arrendamento (sócios)'])assert.ok(painel.some(t=>t.nome===n),n);
 const telas=c.json('Object.keys(METADATA_TELAS)'),todos=c.json('GlossarioFinanceiro.termos');
 for(const t of todos.filter(t=>t.tela))assert.ok(telas.includes(t.tela),`${t.nome} aponta para ${t.tela}`);
 assert.ok(painel.every(t=>t.tela),'todo termo do painel tem tela');
 assert.equal(todos.find(t=>t.nome==='Margem de contribuição').tela,'precos','termo antigo ganhou a tela');
 for(const n of ['Fator R','Alíquota efetiva do Simples','PGDAS-D','DIFAL','Antecipação de recebíveis','Aging (idade da carteira)','Fluxo de caixa de 13 semanas'])assert.ok(todos.some(t=>t.nome===n),n);
 assert.equal(new Set(todos.map(t=>t.nome)).size,todos.length,'sem termo repetido');
 assert.doesNotMatch(JSON.stringify(painel),/—/,'sem travessão nos termos novos');
});
test('tela do glossário: seções por assunto com índice; busca vira lista; link "Ver em" para a tela',()=>{
 const c=ctx();let h=c.run('resultadosGlossario()');
 assert.match(h,/<nav class="glossary-indice"/);assert.match(h,/<section class="glossary-secao" id="glossario-painel"><h3>Como este painel calcula <small>\d+ termos<\/small>/);
 assert.match(h,/data-glossario-go="precos"(?: data-glossario-ir="precos-[\w-]+")?>Ver em Preço e equilíbrio →/);
 c.run("glossarioUI.busca='material politico'");h=c.run('resultadosGlossario()');assert.doesNotMatch(h,/glossary-secao/);assert.match(h,/Material político/);
 c.run("glossarioUI.busca='';glossarioUI.grupo='credito'");h=c.run('resultadosGlossario()');assert.doesNotMatch(h,/glossary-secao/);assert.match(h,/Antecipação de recebíveis/);
 c.run("glossarioUI.busca='xyz123';glossarioUI.grupo='todos'");assert.match(c.run('resultadosGlossario()'),/Nenhum termo encontrado/);
});

// ── v135 ──
test('v135 (I20): siglas das telas com verbete, nomes exatos usados pelas outras telas e textos sem travessão',()=>{
 const c=ctx(),todos=c.json('GlossarioFinanceiro.termos'),nomes=todos.map(t=>t.nome);
 for(const n of ['PMR (prazo médio de recebimento, DSO)','PMPF (prazo médio de pagamento a fornecedores, DPO)','PME (prazo médio de estoque)','FCO, FCI e FCF','ROE (retorno sobre o patrimônio)','ROA (retorno sobre o ativo)','Estados do mês','PDD (provisão para devedores duvidosos)','Aging (idade da carteira)','Necessidade de capital de giro','Margem de contribuição','Ponto de equilíbrio','Margem de segurança'])assert.ok(nomes.includes(n),n);
 assert.ok(!nomes.includes('DSO / prazo de recebimento')&&!nomes.includes('DPO / prazo de pagamento'),'nomes antigos saíram');
 for(const q of ['PMR','PME','PMPF','FCO','FCF','ROE','ROA','Reaberto','DSO','DPO'])assert.ok(c.json(`GlossarioFinanceiro.buscar(${JSON.stringify(q)}).length`)>=1,q);
 const t=n=>todos.find(x=>x.nome===n);
 assert.equal(t('PMR (prazo médio de recebimento, DSO)').tela,'giro');assert.equal(t('PMPF (prazo médio de pagamento a fornecedores, DPO)').tela,'giro');assert.equal(t('PME (prazo médio de estoque)').tela,'giro');
 assert.equal(t('PME (prazo médio de estoque)').formula,'Estoque ÷ custo do material no mês × 30');assert.equal(t('Ciclo financeiro').formula,'PME + PMR − PMPF');
 assert.equal(t('FCO, FCI e FCF').tela,'dfc');assert.equal(t('FCO, FCI e FCF').formula,'FCO + FCI + FCF = variação do caixa');
 assert.equal(t('ROE (retorno sobre o patrimônio)').tela,'indicadores');assert.equal(t('ROA (retorno sobre o ativo)').formula,'Resultado ÷ ativo total médio');
 const e=t('Estados do mês');assert.equal(e.grupo,'painel');assert.equal(e.tela,'conferencia');
 for(const s of ['Aguardando conferência','Conciliado','Fechado','Reaberto','Cobertura a conferir','Período parcial','Não apurado','Sem fonte'])assert.match(e.definicao,new RegExp(s+':'),s);
 assert.doesNotMatch(JSON.stringify(todos),/—/,'nenhum verbete com travessão');
 // I34: as referências usam dois-pontos
 const h=c.run('renderGlossario()');const ref=h.slice(h.indexOf('Referências e critérios'));assert.doesNotMatch(ref.slice(0,ref.indexOf('</details>')),/—/);assert.match(h,/CPC 26: apresentação das demonstrações/);assert.match(h,/Guia de planejamento financeiro: Sebrae/);
 assert.doesNotMatch(ler('pdf-cfo.js'),/nos dois meses — confira/);
});
test('v135 (D36, N22, N24): marca do termo pelo CSS, link de seção que abre em aba nova, termo aberto lembrado e "Explorar o glossário completo" com busca',()=>{
 const els={},rolou=[];let toggle=null;
 const el=id=>els[id]||(els[id]={id,dataset:{},open:false,value:'',innerHTML:'',close(){this.open=false;},showModal(){this.open=true;},focus(){},addEventListener(t,f){if(t==='toggle')toggle=f;},scrollIntoView(o){rolou.push([id,o]);}});
 const c=ctx();c.document.getElementById=el;let desenhou=0;c.render=()=>{desenhou++;};
 let h=c.run('resultadosGlossario()');
 assert.match(h,/<span class="glossary-marca" aria-hidden="true"><\/span><\/summary>/);assert.doesNotMatch(h,/＋/);
 assert.match(h,/<a href="#tela=glossario&secao=painel" data-glossario-secao="painel">/);assert.doesNotMatch(h,/href="#glossario-/);
 assert.match(h,/<details class="glossary-item" data-termo="DRE">/,'fechado por padrão');
 // link direto: a gestão grava state.glossarioSecao; o wire rola até a seção e zera
 c.run("state.view='glossario';state.glossarioSecao='painel';wireGlossario()");
 assert.equal(JSON.stringify(rolou),JSON.stringify([['glossario-painel',{block:'start'}]]));assert.equal(c.run('state.glossarioSecao'),'');
 // termo aberto pela pessoa continua aberto ao redesenhar
 toggle({target:{dataset:{termo:'Markup'},open:true}});assert.match(c.run('resultadosGlossario()'),/<details class="glossary-item" open data-termo="Markup">/);
 toggle({target:{dataset:{termo:'Markup'},open:false}});assert.doesNotMatch(c.run('resultadosGlossario()'),/open data-termo="Markup"/);
 // "Explorar o glossário completo": vai com a busca preenchida e o termo aberto
 const b={dataset:{term:'Margem de contribuição'}};c.document.querySelectorAll=s=>s==='[data-term]'?[b]:[];
 c.run("state.view='precos';wireGlossario()");b.onclick();assert.equal(els.detailDialog.open,true);els.abrirGlossario.onclick();
 assert.equal(c.run('state.view'),'glossario');assert.equal(desenhou,1);assert.equal(els.detailDialog.open,false);
 assert.equal(c.run('glossarioUI.busca'),'Margem de contribuição');assert.equal(c.run('glossarioUI.grupo'),'todos');
 assert.match(c.run('resultadosGlossario()'),/<details class="glossary-item" open data-termo="Margem de contribuição">/);
});
