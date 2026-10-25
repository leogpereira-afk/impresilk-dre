/* ====================================================================
   Impresilk · DRE Caixa — dashboard
   Fonte de dados: sessão autenticada, cópia local isolada e importação revisada.
   ==================================================================== */

let STORE_KEY = 'impresilk_dre_data';
const THEME_KEY = 'impresilk_dre_theme';
const VIEW_KEY = 'impresilk_dre_view';

const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();
let activeRenderAll = null; // permite recolorir após troca de tema
// Voltar do navegador: o popstate (gestao.js) liga estes avisos para o diálogo fechar sem
// voltar de novo e para a troca de tela não rolar ao topo.
let fechandoPorVoltar=false,voltandoHistorico=false;
// Cartões que lembram se a pessoa abriu ou fechou, por tela e título (sem mês, ano, faixa de meses
// entre parênteses e marca do mês parcial, para a chave não mudar ao trocar o mês ou o ano). O ouvinte de toggle grava só a escolha
// da pessoa: o toggle que o navegador dispara ao desenhar um cartão aberto não vira escolha.
const cardAbertos={},cardPadrao={};
function cardChave(titulo){const v=typeof state!=='undefined'?state.view:'';return v+':'+String(titulo??'').replace(/\s*\((?:ano inteiro|(?:Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)\b[^)]*)\)/g,'').replace(/\b[A-Z][a-zç]{2}\/\d{4}\b|\b\d{2}\/\d{2}(\/\d{4})?\b|\b\d{4}\b/g,'').split('·').map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x&&!/^(coletado|planilha com dados)/.test(x)).join(' · ');}
function cardAttrs(titulo,abertoPadrao=true){const k=cardChave(titulo),o=k in cardAbertos?cardAbertos[k]:abertoPadrao;cardPadrao[k]=!!abertoPadrao;return `data-card="${String(k).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}"${o?' open':''}`;}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('toggle',e=>{const k=e.target?.dataset?.card;if(k&&(k in cardAbertos||!!e.target.open!==cardPadrao[k]))cardAbertos[k]=!!e.target.open;},true);

/* ---------- parsing de números pt-BR (espelha o extract.py) ---------- */
function parseNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Valor inválido'); return v; }
  // o "−" (U+2212) que a tela mostra vale como sinal de menos, também antes do R$
  let s = String(v).trim().replace(/−/g, '-').replace(/^(-?)R\$\s*/, '$1').replace(/\s/g, '');
  if (!s) return 0;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('Valor monetário inválido: confira a planilha.');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Valor fora do limite.');
  return n;
}

const round2 = n => Math.round(n * 100) / 100;

/* ---------- conexão MubySys: export "Plano de Contas" (1 mês) ---------- */
const PT_MON = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function nextMonthLabel(last) {
  const m = String(last || '').match(/([A-Za-zçÇ]{3})\D*(\d{4})/);
  if (!m) { const d = new Date(); return PT_MON[d.getMonth()] + '/' + d.getFullYear(); }
  const idx = PT_MON.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return '';
  let yr = +m[2], ni = idx + 1;
  if (ni > 11) { ni = 0; yr++; }
  return PT_MON[ni] + '/' + yr;
}

/* lê o export "Plano de Contas" (bullet + código + " - nome", coluna "Valor") */
function parsePlanoContas(rows) {
  if (!rows || !rows.length) throw new Error('Planilha vazia.');
  const header = rows[0].map(c => (c == null ? '' : String(c).trim()));
  let valCol = header.findIndex(h => /^valor$/i.test(h));
  if (valCol < 0) valCol = header.findIndex(h => /valor/i.test(h));
  if (valCol < 0) throw new Error('Coluna "Valor" não encontrada: não parece o export Plano de Contas.');

  const codeRe = /^[•\s]*([\d][\d\s.]*?)\s*-\s*(.+)$/; // ignora o "•" e espaços nos códigos
  const accounts = [];
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r][0];
    if (raw == null) continue;
    const m = String(raw).trim().match(codeRe);
    if (!m) continue; // pula rodapé "Receitas/Despesas/Resultado"
    const segs = m[1].split('.').map(s => s.trim()).filter(Boolean);
    if (!segs.length) continue;
    const code = segs.join('.');
    accounts.push({
      code, name: m[2].trim(), level: segs.length,
      parent: segs.length > 1 ? segs.slice(0, -1).join('.') : null,
      value: round2(parseNum(rows[r][valCol]))
    });
  }
  if (!accounts.find(a => a.code === '1') || !accounts.find(a => a.code === '2'))
    throw new Error('Não encontrei as contas 1-Receitas e 2-Despesas no export.');
  return accounts;
}

/* A BIBLIOTECA DE PLANILHA CHEGA SO NA HORA DE IMPORTAR UMA PLANILHA.
 *
 * O xlsx tem 307 kB e estava no <script> do index.html: era 76% de tudo o que
 * a primeira tela pedia (307 de 401 kB), em toda visita, para todo mundo -
 * inclusive para quem so abre o DRE para olhar os numeros do mes, que e o uso
 * normal. Ler planilha acontece uma vez por mes, ao importar o export do ERP.
 *
 * Uma promessa so, zerada em caso de falha para a proxima tentativa poder
 * tentar de novo.
 */
let _xlsxPronto = null;
function garantirXLSX() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (_xlsxPronto) return _xlsxPronto;
  _xlsxPronto = new Promise((ok, falhou) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    // Integridade: o navegador só executa o arquivo se ele for byte a byte o
    // que foi conferido. Um CDN comprometido (ou um arquivo trocado no meio do
    // caminho) vira erro de carregamento, não código rodando com o crachá.
    s.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
    s.crossOrigin = 'anonymous';
    const timer=setTimeout(()=>{s.remove();_xlsxPronto=null;falhou(new Error('O leitor de planilhas demorou para carregar. Verifique a conexão e tente novamente.'));},25000);
    s.onload = () => {clearTimeout(timer);ok();};
    s.onerror = () => {
      clearTimeout(timer);
      _xlsxPronto = null;
      falhou(new Error('Nao consegui carregar o leitor de planilha. Verifique a conexao e tente de novo.'));
    };
    document.head.appendChild(s);
  });
  return _xlsxPronto;
}

function parsePlanoContasWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  return parsePlanoContas(rows);
}

/* funde um mês (parsePlanoContas) na série histórica — adiciona ou substitui */
function upsertMonth(D, monthLabel, parsed) {
  const months = D.months.slice();
  let mi = months.indexOf(monthLabel);
  if (mi < 0) { months.push(monthLabel); mi = months.length - 1; }
  const N = months.length;
  const valByCode = new Map(parsed.map(p => [p.code, p.value]));
  const byCode = new Map();
  const accounts = D.accounts.map(a => {
    const values = a.values.slice();
    while (values.length < N) values.push(0);
    values[mi] = valByCode.has(a.code) ? valByCode.get(a.code) : 0;
    const names=(a.names||D.months.map(()=>a.name)).slice(); while(names.length<N)names.push(null); names[mi]=parsed.find(p=>p.code===a.code)?.name||names[mi];
    const na = { ...a, values, names };
    byCode.set(a.code, na);
    return na;
  });
  parsed.forEach(p => {
    if (byCode.has(p.code)) return; // conta nova (não existia na série)
    const values = new Array(N).fill(0);
    values[mi] = p.value;
    const na = { code: p.code, name: p.name, level: p.level, parent: p.parent, values };
    accounts.push(na); byCode.set(p.code, na);
  });
  // origens acompanha months, posição a posição. Sem esta linha qualquer
  // upload apagava a marcação "erp" de Jul/2026 e desligava TODAS as guardas
  // de comparação planilha×ERP (achado da auditoria de 01/08).
  const origens = (D.origens || D.months.map(() => 'planilha')).slice();
  while (origens.length < N) origens.push('planilha');
  origens[mi] = 'planilha';   // upload de .xlsx é, por definição, planilha
  // idem para as pendências: um upload não pode apagar o que o robô achou nos
  // OUTROS meses. No mês subido elas zeram — o .xlsx não traz título nenhum.
  const pends = (D.pendencias || D.months.map(() => [])).slice();
  while (pends.length < N) pends.push([]);
  // Pendências não são apagadas por uma planilha que não contém os títulos.
  return { company: D.company, basis: D.basis, months, accounts, origens, pendencias: pends, registros:months.map((label,i)=>({...((D.registros||[])[i]||{}),...(i===mi?{qualidade:{estado:'cobertura-nao-validada'},origem:'planilha',importadoEm:new Date().toISOString()}:{}),label})), _replaced: D.months.includes(monthLabel) };
}

/* acha um mês já existente que representa o MESMO período, mesmo com outra
   grafia ("jun/2026", "Junho/2026", "06/2026" → "Jun/2026"). Evita duplicar. */
function findExistingMonth(D, label) {
  if (!D || !D.months || !label) return null;
  const exact = D.months.find(m => m === label);
  if (exact) return exact;
  const key = monthSortKey(label);
  if (key >= 0) return D.months.find(m => monthSortKey(m) === key) || null;
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
  return D.months.find(m => norm(m) === norm(label)) || null;
}

let sessionDataset=null;
function getCurrentData() {
  if(sessionDataset)return sessionDataset;
  try { const s = localStorage.getItem(STORE_KEY); if (s) return JSON.parse(s); } catch (_) {}
  return {company:"Impresilk + Universo",basis:"Caixa gerencial",months:[],accounts:[],registros:[]};
}

// Fase 13: a base vive na memória da sessão; a cópia do aparelho fica no IndexedDB
// (cache-local.js, CacheDRE), com a versão do SERVIDOR de cada mês, gravada pela leitura
// da nuvem e pelas confirmações. O localStorage não guarda mais a base (uns 5 MB divididos
// com os outros sistemas do github.io: não cabia e a página baixava tudo de novo).
// A fila de edições continua no localStorage: é pequena e não pode se perder.
const copiaDescartavel=k=>k===STORE_KEY||k==='impresilk_dre_data'||/^dre_v2_data:/.test(k);
function liberarCopiasLocais(){
  const ks=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(copiaDescartavel(String(k)))ks.push(k);}}catch(_){}
  for(const k of new Set([STORE_KEY,'impresilk_dre_data',...ks]))try{localStorage.removeItem(k);}catch(_){}
}
function salvarLocal(dataset) { sessionDataset=dataset; return true; }
// Versão do servidor de cada mês guardada no aparelho (id → registro): base do índice.
let servidorLocal=new Map(),cacheFalhou=false;
const cacheDisponivel=()=>!cacheFalhou&&typeof CacheDRE!=='undefined'&&CacheDRE.disponivel();
// Grava no aparelho o que veio do servidor; sem IndexedDB, segue na memória. Se uma gravação
// falha (o banco fica como estava), a sessão para de gravar: assim a hora da cópia não avança
// sem os meses, e a próxima abertura busca pelo índice o que faltou.
async function guardarNoAparelho(meses,apagar=[],base){
  for(const m of meses)if(m?.id)servidorLocal.set(m.id,m);for(const id of apagar)servidorLocal.delete(id);
  // A cópia antiga do localStorage não é mais atualizada: sai a cada leitura completa (libera espaço dos outros sistemas).
  if(base!==undefined)liberarCopiasLocais();
  if(!cacheDisponivel())return false;
  const ok=await CacheDRE.gravar({meses,apagar,base});
  if(ok===false)cacheFalhou=true;
  return ok===true;
}
// Configuração gravada na nuvem: a cópia do aparelho acompanha (sem mexer nos meses).
function cfgConfirmada(){if(cacheDisponivel())CacheDRE.gravar({base:{versao:1,cfg:state.cfg,cfgVersion:state.cfgVersion,lidoEm:state.updated||null,permissoes:state.permissoes}}).then(ok=>{if(ok===false)cacheFalhou=true;}).catch(()=>{});}

/* Sincronização por mês: fila isolada por usuário e versão da base lida.
   A resposta confirma somente seu ID de operação. Edições concorrentes,
   falhas e conflitos permanecem disponíveis para revisão explícita. */
let MONTH_TS_KEY = 'impresilk_dre_month_ts'; // { label: atualizadoEm } por mês
let QUEUE_KEY = 'impresilk_dre_queue';       // fila persistente de upserts pendentes
const PT_MES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
// Pendências não são descartadas por falhas: exigem resolução explícita.

// id de blob estável e seguro a partir do rótulo do mês ("Jun/2026" -> "Jun_2026")
function safeId(label) { return String(label).trim().replace(/[^\w]+/g, '_'); }
// chave de ordenação cronológica a partir do rótulo pt-BR ("Jun/2026" ou "06/2026")
function monthSortKey(label) {
  const s = String(label).toLowerCase();
  const m = s.match(/([a-z]{3})\w*\s*[\/\-]?\s*(\d{4})/);
  if (m) { const mi = PT_MES[m[1]]; return (+m[2]) * 12 + (mi == null ? 0 : mi); }
  const n = s.match(/(\d{1,2})\s*[\/\-]\s*(\d{4})/);   // formato numérico "06/2026"
  if (n) return (+n[2]) * 12 + Math.min(11, Math.max(0, +n[1] - 1));
  return -1;
}

function getMonthTS() { try { return JSON.parse(localStorage.getItem(MONTH_TS_KEY)) || {}; } catch (_) { return {}; } }
function setMonthTS(map) { try { localStorage.setItem(MONTH_TS_KEY, JSON.stringify(map)); } catch (_) {} }
function getQueue() { const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]'); if(!Array.isArray(q))throw new Error('A fila local precisa de recuperação. Baixe uma cópia antes de continuar.'); return q; }
function setQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

// dataset (centrado em contas) -> 1 registro por mês (centrado em células)
function monthRecord(D, i, ts) {
  const label = D.months[i];
  return {
    ...((D.registros || [])[i] || {}),
    baseAtualizadoEm: ((D.registros || [])[i] || {}).atualizadoEm || null,
    id: safeId(label), label, atualizadoEm: ts,
    company: D.registros?.[i]?.company ?? D.company, basis: D.registros?.[i]?.basis ?? D.basis,
    // origem viaja no registro — o robô grava "erp" e o painel PRECISA
    // devolver o mesmo valor ao sincronizar, senão o primeiro sync rebaixa
    // Jul/2026 para "planilha" e as guardas de comparação morrem em silêncio.
    origem: (D.origens || [])[i] || 'planilha',
    // pendências do mês (o que está em conta suspeita DENTRO do Mubisys) viajam
    // junto pelo mesmo motivo: sem devolvê-las, o primeiro sync do painel
    // apagava do servidor a lista que o robô tinha acabado de escrever.
    pendencias: (D.pendencias || [])[i] || [],
    cells: D.accounts.filter(a=>a.values[i]!=null).map(a => ({ code: a.code, name: a.names?.[i] || a.name, level: a.level, parent: a.parent, value: a.values[i] || 0 })),
  };
}
// registros por mês -> dataset (reconstrói as contas, em ordem cronológica)
function monthsToDataset(records) {
  const recs = records.slice().sort((a, b) => monthSortKey(a.label) - monthSortKey(b.label));
  const months = recs.map(r => r.label);
  const meta = new Map(); const order = []; // união de códigos preservando a ordem hierárquica
  recs.forEach(r => (r.cells || []).forEach(c => {
    if (!meta.has(c.code)) order.push(c.code);      // ordem hierárquica: 1ª vez
    // Metadados gerais usam o último registro; names preserva o rótulo de
    // cada mês, usado no detalhe e na verificação de comparabilidade.
    meta.set(c.code, { name: c.name, level: c.level, parent: c.parent });
  }));
  const accounts = order.map(code => {
    const m = meta.get(code);
    const values = recs.map(r => { const c = (r.cells || []).find(x => x.code === code); return c && c.value!=null ? c.value : null; });
    return { code, name: m.name, names: recs.map(r => (r.cells || []).find(c => c.code === code)?.name || null), level: m.level, parent: m.parent, values };
  });
  const last = recs[recs.length - 1] || {};
  // origem de cada mês: "planilha" (veio do .xlsx) ou "erp" (o robô montou).
  // Os dois têm o MESMO plano de despesa, mas a receita é quebrada de formas
  // diferentes — a planilha usa as subcontas (Acrílicos, Lonas…) e o ERP usa o
  // produto vendido. Comparar folha com folha entre os dois faria a receita
  // inteira "sumir" de um mês e "nascer" no outro.
  return { company: last.company, basis: last.basis, months, accounts, registros: recs,
           origens: recs.map(r => r.origem || 'planilha'),
           pendencias: recs.map(r => r.pendencias || []) };
}

// indicador visual no botão de sync: ☁️ ok · ⏳ trabalhando · 📴 offline/erro · ⚠️ pendências
function setSyncState(state, title) {
  const el = document.getElementById('syncState');
  if (el) {el.textContent=title || state;el.dataset.state=state;}
}

// fila inteligente: upsert do mesmo mês SUBSTITUI o anterior (só a versão mais nova importa)
function enqueueUpsert(record) {
  const q = getQueue().filter(it => !(it.action === 'upsert' && it.registro && it.registro.id === record.id));
  q.push({ opId: crypto.randomUUID(), action: 'upsert', registro: record, fails: 0 });
  setQueue(q);
}

// adota a versão do servidor de um mês (resolução de conflito) e re-renderiza
function adoptServerMonth(record) {
  const D = getCurrentData();
  const recs = datasetRecords(D);
  const map = new Map(recs.map(r => [r.id, r]));
  map.set(record.id, normalizeRecord(record));
  const merged = monthsToDataset([...map.values()]);
  salvarLocal(merged);if(record?.id)guardarNoAparelho([record]).catch(()=>{});
  const ts = getMonthTS(); ts[record.label || record.id] = record.atualizadoEm; setMonthTS(ts);
  boot(merged);
}
// garante o shape esperado (label/cells) num registro vindo do servidor
function normalizeRecord(r) {
  return { ...r, id: r.id, label: r.label || r.id, atualizadoEm: r.atualizadoEm, company: r.company, basis: r.basis, origem: r.origem || 'planilha', pendencias: r.pendencias || [], cells: r.cells || [] };
}
// quebra o dataset local atual em registros por mês (usando os timestamps locais)
function datasetRecords(D) {
  const ts = getMonthTS();
  return (D.months || []).map((label, i) => monthRecord(D, i, ts[label] || '1970-01-01T00:00:00.000Z'));
}

