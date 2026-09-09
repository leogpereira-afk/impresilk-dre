import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
function view(){
 const elements={exportCosts:{}};
 const c={document:{addEventListener(){},querySelectorAll:()=>[],getElementById:id=>elements[id]},localStorage:{getItem:()=>null},navigator:{onLine:true}};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','app.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 vm.runInContext(`state.periodo='Ago/2026';state.records=[{label:'Jul/2026',cells:[{code:'1',name:'Entradas',value:100},{code:'2',name:'Saídas',value:60},{code:'2.5',name:'Fixas',value:60},{code:'2.5.3',name:'Cemig',value:0}]},{label:'Ago/2026',cells:[{code:'1',name:'Entradas',value:200},{code:'2',name:'Saídas',value:210},{code:'2.5',name:'Fixas',value:210}]}];state.D={accounts:[]};`,c);
 return {c,elements};
}
test('as áreas analíticas renderizam com mês disponível e com mês ausente',()=>{
 const {c}=view();
 for(const label of ['Ago/2026','Set/2026'])for(const f of ['renderInicio','renderCaixa','renderResultado','renderCustos']){
  const html=vm.runInContext(`state.periodo='${label}';${f}(regAtual(),F.qualidade(regAtual()))`,c);
  assert.ok(html.length>100);assert.doesNotMatch(html,/NaN|undefined|height:-/);
 }
});
test('energia ausente não aparece como zero e a conta histórica continua consultável',()=>{
 const {c}=view();const html=vm.runInContext('renderCustos(regAtual())',c);
 assert.match(html,/Energia<\/span><strong>Não informado/);assert.match(html,/Cemig · histórico/);assert.match(html,/Jul\/2026 · Cemig: R\$ 0,00/);
});
test('exportação mensal preserva ausência, zero, cobertura e nomenclatura original',()=>{
 const {c,elements}=view();c.download=(name,content)=>{c.exported={name,content};};
 vm.runInContext('wireGraficos()',c);elements.exportCosts.onclick();
 assert.match(c.exported.content,/"2.5.3";"Cemig";"0,00";"Não informado"/);
 assert.match(c.exported.content,/"Cobertura"/);assert.match(c.exported.content,/"Nome original";"Cemig";"Não informado"/);
});
test('nomes de contas são texto escapado nos gráficos e na tabela',()=>{
 const {c}=view();const html=vm.runInContext(`state.records[0].cells.at(-1).name='<img src=x onerror=alert(1)>';renderCustos(regAtual())`,c);
 assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);
});
test('cascata de caixa fecha em centavos mesmo com resíduo negativo',()=>{
 const {c}=view();const html=vm.runInContext(`graficoPonte({label:'Jan/2026',cells:[{code:'1',value:100},{code:'2',value:80},{code:'2.5',name:'Fixas',value:100}]})`,c);
 assert.match(html,/Variação: R\$ 20,00/);assert.match(html,/Sem detalhamento \/ diferença: R\$ 20,00/);
});
