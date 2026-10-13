/* ── CÓPIA DA BASE NO APARELHO · FASE 13 ───────────────────────────────────
   A base (80 meses, uns 5 MB) não cabia no localStorage, que tem uns 5 MB divididos com
   os outros sistemas do github.io: a cópia offline falhava e a página baixava tudo a
   cada abertura. Agora ela fica no IndexedDB, que guarda centenas de MB por site.
   - Um banco por crachá ("impresilk-dre:<pessoa>"); some no Sair.
   - Guarda a versão do SERVIDOR de cada mês (nunca a edição local, que vive na fila do
     localStorage e é aplicada por cima), a configuração e a hora da última leitura.
   - Cada gravação é uma transação só: se falhar, o banco fica como estava (cada mês com o
     seu carimbo), e o índice da próxima abertura busca o que faltou.
   - Sem IndexedDB (navegador antigo, teste), tudo segue só na memória e a barra diz
     "sem cópia neste aparelho". Falhar aqui nunca impede a tela. */
const CacheDRE=(()=>{
 let nome=null,dbp=null;
 const disponivel=()=>{try{return typeof indexedDB!=='undefined'&&!!indexedDB;}catch{return false;}};
 function escopo(pessoa){const n='impresilk-dre:'+String(pessoa||'equipe');if(n!==nome){fechar();nome=n;}}
 function fechar(){if(dbp)dbp.then(db=>{try{db?.close();}catch{}});dbp=null;}
 // Conexão que falhou ou foi fechada sai, para a próxima chamada abrir outra.
 function descartar(db){const p=dbp;if(p)p.then(d=>{if(d===db&&dbp===p){try{db?.close();}catch{}dbp=null;}});}
 function abrir(){
  if(!disponivel()||!nome)return Promise.resolve(null);
  if(dbp)return dbp;
  const p=dbp=new Promise(res=>{let req;const falhou=()=>{if(dbp===p)dbp=null;res(null);};try{req=indexedDB.open(nome,1);}catch{return falhou();}
   req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('meses'))db.createObjectStore('meses',{keyPath:'id'});if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');};
   req.onsuccess=()=>{const db=req.result;
    // Outra aba apagou o banco (Sair): esta para de gravar até o próximo login.
    db.onversionchange=e=>{try{db.close();}catch{}if(dbp===p)dbp=null;if(e&&e.newVersion===null)nome=null;};
    db.onclose=()=>{if(dbp===p)dbp=null;};res(db);};
   req.onerror=falhou;req.onblocked=falhou;});
  return p;
 }
 const transacao=(db,lojas,modo,fazer)=>new Promise((res,rej)=>{const t=db.transaction(lojas,modo),volta=fazer(t);
  t.oncomplete=()=>res(volta?.());t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error('Transação interrompida'));});
 // Lê tudo: {meses:[...], base:{cfg,cfgVersion,lidoEm}} ou null sem cópia.
 async function ler(){
  for(let tentativa=0;tentativa<2;tentativa++){
   const db=await abrir();if(!db)return null;
   try{return await transacao(db,['meses','meta'],'readonly',t=>{const a=t.objectStore('meses').getAll(),b=t.objectStore('meta').get('base');return ()=>({meses:a.result||[],base:b.result||null});});}
   catch{descartar(db);}
  }
  return null;
 }
 // Grava numa transação só: meses do servidor que chegaram, os que sumiram e a base.
 // true = gravado; false = a transação falhou (nada mudou no banco); null = sem banco.
 async function gravar({meses=[],apagar=[],base}={}){
  for(let tentativa=0;tentativa<2;tentativa++){
   const db=await abrir();if(!db)return tentativa?false:null;
   try{await transacao(db,['meses','meta'],'readwrite',t=>{const s=t.objectStore('meses');
    for(const m of meses)if(m&&m.id)s.put(m);for(const id of apagar)s.delete(id);if(base!==undefined)t.objectStore('meta').put(base,'base');});return true;}
   catch{descartar(db);}
  }
  return false;
 }
 // Apaga o banco desta pessoa (Sair) e desliga o escopo: leitura atrasada não recria a cópia.
 async function limpar(){
  const n=nome;nome=null;fechar();if(!disponivel()||!n)return;
  await new Promise(res=>{try{const r=indexedDB.deleteDatabase(n);r.onsuccess=r.onerror=r.onblocked=()=>res();}catch{res();}});
 }
 return {escopo,ler,gravar,limpar,disponivel};
})();