// registros que representam o MESMO período com grafias diferentes ("Jun/2026" x
// "jun/2026"): mantém o mais novo por atualizadoEm e devolve os descartados
function dedupePeriods(records) {
  const byPeriod = new Map(); const dropped = [];
  records.forEach(r => {
    const k = monthSortKey(r.label);
    const pk = k >= 0 ? 'p' + k : 'l' + String(r.label).toLowerCase();
    const cur = byPeriod.get(pk);
    if (!cur) { byPeriod.set(pk, r); return; }
    const keep = new Date(r.atualizadoEm) >= new Date(cur.atualizadoEm) ? r : cur;
    dropped.push(keep === r ? cur : r);
    byPeriod.set(pk, keep);
  });
  return { kept: [...byPeriod.values()], dropped };
}

let _syncing = false;
// drena a fila pendente (item E/L do guia): chama upsert por mês; trata conflito,
// Preserva qualquer falha ou conflito para revisão explícita.
async function trySync() {
  if (typeof api !== 'function' || _syncing) return;
  const q0 = getQueue();
  if (!q0.length) { setSyncState('ok', 'Sem edições pendentes'); return; }
  if (!navigator.onLine) { setSyncState('off', 'Edições guardadas neste aparelho'); return; }
  _syncing = true;
  try {
    // IDs antigos recebem uma identidade antes do primeiro envio.
    setQueue(getQueue().map(it => ({...it, opId:it.opId || crypto.randomUUID()})));
    while (getQueue().length) {
      const item = getQueue()[0];
      if (item.conflito) { setSyncState('pending', 'Conflito preservado para revisão'); return; }
      let r;
      try { r = await api(item.action, {registro:item.registro, baseAtualizadoEm:item.registro.baseAtualizadoEm ?? null, operacaoId:item.opId}); }
      catch (_) { setSyncState('off', 'Envio interrompido; edição preservada'); return; }
      const atual = getQueue();
      const idx = atual.findIndex(it => it.opId === item.opId);
      if (r?.ok) {
        if (idx >= 0) atual.splice(idx,1);
        const stamp = r.registro?.atualizadoEm;
        // Uma edição feita durante o envio parte da versão que acaba de ser confirmada.
        if (stamp) {
          if (r.registro?.id) guardarNoAparelho([r.registro]).catch(()=>{});
          atual.forEach(it => {if(it.registro?.id === item.registro.id) it.registro.baseAtualizadoEm = stamp;});
          const ts = getMonthTS(); ts[item.registro.label] = stamp; setMonthTS(ts);
          const D=getCurrentData();
          if(D.registros){D.registros=D.registros.map(reg=>reg.id===item.registro.id?{...reg,atualizadoEm:stamp,baseAtualizadoEm:stamp}:reg);if(state.D===D)state.records=D.registros.filter(reg=>!reg.apagado);if(!salvarLocal(D))throw new Error('A confirmação chegou, mas a cópia local não foi gravada. A fila foi preservada.');}
        }
        setQueue(atual);
        continue;
      }
      if (idx >= 0) {
        atual[idx] = {...atual[idx], fails:(item.fails || 0)+1,
          ...(r?.conflito ? {conflito:{servidor:r.servidor || null}} : {erro:r?.erro || 'Falha ao salvar'})};
        setQueue(atual);
      }
      setSyncState('pending', r?.conflito ? 'Conflito preservado para revisão' : 'Edição não salva; mantida no aparelho');
      return;
    }
    setSyncState('ok', 'Edições confirmadas na nuvem');
  } finally { _syncing = false; }
}


