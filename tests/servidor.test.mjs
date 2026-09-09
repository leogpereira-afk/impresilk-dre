import {createHmac} from 'node:crypto';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {test} from 'node:test';import assert from 'node:assert/strict';
function server(initial=null,roles={}){let row=initial,handler,writes=0;const sb={rpc:async()=>({data:false,error:null}),from(table){let filters=[],mode='select',payload;const b={select(){return b;},eq(k,v){filters.push([k,v]);return b;},maybeSingle:async()=>({data:table==='dre_config_global'?{config:{permissoes:roles}}:row,error:null}),update(v){mode='update';payload=v;return b;},insert(v){mode='insert';payload=v;return b;},upsert(v){mode='upsert';payload=v;return b;},delete(){mode='delete';return b;},then(resolve){let result={data:null,error:null};if(mode==='delete')result.error={message:'falha de exclusão'};if(mode==='upsert'||mode==='insert'||mode==='update'){if(mode==='insert'&&row)result.error={code:'23505',message:'duplicate'};else if(mode==='update'&&!filters.every(([k,v])=>row?.[k]===v))result.data=[];else{row={...row,...payload};writes++;result.data=[row];}}resolve(result);}};return b;}};const env={DRE_TOKEN:'machine-test',DRE_COLLECTOR_TOKEN:'collector-test',EQUIPE_JWT_SECRET:'fixture-only-not-real'};const ctx={Deno:{env:{get:k=>env[k]||''},serve:f=>handler=f},createClient:()=>sb,Request,Response,crypto:globalThis.crypto,TextEncoder,TextDecoder,atob,btoa,console:{...console,error:()=>{}}};vm.createContext(ctx);const src=fs.readFileSync(new URL('../supabase/functions/dre-sync/index.ts',import.meta.url),'utf8').replace(/^import .*;$/mg,'');vm.runInContext(stripTypeScriptTypes(src),ctx);return {call:async (body,headers={'x-token':'machine-test'})=>{const res=await handler(new Request('https://test/dre-sync',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};},row:()=>row,writes:()=>writes};}
const stamp='2026-09-09T12:00:00.000Z';const reg=(value=100)=>({id:'Ago_2026',label:'Ago/2026',atualizadoEm:stamp,cells:[{code:'1',value},{code:'2',value:0}]});const existing=()=>({colecao:'os',id:'Ago_2026',registro:reg(),atualizado_em:stamp});
test('versão antiga não sobrescreve mês atualizado',async()=>{const s=server(existing());const r=await s.call({action:'upsert',registro:{...reg(200),atualizadoEm:'2030-01-01T00:00:00Z'},baseAtualizadoEm:'2026-01-01T00:00:00Z',operacaoId:'op1'});assert.equal(r.body.conflito,true);assert.equal(s.row().registro.cells[0].value,100);});
test('gravação confirmada conserva dados e id da operação',async()=>{const s=server(existing());const r=await s.call({action:'upsert',registro:reg(200),baseAtualizadoEm:stamp,operacaoId:'op1'});assert.equal(r.body.ok,true);assert.equal(s.row().registro.cells[0].value,200);assert.equal(s.row().registro._operacaoId,'op1');});
test('repetir resposta incerta da mesma operação não duplica gravação',async()=>{const s=server(existing());const req={action:'upsert',registro:reg(200),baseAtualizadoEm:stamp,operacaoId:'op1'};await s.call(req);const r=await s.call(req);assert.equal(r.body.ok,true);assert.equal(s.writes(),1);});
test('valores inválidos são recusados antes da escrita',async()=>{const s=server();const r=await s.call({action:'upsert',registro:{...reg(),cells:[{code:'1',value:'inválido'}]},baseAtualizadoEm:null});assert.equal(r.status,400);assert.equal(s.writes(),0);});
test('exclusão com falha nunca responde sucesso',async()=>{const s=server(existing());const r=await s.call({action:'delete',id:'Ago_2026'});assert.notEqual(r.body.ok,true);});

function jwt(sub){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub,sis:'dre',papel:'equipe',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');return h+'.'+p+'.'+createHmac('sha256','fixture-only-not-real').update(h+'.'+p).digest('base64url');}
test('sem sessão não há leitura de dados',async()=>{const s=server();const r=await s.call({action:'list'},{});assert.equal(r.status,401);});
test('perfil de leitura não importa nem muda regras',async()=>{const s=server(existing(),{usuario:'leitura'}),headers={authorization:'Bearer '+jwt('usuario')};for(const action of ['upsert','setCfg','delete']){const r=await s.call({action,registro:reg(),id:'Ago_2026'},headers);assert.equal(r.status,403);}assert.equal(s.writes(),0);});
const collector={'x-token':'collector-test'};
test('coletor exclusivo consulta regras sem receber permissões de pessoas',async()=>{
  const s=server(null,{pessoa:'admin'}),r=await s.call({action:'getCfg'},collector);
  assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.cfg.permissoes,undefined);
});
test('coletor exclusivo não apaga registros nem altera regras ou arquivos',async()=>{
  const s=server(existing());for(const action of ['delete','setCfg','putPhoto','getPhoto']){
    const r=await s.call({action,id:'Ago_2026'},collector);assert.equal(r.status,403);
  }assert.equal(s.writes(),0);
});
test('coletor exclusivo só grava meses ERP e preserva mês importado',async()=>{
  const s=server(),body={action:'upsert',registro:{...reg(),origem:'erp'},operacaoId:'coleta-1'};
  assert.equal((await s.call(body,collector)).body.ok,true);
  const saved=existing();saved.registro.origem='planilha';const protectedServer=server(saved);
  assert.equal((await protectedServer.call({...body,baseAtualizadoEm:stamp},collector)).status,403);
  assert.equal(protectedServer.writes(),0);
  assert.equal((await server().call({...body,registro:reg()},collector)).status,403);
});
