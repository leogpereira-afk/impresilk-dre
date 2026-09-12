import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function module(){const ctx={};vm.createContext(ctx);const p=new URL('../coleta-ui.js',import.meta.url);if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),ctx);return vm.runInContext('typeof DREColeta!=="undefined"?DREColeta:null',ctx);}
test('painel diferencia inatividade, espera, execução, falha e conclusão',()=>{
  const m=module();assert.ok(m,'O botão precisa mostrar o estado real da coleta');
  assert.equal(m.visao(null).podeSolicitar,false);
  assert.equal(m.visao({ativa:false}).podeSolicitar,false);
  for(const estado of ['aguardando','executando'])assert.equal(m.visao({ativa:true,estado}).podeSolicitar,false);
  assert.equal(m.visao({ativa:true,estado:'erro'}).podeSolicitar,true);
  assert.match(m.visao({ativa:true,estado:'aguardando'}).descricao,/fechar/);
  assert.match(m.visao({ativa:true,estado:'interrompido'}).titulo,/interrompida/);
});
test('clicar pede a coleta; ler nuvem só acontece quando uma tentativa termina',async()=>{
  const m=module();assert.ok(m);let refresh=0,actions=[],status={ativa:true,estado:'concluido',ultimaTentativa:{em:'2026-09-01',runId:'1'}};
  const c=m.controlador({api:async action=>{actions.push(action);return {ok:true,status};},render:()=>{},onConcluido:async()=>refresh++});
  await c.consultar();assert.equal(refresh,0);
  status={ativa:true,estado:'aguardando'};await c.solicitar();assert.equal(actions.at(-1),'solicitarColeta');assert.equal(refresh,0);
  status={ativa:true,estado:'executando'};await c.consultar();assert.equal(refresh,0);
  status={ativa:true,estado:'concluido',ultimaTentativa:{em:'2026-09-12',runId:'2'}};await c.consultar();assert.equal(refresh,1);
  await c.consultar();assert.equal(refresh,1);
});
test('resposta recusada continua sendo falha, sem mensagem de atualização concluída',async()=>{
  const m=module();assert.ok(m);let shown;
  const c=m.controlador({api:async()=>({erro:'Rotina indisponível'}),render:v=>shown=v,onConcluido:async()=>assert.fail()});
  await c.solicitar();assert.match(shown.erro,/indisponível/);assert.notEqual(shown.status?.estado,'concluido');
});
test('resposta que chega depois de sair da sessão é descartada',async()=>{
  const m=module();assert.ok(m);let resolve,shown;
  const c=m.controlador({api:()=>new Promise(r=>resolve=r),render:v=>shown=v,onConcluido:async()=>assert.fail()});
  const p=c.consultar();c.reset();resolve({ok:true,status:{ativa:true,estado:'concluido'}});await p;
  assert.equal(shown.status,null);
});
