// Fase 11.4: fechamento do mês — a lista se confere sozinha; fechar só registra quem,
// quando e como estava; com ⚠️ exige justificativa; reabrir pede o motivo; "Fechado" no app.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
const mes=[cel('1','Receitas',10000),cel('1.1','Comunicação Visual',10000),cel('2','Despesas',7000),cel('2.4','Impostos',1000),cel('2.4.1','DAS',1000),cel('2.4.1.2','Impresilk',1000),cel('2.12','Materiais',6000)];
const reg=(label,ate,extra={})=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:mes,...extra});
const CFG_OK={parametros:{simples:{'2026-09':{impresilk:{aliquota:6},universo:{aliquota:6}}},operacao:{'2026-09':{saldoInicial:1000,estoque:5000},'2026-10':{saldoInicial:4000}},balanco:{'2026-09':{imobilizado:100000,emprestimos:0,parcelamentoDAS:0}}},gestao:{}};
function app({regs=[reg('Set/2026','2026-09-30'),reg('Out/2026','2026-10-12')],cfg=CFG_OK,hist=[{id:'2026-09'}],admin=true}={}){
 const el={};const c={structuredClone,atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),document:{addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[],querySelector:s=>el[s]||null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout,Promise};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js','plano-contas.js','auditoria.js','fechamento.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=structuredClone(regs);c.__cfg=structuredClone(cfg);c.el=el;
 c.run(`dfcHoje=()=>'2026-10-12';render=()=>{};toast=()=>{};globalThis.AUTH={cracha:()=>'x.'+btoa(JSON.stringify({sub:'leonardo'}))+'.y'};state.records=__r;state.cfg=__cfg;state.view='conferencia';state.periodo='Set/2026';state.permissoes={leitura:true,edicao:true,admin:${admin}};giroUI.dados={historico:{meses:${JSON.stringify(hist)}}};giroUI.em=Date.now();
  __gravados=[];api=async(acao,b)=>{if(acao==='getCfg')return {ok:true,cfg:state.cfg,atualizadoEm:'v1'};if(acao==='setCfg'){__gravados.push(b.cfg);return {ok:true,atualizadoEm:'v2'};}return {ok:false};}`);
 return c;
}
const ok=c=>Object.fromEntries(c.json(`fechConferir('Set/2026')`).map(x=>[x.id,x.ok]));
test('lista: mês completo e cadastrado fica todo certo',()=>{
 const c=app();assert.deepEqual(ok(c),{coleta:true,caixa:true,classificacao:true,saldo:true,aliquota:true,cadastros:true,posicao:true,auditoria:true});
 assert.match(c.run('renderFechamento()'),/Todos os itens certos/);
});
test('lista: cada falta vira ⚠️ com o que fazer',()=>{
 const cfg=structuredClone(CFG_OK);delete cfg.parametros.operacao['2026-10'];delete cfg.parametros.simples;delete cfg.parametros.operacao['2026-09'].estoque;
 const c=app({regs:[reg('Set/2026','2026-09-20',{pendencias:[{tipo:'sem-classe'}]}),reg('Out/2026','2026-10-12')],cfg,hist:[]});const L=c.json(`fechConferir('Set/2026')`),t=Object.fromEntries(L.map(x=>[x.id,x]));
 assert.equal(t.coleta.ok,false);assert.match(t.coleta.texto,/Coletado só até 20\/09\/2026/);
 assert.equal(t.classificacao.ok,false);assert.match(t.classificacao.texto,/1 pendência/);
 assert.equal(t.saldo.ok,false);assert.match(t.saldo.texto,/saldo bancário do início de Out\/2026/);
 assert.equal(t.aliquota.ok,false);assert.equal(t.cadastros.ok,false);assert.match(t.cadastros.texto,/estoque/);
 assert.equal(t.posicao.ok,false);assert.match(t.posicao.texto,/Histórico de posições/);
 const div=structuredClone(CFG_OK);div.parametros.operacao['2026-10'].saldoInicial=3900;assert.match(app({cfg:div}).json(`fechConferir('Set/2026')`).find(x=>x.id==='saldo').texto,/difere R\$\s100,00/);
});
test('fechar: com ⚠️ exige justificativa; grava quem, quando e a foto; "Fechado" no app; reabrir pede motivo',async()=>{
 const cfg=structuredClone(CFG_OK);delete cfg.parametros.simples;const c=app({cfg});
 // Sem justificativa: não grava.
 c.run(`document.querySelector=()=>null`);c.run(`fechUI.erro=''`);
 const clique=sel=>c.run(`(()=>{const h=[];document.addEventListener=(t,f)=>h.push(f);wireFechamento();h[0]({target:{closest:()=>({hasAttribute:a=>a==='${sel}'})}});})()`);
 clique('data-fech-fechar');assert.match(c.run('fechUI.erro'),/justificativa/);assert.equal(c.run('__gravados.length'),0);
 c.run(`document.querySelector=s=>s==='[data-fech-just]'?{value:'PGDAS sai dia 13'}:null`);clique('data-fech-fechar');
 await new Promise(r=>setTimeout(r,20));
 assert.equal(c.run('__gravados.length'),1);const f=c.json(`state.cfg.gestao['fechamento:Set_2026']`);
 assert.deepEqual([f.estado,f.por,f.pendentes,f.justificativa],['fechado','leonardo',['aliquota'],'PGDAS sai dia 13']);assert.equal(f.itens.length,8);
 assert.equal(c.json(`F.qualidade(state.records[0]).rotulo`),'Fechado');assert.equal(c.json(`F.qualidade(state.records[1]).rotulo`)!=='Fechado',true,'mês em andamento não fecha');
 assert.match(c.run('renderFechamento()'),/Fechado<\/b> por leonardo/);
 clique('data-fech-reabrir');c.run(`document.querySelector=s=>s==='[data-fech-motivo]'?{value:''}:null`);clique('data-fech-reabrir-ok');assert.match(c.run('fechUI.erro'),/por que/);
 c.run(`document.querySelector=s=>s==='[data-fech-motivo]'?{value:'Nota fiscal atrasada'}:null`);clique('data-fech-reabrir-ok');await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(c.json(`[state.cfg.gestao['fechamento:Set_2026'].estado,state.cfg.gestao['fechamento:Set_2026'].motivo,state.cfg.gestao.historico.length]`),['reaberto','Nota fiscal atrasada',2]);
 assert.notEqual(c.json(`F.qualidade(state.records[0]).rotulo`),'Fechado');
});
test('sem acesso de administrador: a lista aparece, o botão não',()=>{
 const h=app({admin:false}).run('renderFechamento()');assert.doesNotMatch(h,/data-fech-fechar/);assert.match(h,/Só um administrador/);
});
