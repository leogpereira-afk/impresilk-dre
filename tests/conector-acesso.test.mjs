import fs from 'node:fs';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
function server({role='leitura',dbFail=false,permFail=false,response={status:200,data:[]},fetchERP}={}) {
  let handler,writes=0,erp=[];
  const env={DRE_TOKEN:'fixture-machine',DRE_COLLECTOR_TOKEN:'fixture-collector',EQUIPE_JWT_SECRET:'fixture-jwt',MUBI_PUBLIC_KEY:'fixture-public',MUBI_TOKEN:'fixture-access'};
  const sb={rpc:async()=>({data:false,error:null}),from(table){let invalid=false;const b={select(){return b;},eq(k,v){if(table==='dre_config_global'&&k==='id'&&v!==true)invalid=true;return b;},maybeSingle:async()=>({data:table==='dre_config_global'&&!permFail?{config:{permissoes:{user:role}}}:null,error:invalid||(permFail&&table==='dre_config_global')?{message:'id booleano inválido'}:null}),upsert:async()=>{writes++;return {error:dbFail?{message:'erro de teste'}:null};}};return b;}};
  const context={Deno:{env:{get:k=>env[k]||''},serve:f=>handler=f},createClient:()=>sb,TextEncoder,TextDecoder,Request,Response,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,atob,console,fetch:async(u,init)=>{erp.push(String(u));return fetchERP?fetchERP(u,init):new Response(JSON.stringify(response.data),{status:response.status});}};
  vm.createContext(context);vm.runInContext(stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/dre-financas/index.ts',import.meta.url),'utf8').replace(/^import .*;$/mg,'')),context);
  const h=Buffer.from('{"alg":"HS256"}').toString('base64url'),p=Buffer.from(JSON.stringify({sub:'user',sis:'dre',papel:'equipe',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const jwt=h+'.'+p+'.'+createHmac('sha256',env.EQUIPE_JWT_SECRET).update(h+'.'+p).digest('base64url');
  return {writes:()=>writes,erp:()=>erp,call:async(body,machine=false)=>{const r=await handler(new Request('https://test/dre-financas',{method:'POST',headers:{'content-type':'application/json',...(machine?{'x-token':machine==='collector'?env.DRE_COLLECTOR_TOKEN:env.DRE_TOKEN}:{authorization:'Bearer '+jwt})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}
test('leitor não altera credenciais da integração',async()=>{const s=server();const r=await s.call({action:'salvarConfig',publicKey:'nova'});assert.equal(r.status,403);assert.equal(s.writes(),0);});
test('administrador recebe falha quando a configuração não foi salva',async()=>{const s=server({role:'admin',dbFail:true});const r=await s.call({action:'salvarConfig',publicKey:'nova'});assert.equal(r.status,500);assert.notEqual(r.body.ok,true);});
test('ping 404 ambíguo não afirma credencial válida nem período vazio',async()=>{const s=server({response:{status:404,data:{message:'Not found'}}});const r=await s.call({action:'ping'},true);assert.equal(r.body.ok,false);assert.equal(r.body.vazio,false);});
test('ping 422 distingue resposta do servidor de consulta válida',async()=>{const s=server({response:{status:422,data:{message:'Invalid'}}});const r=await s.call({action:'ping'},true);assert.equal(r.body.ok,false);assert.equal(r.body.http,422);});
test('ping bem sucedido continua disponível',async()=>{const s=server();const r=await s.call({action:'ping'},true);assert.equal(r.body.ok,true);});

test('administrador configura a integração usando o registro global existente',async()=>{const s=server({role:'admin'});const r=await s.call({action:'salvarConfig',publicKey:'nova'});assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(s.writes(),1);});

test('consulta incompleta explica a origem da falha na interface existente',async()=>{
  const s=server({response:{status:503,data:{error:'detalhe-privado'}}});
  const r=await s.call({action:'importarMes',datainicial:'2026-08-01',datafinal:'2026-08-07'},true);
  assert.equal(r.body.parcial,true);
  assert.match(r.body.aviso,/contas-pagar.*2026-08-01.*HTTP 503/);
  assert.equal(r.body.diag.janelasIncompletas.length,2);
  assert.equal(JSON.stringify(r).includes('detalhe-privado'),false);
  assert.equal(s.writes(),0);
});
test('diagnóstico raw retorna somente estrutura e contagens sem dados comerciais',async()=>{
  const s=server({response:{status:200,data:[{id:1,cliente:'cliente-privado',valor:98765}]}});
  const r=await s.call({action:'raw',recurso:'contas-pagar'},true);
  assert.equal(r.body.total,1);
  assert.equal(r.body.tipos.cliente,'string');
  assert.equal(JSON.stringify(r).includes('cliente-privado'),false);
  assert.equal(JSON.stringify(r).includes('98765'),false);
});
test('consulta de OS para rateio conserva os pesos sem devolver dados do cliente',async()=>{
  const s=server({response:{status:200,data:{id:3,status:'Entregue',cliente:'cliente-privado',itens:[{item:'Placa',modelo:'A',valor_final:120,sub_total:100,observacao:'observacao-privada',itens_agrupados:[]}]}}});
  const r=await s.call({action:'listar',recurso:'ordem-servico/numero/12345'},true);
  assert.equal(r.body.itens[0].itens[0].valor_final,120);
  assert.equal(r.body.itens[0].status,'Entregue');
  assert.equal(JSON.stringify(r).includes('cliente-privado'),false);
  assert.equal(JSON.stringify(r).includes('observacao-privada'),false);
});
test('coletor exclusivo lê o financeiro, mas não muda credenciais nem acessa outros recursos',async()=>{
  const s=server();assert.equal((await s.call({action:'listar',recurso:'contas-pagar'},'collector')).body.ok,true);
  assert.equal((await s.call({action:'salvarConfig',publicKey:'nova'},'collector')).status,403);
  assert.equal((await s.call({action:'listar',recurso:'funcionarios'},'collector')).status,403);
  assert.equal(s.writes(),0);
});

// Porta do ERP (25/09/2026): a lista de recursos vale para todo mundo, e as
// consultas de diagnóstico ficam com a máquina e a administração. A tela do
// DRE só usa importarMes.
test('crachá comum não usa o conector para ler outro recurso do ERP',async()=>{
  for(const role of ['leitura','edicao','admin']){
    const s=server({role});
    for(const recurso of ['funcionarios','clientes','contas-pagar/../funcionarios','ordem-servico/numero/1/../../clientes']){
      const r=await s.call({action:'listar',recurso});
      assert.equal(r.status,403,role+' '+recurso);
    }
    assert.equal(s.erp().length,0,'nenhuma consulta chegou ao ERP');
  }
});
test('máquina também fica presa à lista de recursos',async()=>{
  const s=server();
  assert.equal((await s.call({action:'listar',recurso:'funcionarios'},true)).status,403);
  assert.equal((await s.call({action:'preview',recurso:'clientes'},true)).status,403);
  assert.equal(s.erp().length,0);
  assert.equal((await s.call({action:'listar',recurso:'contas-pagar'},true)).body.ok,true);
});
test('consultas de diagnóstico ficam com a administração',async()=>{
  for(const action of ['listar','preview','raw','ping','statusConfig']){
    const s=server({role:'edicao'});
    const r=await s.call({action,recurso:'contas-pagar'});
    assert.equal(r.status,403,action);
    assert.equal(JSON.stringify(r.body).includes('fixture-access'.slice(-4)),false,action+' não mostra o fim do token');
    assert.equal(s.erp().length,0,action);
  }
  const adm=server({role:'admin'});
  assert.equal((await adm.call({action:'listar',recurso:'contas-pagar'})).body.ok,true);
  assert.equal((await adm.call({action:'statusConfig'})).body.ok,true);
});
test('sem conseguir conferir o papel, a consulta de diagnóstico fica fechada',async()=>{
  const s=server({role:'admin',permFail:true});
  const r=await s.call({action:'listar',recurso:'contas-pagar'});
  assert.equal(r.status,503);
  assert.equal(s.erp().length,0);
});
test('a conferência da tela (importarMes) continua aberta para quem entra no DRE',async()=>{
  const s=server({role:'leitura'});
  const r=await s.call({action:'importarMes',datainicial:'2026-08-01',datafinal:'2026-08-07'});
  assert.equal(r.status,200);
  assert.equal(r.body.ok,true);
  assert.ok(s.erp().every(u=>/\/contas-(pagar|receber)\?/.test(u)),'só contas a pagar e a receber');
});
test('todos os fluxos expõem diagnóstico fixo de rede, sem URL ou mensagem privada',async()=>{
  const privado='https://api.mubisys.com/api/fixture-public segredo-fixture-access';
  for(const [action,recurso] of [['listar','contas-pagar'],['preview','contas-pagar'],['ping','contas-pagar'],['raw','contas-pagar'],['listar','ordem-servico/numero/1'],['importarMes','contas-pagar']]){
    const s=server({fetchERP:async()=>{throw new TypeError(privado);}});
    const r=await s.call({action,recurso,datainicial:'2026-08-01',datafinal:'2026-08-07'},true);
    if(action==='importarMes'){
      assert.equal(r.body.parcial,true);assert.equal(r.body.diag.janelasIncompletas.length,2);
      assert.ok(r.body.diag.janelasIncompletas.every(x=>x.motivo==='rede-indisponivel'));
      assert.match(r.body.aviso,/rede indisponível/);
    }else assert.equal(r.body.diagnostico?.motivo,'rede-indisponivel',action);
    assert.equal(JSON.stringify(r).includes(privado),false,action);
    assert.equal(s.writes(),0);
  }
});
test('importarMes inclui o último dia na virada de mês/ano sem somar o dia seguinte',async()=>{
  for(const [fim,exclusivo] of [['2026-08-31','2026-09-01'],['2026-12-31','2027-01-01'],['2024-02-29','2024-03-01']]){
    const s=server({fetchERP:async url=>{
      const u=new URL(url),a=u.searchParams.get('datainicial'),b=u.searchParams.get('datafinal');
      const pagar=u.pathname.includes('contas-pagar');
      const titulos=a<=fim&&fim<b?[{id:pagar?1:2,compoe_dre:'Sim',plano_contas:pagar?'2.1 - Custo sintético':'1.1 - Entrada sintética',pagamentos:[{data_pagamento:fim,valor:pagar?40:100},{data_pagamento:exclusivo,valor:900}]}]:[];
      return new Response(JSON.stringify(titulos),{status:200});
    }});
    const r=await s.call({action:'importarMes',datainicial:fim,datafinal:fim},true);
    assert.equal(r.body.parcial,false);assert.equal(r.body.totais.receita,100);assert.equal(r.body.totais.despesa,40);
    assert.ok(s.erp().every(url=>new URL(url).searchParams.get('datafinal')===exclusivo));
  }
});
test('importarMes converte cada fim inclusivo, mas listar/raw preservam o fim recebido',async()=>{
  const s=server();await s.call({action:'importarMes',datainicial:'2026-12-26',datafinal:'2027-01-05'},true);
  assert.deepEqual(s.erp().map(url=>{const u=new URL(url);return [u.searchParams.get('datainicial'),u.searchParams.get('datafinal')];}).sort(),[['2026-12-26','2027-01-02'],['2026-12-26','2027-01-02'],['2027-01-02','2027-01-06'],['2027-01-02','2027-01-06']]);
  for(const action of ['listar','raw']){
    const t=server();await t.call({action,recurso:'contas-pagar',datainicial:'2026-12-26',datafinal:'2027-01-06'},true);
    assert.equal(new URL(t.erp()[0]).searchParams.get('datafinal'),'2027-01-06',action);
  }
});