/* Interface financeira: as cinco leituras compartilham período e fonte. */
const F = typeof DREFinancas !== 'undefined' ? DREFinancas : null;
let state={D:null,records:[],cfg:{},permissoes:{leitura:true,edicao:false,admin:false},view:'inicio',periodo:'',comparar:'',anoComparar:'',consulta:'',grupo:'todos',tipo:'todos',ano:false,detCache:{},updated:null};
const $$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Sinal de menos tipográfico (U+2212) e sem "-0": o PDF troca de volta para hífen (pdfTexto).
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'Não apurado':(Number(n)+0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace('-','−');
const dataBR=s=>s?new Date(s).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Não registrada';
const mesHoje=()=>PT_MON[new Date().getMonth()]+'/'+new Date().getFullYear();
function toast(t,kind=''){const el=$$('toast');if(!el)return;el.textContent=t;el.className='show '+kind;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='',6000);}
// Diálogo com entrada no histórico: Voltar fecha o diálogo e fica na tela. Ao fechar pelo ✕
// ou por código, a entrada sai com um back adiado; a troca de tela logo depois (gravarRota
// no render) troca a entrada do diálogo e cancela esse back, para o "Ver em" de dentro do
// diálogo não pedir dois Voltar.
let dialogoLigado=null;
function dialog(title,html){$$('detailTitle').textContent=title;$$('detailContent').innerHTML=html;const d=$$('detailDialog');if(d.open){const t=$$('detailTitle');t.tabIndex=-1;t.focus?.();return;}d.showModal();
 const hist=typeof history!=='undefined'&&typeof history.pushState==='function'?history:null;if(!hist)return;
 if(!hist.state?.dialogo)try{hist.pushState({...(hist.state||{}),dialogo:1},'',location.href);}catch(_){}
 if(dialogoLigado!==d&&typeof d.addEventListener==='function'){dialogoLigado=d;d.addEventListener('close',()=>{if(fechandoPorVoltar||!hist.state?.dialogo)return;queueMicrotask(()=>{if(hist.state?.dialogo&&!d.open)hist.back();});});}
}
const fato=(label,value)=>`<div class="fato"><span class="label">${esc(label)}</span><b>${esc(value)}</b></div>`;
const linha=(label,value,total=false,code='',tom=tomDoValor(code,value))=>`<div class="line ${total?'total':''}"><span>${code?botaoConta(code,label):esc(label)}</span><b class="${tom}">${value==null?'Não apurado':typeof value==='number'?money(value):esc(value)}</b></div>`;
const card=(title,html,open=true,id='')=>`<details class="card"${id?` id="${id}"`:''} ${cardAttrs(title,open)}><summary><h2 class="card-titulo">${esc(title)}</h2></summary><div class="card-body">${html}</div></details>`;
const metric=(label,value,desc,code='',tom='')=>`<${code?'button':'div'} class="metric${tom?' metric-'+tom.slice(4):''}" ${code?`data-account="${esc(code)}"`:''}><span class="label">${esc(label)}</span><strong${tom?` class="${tom}"`:''}>${value==null?'Não apurado':typeof value==='number'?money(value):esc(value)}</strong><small>${esc(desc)}</small></${code?'button':'div'}>`;
function escreverRodape(){const el=$$('footMeta');if(!el||!state.D)return;el.textContent=state.view==='dre'&&dreUI.base==='competencia'?`Competência informada por mês · nuvem lida em ${dataBR(state.updated)}. Preenchimento não equivale a fechamento contábil.`:`${state.records.length} registros mensais · ${state.D.accounts.length} contas · ${telaNoAno()?rotuloAno():state.periodo} · ${state.rotuloQualidade||''} · Nuvem lida em ${dataBR(state.updated)}. Valores não conciliados não representam fechamento.`;}
function regAtual(){return state.records.find(r=>r.label===state.periodo)||null;}
function boot(D){state.D=D;state.records=(D?.registros||datasetRecords(D||getCurrentData())).filter(r=>!r.apagado);if(!state.periodo)state.periodo=mesHoje();if(!state.comparar&&!(typeof rotaLida!=='undefined'&&rotaLida))state.comparar=state.records.filter(r=>monthSortKey(r.label)<monthSortKey(state.periodo)).at(-1)?.label||'';render();}
function scopeSession(){sessionDataset=null;if(typeof planoSujo!=='undefined')planoSujo=false;let sub='equipe';try {const raw=AUTH.cracha().split('.')[1];sub=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/'))).sub||sub;}catch(_){}const suffix=encodeURIComponent(String(sub));STORE_KEY='dre_v2_data:'+suffix;MONTH_TS_KEY='dre_v2_ts:'+suffix;QUEUE_KEY='dre_v2_queue:'+suffix;servidorLocal=new Map();cacheFalhou=false;state.lidoNuvem=false;state.telaDoAparelho=false;if(typeof CacheDRE!=='undefined')CacheDRE.escopo(suffix);}
async function onAuthed(){
  if(!AUTH.temCracha())return;
  const check=await AUTH.conferir();if(check===false){scopeSession();limparCopiaLocal();AUTH.esquecer();return;}
  state.permissoes={leitura:true,edicao:false,admin:false};state.cfg={};state.cfgVersion=null;scopeSession();$$('authOverlay').hidden=true;$$('appShell').hidden=false;
  await abrirCopiaDoAparelho();await pullCloud();iniciarAcompanhamentoColeta();
}
const horaBR=s=>{const d=new Date(s||'');return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';};
// A tela abre na hora com a cópia do aparelho (versão do servidor + edições da fila por cima);
// a leitura da nuvem vem depois e só troca o que mudou.
function previaLegada(map){const legacy=state.cfg?.previaERP;if(legacy?.label)for(const r of map.values())if(r.label===legacy.label&&r.origem==='erp'&&!r.previaERP)r.previaERP=legacy;}
async function abrirCopiaDoAparelho(){
  const local=cacheDisponivel()?await CacheDRE.ler():null;
  servidorLocal=new Map((local?.meses||[]).filter(r=>r?.id).map(r=>[r.id,r]));
  if(local?.base?.cfg){state.cfg=local.base.cfg;state.cfgVersion=local.base.cfgVersion||null;if(typeof carregarGestao==='function')carregarGestao();}
  // Permissões da última leitura: a tela abre como vai ficar; a leitura da nuvem confirma (o servidor decide).
  if(local?.base?.permissoes&&typeof local.base.permissoes==='object'){const p=local.base.permissoes;state.permissoes={leitura:!!p.leitura,edicao:!!p.edicao,admin:!!p.admin};}
  if(!servidorLocal.size){boot(getCurrentData());return;}
  const map=new Map([...servidorLocal.values()].filter(r=>!r.apagado).map(r=>[r.id,normalizeRecord(r)]));
  let pend=[];try{pend=getQueue();}catch(_){}
  for(const item of pend)if(item.registro)map.set(item.registro.id,item.registro);
  previaLegada(map);if(local.base?.lidoEm)state.updated=local.base.lidoEm;
  const D=monthsToDataset([...map.values()]);sessionDataset=D;state.telaDoAparelho=true;boot(D);
  setSyncState('busy',`Dados deste aparelho${local.base?.lidoEm?' de '+horaBR(local.base.lidoEm):''} · conferindo a nuvem…`);
}
// Índice leve e só os meses novos ou mudados; servidor sem o índice (versão anterior): a lista inteira.
async function lerMesesDaNuvem(){
  let idx=null;
  const ri=await api('indice');
  if(ri?.ok&&Array.isArray(ri.itens))idx=ri.itens;
  else if(!/Ação desconhecida/i.test(ri?.erro||''))throw new Error(ri?.erro||'Leitura não confirmada');
  if(!idx){
    const all=[];let offset=0;const seen=new Set();
    do{if(seen.has(offset))throw new Error('Paginação inconsistente');seen.add(offset);const r=await api('list',{offset},60000);if(!r.ok||!Array.isArray(r.itens))throw new Error(r.erro||'Leitura não confirmada');all.push(...r.itens);offset=r.nextOffset;}while(offset!=null);
    const ids=new Set(all.map(r=>r.id));
    return {todos:all,mudados:all,apagados:[...servidorLocal.keys()].filter(id=>!ids.has(id)),indice:false};
  }
  const vivos=idx.filter(i=>!i.apagado),faltam=vivos.filter(i=>!i.atualizadoEm||servidorLocal.get(i.id)?.atualizadoEm!==i.atualizadoEm).map(i=>i.id);
  const novos=[];
  for(let k=0;k<faltam.length;k+=8){const r=await api('buscar',{ids:faltam.slice(k,k+8)},60000);if(!r?.ok||!Array.isArray(r.itens))throw new Error(r?.erro||'Leitura não confirmada');novos.push(...r.itens);}
  const porId=new Map(novos.map(r=>[r.id,r])),vivosIds=new Set(vivos.map(i=>i.id));
  // Mês sem carimbo de versão vem sempre; só conta como mudado se o conteúdo for outro.
  const mudados=novos.filter(r=>JSON.stringify(r)!==JSON.stringify(servidorLocal.get(r.id)));
  // Mês pedido e não devolvido (apagado entre o índice e a busca) fica de fora.
  const todos=vivos.map(i=>porId.get(i.id)||(faltam.includes(i.id)?null:servidorLocal.get(i.id))).filter(Boolean);
  return {todos,mudados,apagados:[...servidorLocal.keys()].filter(id=>!vivosIds.has(id)||!todos.some(r=>r.id===id)),indice:true};
}
// Uma leitura por vez: a mais nova sempre desenha por último (a coleta e o botão podem disparar juntos).
let filaLeitura=Promise.resolve();
function pullCloud(manual=false){const p=filaLeitura.catch(()=>{}).then(()=>lerNuvem(manual));filaLeitura=p;return p;}
// O que a tela mostra de cada mês (id e versão), para saber se a leitura precisa redesenhar.
const chavePermissoes=p=>[!!p?.leitura,!!p?.edicao,!!p?.admin].join();
const assinaturaMeses=rs=>JSON.stringify([...rs].filter(r=>r&&!r.apagado).map(r=>[String(r.id),r.atualizadoEm??null]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0));
async function lerNuvem(manual=false){
  if(!AUTH.temCracha())return;
  const crachaAgora=()=>{try{return AUTH.cracha?.()??null;}catch(_){return null;}},cracha=crachaAgora();
  if(!navigator.onLine){setSyncState('off','Offline · dados locais');return;}
  setSyncState('busy','Lendo a nuvem…');
  try {
    const permAntes=chavePermissoes(state.permissoes);
    const permissions=await api('permissions');state.permissoes=permissions.permissoes||{leitura:true,edicao:false,admin:false};
    let filaAntes=0;try{filaAntes=getQueue().length;}catch(_){}
    if(state.permissoes.edicao)try{await trySync();}catch(e){toast('Edições locais preservadas; envio pendente.','err');}
    const lido=await lerMesesDaNuvem(),all=lido.todos;
    const rc=await api('getCfg');if(!rc.ok)throw new Error('Não foi possível conferir as configurações.');
    // Saiu ou trocou de pessoa durante a leitura: nada é gravado nem desenhado.
    if(crachaAgora()!==cracha)return;
    const cfgMudou=(rc.atualizadoEm||null)!==(state.cfgVersion||null);state.cfg=rc.cfg||{};state.cfgVersion=rc.atualizadoEm||null;if(typeof carregarGestao==='function')carregarGestao();
    const pend=getQueue();const map=new Map(all.filter(r=>!r.apagado).map(r=>[r.id,normalizeRecord(r)]));
    for(const item of pend){if(item.registro){const rem=map.get(item.registro.id);if(rem&&rem.atualizadoEm!==item.registro.baseAtualizadoEm&&!item.conflito)item.conflito={servidor:rem};map.set(item.registro.id,item.registro);}}
    if(pend.length)try{setQueue(pend);}catch(e){toast('A fila anterior foi preservada. Conflitos serão conferidos novamente antes do envio.','err');}
    // Leitura nunca semeia, exclui duplicatas ou reenvia histórico automaticamente.
    previaLegada(map);
    const ts={};all.forEach(r=>ts[r.label]=r.atualizadoEm);setMonthTS(ts);
    const lidoEm=new Date().toISOString();
    const cacheOk=await guardarNoAparelho(lido.mudados,lido.apagados,{versao:1,cfg:state.cfg,cfgVersion:state.cfgVersion,lidoEm,permissoes:state.permissoes});state.cacheOk=cacheOk;
    // Nada mudou desde a cópia do aparelho: a tela fica como está (sem redesenhar nem perder o foco).
    // Redesenha quando algo mudou: meses, configuração, fila, permissões ou a própria tela
    // (versão descartada num conflito, edição confirmada, leitura atrasada). Nada novo: a tela fica.
    const mudou=(!state.lidoNuvem&&!state.telaDoAparelho)||lido.mudados.length||lido.apagados.length||cfgMudou||pend.length||pend.length!==filaAntes||chavePermissoes(state.permissoes)!==permAntes||assinaturaMeses(state.records||[])!==assinaturaMeses(map.values());
    state.updated=lidoEm;
    if(mudou){const merged=monthsToDataset([...map.values()]);salvarLocal(merged);boot(merged);}else escreverRodape();
    state.lidoNuvem=true;
    const n=lido.mudados.length,novidade=!lido.indice?'base inteira lida':n?`${n} ${n===1?'mês atualizado':'meses atualizados'}`:'nada novo';
    setSyncState(pend.length?'pending':'ok',(pend.length?pend.length+' edições pendentes · ':'')+'Dados aplicados '+(!pend.length&&cacheOk?'':new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' ')+'· '+novidade+(cacheOk?'':' · sem cópia neste aparelho'));
    if(manual)toast('Base salva na nuvem lida. Veja abaixo a data da coleta do ERP.');
  }catch(e){setSyncState('off','Leitura não concluída');toast(e.message||'Não foi possível ler a nuvem.','err');}
}
/* Chip "Ano" (Fase 9.1): o ano inteiro nas telas que somam período. Uma fonte só,
   state.anoTodo, guardada na rota (ano=1); a "Matriz do ano" da DRE (gestaoUI.dre)
   segue ela. O período do app continua sendo um mês, para nenhuma outra tela mudar;
   o fim do ano não é guardado: é sempre o último mês com dados até hoje (fimDoAno),
   para que Voltar, link ou um mês gravado por fora não encurtem o ano. Clicar num
   mês volta ao mês, em qualquer tela. Na DRE por competência o chip não aparece: lá
   a visão é por apuração. */
// Toda tela que mostra a barra de meses tem o Ano; Conferência e Parâmetros não comparam com outro ano.
const ANO_TELAS=['inicio','cfo','dre','caixa','resultado','custos','detalhe','conferencia','dfc','balanco','precos','parametros','indicadores'];
const ANO_TELAS_COMPARAM=ANO_TELAS.filter(v=>v!=='conferencia'&&v!=='parametros');
const anoAtivo=()=>!!state.anoTodo;
const anoCompetencia=()=>state.view==='dre'&&typeof dreUI!=='undefined'&&dreUI.base==='competencia';
// Uma pergunta só para "estou no Ano?": Ano ligado, tela com o chip e fora da competência.
const telaNoAno=()=>anoAtivo()&&ANO_TELAS.includes(state.view)&&!anoCompetencia();
function hojeRotulo(){const d=typeof dfcHoje==='function'?dfcHoje():'';return /^\d{4}-\d{2}/.test(d)?PT_MON[Number(d.slice(5,7))-1]+'/'+d.slice(0,4):mesHoje();}
function anoDaTela(){const y=String(state.periodo||'').split('/')[1]||'';return /^\d{4}$/.test(y)?Number(y):null;}
// Ano de hoje pelo mesmo relógio da DFC (dfcHoje): nenhum ano fica escrito no código, 2027 em diante entra sozinho.
const anoDeHoje=()=>Number(hojeRotulo().split('/')[1]);
const regDoMes=l=>{const k=monthSortKey(l);return k<0?null:state.records.find(r=>monthSortKey(r.label)===k)||null;};
// "Jan a Mar e Mai": meses seguidos em faixa; os 12 meses, "ano inteiro".
function rotuloMesesAno(indices){
 const xs=[...new Set((indices||[]).map(Number).filter(i=>Number.isInteger(i)&&i>=0&&i<12))].sort((a,b)=>a-b);if(!xs.length)return '';if(xs.length===12)return 'ano inteiro';
 const g=[];for(const i of xs){const u=g[g.length-1];if(u&&i===u[1]+1)u[1]=i;else g.push([i,i]);}
 const t=g.map(([a,b])=>a===b?PT_MON[a]:`${PT_MON[a]} a ${PT_MON[b]}`);return t.length>1?t.slice(0,-1).join(', ')+' e '+t[t.length-1]:t[0];
}
// "2026 · Jan a Set*": de janeiro ao último mês com dados; * quando esse mês está em andamento ou incompleto.
function rotuloAno(ano=anoDaTela()){
 if(ano==null||!/^\d{4}$/.test(String(ano)))return '';
 const fim=fimDoAno(ano),m=String(fim).split('/')[0],r=regDoMes(fim),parcial=!!r&&!!F.qualidade(r).parcial;
 return `${ano} · ${m==='Jan'?'Jan':'Jan a '+m}${parcial?'*':''}`;
}
// Anos com algum mês registrado, do mais recente ao mais antigo, sem o ano da tela.
function anosComparaveis(ano=anoDaTela()){
 const ys=new Set();for(const r of state.records){if(!F.periodo(r?.label))continue;const y=Number(String(r.label).split('/')[1]);if(Number.isInteger(y)&&y!==Number(ano))ys.add(y);}
 return [...ys].sort((a,b)=>b-a);
}
function anoPadraoComparado(ano=anoDaTela()){
 if(ano==null)return null;const xs=anosComparaveis(ano),y=Number(ano);
 return xs.includes(y-1)?y-1:xs.find(x=>x<y)??null;
}
// O ano escolhido em "Comparar com" (state.anoComparar) validado contra os dados: inválido ou ausente volta ao padrão.
function anoComparado(){
 const v=String(state.anoComparar??'');if(v==='nenhum')return null;
 if(/^\d{4}$/.test(v)&&anosComparaveis().includes(Number(v)))return Number(v);
 return anoPadraoComparado();
}
function selecionarAnoComparado(valor){
 const v=String(valor??'');
 if(v==='nenhum')state.anoComparar='nenhum';else if(/^\d{4}$/.test(v))state.anoComparar=Number(v)===anoPadraoComparado()?'':v;else return;
 const el=typeof document!=='undefined'&&typeof document.getElementById==='function'?id=>document.getElementById(id):()=>null;
 if(el('periodCompare'))el('periodCompare').open=false;render();el('compareSummary')?.focus?.();
}
// Sem ano comparado: se há outro ano com dados, a pessoa escolhe no topo; se não há, a tela diz isso (2027 entra sozinho quando tiver dados).
Object.defineProperty(globalThis,'TEXTO_SEM_ANO_COMPARADO',{configurable:true,get:()=>anosComparaveis().length?'Sem comparação: escolha um ano em “Comparar com”, no topo.':'Sem outro ano com dados para comparar.'});
const textoSemMesesComparaveis=(ano,anoComp)=>`Sem meses completos, da mesma base e com plano de contas em ${ano} e ${anoComp} para comparar.`;
// Contas do ano guardadas por identidade de state.records (troca a cada leitura) e pelo dia de hoje.
const anoCache=new WeakMap();
function anoMemo(chave,f){
 const rs=state.records;if(!rs||typeof rs!=='object')return f();const hoje=typeof dfcHoje==='function'?dfcHoje():'';
 let m=anoCache.get(rs);if(!m){m=new Map();anoCache.set(rs,m);}const k=chave+'|'+hoje+'|'+rs.length;if(!m.has(k))m.set(k,f());return m.get(k);
}
// Meses (0 a 11) completos nos dois anos, da mesma base e com plano de contas (pctSemConta ≤ 10): a régua de toda comparação do Ano.
function mesesComparaveisAno(ano,anoComp){
 if(ano==null||anoComp==null||!/^\d{4}$/.test(String(ano))||!/^\d{4}$/.test(String(anoComp)))return [];
 return anoMemo(`M|${ano}|${anoComp}`,()=>{
  const hoje=typeof dfcHoje==='function'?dfcHoje():new Date().toISOString().slice(0,10);
  const fechado=r=>{const per=r&&F.periodo(r.label);return !!per&&per.ate<hoje&&!F.qualidade(r).parcial;};
  const comPlano=r=>{const a=typeof DRESimples!=='undefined'?DRESimples.apurar(r):null;return !(a&&a.pctSemConta!=null&&a.pctSemConta>10);};
  const out=[];for(let i=0;i<12;i++){const a=regDoMes(PT_MON[i]+'/'+ano),b=regDoMes(PT_MON[i]+'/'+anoComp);if(fechado(a)&&fechado(b)&&F.comparavelComRessalva(a,b).pode&&comPlano(a)&&comPlano(b))out.push(i);}
  return out;
 }).slice();
}
// "Fev/2026 a Mar/2026 e Mai/2026": meses seguidos em faixa (a mesma escrita do DFC no Ano).
function faixasDeMeses(ls){
 const g=[];for(const l of ls){const k=monthSortKey(l),u=g[g.length-1];if(u&&k===u.k+1){u.fim=l;u.k=k;}else g.push({ini:l,fim:l,k});}
 const t=g.map(x=>x.ini===x.fim?x.ini:`${x.ini} a ${x.fim}`);return t.length>1?t.slice(0,-1).join(', ')+' e '+t[t.length-1]:t[0]||'';
}
// Registro do ano: de janeiro ao fim do ano (ou só os meses pedidos), somado em centavos por F.somarMeses.
// Mês faltando não vira zero: o ano não é somado e o motivo diz qual falta.
function registroDoAno(ano,indices=null){
 if(ano==null||!/^\d{4}$/.test(String(ano)))return {disponivel:false,reg:null,motivo:'Ano não reconhecido.',faltam:[],meses:[],parcial:false};
 const idx=Array.isArray(indices)?[...new Set(indices.map(Number))].filter(i=>Number.isInteger(i)&&i>=0&&i<12).sort((a,b)=>a-b):null;
 return anoMemo(`R|${ano}|${idx?idx.join(','):'*'}`,()=>{
  const ate=idx?null:PT_MON.indexOf(String(fimDoAno(ano)).split('/')[0]);
  const meses=idx?idx.map(i=>PT_MON[i]+'/'+ano):PT_MON.slice(0,Math.max(0,ate)+1).map(m=>m+'/'+ano);
  const regs=meses.map(regDoMes),faltam=meses.filter((l,i)=>!regs[i]),parcial=regs.some(r=>r&&F.qualidade(r).parcial);
  if(!meses.length)return {disponivel:false,reg:null,motivo:'Nenhum mês no período.',faltam,meses,parcial};
  if(faltam.length)return {disponivel:false,reg:null,motivo:`${faixasDeMeses(faltam)} sem dados coletados: sem todos os meses, o acumulado de ${ano} não é somado.`,faltam,meses,parcial};
  if(typeof F.somarMeses!=='function')return {disponivel:false,reg:null,motivo:'A soma do ano não está disponível nesta versão.',faltam,meses,parcial};
  const s=F.somarMeses(regs,{label:String(ano),rotulo:idx?`${ano} · ${rotuloMesesAno(idx)}`:rotuloAno(ano)});
  return s?.disponivel?{disponivel:true,reg:s.reg,motivo:'',faltam,meses,parcial}:{disponivel:false,reg:null,motivo:s?.motivo||'O ano não pôde ser somado.',faltam,meses,parcial};
 });
}
// A comparação do Ano: os meses completos nos dois anos, somados de cada lado.
function comparacaoDoAno(ano=anoDaTela(),anoComp=anoComparado()){
 const out={ano,anoComp,indices:[],meses:'',atual:null,anterior:null,ressalva:false,motivo:''};
 if(anoComp==null){out.motivo=TEXTO_SEM_ANO_COMPARADO;return out;}
 const indices=mesesComparaveisAno(ano,anoComp);
 if(!indices.length){out.motivo=textoSemMesesComparaveis(ano,anoComp);return out;}
 const a=registroDoAno(ano,indices),b=registroDoAno(anoComp,indices);
 out.indices=indices;out.meses=rotuloMesesAno(indices);
 if(!a.disponivel||!b.disponivel){out.motivo=(!a.disponivel?a:b).motivo;return out;}
 out.atual=a.reg;out.anterior=b.reg;out.ressalva=indices.some(i=>F.comparavelComRessalva(regDoMes(PT_MON[i]+'/'+ano),regDoMes(PT_MON[i]+'/'+anoComp)).ressalva);
 return out;
}
// Último mês com dados do ano até hoje; sem nenhum, o mês de hoje (ano corrente) ou dezembro.
function fimDoAno(ano){
 const y=String(ano||''),hoje=hojeRotulo();if(!/^\d{4}$/.test(y))return state.periodo;
 const doAno=state.records.map(r=>r.label).filter(l=>String(l).endsWith('/'+y)&&F.periodo(l)&&monthSortKey(l)<=monthSortKey(hoje)).sort((a,b)=>monthSortKey(b)-monthSortKey(a));
 return doAno[0]||(y===hoje.split('/')[1]?hoje:'Dez/'+y);
}
// Fora das telas do Ano (e na competência), o app volta ao mês escolhido antes de ligar o Ano.
function alinharAno(){if(telaNoAno()){const f=fimDoAno(String(state.periodo).split('/')[1]);if(f&&f!==state.periodo)state.periodo=f;}else if(anoAtivo()&&state.mesBase&&String(state.mesBase).split('/')[1]===String(state.periodo).split('/')[1]&&(!ANO_TELAS.includes(state.view)||anoCompetencia()))state.periodo=state.mesBase;return state.periodo;}
function ligarAno(ligado){state.anoTodo=!!ligado;if(typeof gestaoUI!=='undefined')gestaoUI.dre=ligado?'ano':'mes';}
function selecionarAno(ano){
 const y=String(ano||String(state.periodo).split('/')[1]||'');if(!/^\d{4}$/.test(y))return;
 const anoAntes=String(state.periodo).split('/')[1];
 // O mês de onde se ligou o Ano volta nas outras telas; outro ano não tem esse mês guardado.
 if(!state.anoTodo)state.mesBase=state.periodo;else if(y!==anoAntes)state.mesBase='';
 state.periodo=fimDoAno(y);if(y!==anoAntes||state.comparar===state.periodo)state.comparar='';
 // O ano escolhido para comparar não pode ser o próprio ano: volta ao padrão (ano anterior).
 if(String(state.anoComparar??'')===y)state.anoComparar='';ligarAno(true);
 window.DREIndicadores?.ano?.(state.periodo);
 render();
}
function selecionarPeriodo(label){
 if(!F.periodo(label))return;
 state.periodo=label;state.mesBase='';if(state.comparar===label)state.comparar='';
 ligarAno(false);
 // Em qualquer tela: os Indicadores também saem do ano e vão ao mês.
 window.DREIndicadores?.periodo?.(label);
 render();
}
// "Comparar com" escondido: no Ano, nas telas que não comparam; no mês, onde ninguém lê state.comparar.
const compararEscondido=()=>telaNoAno()?!ANO_TELAS_COMPARAM.includes(state.view):['indicadores','detalhe','glossario','caixa','conferencia','config','ajuda',...TELAS_CONTROLE].includes(state.view);
// Devolve se o intervalo é o ano do app: os Indicadores ligam a comparação ao "Comparar com" do topo por ele.
function atualizarChipsPeriodo(p){
 // Intervalo escolhido dentro dos Indicadores: o ano do app (de janeiro até o último mês
 // com dados, ou o ano civil inteiro) acende o chip; outro ano ou outro recorte apaga.
 const y=String(state.periodo).split('/')[1],fim=F.periodo(fimDoAno(y))?.ate;
 const inteiro=p?.de===y+'-01-01'&&(p?.ate===y+'-12-31'||p?.ate===fim),antes=!!state.anoTodo;ligarAno(inteiro);
 if(antes!==inteiro){if(typeof gravarRota==='function')gravarRota();
  // Entrou ou saiu do Ano: o topo é redesenhado (no Ano, "Comparar com" lista anos; fora dele, meses ou fica escondido);
  // os meses novos ganham o clique que o render liga (wireGraficos).
  if(typeof document.getElementById==='function'){periodoOptions();document.querySelectorAll('#monthChips [data-period]').forEach(b=>b.onclick=()=>selecionarPeriodo(b.dataset.period));const pc=$$('periodCompare');if(pc){pc.open=false;pc.hidden=compararEscondido();}}}
 document.querySelectorAll('#monthChips button').forEach(b=>{const m=F.periodo(b.dataset.period);b.setAttribute('aria-pressed',String(!inteiro&&m?.de===p?.de&&m?.ate===p?.ate));});
 document.querySelector('#anoChip button')?.setAttribute('aria-pressed',String(inteiro));
 return inteiro;
}
// Reposiciona só a faixa de meses quando sua largura muda (desktop/celular).
// Não move a página e não impede a rolagem manual da faixa.
let observadorMeses=null;
function revelarMesSelecionado(){
 const barra=$$('monthChips'),selecionado=barra?.querySelector?.('[aria-pressed="true"]');
 if(!selecionado||!barra.clientWidth||barra.scrollWidth<=barra.clientWidth)return;
 const b=barra.getBoundingClientRect(),s=selecionado.getBoundingClientRect();
 if(s.left<b.left||s.right>b.right)barra.scrollLeft+=s.left-b.left-(barra.clientWidth-selecionado.offsetWidth)/2;
}
function acompanharFaixaMeses(){
 const barra=$$('monthChips');if(!barra)return;
 if(!observadorMeses&&typeof ResizeObserver!=='undefined'){observadorMeses=new ResizeObserver(revelarMesSelecionado);observadorMeses.observe(barra);}
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(revelarMesSelecionado);else revelarMesSelecionado();
}
function contextoMovimento(reg){
 const r=telaNoAno()?registroDoAno(anoDaTela()).reg:reg,e=F.valorConta(r,'1'),s=F.valorConta(r,'2'),v=e==null||s==null?null:Math.round((e-s)*100)/100;
 return `<div class="contexto-movimento" aria-label="Resumo do movimento"><span>${esc(telaNoAno()?rotuloAno(anoDaTela()):state.periodo)} · Caixa</span>${[['Entradas',e,'entradas'],['Saídas',s,'saidas'],['Variação',v,'variacao']].map(([t,n,id])=>`<span>${t} <b class="${tomDoValor(id,n)}">${n==null?'Não apurado':esc(money(n))}</b></span>`).join('')}<small>Variação não é lucro nem saldo bancário.</small></div>`;
}
function acoesDashboard(reg){
 const n=telaNoAno()?mesesAteFimDoAno(anoDaTela()).reduce((s,l)=>s+(regDoMes(l)?.pendencias?.length||0),0):(reg?.pendencias?.length||0);
 return `<nav class="dashboard-actions" aria-label="Próximos passos"><button data-go="conferencia"><b>${n} pendência${n===1?'':'s'} a conferir</b><span>Conferência e qualidade →</span></button><button data-go="cfo"><b>Investigar os números</b><span>Análise CFO →</span></button><button data-go="caixa"><b>Planejar o caixa</b><span>Histórico e próximas 13 semanas →</span></button></nav>`;
}
function periodoOptions(){
 // Anos pelos dados e pelo relógio do app (hojeRotulo/anoDeHoje): o ano novo aparece sozinho na virada.
 const labels=[...new Set([...state.records.map(r=>r.label),...Object.values(state.cfg.demonstrativosCompetencia?.meses||{}).map(r=>r.label),state.periodo,hojeRotulo()])].filter(l=>F.periodo(l)).sort((a,b)=>monthSortKey(b)-monthSortKey(a));
 const disponiveis=new Set([...state.records.map(r=>r.label),...Object.values(state.cfg.demonstrativosCompetencia?.meses||{}).map(r=>r.label)]);
 const hojeAno=anoDeHoje(),year=Number(state.periodo.split('/')[1]),years=labels.map(l=>Number(l.split('/')[1])),min=Math.min(...years,hojeAno-1),max=Math.max(...years,hojeAno);
 $$('yearSelect').innerHTML=Array.from({length:max-min+1},(_,i)=>max-i).map(y=>`<option ${year===y?'selected':''}>${y}</option>`).join('');
 const comp=state.view==='dre'&&dreUI.base==='competencia',temAno=ANO_TELAS.includes(state.view)&&!comp,ano=temAno&&anoAtivo();
 // O foco fica no botão que estava com ele (a barra é redesenhada a cada render).
 const focoAntes=typeof document.activeElement!=='undefined'?document.activeElement:null,focoSel=focoAntes?.closest?.('#anoChip')?'#anoChip [data-ano]':focoAntes?.closest?.('#monthChips')&&focoAntes.dataset?.period?`#monthChips [data-period="${focoAntes.dataset.period}"]`:'';
 $$('monthChips').innerHTML=PT_MON.map(m=>{const l=m+'/'+year,has=comp?!!state.cfg.demonstrativosCompetencia?.meses?.[safeId(l)]:disponiveis.has(l);return `<button type="button" data-period="${l}" aria-label="${l}" aria-pressed="${!ano&&state.periodo===l}" class="${has?'has-data':'no-data'}${comp&&has?' apurado':''}" title="${l} · ${has?(comp?'Apuração cadastrada':'Dados disponíveis'):(comp?'Sem apuração':'Sem base registrada')}">${m}</button>`;}).join('');
 // O lugar do chip fica ao lado da barra de meses (que continua com os 12 meses), criado uma vez.
 let chipAno=$$('anoChip');const barra=$$('monthChips');
 acompanharFaixaMeses();
 if(!chipAno&&barra?.parentNode&&typeof document.createElement==='function'){chipAno=document.createElement('div');chipAno.id='anoChip';chipAno.className='month-chips';chipAno.setAttribute('role','group');chipAno.setAttribute('aria-label','Ano inteiro');chipAno.style.cssText='flex:0 0 auto;min-width:0;order:0';barra.after(chipAno);chipAno.addEventListener('click',e=>{const b=e.target.closest?.('[data-ano]');if(b)selecionarAno(b.dataset.ano);});}
 if(chipAno){chipAno.style.display=temAno?'flex':'none';chipAno.innerHTML=temAno?`<button type="button" data-ano="${year}" aria-pressed="${ano}" class="has-data" style="min-width:44px;padding:5px 12px" title="${year}: de janeiro até o último mês com dados">Ano</button>`:'';}
 if(focoSel)document.querySelector?.(focoSel)?.focus?.({preventScroll:true});
 // No Ano, "Comparar com" escolhe o ANO (padrão: o anterior); no mês, os meses como sempre.
 if(ano){const ac=anoComparado();$$('compareSummary').textContent=ac!=null?'Comparar: '+ac:'Comparação';
  $$('compareSelect').innerHTML=`<option value="nenhum" ${ac==null?'selected':''}>Sem comparação</option>`+anosComparaveis().map(y=>`<option value="${y}" ${ac===y?'selected':''}>${y}</option>`).join('');return;}
 $$('compareSummary').textContent=state.comparar?'Comparar: '+state.comparar:'Comparação';
 $$('compareSelect').innerHTML='<option value="">Sem comparação</option>'+labels.filter(l=>l!==state.periodo).map(l=>`<option ${state.comparar===l?'selected':''}>${esc(l)}</option>`).join('');
}
/* Registro único das telas: título e descrição de cada data-view. A rota
   (gestao.js:restaurarRota) e o teste tests/telas.test.mjs leem daqui, para que
   uma tela nova não fique sem rota, sem título ou sem página. */
// Telas que não estão no menu acendem o item de onde se chega a elas (gestao.js:sincronizarMenu usa o mesmo mapa).
const MENU_PAI={custos:'indicadores',resultado:'caixa'};
const METADATA_TELAS={indicadores:['Indicadores','Receita, custos e resultado com origem e qualidade visíveis.'],cfo:['Análise CFO','Prioridades, composição dos valores e perguntas para decidir com segurança.'],dre:['DRE','Movimento de caixa e resultado por competência, por mês ou no ano.'],glossario:['Glossário','Conceitos, fórmulas e exemplos para entender cada número.'],inicio:['Dashboard','O que aconteceu, o que falta conferir e onde agir.'],caixa:['Caixa e planejamento','Entradas, saídas e planejamento, com critérios visíveis.'],resultado:['Composição do caixa','Veja como os recebimentos e pagamentos formam a variação.'],custos:['Despesas e categorias','Despesas por mês: entenda onde o dinheiro é gasto e acompanhe cada categoria.'],detalhe:['Plano de contas','Todas as contas, mês a mês. Selecione uma conta na lista lateral para investigar.'],conferencia:['Conferência','Cobertura, pendências e diferenças antes do fechamento.'],config:['Sistemas e configurações','Integração, importação, backup e acesso.'],ajuda:['Como usar o painel','Onde está cada resposta e como conferir antes de decidir.'],dfc:['Fluxo de caixa DFC','Método direto: quanto a operação, os investimentos e os financiamentos geraram ou consumiram de caixa.'],balanco:['Balanço gerencial','O que a empresa tem, o que deve e o patrimônio no fim de cada mês, com a origem de cada saldo.'],giro:['Capital de giro','Quanto dinheiro fica preso entre comprar, produzir, vender e receber.'],recebiveis:['Recebíveis e aging','Quem deve, há quanto tempo e quanto está em risco, na posição que o Painel atualiza a cada 20 minutos.'],precos:['Preço e equilíbrio','Margem de contribuição, ponto de equilíbrio e simulador de preço.'],parametros:['Parâmetros','Simples Nacional por empresa, prazos, estoque e metas que alimentam os controles.']};
// Telas dos seis controles (Fase 1: esqueleto sem cálculo, desenhado em gestao.js).
const TELAS_CONTROLE=['dfc','balanco','giro','recebiveis','precos','parametros'];
function paginasDoApp(){
  const controle=Object.fromEntries(TELAS_CONTROLE.map(v=>[v,()=>typeof renderControle==='function'?renderControle(v):'']));
  return {indicadores:()=>'<section id="indicadoresRoot"></section>',cfo:renderCFO,dre:renderDRE,glossario:renderGlossario,inicio:renderInicio,caixa:renderCaixa,resultado:renderResultado,custos:renderCustos,detalhe:()=>renderPlanoContas(),conferencia:renderConferencia,config:renderConfig,ajuda:renderAjuda,...controle,
    // Parâmetros já tem cadastro (Fase 2, parametros.js); o esqueleto fica de reserva
    ...(typeof renderParametros==='function'?{parametros:()=>renderParametros()}:{}),
    // Fluxo de caixa já tem cálculo (Fase 4, dfc.js)
    ...(typeof renderDFC==='function'?{dfc:()=>renderDFC()}:{}),
    // Recebíveis já leem a posição do Painel (Fase 5, gestao.js e dre-sync/recebiveis.mjs)
    ...(typeof renderRecebiveis==='function'?{recebiveis:()=>renderRecebiveis()}:{}),
    // Capital de giro: posição de hoje com as contas a pagar classificadas (Fase 6.1, gestao.js e dre-sync/giro.mjs)
    ...(typeof renderGiro==='function'?{giro:()=>renderGiro()}:{}),
    // Preço e ponto de equilíbrio (Fase 7, gestao.js): base caixa, média dos três meses fechados
    ...(typeof renderPrecos==='function'?{precos:()=>renderPrecos()}:{}),
    // Balanço gerencial (Fase 8, gestao.js): caixa da DFC, posição do fim do mês e saldos de Parâmetros
    ...(typeof renderBalanco==='function'?{balanco:()=>renderBalanco()}:{})};
}
// Tela desenhada por último: trocar de tela (menu, data-go, Glossário) leva ao topo e põe o foco
// no título; o Voltar do navegador (voltandoHistorico) não força o topo.
let telaAnterior='';
// Foco no conteúdo: o render troca o HTML da tela inteira; o controle que estava com o foco (aba,
// mês, conta, chip) volta a tê-lo depois, para o teclado não cair no body.
const FOCO_ATRIBUTOS=['data-plano-tab','data-plano-select','data-plano-juntas','data-dre-base','data-dre-visao','data-period','data-cost','data-cfo-rubrica','data-account','data-dre-ir','data-dfc-ir'];
function seletorFocoConteudo(){if(typeof document==='undefined')return '';const f=document.activeElement,c=$$('pageContent');if(!f||!c||typeof c.contains!=='function'||!c.contains(f)||typeof CSS==='undefined'||typeof CSS.escape!=='function')return '';for(const a of FOCO_ATRIBUTOS)if(f.hasAttribute?.(a))return `#pageContent [${a}="${CSS.escape(f.getAttribute(a))}"]`;return f.id?'#'+CSS.escape(f.id):'';}
function render(){
  if(!state.D)return;
  // Ano ligado: o mês do app é sempre o fim do ano (último mês com dados), para cartões,
  // tabelas, qualidade, rota e PDF da mesma tela somarem até o mesmo mês (Fase 9.1).
  alinharAno();
  if(typeof gravarRota==='function')gravarRota();periodoOptions();
  // Controle que não muda nada na tela fica escondido: mês em Glossário, Configurações, Ajuda, Giro e Recebíveis
  // (fotos da carteira); Comparar onde ninguém lê state.comparar; cobertura onde o mês não conta.
  document.querySelector('.period').hidden=['glossario','config','ajuda','giro','recebiveis'].includes(state.view);$$('periodCompare').hidden=compararEscondido();$$('qualityBar').hidden=['glossario','indicadores','config','ajuda','giro','recebiveis'].includes(state.view)||(state.view==='dre'&&dreUI.base==='competencia');const reg=regAtual(),q=F.qualidade(reg);
  const trocouTela=state.view!==telaAnterior,veio=telaAnterior;telaAnterior=state.view;if(trocouTela&&$$('periodCompare'))$$('periodCompare').open=false;
  const [title,desc]=METADATA_TELAS[state.view]||METADATA_TELAS.inicio;$$('pageTitle').textContent=title;$$('pageDesc').textContent=desc;document.title=title+' · DRE Impresilk';
  const pai=MENU_PAI[state.view];document.querySelectorAll('[data-view]').forEach(b=>{const v=b.dataset.view;b.classList.toggle('active',v===state.view||v===pai);b.setAttribute('aria-current',v===state.view?'page':v===pai?'true':'false');});if(typeof sincronizarMenu==='function')sincronizarMenu();
  const semContrato=reg?.qualidade?.apiContratoValidado===false;
  // Com o Ano ligado, o chip diz o ano até o mês; em Preço, o mês parcial fica fora da média.
  const noAno=telaNoAno(),pm=noAno&&state.view==='precos'&&typeof dfcMes==='function'?dfcMes(state.periodo):null,parcialFora=pm?.parcial?` · ${state.periodo} (${pm.emAndamento?'mês em andamento':'mês incompleto'}) fica fora da média`:'';
  const rotuloPeriodo=noAno?`${String(state.periodo).split('/')[1]} até ${state.periodo}`:state.periodo;
  $$('qualityBar').innerHTML=`<details class="status quality-details chip-details est-${esc(q.estado||'sem-dados')} ${q.comparavel?'good':''}"><summary aria-label="${esc(`Qualidade de ${rotuloPeriodo}: ${q.rotulo}${parcialFora}${semContrato?'. Limites da API ainda não validados':''}. Ver cobertura`)}"><span class="quality-dot"></span><span>${esc(rotuloPeriodo)} · <b>${esc(q.rotulo)}</b>${esc(parcialFora)}</span>${semContrato?'<span class="st-ressalva">° API a validar</span>':''}<span class="quality-action">cobertura ▾</span></summary><div><p>${esc(q.mensagem)}</p><small>Última coleta/registro: ${esc(dataBR(q.coletadoEm))} · Fonte: ${!reg?'Não disponível':reg.origem==='erp'?'Mubisys':'Histórico / planilha'} · Base: caixa filtrado por “compõe DRE”. Conciliação bancária: ${reg?.qualidade?.conciliado?'registrada':'não comprovada'}.</small></div></details>`;
  const pages=paginasDoApp();
  const focoSel=seletorFocoConteudo();
  $$('pageContent').innerHTML=(pages[state.view]||renderInicio)(reg,q)+(typeof navContexto==='function'?navContexto():'');
  // Indicadores: anoComparado e mesesComparaveis são lidos na hora, porque o intervalo escolhido lá dentro liga ou desliga o Ano depois do mount.
  $$('cfoTools').hidden=['config','ajuda','indicadores','dre','giro','recebiveis','parametros'].includes(state.view);$$('cfoPDF').hidden=['glossario','dfc','balanco','precos'].includes(state.view);wireContent();if(typeof wirePlanoContas==='function')wirePlanoContas();if(focoSel&&!trocouTela){const alvo=document.querySelector(focoSel);alvo?.focus?.({preventScroll:true});if(document.activeElement!==alvo)$$('pageTitle')?.focus?.({preventScroll:true});}document.body.dataset.screen=state.view;if(state.view==='indicadores')window.DREIndicadores?.mount($$('indicadoresRoot'),{records:state.records,cfg:state.cfg,periodo:state.anoTodo?fimDoAno(String(state.periodo).split('/')[1]):state.periodo,ano:!!state.anoTodo,get anoComparado(){return state.anoTodo?anoComparado():null;},get mesesComparaveis(){const ac=state.anoTodo?anoComparado():null;return ac!=null?mesesComparaveisAno(anoDaTela(),ac):[];},api,dialog,refresh:()=>pullCloud(true),onPeriodo:selecionarPeriodo,onIntervalo:atualizarChipsPeriodo,rota:state.indicadoresRota||null,onDRE:periodo=>{dreUI.base='competencia';state.view='dre';ligarAno(false);if(periodo?.de){const [y,m]=periodo.de.split('-');state.periodo=PT_MON[Number(m)-1]+'/'+y;}render();}});if(state.view==='indicadores'){state.indicadoresRota=null;if(typeof gravarRota==='function')gravarRota();}$$('footMeta').hidden=state.view==='glossario';state.rotuloQualidade=q.rotulo;escreverRodape();
  if(trocouTela&&veio&&!voltandoHistorico){if(typeof window!=='undefined'&&typeof window.scrollTo==='function')window.scrollTo(0,0);$$('pageTitle')?.focus?.({preventScroll:true});}
  // Seção pedida pelo "Ver em" do Glossário ou pelo link secao=<chave> (N24): depois do topo, rola até ela.
  if(typeof irSecaoPendente==='function')irSecaoPendente();
}
// Saldo do fim do mês como a DFC calcula (saldo inicial de Parâmetros + geração), com * no mês
// em andamento ou incompleto; sem saldo, "Não apurado" e o caminho para informar.
function saldoFimDoMes(reg){const s=reg&&typeof dfcSaldo==='function'?dfcSaldo(reg.label):null;return s?.final==null?'Não apurado · <button type="button" class="text-button" data-go="parametros">informe em Parâmetros</button>':`<span class="${s.final>0?'tom-entra':s.final<0?'tom-sai':''}">${esc(money(s.final))}</span>`+(s.parcial?` <span title="${s.emAndamento?'Mês em andamento':'Mês incompleto'}: saldo até a última coleta">*</span>`:'');}
function renderInicio(reg,q){
 if(telaNoAno())return renderInicioAno(reg,q);
 const latest=[...state.records].sort((a,b)=>monthSortKey(b.label)-monthSortKey(a.label))[0];
 let h=!reg?`<div class="month-empty"><div><b>${esc(state.periodo)} ainda não tem dados.</b><span>O histórico abaixo continua disponível para consulta.</span></div>${latest?`<button data-period="${esc(latest.label)}">Abrir ${esc(latest.label)} →</button>`:''}</div>`:'';
 h+=resumoMovimento(reg)+comparativoMovimento(reg);
 h+=`<div class="dashboard-grid">${typeof evolucaoCompacta==='function'?evolucaoCompacta():graficoEvolucao()}${painelGrafico('Para onde foi o dinheiro',state.periodo+' · principais grupos de saídas',rankingCustos(reg),'<button data-go="custos" class="text-button">Ver todas →</button>',['Caixa','Valores em R$'])}</div>`;
 h+=acoesDashboard(reg)+card('Variações e orçamento',resumoGestao(reg),false);
 h+=card('Conferência e próximos passos',`<div class="review-grid"><div><span class="label">Cobertura da base</span><b>${esc(q.rotulo)}</b></div><div><span class="label">Pendências a conferir</span><b><button type="button" class="text-button" data-go="conferencia" aria-label="${(reg?.pendencias||[]).length} pendência(s) a conferir: abrir a Conferência">${(reg?.pendencias||[]).length}</button></b></div><div><span class="label"><button type="button" class="text-button" data-go="dfc">Saldo no fim do mês (Fluxo de caixa)</button></span><b>${saldoFimDoMes(reg)}</b></div></div><div class="actions"><button data-go="conferencia">Conferir dados →</button><button data-go="caixa">Planejar o caixa →</button></div>`,false);
 // Comparativos anuais no fim: o mês vem antes da leitura de vários anos.
 h+=(typeof renderComparativos==='function'?card('Comparativos entre anos',renderComparativos(),false):'');
 return h;
}
/* Operação, investimento e financiamento do mês nas telas Caixa e Composição do
   caixa. Sai da DFC (dfc.js: dfcMes → dfcApurar → DRESimples.apurar), com as
   linhas, os valores e a cor de lá: nenhuma regra própria aqui, para as telas
   nunca discordarem da DRE Simples e do Fluxo de caixa no mesmo mês. Antes vinha
   de F.resumo, que punha o parcelamento do DAS e a compra de máquina na operação.
   F.resumo segue dando só entradas, saídas e variação. A cor segue o sentido em todas as
   linhas, financiamento e mês parcial inclusive (saída vermelha, entrada azul); o mês
   parcial leva a marca da DFC; mês sem dado é "Não apurado". */
function caixaEmBlocos(reg){
  const m=reg&&typeof dfcMes==='function'?dfcMes(reg.label):null;
  if(!m?.d)return null;
  // a mesma marca da DFC: em andamento (o mês ainda corre) ou incompleto (a coleta parou antes do fim)
  const andamento=dfcMarca(m);
  const lin=(id,nome,total=false)=>{const v=dfcValorLinha(m,null,id);return `<div class="line${total?' total':''}" data-dfc-linha="${id}"><span>${esc(nome)}</span><b class="${dfcTomLinha(id,v)}">${money(v)}</b></div>`;};
  const bloco=b=>DFC_ITENS.filter(i=>i.bloco===b).map(i=>lin(i.id,i.nome)).join('')+lin(b,'(=) '+DFC_LINHAS.find(l=>l.id===b).nome,true);
  const fecha=Math.abs(m.d.diferenca)<.01?`<p class="hint">Operação + investimento + financiamento = ${esc(money(m.d.geracao))}, igual a entradas menos saídas do ERP em ${esc(m.label)}.</p>`:`<p class="param-avisos">Diferença de ${esc(money(m.d.diferenca))} entre a geração de caixa e entradas menos saídas do ERP em ${esc(m.label)}: confira as contas no Fluxo de caixa DFC.</p>`;
  return {m,andamento,operacao:bloco('fco'),outros:bloco('fci')+bloco('fcf')+lin('geracao','(=) Geração de caixa do mês',true),
    rodape:fecha+`<p class="hint">Mesma classificação da DRE Simples e do Fluxo de caixa: parcelamento do DAS, dívidas, retiradas, arrendamento e transferências entre as empresas são financiamento (o que sai em vermelho e o empréstimo recebido em azul, como na DRE); compra de máquina ou veículo e parcelas de ativos são investimento; DARF do PGDAS, ICMS/DIFAL das compras, manutenção das máquinas, juros e tarifas ficam na operação.</p><div class="actions"><button data-go="dfc">Ver contas de cada bloco no Fluxo de caixa DFC →</button></div>`};
}
// Último saldo do Fluxo de caixa (DFC), oferecido no planejamento: só entra no campo pelo botão Usar.
function saldoReferenciaPlano(){return typeof dfcSaldos==='function'?[...dfcSaldos().values()].filter(x=>x.final!=null).pop()||null:null;}
// O planejamento das 13 semanas é o mesmo no mês e no Ano (não depende do realizado).
function cardPlanejamento(ref=saldoReferenciaPlano()){return card('Planejar as próximas 13 semanas',`<p>Planejamento independente do realizado. Informe saldo e compromissos e use Salvar planejamento para compartilhar na nuvem. Nenhum lançamento é enviado ao Mubisys.</p><div class="form-grid"><div><label>Saldo inicial considerado (R$)<input id="planSaldo" type="number" step="0.01" placeholder="Informe o saldo" value="${esc(plano.saldo??'')}"></label>${ref?`<p class="hint" id="planSaldoRef">Fluxo de caixa: <b>${esc(money(ref.final))}</b> (${esc(ref.label)}${ref.parcial?', mês em andamento ou incompleto':''}, não conciliado) <button type="button" class="text-button" id="planUsarSaldo">Usar</button></p>`:''}</div><label>Reserva mínima (R$)<input id="planReserva" type="number" step="0.01" min="0" value="${esc(plano.reserva)}"></label><label>Início da projeção<input id="planData" type="date" value="${esc(plano.inicio)}"></label><label>Cenário de recebimento<select id="planCenario"><option value="1">100% dos recebimentos previstos</option><option value="0.8">80% dos recebimentos previstos</option><option value="0.6">60% dos recebimentos previstos</option></select></label></div><div class="actions"><button id="planCarteira">Trazer da carteira do Mubisys</button><button id="planAdicionar">+ Compromisso previsto</button><button id="planCalcular" class="primary">Calcular cenário</button><button id="planSalvar" ${state.permissoes.admin?'':'disabled'}>Salvar planejamento</button><span id="planEstado" role="status">${plano.atualizadoEm?'Salvo: '+esc(dataBR(plano.atualizadoEm)):'Rascunho não salvo'}</span></div><div id="planMovimentos"></div><div id="planResultado"></div><p class="hint">Valores vencidos não resolvidos são considerados no início da projeção. O cenário reduz os recebimentos previstos; não altera saídas. Revise as premissas. "Trazer da carteira" soma, semana a semana, o que vence a receber e a pagar no Mubisys (carga do Painel) e as despesas previstas (fixas, cartão, folha); a pagar vencido entra na 1ª semana, a receber vencido fica de fora por prudência; trazer de novo troca só essas linhas.</p>`,plano.saldo!==''&&plano.saldo!=null,'secao-caixa-plano');}
function renderCaixa(reg){if(telaNoAno())return renderCaixaAno(reg);let h=contextoMovimento(reg);const b=caixaEmBlocos(reg),ref=saldoReferenciaPlano();
  if(reg)h+=`<div class="cash-context"><span>Recebimentos de vendas: <b class="${b?tomDoValor('operacionais',b.m.d.valores.vendas):''}">${money(b?b.m.d.valores.vendas:null)}</b></span><span><button type="button" class="text-button" data-go="dfc">Saldo no fim do mês (Fluxo de caixa)</button>: <b>${saldoFimDoMes(reg)}</b></span><details><summary>Critérios</summary><p>Recebimentos de vendas: pagamentos recebidos de clientes (contas 1.1, 1.2, 1.5 e 1.6). Saldo no fim do mês: o saldo inicial informado em Parâmetros mais a geração de caixa, como no Fluxo de caixa DFC; * marca o mês em andamento ou incompleto. Não substitui a conciliação bancária. A variação do período aparece no resumo acima e considera o movimento da base salva.</p></details></div>`+(b?`<div class="split">${card('Operação · '+reg.label+b.andamento,b.operacao,false)}${card('Investimento e financiamento · '+reg.label+b.andamento,b.outros,false)}</div>${b.rodape}`:`<p class="empty">Operação, investimento e financiamento: não apurados em ${esc(reg.label)}: o mês não tem contas válidas para a classificação.</p>`);
  else h+='<div class="empty"><h2>Este mês ainda não foi coletado.</h2><p>Abra um mês do histórico ou confira a integração.</p></div>';
  h+=cardPlanejamento(ref);
  h+=card('Planilha de caixa · evolução mensal e acumulado',historicoTabela(),false);
  return h;
}
function historicoTabela(){const year=state.periodo.split('/')[1];const recs=state.records.filter(r=>r.label.endsWith('/'+year));if(!recs.length)return '<p>Sem histórico neste ano.</p>';
 /* ACUMULADO DE JANEIRO ATÉ O MÊS ESCOLHIDO — a mesma régua do DRE mensal. Somava
    o ano inteiro (inclusive meses DEPOIS do escolhido) e passava por cima de mês
    sem dado: com fevereiro faltando, Jan + Mar virava "acumulado". Mês sem dado
    nunca vira zero; aqui ele suspende o total e diz qual falta. */
 const ateMes=PT_MON.indexOf(state.periodo.split('/')[0]);
 const esperados=PT_MON.slice(0,ateMes+1).map(m=>m+'/'+year);
 const doPeriodo=esperados.map(l=>recs.find(r=>r.label===l)||null);
 const faltam=esperados.filter((l,i)=>!doPeriodo[i]);
 const escopos=new Set(doPeriodo.filter(Boolean).map(r=>[r.company,r.basis,r.qualidade?.escopo,r.qualidade?.regra].join('|')));
 const bloqueio=faltam.length?`Sem acumulado: falta ${faltam.join(', ')}`:escopos.size>1?'Sem acumulado: empresas ou critérios diferentes no período':'';
 const total=bloqueio?null:(()=>{let e=0,s=0;for(const x of doPeriodo){const r=F.resumo(x);e+=Math.round(r.entradas*100);s+=Math.round(r.saidas*100);}return {e:e/100,s:s/100};})();
 return `<div class="table-scroll"><table><thead><tr><th scope="col">Mês</th><th scope="col">Cobertura</th><th scope="col" class="num">Entradas</th><th scope="col" class="num">Saídas</th><th scope="col" class="num">Variação</th></tr></thead><tbody>${recs.map(x=>{const r=F.resumo(x);return `<tr><td>${esc(x.label)}</td><td>${esc(F.qualidade(x).rotulo)}</td><td class="num ${tomDoValor('entradas',r.entradas)}">${money(r.entradas)}</td><td class="num ${tomDoValor('saidas',r.saidas)}">${money(r.saidas)}</td><td class="num ${tomDoValor('variacao',r.variacao)}">${money(r.variacao)}</td></tr>`;}).join('')}<tr class="total"><td>Acumulado ${esc(esperados[0].split('/')[0])}–${esc(state.periodo)}</td><td>${bloqueio?esc(bloqueio):'Inclui períodos a conferir'}</td><td class="num ${total?tomDoValor('entradas',total.e):''}">${total?money(total.e):'—'}</td><td class="num ${total?tomDoValor('saidas',total.s):''}">${total?money(total.s):'—'}</td><td class="num ${total?tomDoValor('variacao',total.e-total.s):''}">${total?money(Math.round((total.e-total.s)*100)/100):'—'}</td></tr></tbody></table></div><p class="hint">A soma do histórico não é saldo bancário. Meses parciais são identificados e não recebem conclusões automáticas de desempenho.</p>`;
}
const normalizarBusca=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
function filtrarContas(reg){return (reg?.cells||[]).filter(c=>(state.tipo==='todos'||c.code===state.tipo||c.code.startsWith(state.tipo+'.'))&&(state.grupo==='todos'||c.code===state.grupo||c.code.startsWith(state.grupo+'.'))&&(!state.consulta||normalizarBusca(c.name+' '+c.code).includes(normalizarBusca(state.consulta))));}
function cardCompetenciaResultado(){return card('Resultado por competência',`<div class="actions"><button data-go="dre">Abrir a DRE de caixa e de competência →</button></div><div class="note"><h3>Consulte a apuração na DRE</h3><p>Esta base contém recebimentos e pagamentos. A apuração por competência está na DRE, com preenchimento revisado de receitas, custos, despesas, depreciação e tributos.</p></div><p>A leitura gerencial de caixa continua disponível abaixo, com critérios e origem explícitos.</p>`,false);}
function renderResultado(reg){if(telaNoAno())return renderResultadoAno(reg);const b=caixaEmBlocos(reg);return resumoMovimento(reg)+graficoPonte(reg)+cardCompetenciaResultado()+card('Demonstrativo gerencial de caixa',reg?`<p>${esc(reg.label)} · ${esc(F.qualidade(reg).rotulo)} · ${esc(reg.origem==='erp'?'Impresilk + Universo':reg.company||'Empresa não informada')}${b?esc(b.andamento):''}</p>${b?b.operacao+b.outros+b.rodape:`<p class="empty">Operação, investimento e financiamento: não apurados em ${esc(reg.label)}: o mês não tem contas válidas para a classificação.</p>`}<p class="hint">Não comprova conciliação com extrato nem lucro contábil.</p><div class="actions"><button id="printReport">Imprimir / salvar PDF</button><button data-go="detalhe">Ver contas</button></div>`:'<p>Selecione um período com dados.</p>');}
function renderDetalhe(reg){if(!reg)return '<div class="empty">Este mês não tem dados. Escolha um período do histórico.</div>';const cells=reg.cells||[],groups=cells.filter(c=>c.code.split('.').length===2);const filtered=filtrarContas(reg);const pag=Math.min(state.contasPagina||0,Math.max(0,Math.ceil(filtered.length/50)-1));const cmp=state.records.find(r=>r.label===state.comparar),comp=F.comparacao(reg,cmp);const sameMap=(reg.origem||'planilha')===(cmp?.origem||'planilha');
 return card('Contas, produtos e centros',`<div class="filterbar"><input id="searchAccounts" aria-label="Buscar conta ou produto" placeholder="Buscar conta, produto, energia, frota…" value="${esc(state.consulta)}"><select id="accountType" aria-label="Tipo de movimento"><option value="todos">Entradas e saídas</option><option value="1">Entradas</option><option value="2">Saídas</option></select><select id="accountGroup" aria-label="Categoria"><option value="todos">Todas as categorias</option>${groups.map(c=>`<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select></div><p class="hint">${filtered.length} contas. Totais e subcontas são níveis da mesma árvore; não devem ser somados entre si.</p><div class="table-scroll"><table><thead><tr><th scope="col">Conta / produto</th><th scope="col" class="num">${esc(reg.label)}</th><th scope="col" class="num">${esc(state.comparar||'Comparação')}</th><th scope="col" class="num">Variação</th></tr></thead><tbody>${filtered.slice(pag*50,pag*50+50).map(c=>{const old=cmp?.cells?.find(x=>x.code===c.code),ok=comp.permitida&&!!old&&c.value!=null&&old.value!=null&&(sameMap||c.code.split('.').length<=2)&&old.name===c.name;return `<tr><td style="padding-left:${12+Math.min(c.code.split('.').length-1,5)*12}px"><button data-account="${esc(c.code)}">${esc(c.name)}</button><small> ${esc(c.code)}</small></td><td class="num">${botaoConta(c.code,money(c.value))}</td><td class="num">${ok?money(old.value):'—'}</td><td class="num">${ok?money(c.value-old.value):'—'}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">${!state.comparar?'Escolha “Comparar com” no topo para ver a variação conta a conta.':comp.permitida?`Diferenças calculadas contra ${esc(state.comparar)}.${comp.ressalva?' A cobertura da coleta ainda não foi validada nos dois meses: o cálculo está feito, falta conferir se a base está completa antes de decidir.':''}${sameMap?' Conta renomeada ou ausente no outro mês fica em <b>—</b>.':` Os dois meses vieram de bases diferentes: abaixo do segundo nível as contas não se comparam e ficam em <b>—</b>.`}`:esc(comp.motivo||'')} Nomes são os de cada mês, preservados no histórico.</p><div class="actions"><button id="exportAccounts">Baixar seleção em CSV</button><button data-contas-pagina="${pag-1}" ${pag===0?'disabled':''}>Anterior</button><span>Página ${pag+1} / ${Math.max(1,Math.ceil(filtered.length/50))}</span><button data-contas-pagina="${pag+1}" ${(pag+1)*50>=filtered.length?'disabled':''}>Próxima</button></div>`)+card('Totais sem detalhamento',F.residuos(reg).length?F.residuos(reg).map(x=>linha(x.name+' · '+x.code,x.value)).join('')+'<p class="hint">Pode haver lançamento direto na conta-pai. Conferir antes de distribuir qualquer valor.</p>':'<p>Os totais com filhos fecham com o detalhamento disponível.</p>',false);
}
// Edições guardadas no aparelho e períodos repetidos: iguais no mês e no Ano.
function conferenciaRodape(dup){let h='';
 if(localStorage.getItem('impresilk_dre_queue')&&!['[]','null'].includes(localStorage.getItem('impresilk_dre_queue')))h+=card('Edições da versão anterior',`<p>Este aparelho conserva uma fila da versão anterior. Ela não será enviada automaticamente.</p><button id="legacyBackup">Baixar para revisão</button>`);
 if(getQueue().length)h+=card('Edições preservadas no aparelho',getQueue().map(it=>`<div class="line"><span>${esc(it.registro.label)} · ${it.conflito?'Conflito com a nuvem':esc(it.erro||'Aguardando envio')}</span><button data-conflict="${esc(it.opId)}">Revisar</button></div>`).join(''));
 if(dup.length)h+=card('Períodos com mais de um registro',`<p>${dup.length} registro(s) representam períodos repetidos. Foram preservados. A exclusão exige revisão da origem e do conteúdo.</p>`);
 return h;
}
function renderConferencia(reg,q){if(telaNoAno())return renderConferenciaAno(reg,q);const p=reg?.pendencias||[],dup=dedupePeriods(state.records).dropped;let h=faixaCobertura()+card('Saúde da informação',`<div class="fatos">${fato('Cobertura do período',q.rotulo)}${fato('Última coleta ou registro',dataBR(q.coletadoEm))}${fato('Conciliação bancária',reg?.qualidade?.conciliado?'Registrada':'Não comprovada')}${fato('Edições locais pendentes',String(getQueue().length))}</div>`+`<p class="hint">O botão “Atualizar Mubisys” solicita a coleta do mês atual e do anterior. Acompanhe a execução no aviso acima. “Ler base salva”, em Sistemas e configurações, apenas relê a nuvem.</p>`);
// Fechamento do mês escolhido (Fase 11.4, fechamento.js).
 h+=typeof renderFechamento==='function'?renderFechamento():'';
 h+=typeof painelPendencias==='function'?painelPendencias(reg):'';
 // Auditoria completa de todos os meses (Fase 10.2, auditoria.js).
 h+=typeof renderAuditoria==='function'?renderAuditoria():'';
 h+=card('Movimentos na origem',reg?.eventos?.length?`<p>${reg.eventos.length} movimentos com empresa, título, pagamento e conta de origem.</p><button id="originEvents">Consultar movimentos</button>`:'<p>A trilha por pagamento estará disponível após uma nova coleta. O histórico atual conserva os totais e as contas.</p>',false);
 h+=card('Conferir com o Mubisys',`<p>Consulta de leitura. Compara o período com o retrato de origem guardado na coleta. Não transforma diferenças em ajustes.</p><div class="actions"><button id="auditMubi" ${!reg?'disabled':''}>Consultar período</button></div><div id="auditResult"></div><p class="hint">Históricos sem retrato de origem recebem somente confronto dos totais, sem comparar códigos antigos com novos.</p>`);
 h+=conferenciaRodape(dup);
 return h;
}
/* ---------- Telas no Ano (Dashboard, Caixa, Composição do caixa, Conferência) ----------
   De janeiro ao último mês com dados (fimDoAno), com o mês em andamento marcado por *. Somas pelo
   registro do ano (registroDoAno) e pelos blocos da DFC (dfcBlocosAno); comparação só nos meses
   completos dos dois anos (comparacaoDoAno). Mês faltando nunca vira zero: a tela diz qual falta. */
const mesesAteFimDoAno=ano=>{const ate=PT_MON.indexOf(String(fimDoAno(ano)).split('/')[0]);return PT_MON.slice(0,Math.max(0,ate)+1).map(m=>m+'/'+ano);};
const mesCompleto=(r,l)=>{const per=F.periodo(l),hoje=typeof dfcHoje==='function'?dfcHoje():new Date().toISOString().slice(0,10);return !!r&&!!per&&per.ate<hoje&&!F.qualidade(r).parcial;};
// Δ do Ano: seta, cor pela direção (tomDelta) e valor sem sinal; sem número, "—".
const deltaAnoCelula=(d,dir)=>d==null||!Number.isFinite(Number(d))?'<td class="num">—</td>':`<td class="num ${tomDelta(dir,d)||'delta-neutro'}">${d>0?'▲':d<0?'▼':'■'} ${esc(money(Math.abs(d)))}</td>`;
function renderInicioAno(reg,q){
 const ano=anoDaTela(),meses=mesesAteFimDoAno(ano),regs=meses.map(regDoMes),fim=fimDoAno(ano),ra=registroDoAno(ano);
 const latest=[...state.records].sort((a,b)=>monthSortKey(b.label)-monthSortKey(a.label))[0];
 let h=!regs.some(Boolean)?`<div class="month-empty"><div><b>${esc(ano)} ainda não tem dados.</b><span>O histórico abaixo continua disponível para consulta.</span></div>${latest?`<button data-period="${esc(latest.label)}">Abrir ${esc(latest.label)} →</button>`:''}</div>`:'';
 h+=resumoMovimento(reg)+comparativoMovimento(reg);
 h+=`<div class="dashboard-grid">${typeof evolucaoCompacta==='function'?evolucaoCompacta():graficoEvolucao()}${painelGrafico('Para onde foi o dinheiro',`${rotuloAno(ano)} · principais grupos de saídas`,ra.disponivel?rankingCustos(ra.reg):`<p class="empty">${esc(ra.motivo)}</p>`,'<button data-go="custos" class="text-button">Ver todas →</button>',['Caixa','Valores em R$'])}</div>`;
 h+=acoesDashboard(reg)+card('Variações e orçamento',resumoGestao(reg),false);
 const completos=regs.filter((r,i)=>mesCompleto(r,meses[i])).length,pend=regs.reduce((n,r)=>n+(r?.pendencias||[]).length,0);
 h+=card('Conferência e próximos passos',`<div class="review-grid"><div><span class="label">Cobertura da base</span><b>${completos} de ${meses.length} ${meses.length===1?'mês coletado':'meses coletados'} até o último dia</b></div><div><span class="label">Pendências a conferir</span><b><button type="button" class="text-button" data-go="conferencia" aria-label="${pend} pendência(s) a conferir em ${esc(ano)}: abrir a Conferência">${pend}</button></b></div><div><span class="label"><button type="button" class="text-button" data-go="dfc">Saldo no fim de ${esc(fim)} (Fluxo de caixa)</button></span><b>${saldoFimDoMes(regDoMes(fim))}</b></div></div><div class="actions"><button data-go="conferencia">Conferir dados →</button><button data-go="caixa">Planejar o caixa →</button></div>`,false);
 h+=(typeof renderComparativos==='function'?card('Comparativos entre anos',renderComparativos(),false):'');
 return h;
}
// Blocos do caixa no Ano contra o ano comparado, nos mesmos meses completos (dfcComparacaoAno).
function caixaComparacaoAno(ano){
 const c=comparacaoDoAno(ano),titulo=c.anoComp!=null?`Blocos do caixa · ${ano} contra ${c.anoComp}`:`Blocos do caixa · ${ano}`;
 const x=!c.motivo&&typeof dfcComparacaoAno==='function'?dfcComparacaoAno(ano,c.anoComp,c.indices):null;
 if(!x?.linhas)return card(titulo,`<p class="hint">${esc(c.motivo||'A comparação dos blocos do caixa não está disponível nesta versão.')}</p>`);
 const dir=typeof DFC_DIR_ANO!=='undefined'?DFC_DIR_ANO:{},tom=(id,v)=>typeof dfcTomLinha==='function'?dfcTomLinha(id,v):tomDoValor('variacao',v);
 const linhas=[['fco','Caixa da operação (FCO)'],['fci','Investimentos (FCI)'],['fcf','Financiamentos (FCF)'],['geracao','(=) Geração de caixa']];
 const corpo=linhas.map(([id,nome])=>{const l=x.linhas[id]||{};return `<tr${id==='geracao'?' class="total"':''}><th scope="row">${esc(nome)}</th><td class="${['num',l.atual==null?'':tom(id,l.atual)].filter(Boolean).join(' ')}">${esc(money(l.atual))}</td><td class="${['num',l.anterior==null?'':tom(id,l.anterior)].filter(Boolean).join(' ')}">${esc(money(l.anterior))}</td>${deltaAnoCelula(l.delta,dir[id]??0)}</tr>`;}).join('');
 return card(titulo,`<div class="table-scroll"><table class="tabela-controle tabela-ano"><thead><tr><th scope="col">Bloco</th><th scope="col" class="num">${esc(ano)} · ${esc(c.meses)}</th><th scope="col" class="num">${esc(c.anoComp)} · ${esc(c.meses)}</th><th scope="col" class="num">Δ</th></tr></thead><tbody>${corpo}</tbody></table></div><p class="hint">Só os meses completos nos dois anos, da mesma base e com plano de contas${c.ressalva?'; cobertura a conferir em algum mês':''}. Mude o ano em “Comparar com”, no topo.</p>`);
}
const blocosDoAno=ano=>typeof dfcBlocosAno==='function'?dfcBlocosAno(ano):null;
const blocosNaoApurados=(ano,b)=>`<p class="empty">Operação, investimento e financiamento: não apurados em ${esc(ano)}: ${esc(b?.motivo||'o ano não tem contas válidas para a classificação.')}</p>`;
function renderCaixaAno(reg){
 const ano=anoDaTela(),fim=fimDoAno(ano),rot=rotuloAno(ano),ref=saldoReferenciaPlano(),b=blocosDoAno(ano);
 let vendas=null;
 if(typeof dfcMes==='function'&&typeof dfcAcumulado==='function'&&typeof dfcSaldos==='function'){const ms=PT_MON.map(m=>dfcMes(m+'/'+ano)),todos=dfcSaldos(),saldos=ms.map(m=>todos.get(monthSortKey(m.label))||null);vendas=dfcAcumulado(ms,saldos,PT_MON.indexOf(String(fim).split('/')[0]),'vendas');}
 let h=contextoMovimento(reg);
 h+=`<div class="cash-context"><span>Recebimentos de vendas · ${esc(rot)}: <b class="${tomDoValor('operacionais',vendas)}">${money(vendas)}</b></span><span><button type="button" class="text-button" data-go="dfc">Saldo no fim de ${esc(fim)} (Fluxo de caixa)</button>: <b>${saldoFimDoMes(regDoMes(fim))}</b></span><details><summary>Critérios</summary><p>Recebimentos de vendas: pagamentos recebidos de clientes (contas 1.1, 1.2, 1.5 e 1.6), somados de janeiro ao último mês com dados. Saldo no fim do ano: o saldo inicial informado em Parâmetros mais a geração de caixa, como no Fluxo de caixa DFC; * marca o mês em andamento ou incompleto. Não substitui a conciliação bancária. A variação do período aparece no resumo acima e considera o movimento da base salva.</p></details></div>`;
 h+=b?.operacao?`<div class="split">${card('Operação · '+rot,b.operacao,false)}${card('Investimento e financiamento · '+rot,b.outros,false)}</div>${b.rodape||''}`:blocosNaoApurados(ano,b);
 h+=caixaComparacaoAno(ano);
 h+=cardPlanejamento(ref);
 h+=card('Planilha de caixa · evolução mensal e acumulado',historicoTabela(),false);
 return h;
}
function renderResultadoAno(reg){
 const ano=anoDaTela(),rot=rotuloAno(ano),ra=registroDoAno(ano),b=blocosDoAno(ano),base=ra.reg||regDoMes(fimDoAno(ano));
 const ponte=ra.disponivel?graficoPonte(ra.reg):painelGrafico('Do recebimento à variação do caixa',rot,`<p class="empty">${esc(ra.motivo)}</p>`);
 const empresa=base?.origem==='erp'?'Impresilk + Universo':base?.company||'Empresa não informada';
 return resumoMovimento(reg)+comparativoMovimento(reg)+ponte+cardCompetenciaResultado()+card('Demonstrativo gerencial de caixa',`<p>${esc(rot)} · ${esc(ra.disponivel?F.qualidade(ra.reg).rotulo:'Ano não somado')} · ${esc(empresa)}</p>${b?.operacao?b.operacao+b.outros+(b.rodape||''):blocosNaoApurados(ano,b)}<p class="hint">Não comprova conciliação com extrato nem lucro contábil.</p><div class="actions"><button id="printReport">Imprimir / salvar PDF</button><button data-go="detalhe">Ver contas</button></div>`);
}
function renderConferenciaAno(reg,q){
 const ano=anoDaTela(),meses=mesesAteFimDoAno(ano),dup=dedupePeriods(state.records).dropped;
 const linhas=meses.map(l=>{const r=regDoMes(l),qq=F.qualidade(r);return `<tr><th scope="row"><button type="button" class="text-button" data-period="${esc(l)}" aria-label="Abrir ${esc(l)}${qq.parcial?' (mês em andamento ou incompleto)':''}">${esc(l)}${qq.parcial?' *':''}</button></th><td>${esc(r?qq.rotulo:'Sem dados')}</td><td>${esc(r?dataBR(qq.coletadoEm):'—')}</td><td>${r?(r.qualidade?.conciliado?'Registrada':'Não comprovada'):'—'}</td><td class="num">${r?(r.pendencias||[]).length:'—'}</td></tr>`;}).join('');
 let h=faixaCobertura()+card(`Saúde da informação · ${ano}`,`<div class="table-scroll"><table class="tabela-controle tabela-ano"><thead><tr><th scope="col">Mês</th><th scope="col">Cobertura</th><th scope="col">Última coleta</th><th scope="col">Conciliação bancária</th><th scope="col" class="num">Pendências a conferir</th></tr></thead><tbody>${linhas}</tbody></table></div><div class="fatos">${fato('Edições locais pendentes',String(getQueue().length))}</div><p class="hint">* mês em andamento ou incompleto. O botão “Atualizar Mubisys” solicita a coleta do mês atual e do anterior. Acompanhe a execução no aviso acima. “Ler base salva”, em Sistemas e configurações, apenas relê a nuvem.</p>`);
 h+=typeof renderFechamento==='function'?renderFechamento():'';
 h+=typeof painelPendencias==='function'?painelPendencias(reg):'';
 h+=typeof renderAuditoria==='function'?renderAuditoria():'';
 h+=card('Movimentos e conferência com o Mubisys','<p>São por mês: escolha um mês na barra para consultar os movimentos e conferir com o Mubisys.</p>');
 h+=conferenciaRodape(dup);
 return h;
}
function renderConfig(){return card('Integração e atualização',`<p>O coletor revisa o mês atual e o anterior, conserva o histórico de planilha e rejeita gravações com totais inconsistentes.</p><div class="actions"><a href="https://github.com/leogpereira-afk/impresilk-dre/actions/workflows/erp-previa.yml" target="_blank" rel="noopener">Ver execuções no GitHub ↗</a><button id="cloudReadBtn">Ler base salva</button></div><p class="hint">Após a ativação, o servidor revisa os meses às 06h, 12h e 18h (Brasília) e verifica os pedidos do botão a cada 10 minutos. O GitHub pode atrasar esses horários. O acompanhamento acima mostra se a rotina está ativa e quando terminou.</p>`)+card('Importação e recuperação',`<p>Antes de alterar um mês, confira a prévia. Restaurar um backup exige escolher os períodos e confirmar o envio.</p><div class="actions"><button id="backupBtn">💾 Baixar backup do DRE</button><button id="addMonthBtn" ${state.permissoes.edicao?'':'disabled'}>📥 Importar mês</button><button id="restoreBtn" ${state.permissoes.edicao?'':'disabled'}>📂 Revisar backup</button></div><p class="hint">O backup contém meses, metadados, regras de classificação e configurações não secretas. Credenciais não são exportadas.</p>`)+card('Acesso e regras',`<p>Seu acesso permite: ${state.permissoes.admin?'administração e edição':state.permissoes.edicao?'leitura e edição':'leitura'}. As permissões são conferidas no servidor.</p><a href="https://leogpereira-afk.github.io/painel-impresilk/acessos" target="_blank" rel="noopener">Abrir Sistemas e configurações da central ↗</a><p class="hint">A troca de senha permanece na central de acesso. Regras contratuais de arrendamento, dívidas e custos devem ser validadas antes de reclassificação.</p>`,false);}
// Ajuda: primeiro onde está cada resposta, com os nomes do menu e um botão para cada tela;
// depois os conceitos para ler os números.
function renderAjuda(){
 const ir=(v,n)=>`<button type="button" class="text-button" data-go="${v}">${esc(n)}</button>`;
 const mapa=[
  ['O que aconteceu no mês, o que falta conferir e onde agir',[['inicio','Dashboard'],['cfo','Análise CFO']]],
  ['Entradas, saídas e o planejamento das próximas 13 semanas',[['inicio','Dashboard'],['caixa','Caixa e planejamento']]],
  ['Despesas por mês e por categoria, como energia e água (também pelo “Ver todas →” do Dashboard)',[['custos','Despesas e categorias']]],
  ['Contas, produtos, serviços, pessoal, materiais, máquinas e frota, mês a mês',[['detalhe','Plano de contas']]],
  ['Demonstrativos: resultado, fluxo de caixa e patrimônio',[['dre','DRE'],['dfc','Fluxo de caixa DFC'],['balanco','Balanço gerencial']]],
  ['Prazos, carteira a receber e preço',[['giro','Capital de giro'],['recebiveis','Recebíveis e aging'],['precos','Preço e equilíbrio']]],
  ['Receita, custos, margem por O.S. e rentabilidade, com a origem de cada número',[['indicadores','Indicadores']]],
  ['Simples Nacional, prazos, estoque, saldos e metas que alimentam os controles',[['parametros','Parâmetros']]],
  ['Cobertura, pendências a conferir e fechamento do mês',[['conferencia','Conferência']]],
  ['Definições, fórmulas e exemplos',[['glossario','Glossário']]],
  ['Backup, importação e acesso',[['config','Sistemas e configurações']]],
 ].map(([o,ts])=>`<div class="line"><span>${esc(o)}</span><span>${ts.map(([v,n])=>ir(v,n)).join(' · ')}</span></div>`).join('');
 return card('Onde está cada resposta',mapa,true)+[
 ['Caixa realizado','É o movimento efetivo de recebimentos e pagamentos. Este painel ainda filtra “compõe DRE”; por isso os totais não são uma conciliação bancária completa.'],
 ['Resultado por competência','Relaciona receitas reconhecidas com custos e despesas do período econômico. Receber uma venda antiga aumenta o caixa de hoje, mas não cria uma nova venda.'],
 ['Variação e saldo disponível','Variação é entradas menos saídas. Saldo final exige saldo inicial conciliado e todos os movimentos das contas consideradas. Somar variações históricas não prova uma reserva disponível.'],
 ['Sócios, arrendamento e dívidas','Os grupos históricos continuam separados. A classificação gerencial não substitui a revisão de contratos, natureza de retiradas, principal e juros.'],
 ['Comparação e margem','Meses incompletos e códigos que mudaram de significado não recebem comparação automática. Margem consolidada deve dividir resultado total pela receita total comparável.'],
 ['Ponto de equilíbrio e rentabilidade','Exigem custos e receitas correspondentes e classificação validada entre fixos e variáveis. Pagamentos de materiais não comprovam o custo consumido em cada O.S.'],
 ['Rotina de conferência','Verifique data da coleta, cobertura, pagamentos, valores sem categoria e diferenças. Corrija a origem com revisão humana; depois confira a nova coleta antes de fechar o mês.']
 ].map(([a,b])=>card(a,`<p>${b}</p>`,false)).join('');
}
let plano={saldo:'',reserva:0,inicio:new Date().toLocaleDateString('sv-SE'),cenario:1,movimentos:[]};
/* Fase 11.3: a carteira do Mubisys (carga do Painel, lida pelo servidor do capital de
   giro) vira movimentos do planejamento, uma linha por semana e lado. Linhas da
   carteira têm origem 'carteira' e são trocadas a cada importação; as digitadas ficam.
   Saldo inicial: o último saldo do Fluxo de caixa, só se o campo estiver vazio. */
const dataBRCurta=d=>String(d||'').split('-').reverse().slice(0,2).join('/');
const somaDias=(iso,n)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
function planoDaCarteira(sem,saldos){
 const movs=[],add=(data,tipo,valor,descricao)=>{if(valor>0)movs.push({id:'carteira:'+tipo+':'+data+':'+movs.length,origem:'carteira',descricao,data,tipo,valor});};
 add(sem.inicio,'saida',Math.round((sem.vencidos.pagar+sem.vencidos.previstas)*100)/100,'Carteira · a pagar vencido');
 for(const w of sem.semanas){const per=`semana ${w.semana} (${dataBRCurta(w.de)} a ${dataBRCurta(w.ate)})`,inc=x=>x?'':' · carga incompleta';
  add(w.de,'entrada',w.receber,`Carteira · a receber ${per}${inc(w.completa.receber)}`);
  add(w.de,'saida',w.pagar,`Carteira · a pagar ${per}${inc(w.completa.pagar)}`);
  add(w.de,'saida',w.previstas,`Carteira · despesas previstas ${per}`);}
 const ult=saldos?[...saldos.values()].filter(x=>x.final!=null).pop():null;
 return {movs,saldo:ult?{valor:ult.final,label:ult.label,parcial:!!ult.parcial}:null,incompletas:sem.semanas.filter(w=>!w.completa.receber||!w.completa.pagar).map(w=>w.semana)};
}
function aplicarCarteira(){
 const d=typeof giroUI!=='undefined'?giroUI.dados:null,sem=d?.semanas;
 if(!sem){
  // Ainda não lida (ou servidor anterior a esta fase): lê e completa sozinho quando chegar.
  if(d&&!giroUI.busy){toast('O servidor ainda não tem a carteira semana a semana: ela é publicada sozinha pelo Painel. Tente mais tarde.','err');return;}
  if(typeof carregarGiro!=='function')return;
  if(!giroUI.busy)carregarGiro(true);toast('Lendo a carteira do Mubisys…');
  const inicio=Date.now(),olhar=()=>{if(giroUI.busy){if(Date.now()-inicio<90000)setTimeout(olhar,1000);return;}if(giroUI.dados?.semanas)aplicarCarteira();else toast(giroUI.erro||'A carteira não veio do servidor.','err');};
  setTimeout(olhar,1000);return;
 }
 if(!sem.disponivel){toast(sem.avisos?.[0]||'A carteira não está disponível agora.','err');return;}
 const r=planoDaCarteira(sem,typeof dfcSaldos==='function'?dfcSaldos():null);
 plano.movimentos=[...plano.movimentos.filter(m=>m.origem!=='carteira'),...r.movs];plano.inicio=sem.inicio;plano.carteira={em:new Date().toISOString(),incompletas:r.incompletas,avisos:sem.avisos||[]};
 if((plano.saldo===''||plano.saldo==null)&&r.saldo){plano.saldo=r.saldo.valor;plano.carteira.saldo=r.saldo;}
 planoSujo=true;if($$('planEstado'))$$('planEstado').textContent='Alterações não salvas';
 for(const [id,k] of [['planSaldo','saldo'],['planData','inicio']])if($$(id))$$(id).value=plano[k];
 mostrarPlano();toast(`Carteira trazida: ${r.movs.length} linha(s) em ${sem.semanas.length} semanas.`);
}
function wireContent(){

  coletaControle?.show();
  wireGraficos();
  wireDRE();wireGlossario();wireCFO();
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{if(b.dataset.indArea)window.DREIndicadores?.area?.(b.dataset.indArea,b.dataset.indFonte);state.view=b.dataset.go;render();});
  document.querySelectorAll('[data-account]').forEach(b=>b.onclick=()=>abrirConta(b.dataset.account));
  document.querySelectorAll('[data-conflict]').forEach(b=>b.onclick=()=>revisarConflito(b.dataset.conflict));
  const on=(id,fn)=>{if($$(id))$$(id).onclick=fn;};
  on('legacyBackup',()=>download('dre-fila-anterior.json',localStorage.getItem('impresilk_dre_queue')));on('printReport',()=>exportarCFO({tipo:'executivo',periodo:state.periodo,...(telaNoAno()?{ano:true}:{})},$$('printReport')));on('backupBtn',exportarBackup);on('addMonthBtn',()=>$$('monthFileInput').click());on('restoreBtn',()=>$$('restoreInput').click());on('auditMubi',conferirMubi);on('cloudReadBtn',()=>pullCloud(true));on('originEvents',()=>mostrarEventos());
  if($$('searchAccounts')){$$('accountType').value=state.tipo;$$('accountGroup').value=state.grupo;$$('searchAccounts').oninput=e=>{state.contasPagina=0;state.consulta=e.target.value;const pos=e.target.selectionStart;render();$$('searchAccounts').focus();$$('searchAccounts').setSelectionRange(pos,pos);};$$('accountType').onchange=e=>{state.contasPagina=0;state.tipo=e.target.value;state.grupo='todos';render();};$$('accountGroup').onchange=e=>{state.contasPagina=0;state.grupo=e.target.value;render();};}
  on('ritmoMetas',formularioMetas);on('planCarteira',aplicarCarteira);
  on('planAdicionar',()=>{dialog('Compromisso previsto',`<form id="planForm"><label>Descrição<input name="descricao" required maxlength="120"></label><div class="form-grid"><label>Data<input name="data" type="date" value="${esc(plano.inicio)}" required></label><label>Movimento<select name="tipo"><option value="saida">Saída</option><option value="entrada">Entrada</option></select></label><label>Valor (R$)<input name="valor" type="number" min="0.01" step="0.01" required></label></div><button class="primary" type="submit">Adicionar à simulação</button></form>`);$$('planForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);plano.movimentos.push({id:crypto.randomUUID(),descricao:f.get('descricao'),data:f.get('data'),tipo:f.get('tipo'),valor:Number(f.get('valor'))});$$('detailDialog').close();mostrarPlano();};});
  if($$('planSaldo')){for(const [id,k] of [['planSaldo','saldo'],['planReserva','reserva'],['planData','inicio'],['planCenario','cenario']]){$$(id).value=plano[k];$$(id).oninput=e=>{plano[k]=e.target.value;};}on('planCalcular',mostrarPlano);mostrarPlano();}
  on('planUsarSaldo',()=>{const r=saldoReferenciaPlano();if(!r)return;plano.saldo=r.final;$$('planSaldo').value=r.final;planoSujo=true;if($$('planEstado'))$$('planEstado').textContent='Alterações não salvas';mostrarPlano();});
 if(typeof wireGestao==='function')wireGestao();
}
// Saldo no fim de cada semana (D22): semana com * (além da carga do Painel) fica sem ponto; a reserva informada vira linha de referência.
function graficoSaldoPlano(p){
 if(typeof gLinhaArea!=='function'||!p?.semanas?.length)return '';
 const data=/^\d{4}-\d{2}-\d{2}$/.test(String(plano.inicio||'')),inc=s=>!!plano.carteira?.incompletas?.includes(s.semana),reserva=Number(plano.reserva);
 const pontos=p.semanas.map(s=>({rotulo:(data?dataBRCurta(somaDias(plano.inicio,7*s.semana-1)):'S'+s.semana)+(inc(s)?' *':''),valor:inc(s)?null:s.saldo}));
 const vs=pontos.map(x=>x.valor).filter(v=>v!=null),cor=vs.every(v=>v>=0)?'entrada':vs.every(v=>v<0)?'saida':'resultado';
 const sel=pontos.reduce((m,x,i)=>x.valor!=null&&(m<0||x.valor<pontos[m].valor)?i:m,-1),ref=Number.isFinite(reserva)&&reserva>0?{valor:reserva,rotulo:'Reserva mínima'}:null;
 const nota=`Saldo no fim de cada semana, com os compromissos e o cenário escolhidos; o ponto marcado é a semana mais baixa.${ref?' Tracejado: a reserva mínima.':' Sem reserva mínima informada: a referência é o zero.'}${pontos.some(x=>x.valor==null)?' Semana com * fica fora do gráfico: a carga do Painel não chega até ela.':''}`;
 return `<section class="chart-card dre-grafico" id="planGrafico"><div class="chart-heading"><div><h3>Saldo projetado semana a semana</h3><p>${esc(nota)}</p></div></div>${gLinhaArea(pontos,{selecionado:sel,titulo:'Saldo projetado',rotulo:'Saldo projetado',eixo:'Fim da semana',cor,referencia:ref})}</section>`;
}
function mostrarPlano(){if(!$$('planMovimentos'))return;$$('planMovimentos').innerHTML=plano.movimentos.length?`<div class="table-scroll"><table><thead><tr><th scope="col">Compromisso</th><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col" class="num">Valor</th><th scope="col"></th></tr></thead><tbody>${plano.movimentos.map(m=>`<tr><td>${esc(m.descricao)}</td><td>${esc(String(m.data||'').split('-').reverse().join('/'))}</td><td>${m.tipo==='entrada'?'Entrada':'Saída'}</td><td class="num ${tomDoValor(m.tipo==='entrada'?'entradas':'saidas',Number(m.valor))}">${money(m.valor)}</td><td><button data-remove-plan="${m.id}" aria-label="Remover ${esc(m.descricao)}">✕</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">Nenhum compromisso adicionado. O cenário ficará limitado ao saldo informado.</p>';document.querySelectorAll('[data-remove-plan]').forEach(b=>b.onclick=()=>{plano.movimentos=plano.movimentos.filter(m=>m.id!==b.dataset.removePlan);planoSujo=true;if($$('planEstado'))$$('planEstado').textContent='Alterações não salvas';mostrarPlano();});
 try{const p=F.projecao({...plano,fatorRecebimento:Number(plano.cenario)});$$('planResultado').innerHTML=p.disponivel?`<div class="cards">${metric('Menor saldo projetado',p.minimo,'Cenário informado, não conciliado','',tomDoValor('variacao',p.minimo))}${metric('Saldo ao final',p.final,'Após 13 semanas','',tomDoValor('variacao',p.final))}${metric('Primeiro dia abaixo da reserva',p.primeiroAperto?p.primeiroAperto.split('-').reverse().join('/'):'Nenhum','Considerando apenas os compromissos informados')}</div>${graficoSaldoPlano(p)}<div class="table-scroll"><table><thead><tr><th scope="col">Semana</th><th scope="col" class="num">Entradas</th><th scope="col" class="num">Saídas</th><th scope="col" class="num">Saldo</th></tr></thead><tbody>${p.semanas.map(s=>`<tr><td>${s.semana}${/^\d{4}-\d{2}-\d{2}$/.test(String(plano.inicio||''))?` · ${dataBRCurta(somaDias(plano.inicio,7*(s.semana-1)))} a ${dataBRCurta(somaDias(plano.inicio,7*(s.semana-1)+6))}`:''}${plano.carteira?.incompletas?.includes(s.semana)?' *':''}</td><td class="num ${tomDoValor('entradas',s.entradas)}">${money(s.entradas)}</td><td class="num ${tomDoValor('saidas',s.saidas)}">${money(s.saidas)}</td><td class="num ${tomDoValor('variacao',s.saldo)}">${money(s.saldo)}</td></tr>`).join('')}</tbody></table></div>${plano.carteira?`<p class="hint">${plano.carteira.saldo?`Saldo inicial: o último do Fluxo de caixa (${esc(plano.carteira.saldo.label)}${plano.carteira.saldo.parcial?', mês em andamento':''}). `:''}${plano.carteira.incompletas?.length?`* Semana além do que a carga do Painel traz (a pagar até 60 dias, a receber até 90): os valores dela estão incompletos. `:''}${(plano.carteira.avisos||[]).map(esc).join(' ')}</p>`:''}`:'<p class="note">Informe o saldo inicial para calcular. A variação histórica não será usada como dinheiro disponível.</p>';}catch(e){$$('planResultado').textContent=e.message;}}
function abrirConta(code){cfoVoltas=[];abrirAnaliseConta(code,state.periodo);}
// voltar: quem abriu a trilha a partir de uma conta (Análise CFO) ganha o "← Voltar à conta".
function mostrarEventos(page=0,query='',reg=regAtual(),voltar=null){
 const events=(reg?.eventos||[]).filter(e=>[e.empresa,e.tituloId,e.contaOrigem,e.nomeConta,...(e.ordensServico||[])].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).sort((a,b)=>a.data.localeCompare(b.data));
 dialog('Movimentos na origem · '+reg.label,`<p>Pagamentos que compõem esta coleta. A conta abaixo é a original do Mubisys, antes da classificação gerencial. Um pagamento sem identificador próprio conserva sua posição na coleta.</p><input id="eventSearch" aria-label="Buscar movimento" placeholder="Empresa, título, conta ou O.S." value="${esc(query)}"><p>${events.length} movimentos · página ${page+1} de ${Math.max(1,Math.ceil(events.length/100))}</p><div class="table-scroll"><table><thead><tr><th scope="col">Data</th><th scope="col">Empresa / título</th><th scope="col">Conta / O.S.</th><th scope="col" class="num">Movimento</th></tr></thead><tbody>${events.slice(page*100,page*100+100).map(e=>`<tr><td>${esc(e.data.split('-').reverse().join('/'))}</td><td>${esc(e.empresa)}<br>Título ${esc(e.tituloId)} · Pagamento ${esc(e.pagamentoId??'não informado')}</td><td>${esc(e.contaOrigem+' '+e.nomeConta)}<br>${e.ordensServico?.length?'O.S. '+esc(e.ordensServico.join(', ')):''}</td><td class="num">${e.natureza==='entrada'?'Entrada':'Saída'}<br><span class="${tomDoValor(e.natureza==='entrada'?'entradas':'saidas',e.valor)}">${money(e.valor)}</span></td></tr>`).join('')}</tbody></table></div><div class="actions">${typeof voltar==='function'?'<button id="eventVoltar">← Voltar à conta</button>':''}<button id="eventPrev" ${page?'':'disabled'}>Anterior</button><button id="eventNext" ${(page+1)*100<events.length?'':'disabled'}>Próxima</button></div>`);
 $$('eventSearch').onchange=e=>mostrarEventos(0,e.target.value,reg,voltar);$$('eventPrev').onclick=()=>mostrarEventos(page-1,query,reg,voltar);$$('eventNext').onclick=()=>mostrarEventos(page+1,query,reg,voltar);if(typeof voltar==='function')$$('eventVoltar').onclick=voltar;
}
async function conferirMubi(){const reg=regAtual(),per=F.periodo(reg?.label);if(!per)return;const b=$$('auditMubi'),h=$$('auditResult');b.disabled=true;h.textContent='Consultando o período…';try{const r=await apiFn('financas','importarMes',{datainicial:per.de,datafinal:per.ate},150000);if(!r.ok||r.parcial)throw new Error(r.aviso||r.erro||'Coleta incompleta. Totais não serão comparados.');const salvo=reg.previaERP?.porCodigo;let html=linha('Despesas retornadas pela consulta',r.totais.despesa,false,'',tomDoValor('saidas',r.totais.despesa))+linha('Despesas salvas no mês',F.resumo(reg).saidas,false,'',tomDoValor('saidas',F.resumo(reg).saidas))+linha('Diferença bruta, ainda não conciliada',r.totais.despesa-F.resumo(reg).saidas,true);if(salvo){const contas=new Set([...Object.keys(salvo),...Object.keys(r.porCodigo||{})]);html+='<h3 style="margin-top:20px">Diferenças na origem (mesmos códigos do Mubisys)</h3>';let n=0;for(const c of contas){if(c!=='2'&&!c.startsWith('2.'))continue;const a=salvo[c]?.valor||0,v=r.porCodigo?.[c]?.valor||0;if(Math.abs(v-a)>=.009){html+=linha((r.porCodigo?.[c]?.nome||salvo[c]?.nome||c)+' · '+c,v-a);n++;}}if(!n)html+='<p>Nenhuma diferença no retrato das contas de despesa. Ainda falta a conciliação bancária.</p>';}else html+='<p class="note">Este histórico não guarda os códigos de origem. A comparação linha a linha está indisponível para evitar diferenças falsas entre códigos antigos e novos.</p>';html+='<p class="hint">Nenhum ajuste foi feito. Verifique cobertura, datas e natureza dos lançamentos antes de corrigir qualquer valor.</p>';h.innerHTML=html;}catch(e){h.textContent=e.message;}finally{b.disabled=false;}}
function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let coletaTimer=null;
const coletaControle=typeof DREColeta==='undefined'?null:DREColeta.controlador({
  api:action=>api(action),render:mostrarColeta,onConcluido:()=>pullCloud()
});
// A coleta mora num chip da régua de status. Só vira cartão quando há falha
// que pede ação: erro, execução interrompida, falha ao consultar/pedir, ou
// pedido de alguém parado. Rotina quieta NÃO é falha: o GitHub roda o
// agendamento a cada 3–5h na prática (execuções de 22 a 25/09/2026), e o
// alerta antigo de "1h sem sinal" ficava aceso quase sempre. Pelo mesmo
// motivo, pedido esperando 1–2h é normal: "parado" é quando a rotina já passou
// depois do pedido e não o pegou, ou quando passou do maior intervalo visto.
// Com o disparo imediato (acionadaEm), a rotina começa em 1–2 minutos: se
// passar de MINUTOS_ACIONADA_PARADA sem começar, aí é falha.
const HORAS_PEDIDO_PARADO=6,HORAS_ROTINA_SEM_SINAL=8,MINUTOS_ROTINA_PASSOU=15,MINUTOS_ACIONADA_PARADA=20;
// Troca o conteúdo só quando muda: a consulta de 30s refazia o chip e tirava
// o foco de quem navega por teclado.
function trocarColeta(bar,classe,html){
  if(bar.dataset&&bar.className===classe&&bar.dataset.h===html)return;
  const ativo=typeof document!=='undefined'?document.activeElement:null;
  const foco=ativo&&typeof bar.contains==='function'&&bar.contains(ativo)?(ativo.matches?.('summary')?'summary':ativo.matches?.('a')?'a':null):null;
  const aberto=!!bar.querySelector('details[open]');
  bar.className=classe;bar.innerHTML=aberto?html.replace('<details ','<details open '):html;
  if(bar.dataset)bar.dataset.h=html;
  if(foco)bar.querySelector(foco)?.focus?.({preventScroll:true});
}
function mostrarColeta(v){
  const bar=$$('coletaBar'),button=$$('syncBtn');if(!bar||!button)return;
  button.disabled=v.pedindo||!v.podeSolicitar||!state.permissoes.edicao;
  button.textContent=v.pedindo?'Enviando pedido…':v.status?.estado==='executando'?'↻ Coletando…':v.status?.estado==='aguardando'?'◷ Solicitado':'↻ Atualizar Mubisys';
  const st=v.status,estado=st?.estado,t=st?.ultimaTentativa,meses=t?.meses||[];
  const nomes={gravado:'atualizado',preservado:'histórico de planilha preservado',vazio:'sem lançamentos no período',simulado:'simulação, sem gravação'};
  const detalhes=meses.map(m=>`${m.label}: ${nomes[m.estado]||m.estado}`).join(' · ');
  const stamp=t?.em?`Última tentativa: ${dataBR(t.em)}`:'';
  // relógio do aparelho fora de hora não pode inventar nem esconder alerta:
  // quando o servidor informa a hora dele, as idades são medidas por ela.
  const desvio=st?.agora&&Number.isFinite(Date.parse(st.agora))?Date.parse(st.agora)-Date.now():0;
  const horas=x=>x?Math.max(0,(Date.now()+desvio-Date.parse(x))/36e5):0;
  const esperando=['aguardando','executando'].includes(estado);
  const rotinaPassou=estado==='aguardando'&&!!st?.solicitadoEm&&!!st?.rotinaVistaEm&&Date.parse(st.rotinaVistaEm)-Date.parse(st.solicitadoEm)>MINUTOS_ROTINA_PASSOU*6e4;
  const acionadaParada=estado==='aguardando'&&!!st?.acionadaEm&&horas(st.acionadaEm)*60>MINUTOS_ACIONADA_PARADA;
  const pedidoParado=estado==='aguardando'&&!!st?.solicitadoEm&&(rotinaPassou||acionadaParada||horas(st.solicitadoEm)>HORAS_PEDIDO_PARADO);
  // Sem internet não é falha da rotina: o aviso de offline já está no topo, e o chip diz que a coleta não foi consultada.
  const semRede=typeof navigator!=='undefined'&&navigator.onLine===false;
  const falha=!semRede&&(!!v.erro||['erro','interrompido'].includes(estado)||pedidoParado);
  const runId=t?.runId||st?.runId;
  const link=/^\d+$/.test(String(runId||''))?`<a href="https://github.com/leogpereira-afk/impresilk-dre/actions/runs/${esc(runId)}" target="_blank" rel="noopener">Ver execução ↗</a>`:'';
  const pedido=esperando&&st?.solicitadoEm?`Solicitado em ${dataBR(st.solicitadoEm)}.`:'';
  if(falha){
    const alerta=v.erro||(acionadaParada?`A rotina foi acionada no GitHub há mais de ${MINUTOS_ACIONADA_PARADA} minutos e não começou. Confira as execuções.`:rotinaPassou?'A rotina do GitHub rodou depois do pedido e não o executou. Confira as execuções.':pedidoParado?`O pedido espera há mais de ${HORAS_PEDIDO_PARADO} horas e a rotina do GitHub ainda não o pegou. Confira as execuções.`:v.descricao);
    trocarColeta(bar,'coleta-bar coleta-alerta',`<div><strong>${esc(pedidoParado?'Pedido de atualização parado':v.titulo)}</strong><p>${esc(alerta)} ${esc(pedido)}</p>${stamp?`<small>${esc(stamp)}${detalhes?' · '+esc(detalhes):''}</small>`:''}</div>${link}`);
    return;
  }
  const semSinal=st?.ativa&&st.rotinaVistaEm?horas(st.rotinaVistaEm):0,silencio=!esperando&&semSinal>HORAS_ROTINA_SEM_SINAL;
  const hora=x=>dataBR(x).slice(12,17);
  const texto=semRede&&(!st||v.erro)?'Sem internet · coleta não consultada':!st?'Conferindo atualização…':!st.ativa?'Atualização automática pendente':estado==='executando'?'Coletando no Mubisys…':estado==='aguardando'?`Atualização solicitada${st.solicitadoEm?' às '+hora(st.solicitadoEm):''} · ${st.acionadaEm?'rotina acionada':'aguardando a rotina'}`:t?.em?`Mubisys · coletado ${dataBR(t.em).slice(0,17)}`:'Mubisys · sem coleta registrada';
  const explica=semRede?'Sem internet agora. A situação da coleta volta a ser consultada quando a conexão voltar; os números da última leitura continuam na tela.':estado==='aguardando'?(st?.acionadaEm?'A rotina do GitHub foi acionada: a coleta costuma começar em 1–2 minutos. Você pode fechar esta tela.':'O pedido fica registrado e a rotina do GitHub o executa na próxima passagem. Costuma levar de minutos a algumas horas. Você pode fechar esta tela.'):v.descricao;
  const tom=semRede?'warn':esperando?'info':silencio||(st&&!st.ativa)?'warn':st?'ok':'';
  trocarColeta(bar,'coleta-slot',`<details class="chip-details coleta-chip ${tom}"><summary aria-label="${esc('Coleta do Mubisys: '+texto+(silencio?`. A rotina não dá sinal há ${Math.floor(semSinal)} horas`:''))}"><span class="st-dot" aria-hidden="true"></span><span class="st-txt">${esc(texto)}${silencio?` · sem sinal há ${Math.floor(semSinal)}h`:''}</span></summary><div class="chip-pop"><strong>${esc(v.titulo)}</strong><p>${esc(explica)} ${esc(pedido)}${silencio?` A rotina não dá sinal há ${Math.floor(semSinal)} horas; o GitHub pode estar atrasando o agendamento.`:''}</p>${stamp?`<small>${esc(stamp)}${detalhes?' · '+esc(detalhes):''}</small>`:''}${link}</div></details>`);
}
function iniciarAcompanhamentoColeta(){
  if(!coletaControle)return;
  clearInterval(coletaTimer);coletaControle.reset();coletaControle.consultar();
  coletaTimer=setInterval(()=>{if(!document.hidden&&AUTH.temCracha())coletaControle.consultar();},30000);
}
function pararAcompanhamentoColeta(){clearInterval(coletaTimer);coletaTimer=null;coletaControle?.reset();}
function configSegura(cfg){const allowed=['produtosCodigo','contasRemanejadas','previaERP','bancos','regras','demonstrativosCompetencia','gestao','parametros'];return Object.fromEntries(allowed.filter(k=>cfg[k]!=null).map(k=>[k,cfg[k]]));}
function exportarBackup(){download('impresilk-dre-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({versao:2,app:'impresilk-dre',exportadoEm:new Date().toISOString(),meses:state.records,cfg:configSegura(state.cfg),fila:getQueue()},null,2));toast('Backup preparado. Guarde o arquivo em local privado.');}
function validarRegistro(r){if(!r||!r.id||!F.periodo(r.label)||!Array.isArray(r.cells))throw new Error('Registro mensal inválido.');const codes=new Set();for(const c of r.cells){if(!/^\d+(\.\d+)*$/.test(c.code)||codes.has(c.code)||typeof c.value!=='number'||!Number.isFinite(c.value))throw new Error('Conta duplicada ou valor inválido.');codes.add(c.code);}if(!codes.has('1')||!codes.has('2'))throw new Error('O mês precisa dos totais de entradas e saídas.');return r;}
function diffRegistro(antes,depois){const a=new Map((antes?.cells||[]).map(c=>[c.code,c])),b=new Map(depois.cells.map(c=>[c.code,c]));return [...new Set([...a.keys(),...b.keys()])].flatMap(code=>{const old=a.get(code),next=b.get(code);const v=next?.value||0,p=old?.value||0;return Math.abs(v-p)>=.009||!next||!old||next.name!==old.name?[{code,name:next?.name||old?.name,antes:p,depois:v,ausente:!next}]:[];});}
function prepararImportacao(records,label,parsed){
 const old=records.find(x=>x.label===label);
 return {...old,id:old?.id||safeId(label),label,company:old?.company||'Impresilk + Universo',basis:'Caixa gerencial',
  origem:'planilha',qualidade:{estado:'cobertura-nao-validada'},previaERP:null,eventos:[],
  atualizadoEm:new Date().toISOString(),baseAtualizadoEm:old?.atualizadoEm||null,
  pendencias:[...(old?.pendencias||[])],cells:parsed.map(c=>({...c}))};
}
async function previewImport(file){if(!state.permissoes.edicao)return;try{if(file.size>15*1024*1024)throw new Error('A planilha excede 15 MB. Exporte somente o plano de contas do mês.');toast('Lendo a planilha…');await garantirXLSX();const parsed=parsePlanoContasWorkbook(await file.arrayBuffer());dialog('Revisar importação',`<p>A planilha substitui o mês escolhido. Contas ausentes serão zeradas somente após sua confirmação. O mês passará a ser protegido contra substituição automática do ERP.</p><label>Período<input id="importLabel" value="${esc(state.periodo)}" placeholder="Set/2026"></label><button id="importPreview" class="primary">Conferir diferenças</button><div id="importDiff"></div>`);$$('importPreview').onclick=()=>{try{let label=$$('importLabel').value.trim();if(!F.periodo(label))throw new Error('Use o período no formato Set/2026.');label=findExistingMonth(state.D,label)||label;const r=prepararImportacao(state.records,label,parsed);validarRegistro(r);const old=state.records.find(x=>x.label===label);if(getQueue().some(it=>it.registro?.id===r.id))throw new Error('Revise a edição pendente desse mês antes de importar outra versão.');r.baseAtualizadoEm=old?.atualizadoEm||null;const dif=diffRegistro(old,r);$$('importDiff').innerHTML=`<p class="note">${dif.length} contas novas, alteradas ou ausentes. ${old?'Mês existente será substituído.':'Novo período.'}</p><div class="table-scroll"><table><thead><tr><th scope="col">Conta</th><th scope="col" class="num">Antes</th><th scope="col" class="num">Depois</th></tr></thead><tbody>${dif.map(x=>`<tr><td>${esc(x.name)} ${x.ausente?'· ausente na planilha':''}</td><td class="num">${money(x.antes)}</td><td class="num">${money(x.depois)}</td></tr>`).join('')}</tbody></table></div><label class="check-label"><input type="checkbox" id="importAgree">Conferi o período, os valores e as contas ausentes</label><button id="importSave" class="primary" disabled>Salvar este mês</button>`;$$('importAgree').onchange=e=>$$('importSave').disabled=!e.target.checked;$$('importSave').onclick=async()=>{if(!$$('importAgree').checked)return;try{await salvarMeses([r]);$$('detailDialog').close();}catch(e){toast(e.message,'err');}};}catch(e){toast(e.message,'err');}};}catch(e){toast(e.message,'err');}}
async function salvarMeses(recs){
  if(!state.permissoes.edicao)throw new Error('Seu acesso é somente leitura.');
  const map=new Map(state.records.map(r=>[r.id,r]));const q=getQueue();
  for(const r of recs){validarRegistro(r);if(q.some(it=>it.registro?.id===r.id))throw new Error('Há uma edição pendente desse mês. Revise-a antes de substituir.');map.set(r.id,r);q.push({opId:crypto.randomUUID(),action:'upsert',registro:r,fails:0});}
  setQueue(q); // A cópia recuperável da edição é gravada antes da apresentação.
  const D=monthsToDataset([...map.values()]);if(!salvarLocal(D))throw new Error('A edição está na fila, mas não houve espaço para atualizar a cópia local.');
  boot(D);await trySync();boot(getCurrentData());toast(getQueue().length?'Edição preservada no aparelho; confira as pendências.':'Gravação confirmada na nuvem.');
}
async function importarBackup(file){
 if(!state.permissoes.edicao)return;
 try{
  const data=JSON.parse(await file.text());if(data.app!=='impresilk-dre'||!Array.isArray(data.meses))throw new Error('Arquivo de backup não reconhecido.');
  const recs=data.meses.map(validarRegistro),cfg=configSegura(data.cfg||{}),seen=new Set();
  for(const r of recs){if(seen.has(monthSortKey(r.label)))throw new Error('Há períodos repetidos no backup. Revise o arquivo antes de recuperar.');seen.add(monthSortKey(r.label));}
  dialog('Revisar recuperação do backup',`<p>Marque os períodos que deseja recuperar e confira suas diferenças. Edições pendentes são preservadas.</p>${recs.map((r,i)=>{const dif=diffRegistro(state.records.find(x=>x.id===r.id),r);return `<details class="restore-month"><summary>${esc(r.label)} · ${dif.length} contas alteradas</summary><label class="check-label"><input aria-label="Recuperar ${esc(r.label)}" type="checkbox" data-restore-i="${i}">Recuperar este mês</label>${dif.map(x=>linha(x.name+' · atual '+money(x.antes)+' → backup',x.depois)).join('')||'<p>Não há diferença de valores.</p>'}</details>`;}).join('')}<button id="restoreConfirm" class="primary">Recuperar meses selecionados</button>
  ${Object.keys(cfg).length?`<details style="margin-top:24px"><summary>Regras e configurações do backup</summary><p>Esta etapa é independente dos meses e exige acesso administrativo. As demais configurações da nuvem serão mantidas.</p><pre class="config-diff">${esc(JSON.stringify(cfg,null,2))}</pre><label class="check-label"><input id="cfgAgree" type="checkbox" ${state.permissoes.admin?'':'disabled'}>Revisei estas regras e quero substituir os mesmos campos na nuvem</label><button id="cfgRestore" disabled>Recuperar regras revisadas</button><p id="cfgResult" role="status"></p></details>`:''}`);
  $$('restoreConfirm').onclick=async()=>{const selected=[...document.querySelectorAll('[data-restore-i]:checked')].map(el=>{const r=recs[+el.dataset.restoreI];return {...r,baseAtualizadoEm:state.records.find(x=>x.id===r.id)?.atualizadoEm||null,atualizadoEm:new Date().toISOString()};});if(!selected.length)return toast('Selecione pelo menos um período.');try{await salvarMeses(selected);document.querySelectorAll('[data-restore-i]:checked').forEach(el=>{el.checked=false;el.disabled=true;});}catch(e){toast(e.message,'err');}};
  if($$('cfgAgree')){$$('cfgAgree').onchange=e=>$$('cfgRestore').disabled=!e.target.checked;$$('cfgRestore').onclick=async()=>{if(!state.permissoes.admin||!$$('cfgAgree').checked)return;const b=$$('cfgRestore');b.disabled=true;try{const volta=typeof paramPrepararRestauracao==='function'?paramPrepararRestauracao(cfg,state.cfg,data.exportadoEm):cfg;const r=await api('setCfg',{cfg:{...state.cfg,...volta},baseAtualizadoEm:state.cfgVersion||null});if(!r.ok)throw new Error(r.conflito?'As regras mudaram na nuvem. Leia a base novamente antes de revisar o backup.':r.erro||'Gravação não confirmada.');state.cfg={...state.cfg,...volta};state.cfgVersion=r.atualizadoEm;cfgConfirmada();$$('cfgResult').textContent='Regras confirmadas na nuvem.';}catch(e){$$('cfgResult').textContent=e.message;b.disabled=false;}};}
 }catch(e){toast(e.message,'err');}
}
function revisarConflito(id){const item=getQueue().find(it=>it.opId===id);if(!item)return;const remote=item.conflito?.servidor;const dif=remote?diffRegistro(remote,item.registro):[];dialog('Revisar edição de '+item.registro.label,`<p>${remote?'Há uma versão diferente na nuvem. Compare os valores antes de escolher.':'A edição foi preservada e ainda não foi confirmada.'}</p>${dif.map(x=>linha(x.name+' · nuvem '+money(x.antes)+' → aparelho',x.depois)).join('')}<div class="actions"><button id="saveConflictCopy">Baixar cópia desta edição</button>${remote?'<button id="adoptRemote">Usar versão da nuvem</button><button id="retryLocal" class="primary">Confirmar versão deste aparelho</button>':'<button id="retryLocal" class="primary">Tentar envio novamente</button>'}</div>`);$$('saveConflictCopy').onclick=()=>download('edicao-'+safeId(item.registro.label)+'.json',JSON.stringify(item,null,2));if($$('adoptRemote'))$$('adoptRemote').onclick=async()=>{download('edicao-preservada-'+safeId(item.registro.label)+'.json',JSON.stringify(item,null,2));setQueue(getQueue().filter(it=>it.opId!==id));$$('detailDialog').close();await pullCloud();};$$('retryLocal').onclick=async()=>{const q=getQueue(),it=q.find(x=>x.opId===id);if(!it)return;it.registro.baseAtualizadoEm=item.conflito?(remote?.atualizadoEm||null):(it.registro.baseAtualizadoEm||null);delete it.conflito;delete it.erro;setQueue(q);$$('detailDialog').close();await trySync();render();};}
// Sair apaga do aparelho a cópia dos números (ela volta do servidor no próximo
// acesso). Edição que ainda não chegou à nuvem é tentada antes; se continuar
// presa, só sai com a pessoa sabendo que ela será apagada.
function limparCopiaLocal({fila=false}={}){sessionDataset=null;servidorLocal=new Map();for(const k of [STORE_KEY,MONTH_TS_KEY,'impresilk_dre_data',...(fila?[QUEUE_KEY]:[])])try{localStorage.removeItem(k);}catch(_){}return typeof CacheDRE!=='undefined'?CacheDRE.limpar():Promise.resolve();}
async function logout(){let q;try{q=getQueue();}catch(_){q=null;}if(q?.length&&navigator.onLine){try{await trySync();}catch(_){}try{q=getQueue();}catch(_){q=null;}}
 if(q===null&&!confirm('A fila de edições deste aparelho está ilegível. Sair apaga essa fila. Para guardar, cancele e use "Baixar backup do DRE" em Sistemas e configurações. Sair mesmo assim?'))return;
 if(q?.length&&!confirm(`${q.length===1?'Uma edição ainda não chegou':q.length+' edições ainda não chegaram'} à nuvem. Sair apaga ${q.length===1?'essa edição':'essas edições'} deste aparelho. Para guardar, cancele e use "Baixar backup do DRE" em Sistemas e configurações. Sair mesmo assim?`))return;
 globalThis.DREIndicadores?.clear();pararAcompanhamentoColeta();AUTH.esquecer();await limparCopiaLocal({fila:true});$$('appShell').hidden=true;$$('authOverlay').hidden=false;$$('loginPass').value='';state.D=null;state.records=[];state.cfg={};state.cfgVersion=null;$$('detailDialog').close();state.permissoes={leitura:true,edicao:false,admin:false};}
function initApp(){
 if(typeof restaurarRota==='function')restaurarRota();
  $$('loginForm').onsubmit=async e=>{e.preventDefault();$$('loginErr').textContent='';const b=e.target.querySelector('button');b.disabled=true;try{await AUTH.entrar($$('loginPass').value);$$('loginPass').value='';await onAuthed();}catch(err){$$('loginErr').textContent=err.message||'Não foi possível entrar.';}finally{b.disabled=false;}};
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();});$$('settingsBtn').onclick=()=>{state.view='config';render();};$$('helpBtn').onclick=()=>{state.view='ajuda';render();};$$('logoutBtn').onclick=logout;{const marca=document.querySelector?.('.brand');if(marca)marca.onclick=e=>{e.preventDefault();state.view='inicio';render();};}$$('syncBtn').onclick=()=>coletaControle?.solicitar();
  $$('yearSelect').onchange=e=>{if(telaNoAno())return selecionarAno(e.target.value);const labels=state.records.map(r=>r.label).filter(l=>l.endsWith('/'+e.target.value)).sort((a,b)=>monthSortKey(b)-monthSortKey(a));const desired=state.periodo.split('/')[0]+'/'+e.target.value;state.comparar='';selecionarPeriodo(labels.includes(desired)?desired:(labels[0]||desired));};
  $$('compareSelect').onchange=e=>{if(telaNoAno())return selecionarAnoComparado(e.target.value);
  // Fora do Ano, só um mês vai para state.comparar (um ano é do state.anoComparar).
  if(!e.target.value||F.periodo(e.target.value))state.comparar=e.target.value;$$('periodCompare').open=false;render();$$('compareSummary').focus();};
  $$('detailClose').onclick=()=>$$('detailDialog').close();$$('themeToggle').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem(THEME_KEY,document.body.classList.contains('dark')?'dark':'light');};document.body.classList.toggle('dark',localStorage.getItem(THEME_KEY)==='dark');
  $$('monthFileInput').onchange=async e=>{if(e.target.files[0])await previewImport(e.target.files[0]);e.target.value='';};$$('restoreInput').onchange=async e=>{if(e.target.files[0])await importarBackup(e.target.files[0]);e.target.value='';};
  window.addEventListener('online',()=>{pullCloud();if(AUTH.temCracha())coletaControle?.consultar();});window.addEventListener('offline',()=>{setSyncState('off','Offline · dados locais');coletaControle?.show();});
  onAuthed().catch(e=>{$$('loginErr').textContent=e.message;});
}
document.addEventListener('DOMContentLoaded',initApp);

// Service Worker e aviso de versão nova. O SW novo assume as abas abertas
// sozinho (skipWaiting + clients.claim), mas o JavaScript que já está rodando
// é o antigo até recarregar: sem aviso, quem deixa o app aberto dias seguidos
// fica olhando a versão velha. Primeira instalação não avisa (não havia
// controlador antes).
(function registrarSW(){
  if(typeof navigator==='undefined'||typeof location==='undefined'||!('serviceWorker' in navigator)||location.protocol!=='https:')return;
  const tinhaVersao=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{});});
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(tinhaVersao)avisarVersaoNova();});
})();
function avisarVersaoNova(){
  if(document.getElementById('versaoNova'))return;
  const el=document.createElement('div');el.id='versaoNova';el.setAttribute('role','status');
  el.innerHTML='<span>Há uma versão nova do DRE.</span><button type="button" class="primary">Atualizar</button><button type="button" aria-label="Fechar aviso">✕</button>';
  const [atualizar,fechar]=el.querySelectorAll('button');
  atualizar.onclick=()=>location.reload();fechar.onclick=()=>el.remove();
  document.body.appendChild(el);
}

// Chips da régua de status e o Comparar: um aberto por vez; clique fora ou Esc fecha.
document.addEventListener('click',e=>{if(typeof e?.target?.closest!=='function')return;const dentro=e.target.closest('.status-line details, #periodCompare');document.querySelectorAll('.status-line details[open], #periodCompare[open]').forEach(d=>{if(d!==dentro)d.open=false;});});
// Pular para o conteúdo (botão do index.html): foco no título da tela, sem mexer no hash da rota.
document.addEventListener('click',e=>{if(e?.target?.closest?.('#pularConteudo')){const h=$$('pageTitle');if(!h)return;h.focus?.();h.scrollIntoView?.({block:'start'});}});
document.addEventListener('keydown',e=>{if(e?.key==='Escape')document.querySelectorAll('.status-line details[open], #periodCompare[open]').forEach(d=>{d.open=false;});});
