import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
function client(){const storage=new Map();const ctx={localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{addEventListener(){}},navigator:{onLine:true},crypto:globalThis.crypto};vm.createContext(ctx);vm.runInContext(source,ctx);vm.runInContext('setSyncState=()=>{};',ctx);return ctx;}
test('moeda BR é interpretada sem virar zero',()=>{assert.equal(vm.runInContext(`parseNum('R$ 1.234,56')`,client()),1234.56);});
test('texto monetário inválido é rejeitado',()=>{assert.throws(()=>vm.runInContext(`parseNum('12 reais inválidos')`,client()));});
test('edição durante envio continua na fila até ser confirmada',async()=>{
 const c=client();let release;const sent=[];c.api=(_a,args)=>{sent.push(args.registro.valor);if(sent.length===1)return new Promise(r=>release=r);return Promise.resolve({ok:true});};
 vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);
 const work=vm.runInContext('trySync()',c);
 vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:200})`,c);
 release({ok:true});await work;assert.deepEqual(sent,[100,200]);assert.equal(vm.runInContext('getQueue().length',c),0);
});
test('erro permanente nunca descarta dado não salvo',async()=>{const c=client();c.api=async()=>({erro:'Inválido'});vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);for(let i=0;i<27;i++)await vm.runInContext('trySync()',c);assert.equal(vm.runInContext('getQueue().length',c),1);});
test('conflito conserva edição e versão remota para revisão',async()=>{const c=client();c.api=async()=>({conflito:true,servidor:{id:'Ago_2026',valor:150}});vm.runInContext(`adoptServerMonth=()=>{};enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);await vm.runInContext('trySync()',c);assert.equal(vm.runInContext('getQueue()[0]?.registro.valor',c),100);assert.equal(vm.runInContext('getQueue()[0]?.conflito.servidor.valor',c),150);});
test('histórico preserva nomes e metadados de cada mês',()=>{const c=client();const out=vm.runInContext(`monthsToDataset([{id:'Jan_2026',label:'Jan/2026',qualidade:{estado:'parcial'},cells:[{code:'2.1',name:'Antes',value:100}]},{id:'Fev_2026',label:'Fev/2026',cells:[{code:'2.1',name:'Depois',value:200}]}])`,c);assert.deepEqual(Array.from(out.accounts[0].names),['Antes','Depois']);assert.equal(out.registros[0].qualidade.estado,'parcial');});
test('nova edição parte da versão confirmada pelo servidor',async()=>{const c=client();const stamp='2026-09-09T20:00:00Z';c.api=async()=>({ok:true,registro:{id:'Ago_2026',label:'Ago/2026',atualizadoEm:stamp,cells:[{code:'1',value:100},{code:'2',value:0}]}});vm.runInContext(`salvarLocal(monthsToDataset([{id:'Ago_2026',label:'Ago/2026',atualizadoEm:'2026-01-01',cells:[{code:'1',value:100},{code:'2',value:0}]}]));enqueueUpsert(datasetRecords(getCurrentData())[0]);`,c);await vm.runInContext('trySync()',c);assert.equal(vm.runInContext('monthRecord(getCurrentData(),0,"nova").baseAtualizadoEm',c),stamp);});
test('falta de espaço na fila não finge que salvou a edição',()=>{const c=client();c.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};assert.throws(()=>vm.runInContext(`enqueueUpsert({id:'Ago_2026'})`,c));});
test('importação atualiza nome apenas no mês escolhido',()=>{const c=client();const r=vm.runInContext(`(()=>{const d=monthsToDataset([{label:'Jan/2026',cells:[{code:'2',name:'Antes',value:10}]},{label:'Fev/2026',cells:[{code:'2',name:'Velho',value:20}]}]);return monthRecord(upsertMonth(d,'Fev/2026',[{code:'2',name:'Novo',value:30}]),1,'agora')})()`,c);assert.equal(r.cells[0].name,'Novo');});
test('importar mês não inventa contas zeradas de outros períodos',()=>{const c=client();const r=vm.runInContext(`prepararImportacao([{id:'Jan_2026',label:'Jan/2026',cells:[{code:'1',value:10},{code:'2',value:3},{code:'2.99',value:3}]}],'Fev/2026',[{code:'1',name:'Entradas',value:100},{code:'2',name:'Saídas',value:40}])`,c);assert.equal(r.cells.length,2);assert.equal(r.cells[0].value,100);});
test('backup de configurações exclui campos de credenciais e permissões',()=>{const c=client();const r=vm.runInContext(`configSegura({accessToken:'segredo',publicKey:'chave',permissoes:{equipe:'admin'},produtosCodigo:{A:'1.1'},regras:{reserva:100}})`,c);assert.deepEqual(Object.keys(r).sort(),['produtosCodigo','regras']);});
