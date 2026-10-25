import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
const fonte=fs.readFileSync(new URL('../graficos.js',import.meta.url),'utf8');
function contexto(extra={}){const c={tomDoValor:()=>'',...extra};vm.createContext(c);vm.runInContext(fonte,c);return c;}
test('cascata: a lista numerada preserva a geometria, a escala e os valores exatos',()=>{
 const c=contexto(),h=c.gCascata([{rotulo:'Receita',valor:100,total:true},{rotulo:'Custos',valor:-20},{rotulo:'Resultado',valor:80,total:true}],{inicio:'entrada'});
 const barras=[...h.matchAll(/<rect class="g-marca-dado [^"]+" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map(m=>m.slice(1).map(Number));
 assert.deepEqual(barras,[[73.33,0,186.67,220],[406.67,0,186.67,44],[740,44,186.67,176]]);
 assert.match(h,/Etapa 2: Custos\. −R\$\s20,00\. −20,0% da base/);
 assert.match(h,/<th scope="row">Resultado<\/th><td class="num[^"]*">R\$\s80,00/);
});
test('cascata: texto malicioso, ausência e zero conservam estados distintos na lista',()=>{
 const c=contexto(),h=c.gCascata([{rotulo:'Receita',valor:100,total:true},{rotulo:'<img src=x>',valor:0},{rotulo:'Ausente',valor:null},{rotulo:'Após lacuna',valor:-5},{rotulo:'Total',valor:95,total:true}]);
 assert.doesNotMatch(h,/<img src=x>/);assert.match(h,/&lt;img src=x&gt;/);
 const botoes=[...h.matchAll(/<button type="button" class="g-cascata-etapa[^>]+/g)].map(m=>m[0]);
 assert.equal(botoes.length,5);assert.doesNotMatch(botoes[1],/disabled/);assert.match(botoes[1],/R\$\s0,00/);
 assert.match(botoes[2],/Não apurado[^>]+disabled/);assert.match(botoes[3],/Não apurado[^>]+disabled/);
});
test('cascata: etapa, marca e dica ficam sincronizadas por clique e setas; Escape limpa o destaque',()=>{
 const node=attrs=>({attrs,events:{},classes:new Set(),getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.events[k]=fn;},getBoundingClientRect(){return {left:20,top:50,width:10,bottom:70};}});
 const marcas=[node({'data-g-step':'0','data-dica':'Receita\nR$ 100,00','data-tom':'tom-entra'}),node({'data-g-step':'1','data-dica':'Custos\n−R$ 20,00','data-tom':'tom-sai'})];
 marcas.forEach(m=>m.classList={toggle:(k,v)=>v?m.classes.add(k):m.classes.delete(k)});
 const etapas=[node({'data-g-step':'0'}),node({'data-g-step':'1'})],dica={hidden:true,style:{},offsetWidth:40,offsetHeight:20,append(){}};
 const fig={querySelector:()=>dica,querySelectorAll:()=>etapas,getBoundingClientRect:()=>({left:0,top:0,width:100})};
 const plot=node({});plot.dataset={};plot.closest=()=>fig;plot.querySelectorAll=()=>marcas;plot.contains=m=>marcas.includes(m);
 const c=contexto({document:{createElement:()=>({})}});c.ligarDicasGraficos({querySelectorAll:()=>[plot]});
 etapas[1].events.click();assert.equal(etapas[1].attrs['aria-pressed'],'true');assert.equal(dica.textContent,'Custos');assert.equal(dica.hidden,false);assert.ok(marcas[1].classes.has('g-ativo'));
 plot.events.keydown({key:'Home',preventDefault(){}});assert.equal(etapas[0].attrs['aria-pressed'],'true');assert.equal(etapas[1].attrs['aria-pressed'],'false');assert.equal(dica.textContent,'Receita');
 plot.events.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(dica.textContent,'Custos');
 etapas[1].events.keydown({key:'Escape'});assert.equal(dica.hidden,true);assert.ok(etapas.every(x=>x.attrs['aria-pressed']==='false'));
});
test('cascata: setas nos botões movem o foco, saltam lacunas e incluem valor zero',()=>{
 let focado=null,prevenidos=0;
 const node=attrs=>({attrs,events:{},classes:new Set(),getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.events[k]=fn;},getBoundingClientRect(){return {left:20,top:50,width:10,bottom:70};},focus(){if(focado!==this){focado?.events.blur?.();focado=this;this.events.focus?.();}}});
 const marcas=[node({'data-g-step':'0','data-dica':'Receita'}),node({'data-g-step':'2','data-dica':'Devoluções zero'}),node({'data-g-step':'3','data-dica':'Resultado'})];
 marcas.forEach(m=>m.classList={toggle:(k,v)=>v?m.classes.add(k):m.classes.delete(k)});
 const etapas=[0,1,2,3].map(i=>node({'data-g-step':String(i)}));etapas[1].disabled=true;
 const dica={hidden:true,style:{},offsetWidth:40,offsetHeight:20,append(){}},fig={querySelector:()=>dica,querySelectorAll:()=>etapas,getBoundingClientRect:()=>({left:0,top:0,width:100})};
 const plot=node({});plot.dataset={};plot.closest=()=>fig;plot.querySelectorAll=()=>marcas;plot.contains=m=>marcas.includes(m);
 const c=contexto({document:{createElement:()=>({})}});c.ligarDicasGraficos({querySelectorAll:()=>[plot]});
 const tecla=key=>focado.events.keydown({key,preventDefault(){prevenidos++;}});
 etapas[0].focus();tecla('ArrowRight');assert.equal(focado,etapas[2]);assert.equal(dica.textContent,'Devoluções zero');assert.equal(etapas[2].attrs['aria-pressed'],'true');assert.ok(marcas[1].classes.has('g-ativo'));
 tecla('ArrowDown');assert.equal(focado,etapas[3]);assert.equal(dica.textContent,'Resultado');
 tecla('Home');assert.equal(focado,etapas[0]);assert.equal(dica.textContent,'Receita');
 tecla('ArrowLeft');assert.equal(focado,etapas[0]);
 tecla('End');assert.equal(focado,etapas[3]);
 tecla('ArrowUp');assert.equal(focado,etapas[2]);
 tecla('Escape');assert.equal(dica.hidden,true);assert.ok(etapas.every(x=>x.attrs['aria-pressed']==='false'));
 assert.equal(prevenidos,6);assert.equal(etapas[1].attrs['aria-pressed'],'false');
});
