import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const path=new URL('../supabase/functions/dre-sync/coleta.ts',import.meta.url);
function harness(initial=null){
  let row=initial,version=0;
  const ctx={crypto:globalThis.crypto,Date,Intl};vm.createContext(ctx);
  if(fs.existsSync(path))vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/export /g,'')),ctx);
  const store={read:async()=>row?{valor:structuredClone(row),version}:null,save:async(next,base)=>{if(base!==(row?version:null))return false;row=structuredClone(next);version++;return true;}};
  return {row:()=>row,call:async(action,body={},who={editor:true},date='2026-09-12T13:00:00Z')=>{
    assert.equal(typeof ctx.coleta,'function','O servidor precisa aceitar solicitações de coleta');
    return ctx.coleta({action,...body},{configured:true,...who},store,new Date(date));
  }};
}
test('botão registra solicitação uma única vez; não finge coleta concluída',async()=>{
  const h=harness({enabled:true});const a=await h.call('solicitarColeta');
  assert.equal(a.body.status.estado,'aguardando');assert.equal(h.row().ultimaConclusao,undefined);
  const b=await h.call('solicitarColeta');assert.equal(b.body.status.pedidoId,a.body.status.pedidoId);
});
test('sem credencial ou sem rotina ativa não aceita promessa de atualização',async()=>{
  for(const who of [{editor:true,configured:false},{editor:true}]){
    const h=harness();const r=await h.call('solicitarColeta',{},who);assert.equal(r.code,503);assert.equal(h.row(),null);
  }
});
test('leitor vê status mas não pede coleta; usuário não se passa pelo coletor',async()=>{
  const h=harness({enabled:true});
  assert.equal((await h.call('coletaStatus',{},{})).code,200);
  assert.equal((await h.call('solicitarColeta',{},{})).code,403);
  assert.equal((await h.call('coletaIniciar',{runId:'123'}, {editor:true})).code,403);
});
test('rotina assume pedido e somente a execução dona pode concluí-lo',async()=>{
  const h=harness({enabled:true});await h.call('solicitarColeta');
  const r=await h.call('coletaIniciar',{runId:'123'},{collector:true});
  assert.equal(r.body.executar,true);assert.equal(h.row().estado,'executando');
  assert.equal((await h.call('coletaConcluir',{runId:'999',ok:true,meses:[]},{collector:true})).code,409);
  const fim=await h.call('coletaConcluir',{runId:'123',ok:true,meses:[{label:'Set/2026',estado:'gravado'}]},{collector:true});
  assert.equal(fim.body.status.estado,'concluido');assert.equal(fim.body.status.ultimaConclusao.meses[0].estado,'gravado');
});
test('agendamento atualiza três janelas diárias em São Paulo, sem repetir a mesma',async()=>{
  const h=harness();const who={collector:true};
  for(const [at,id] of [['2026-09-12T09:04:00Z','1'],['2026-09-12T15:03:00Z','2'],['2026-09-12T21:09:00Z','3']]){
    assert.equal((await h.call('coletaIniciar',{runId:id},who,at)).body.executar,true);
    await h.call('coletaConcluir',{runId:id,ok:true,meses:[]},who,at);
    assert.equal((await h.call('coletaIniciar',{runId:id+'1'},who,at)).body.executar,false);
  }
});
test('falha continua visível e nova solicitação permite tentar novamente',async()=>{
  const h=harness();await h.call('coletaIniciar',{runId:'42'},{collector:true});
  const r=await h.call('coletaConcluir',{runId:'42',ok:false,meses:[{label:'Ago/2026',estado:'gravado'}]},{collector:true});
  assert.equal(r.body.status.estado,'erro');assert.ok(r.body.status.ultimaConclusao == null);
  assert.equal(r.body.status.ultimaTentativa.meses.length,1);
  await h.call('solicitarColeta');assert.equal(h.row().estado,'aguardando');
});
test('execução interrompida expira; outra recupera sem aceitar conclusão atrasada',async()=>{
  const h=harness();await h.call('coletaIniciar',{runId:'1'},{collector:true});
  assert.equal((await h.call('coletaIniciar',{runId:'2'},{collector:true})).body.executar,false);
  assert.equal((await h.call('coletaIniciar',{runId:'2'},{collector:true},'2026-09-12T15:00:00Z')).body.executar,true);
  assert.equal((await h.call('coletaConcluir',{runId:'1',ok:true},{collector:true},'2026-09-12T15:00:00Z')).code,409);
});
test('status público contém somente acompanhamento, sem credencial ou dados comerciais',async()=>{
  const h=harness({enabled:true,segredo:'nao-mostrar',pedidoPor:'pessoa',ultimaConclusao:{em:'2026-09-12',meses:[{label:'Ago/2026',estado:'gravado',valor:999}]}});
  const r=await h.call('coletaStatus');const s=JSON.stringify(r.body);
  assert.ok(!s.includes('nao-mostrar'));assert.ok(!s.includes('pessoa'));assert.ok(!s.includes('999'));
});
test('resposta perdida ao iniciar permite retomar a mesma execução',async()=>{
  const h=harness();const args={runId:'12'},who={collector:true};
  assert.equal((await h.call('coletaIniciar',args,who)).body.executar,true);
  assert.equal((await h.call('coletaIniciar',args,who)).body.executar,true);
});
test('conclusão repetida após perda de resposta não muda o resultado salvo',async()=>{
  const h=harness();const who={collector:true};await h.call('coletaIniciar',{runId:'12'},who);
  const fim={runId:'12',ok:true,meses:[{label:'Set/2026',estado:'gravado'}]};
  await h.call('coletaConcluir',fim,who);
  assert.equal((await h.call('coletaConcluir',fim,who)).code,200);
});
