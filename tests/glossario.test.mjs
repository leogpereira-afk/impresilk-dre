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
 for(const n of ['DRE de caixa (DRE Simples)','Material político','Saídas sem detalhamento (2.99)','Mês fechado, em andamento e pela metade','Trilha por pagamento','Retiradas e arrendamento (sócios)'])assert.ok(painel.some(t=>t.nome===n),n);
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
 assert.match(h,/data-glossario-go="precos">Ver em Preço e equilíbrio →/);
 c.run("glossarioUI.busca='material politico'");h=c.run('resultadosGlossario()');assert.doesNotMatch(h,/glossary-secao/);assert.match(h,/Material político/);
 c.run("glossarioUI.busca='';glossarioUI.grupo='credito'");h=c.run('resultadosGlossario()');assert.doesNotMatch(h,/glossary-secao/);assert.match(h,/Antecipação de recebíveis/);
 c.run("glossarioUI.busca='xyz123';glossarioUI.grupo='todos'");assert.match(c.run('resultadosGlossario()'),/Nenhum termo encontrado/);
});
