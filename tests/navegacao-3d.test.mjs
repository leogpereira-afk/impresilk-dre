import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

function ambiente(hash='#tela=custos&mes=Ago%2F2026') {
 const c={structuredClone,URLSearchParams,location:{hash},navigator:{onLine:true},localStorage:{getItem:()=>null,setItem(){}},document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,getElementById:()=>null}};
 c.history={state:null,replaceState(_s,_t,h){c.location.hash=h;},pushState(_s,_t,h){c.location.hash=h;}};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','cfo-modelo.js','cfo.js','app.js','gestao.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);return c;
}
test('grupo, busca e conta das despesas sobrevivem à atualização pelo link, incluindo acentos e &',()=>{
 const c=ambiente();c.run("restaurarRota();custoUI.grupo='2.12';custoUI.conta='2.12.3';custoUI.busca='Chapas & tinta';gravarRota()");
 const reaberto=ambiente(c.location.hash);reaberto.run('restaurarRota()');
 assert.equal(reaberto.run('JSON.stringify(custoUI)'),JSON.stringify({grupo:'2.12',conta:'2.12.3',busca:'Chapas & tinta'}));
 c.run("state.view='cfo';gravarRota();state.view='custos';gravarRota()");
 assert.equal(new URLSearchParams(c.location.hash.slice(1)).get('custoconta'),'2.12.3');
});
test('rota de despesas valida códigos e limita a busca; sem comparação permanece vazio',()=>{
 const c=ambiente('#tela=custos&mes=Ago%2F2026&comparar=&custogrupo=javascript:1&custoconta=1.1&custobusca='+('x'.repeat(300)));c.run('restaurarRota()');
 assert.equal(c.run('custoUI.grupo'),'2.5');assert.equal(c.run('custoUI.conta'),'');assert.equal(c.run('custoUI.busca.length'),200);assert.equal(c.run('state.comparar'),'');
});
test('mudança de largura revela o mês selecionado sem rolar a página e não recentraliza mês já visível',()=>{
 const c=ambiente();let largura=300,esquerda=1000,callbacks=0;
 const barra={clientWidth:300,scrollWidth:1200,scrollLeft:0,getBoundingClientRect:()=>({left:0,right:largura}),querySelector:()=>({offsetWidth:50,getBoundingClientRect:()=>({left:esquerda,right:esquerda+50})})};
 c.document.getElementById=id=>id==='monthChips'?barra:null;c.ResizeObserver=class{constructor(fn){c.resize=fn;}observe(){callbacks++;}};c.requestAnimationFrame=fn=>fn();
 c.run('acompanharFaixaMeses()');assert.equal(barra.scrollLeft,875);assert.equal(callbacks,1);
 esquerda=100;c.run('acompanharFaixaMeses()');assert.equal(barra.scrollLeft,875);assert.equal(callbacks,1);
 esquerda=280;largura=250;barra.clientWidth=250;c.resize();assert.equal(barra.scrollLeft,1055);
});
