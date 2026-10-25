import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function atalhos(records, anual=null){
 const c={state:{records,view:'custos'},regAtual:()=>records.at(-1),
  F:{valorConta:(reg,code)=>reg?.cells?.find(x=>x.code===code)?.value??null},
  money:v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v),
  esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  telaNoAno:()=>!!anual,registroDoAno:()=>anual,anoDaTela:()=>2026};
 vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../graficos.js',import.meta.url),'utf8'),c);
 const html=vm.runInContext('atalhosCustos()',c);
 return label=>{const card=[...html.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(x=>x[0]).find(x=>x.includes(`<span class="label">${label}</span>`));assert.ok(card,`atalho ${label}`);return card;};
}
const cell=(code,name,value)=>({code,name,value});
test('atalhos seguem os nomes vigentes quando os códigos de energia e aluguel estão trocados',()=>{
 const card=atalhos([{label:'Out/2026',cells:[cell('2.5.3','Aluguel do galpão',8000),cell('2.5.2','Energia elétrica',3500)]}]);
 assert.match(card('Energia'),/data-cost="2\.5\.2"/);assert.match(card('Energia'),/3\.500,00/);assert.match(card('Energia'),/<small>Energia elétrica<\/small>/);
 assert.match(card('Aluguel'),/data-cost="2\.5\.3"/);assert.match(card('Aluguel'),/8\.000,00/);assert.match(card('Aluguel'),/<small>Aluguel do galpão<\/small>/);
});
test('código histórico reutilizado não cria Energia com o valor de outra conta',()=>{
 const card=atalhos([{label:'Set/2026',cells:[cell('2.5.3','Cemig',120)]},{label:'Out/2026',cells:[cell('2.5.3','Aluguel do galpão',8000)]}]);
 assert.match(card('Energia'),/disabled/);assert.doesNotMatch(card('Energia'),/data-cost=|8\.000,00|Aluguel do galpão/);
 assert.match(card('Aluguel'),/data-cost="2\.5\.3"/);
});
test('conta histórica ausente continua consultável sem assumir valor zero',()=>{
 const card=atalhos([{label:'Set/2026',cells:[cell('2.7.8','Cemig',0)]},{label:'Out/2026',cells:[]}]);
 assert.match(card('Energia'),/data-cost="2\.7\.8"/);assert.match(card('Energia'),/Não informado/);assert.match(card('Energia'),/Cemig · histórico/);
});
test('mais de uma conta da mesma categoria não escolhe uma arbitrariamente',()=>{
 const card=atalhos([{label:'Out/2026',cells:[cell('2.7.1','Energia fábrica',200),cell('2.7.2','Energia escritório',100)]}]);
 assert.match(card('Energia'),/disabled/);assert.doesNotMatch(card('Energia'),/data-cost=|200,00|100,00/);
});
test('ano não apresenta aluguel somado com energia quando o código muda de significado',()=>{
 const records=[{label:'Jan/2026',cells:[cell('2.5.3','Aluguel do galpão',8000)]},{label:'Fev/2026',cells:[cell('2.5.3','Energia elétrica',3500)]}];
 const card=atalhos(records,{disponivel:true,meses:['Jan/2026','Fev/2026'],reg:{cells:[cell('2.5.3','Energia elétrica',11500)]}});
 assert.match(card('Energia'),/disabled/);assert.doesNotMatch(card('Energia'),/data-cost=|11\.500,00/);
});
test('mesma categoria reconhecida em todo o ano mantém o total anual e escapa o nome',()=>{
 const records=[{label:'Jan/2026',cells:[cell('2.9.1','Cemig',100)]},{label:'Fev/2026',cells:[cell('2.9.1','Energia elétrica <sede>',200)]}];
 const card=atalhos(records,{disponivel:true,meses:['Jan/2026','Fev/2026'],reg:{cells:[cell('2.9.1','Energia elétrica <sede>',300)]}});
 assert.match(card('Energia'),/data-cost="2\.9\.1"/);assert.match(card('Energia'),/300,00/);assert.match(card('Energia'),/&lt;sede&gt;/);assert.doesNotMatch(card('Energia'),/<sede>/);
});
