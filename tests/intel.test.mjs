// Arquivo das importações do Painel (Fase 9.3): cada recorte completo do Painel fica
// guardado por fonte e período; a consulta usa o arquivo quando o recorte de hoje não
// cobre o período, junta meses inteiros e diz o que falta. Nada é inventado.
import assert from 'node:assert/strict';import {test} from 'node:test';
import {arquivarIntel,recorteArquivado,recorteValido} from '../supabase/functions/dre-sync/intel.mjs';
import {consultarIndicadores} from '../supabase/functions/dre-sync/indicadores.mjs';

// Banco em memória com só o que o código usa (painel_cache e dre_registros).
function banco({cache={},registros=[],falhas={}}={}){
 const reg=registros.map(r=>({...r})),gravados=[];
 const q=t=>{const f={eq:[],like:null,in:null};const api={select(){return api;},eq(k,v){f.eq.push([k,v]);return api;},like(k,v){f.like=[k,v];return api;},in(k,v){f.in=[k,v];return api;},
  maybeSingle(){if(falhas[t])return Promise.resolve({data:null,error:new Error('x')});if(t==='painel_cache'){const k=f.eq.find(x=>x[0]==='chave')?.[1];return Promise.resolve({data:cache[k]?{valor:cache[k],atualizado_em:'2026-10-01T12:00:00Z'}:null,error:null});}
   const id=f.eq.find(x=>x[0]==='id')?.[1],r=reg.find(x=>x.colecao==='intel'&&x.id===id);return Promise.resolve({data:r?{em:r.registro.em==null?null:String(r.registro.em)}:null,error:null});},
  then(ok,erro){if(falhas[t])return Promise.resolve({data:null,error:new Error('x')}).then(ok,erro);let data;if(t==='painel_cache')data=Object.entries(cache).filter(([k])=>f.in[1].includes(k)).map(([chave,valor])=>({chave,valor}));
   else{const pre=f.like?.[1]?.replace('%','')||'';data=reg.filter(x=>x.colecao==='intel'&&x.id.startsWith(pre)).map(x=>({id:x.id,registro:x.registro}));}return Promise.resolve({data,error:null}).then(ok,erro);},
  upsert(linha){gravados.push(linha);const i=reg.findIndex(x=>x.colecao===linha.colecao&&x.id===linha.id);if(i>=0)reg[i]=linha;else reg.push(linha);return Promise.resolve({error:falhas.upsert?new Error('x'):null});}};return api;};
 return {from:q,reg,gravados};
}
const nf=(id,em,valor)=>({id,numero:String(id),em,destinatario:'Cliente '+id,valor,status:'Autorizada',normal:true,saida:true,cancelada:false});
const os=(id,venda,custo)=>({id,numero:String(id),cliente:'Cliente '+id,tipo:'Normal',venda,custo,cancelada:false});
const recorte=(desde,ate,itens,em='2026-10-01T12:00:00Z')=>({completo:true,desde,ate,em,itens});

