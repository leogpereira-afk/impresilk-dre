import fs from 'node:fs';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
function server({role='leitura',dbFail=false,response={status:200,data:[]}}={}) {
  let handler,writes=0;
  const env={DRE_TOKEN:'fixture-machine',DRE_COLLECTOR_TOKEN:'fixture-collector',EQUIPE_JWT_SECRET:'fixture-jwt',MUBI_PUBLIC_KEY:'fixture-public',MUBI_TOKEN:'fixture-access'};
  const sb={rpc:async()=>({data:false,error:null}),from(table){let invalid=false;const b={select(){return b;},eq(k,v){if(table==='dre_config_global'&&k==='id'&&v!==true)invalid=true;return b;},maybeSingle:async()=>({data:table==='dre_config_global'?{config:{permissoes:{user:role}}}:null,error:invalid?{message:'id booleano inválido'}:null}),upsert:async()=>{writes++;return {error:dbFail?{message:'erro de teste'}:null};}};return b;}};
  const context={Deno:{env:{get:k=>env[k]||''},serve:f=>handler=f},createClient:()=>sb,TextEncoder,TextDecoder,Request,Response,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,atob,console,fetch:async()=>new Response(JSON.stringify(response.data),{status:response.status})};
  vm.createContext(context);vm.runInContext(stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/dre-financas/index.ts',import.meta.url),'utf8').replace(/^import .*;$/mg,'')),context);
  const h=Buffer.from('{"alg":"HS256"}').toString('base64url'),p=Buffer.from(JSON.stringify({sub:'user',sis:'dre',papel:'equipe',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const jwt=h+'.'+p+'.'+createHmac('sha256',env.EQUIPE_JWT_SECRET).update(h+'.'+p).digest('base64url');
  return {writes:()=>writes,call:async(body,machine=false)=>{const r=await handler(new Request('https://test/dre-financas',{method:'POST',headers:{'content-type':'application/json',...(machine?{'x-token':machine==='collector'?env.DRE_COLLECTOR_TOKEN:env.DRE_TOKEN}:{authorization:'Bearer '+jwt})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
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
