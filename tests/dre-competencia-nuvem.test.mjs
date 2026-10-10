import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
// Só o modelo: DRECompetencia.salvar recebe a api por parâmetro, sem tela nem servidor.
function context(){const c={structuredClone};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../dre-modelo.js',import.meta.url),'utf8'),c);return c;}
// Ordem de chaves do jsonb do Postgres: por tamanho, depois por bytes.
const jsonb=v=>Array.isArray(v)?v.map(jsonb):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0)).map(k=>[k,jsonb(v[k])])):v;
// Nuvem simulada: getCfg devolve o cfg na ordem do jsonb; setCfg recusa base velha.
function nuvem(){const n={cfg:{},em:'t0',writes:0};n.api=async(a,b)=>{if(a==='getCfg')return {ok:true,cfg:jsonb(structuredClone(n.cfg)),atualizadoEm:n.em};if(b.baseAtualizadoEm!==n.em)return {conflito:true};n.cfg=structuredClone(b.cfg);n.em+='+';n.writes++;return {ok:true,atualizadoEm:n.em};};return n;}
const valores=(c,extra={})=>Object.assign(Object.fromEntries(c.DREModelo.campos.map(f=>[f.id,0])),extra);
const registro=(c,revisao,extra={},parcial=false)=>{const v=valores(c,extra);if(parcial)v.da=null;return {label:'Set/2026',company:'Impresilk + Universo',fonte:'Balancete de teste',notas:'',valores:v,revisao,revisadoEm:'2026-10-10T12:00:00Z'};};
// Como a tela: o original sai de uma cópia do state.cfg, que depois de salvar é o cfg devolvido por salvar.
const original=(c,cfg)=>structuredClone(c.DRECompetencia.obter(cfg,'Set_2026'));

test('salvar o mesmo mês de novo na sessão não acusa conflito só porque o jsonb reordenou as chaves',async()=>{
 const c=context(),n=nuvem(),C=c.DRECompetencia;
 let res=await C.salvar({api:n.api,admin:true,id:'Set_2026',original:null,registro:registro(c,'r1',{produtos:1000,custos:400})});
 res=await C.salvar({api:n.api,admin:true,id:'Set_2026',original:original(c,res.cfg),registro:registro(c,'r2',{produtos:1100,custos:400},true)});
 // Terceira gravação: o histórico traz o registro anterior com historico:undefined, que o jsonb não guarda.
 res=await C.salvar({api:n.api,admin:true,id:'Set_2026',original:original(c,res.cfg),registro:registro(c,'r3',{produtos:1200,custos:450})});
 const mes=n.cfg.demonstrativosCompetencia.meses.Set_2026;
 assert.equal(n.writes,3);assert.equal(mes.revisao,'r3');assert.equal(mes.valores.produtos,1200);assert.equal(mes.estado,'preenchido');
 assert.deepEqual(mes.historico.map(h=>h.revisao),['r2','r1']);assert.equal(mes.historico[0].estado,'parcial');
});
test('mudança de verdade no mês continua recusada, sem gravar por cima',async()=>{
 const c=context(),n=nuvem(),C=c.DRECompetencia;
 const res=await C.salvar({api:n.api,admin:true,id:'Set_2026',original:null,registro:registro(c,'r1',{produtos:1000})});
 const meu=original(c,res.cfg);
 // Outra pessoa salva o mesmo mês com outro valor.
 n.cfg.demonstrativosCompetencia.meses.Set_2026.valores.produtos=999;n.em+='*';
 await assert.rejects(C.salvar({api:n.api,admin:true,id:'Set_2026',original:meu,registro:registro(c,'r2',{produtos:1100})}),/mudou na nuvem/);
 // Só a ordem de um histórico diferente também é mudança: a ordem dos itens de uma lista conta.
 n.cfg.demonstrativosCompetencia.meses.Set_2026.valores.produtos=1000;n.cfg.demonstrativosCompetencia.meses.Set_2026.historico=[{revisao:'a'},{revisao:'b'}];n.em+='*';
 const comLista={...meu,historico:[{revisao:'b'},{revisao:'a'}]};
 await assert.rejects(C.salvar({api:n.api,admin:true,id:'Set_2026',original:comLista,registro:registro(c,'r3',{produtos:1100})}),/mudou na nuvem/);
 assert.equal(n.writes,1);assert.equal(n.cfg.demonstrativosCompetencia.meses.Set_2026.revisao,'r1');
});
test('igual compara sem depender da ordem das chaves e mantém ausente igual a nulo',()=>{
 const {igual}=context().DRECompetencia;
 assert.equal(igual({a:1,b:{c:2,d:[1,{e:3,f:4}]}},{b:{d:[1,{f:4,e:3}],c:2},a:1}),true);
 assert.equal(igual({a:[1,2]},{a:[2,1]}),false);assert.equal(igual({a:1},{a:2}),false);
 assert.equal(igual({a:1,b:undefined},{a:1}),true);
 assert.equal(igual(null,undefined),true);assert.equal(igual(undefined,null),true);assert.equal(igual(null,{}),false);
});