test('arquivar: guarda cada recorte completo uma vez; incompleto fica de fora; nada no Painel muda',async()=>{
 const sb=banco({cache:{intel_nfe:recorte('2026-09-01','2026-09-30',[nf(1,'2026-09-10',100000)]),intel_detalhes:recorte('2026-09-01','2026-09-30',[os(7,500000,300000)]),intel_compras:{completo:false,desde:'2026-09-01',ate:'2026-09-30',itens:[]}}});
 const a=await arquivarIntel(sb,new Date('2026-10-11T12:00:00Z'));
 assert.deepEqual(a.arquivos.map(x=>[x.chave,x.estado]),[['intel_nfe','gravado'],['intel_detalhes','gravado'],['intel_compras','incompleto']]);
 assert.deepEqual(sb.gravados.map(x=>[x.colecao,x.id,x.registro.chave,x.registro.arquivadoEm]),[['intel','intel_nfe:2026-09-01:2026-09-30','intel_nfe','2026-10-11T12:00:00.000Z'],['intel','intel_detalhes:2026-09-01:2026-09-30','intel_detalhes','2026-10-11T12:00:00.000Z']]);
 const b=await arquivarIntel(sb);assert.deepEqual(b.arquivos.map(x=>x.estado),['igual','igual','incompleto'],'o mesmo retrato não é regravado');assert.equal(sb.gravados.length,2);
 await assert.rejects(()=>arquivarIntel(banco({falhas:{painel_cache:1}})),/Não foi possível ler as importações do Painel/);
 assert.equal(recorteValido({completo:true,desde:'2026-09-30',ate:'2026-09-01',itens:[]}),false,'período invertido não vale');
});
test('consulta: O.S. com custo de um mês antigo vêm do arquivo (recorte exato), com o aviso de onde vieram',async()=>{
 const sb=banco({cache:{intel_detalhes:recorte('2026-09-01','2026-09-30',[os(7,500000,300000)])},registros:[{colecao:'intel',id:'intel_detalhes:2026-08-01:2026-08-31',registro:{...recorte('2026-08-01','2026-08-31',[os(5,200000,150000),os(6,100000,null)]),chave:'intel_detalhes'}}]});
 const r=await consultarIndicadores(sb,{fonte:'custos',de:'2026-08-01',ate:'2026-08-31'});
 assert.deepEqual([r.disponivel,r.total,r.comValor,r.valor],[true,2,1,1500]);assert.match(r.avisos[0],/^Recorte guardado pelo DRE: importação do Painel de 2026-08-01 a 2026-08-31\./);
 const hoje=await consultarIndicadores(sb,{fonte:'custos',de:'2026-09-01',ate:'2026-09-30'});assert.equal(hoje.avisos.some(a=>/guardado pelo DRE/.test(a)),false,'o recorte de hoje continua valendo primeiro');
});
test('consulta: vários meses inteiros juntam os recortes mensais; faltando mês, diz qual; mês futuro não é exigido',async()=>{
 const mes=(ym,itens)=>({colecao:'intel',id:`intel_nfe:${ym}-01:${new Date(Date.UTC(+ym.slice(0,4),+ym.slice(5),0)).toISOString().slice(0,10)}`,registro:{...recorte(`${ym}-01`,new Date(Date.UTC(+ym.slice(0,4),+ym.slice(5),0)).toISOString().slice(0,10),itens),chave:'intel_nfe'}});
 const sb=banco({registros:[mes('2026-07',[nf(1,'2026-07-10',100000)]),mes('2026-08',[nf(2,'2026-08-10',200000),nf(1,'2026-07-10',100000)]),mes('2026-09',[nf(3,'2026-09-10',300000)])]});
 const t=await recorteArquivado(sb,'intel_nfe',{de:'2026-07-01',ate:'2026-09-30'},false,new Date('2026-10-11T12:00:00Z'));
 assert.deepEqual([t.recorte.partes,t.recorte.itens.map(x=>x.id)],[3,[1,2,3]],'nota repetida entre meses entra uma vez');
 const r=await consultarIndicadores(sb,{fonte:'fiscal',de:'2026-07-01',ate:'2026-09-30'});assert.deepEqual([r.disponivel,r.valor],[true,6000]);assert.match(r.avisos[0],/3 importações mensais do Painel juntas/);
 const f=await recorteArquivado(sb,'intel_nfe',{de:'2026-06-01',ate:'2026-09-30'},false,new Date('2026-10-11T12:00:00Z'));assert.deepEqual(f,{faltam:['2026-06']});
 const ano=await recorteArquivado(sb,'intel_nfe',{de:'2026-07-01',ate:'2026-12-31'},false,new Date('2026-09-20T12:00:00Z'));assert.deepEqual(ano.recorte.partes,3,'outubro a dezembro ainda não chegaram: não são exigidos');
 const g=await consultarIndicadores(sb,{fonte:'fiscal',de:'2026-06-01',ate:'2026-09-30'});assert.equal(g.disponivel,false);assert.ok(g.avisos.some(a=>/faltam no arquivo as importações de 2026-06/.test(a)));
 const meio=await recorteArquivado(sb,'intel_nfe',{de:'2026-07-15',ate:'2026-09-30'},false);assert.equal(meio,null,'intervalo que não é de meses inteiros não junta recortes');
});
test('consulta: falha ao ler o arquivo avisa sem derrubar nem inventar',async()=>{
 const sb=banco({falhas:{dre_registros:1}});const r=await consultarIndicadores(sb,{fonte:'compras',de:'2026-08-01',ate:'2026-08-31'});
 assert.equal(r.disponivel,false);assert.ok(r.avisos.includes('O arquivo das importações não pôde ser lido agora.'));assert.equal(r.valor,null);
});

test('revisão: recorte sem data não é regravado; importação antes do fim do mês e meses futuros são ditos; cada importação vira fonte',async()=>{
 const sb=banco({cache:{intel_nfe:{completo:true,desde:'2026-09-01',ate:'2026-09-30',itens:[nf(1,'2026-09-10',100)]}}});
 assert.deepEqual((await arquivarIntel(sb)).arquivos.map(x=>x.estado),['gravado']);assert.deepEqual((await arquivarIntel(sb)).arquivos.map(x=>x.estado),['igual'],'sem em: não regrava');
 const mes=(ym,em,itens)=>{const fim=new Date(Date.UTC(+ym.slice(0,4),+ym.slice(5),0)).toISOString().slice(0,10);return {colecao:'intel',id:`intel_nfe:${ym}-01:${fim}`,registro:{...recorte(`${ym}-01`,fim,itens,em),chave:'intel_nfe'}};};
 const s2=banco({registros:[mes('2026-07','2026-07-10T12:00:00Z',[nf(1,'2026-07-05',100000)]),mes('2026-08','2026-09-02T12:00:00Z',[nf(2,'2026-08-05',200000)])]});
 const r=await recorteArquivado(s2,'intel_nfe',{de:'2026-07-01',ate:'2026-09-30'},false,new Date('2026-08-20T12:00:00Z'));
 assert.deepEqual([r.recorte.partes,r.recorte.antesDoFim,r.recorte.futuros,r.recorte.em],[2,['2026-07-01 a 2026-07-31'],['2026-09'],'2026-07-10T12:00:00Z']);
 assert.deepEqual(r.recorte.fontes.map(f=>f.periodo),['2026-07-01 a 2026-07-31','2026-08-01 a 2026-08-31']);
}); 
