/* ====================================================================
   Impresilk · DRE Caixa — dashboard
   Fonte de dados: sessão autenticada, cópia local isolada e importação revisada.
   ==================================================================== */

let STORE_KEY = 'impresilk_dre_data';
const THEME_KEY = 'impresilk_dre_theme';
const VIEW_KEY = 'impresilk_dre_view';

const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();
let activeRenderAll = null; // permite recolorir após troca de tema

/* ---------- parsing de números pt-BR (espelha o extract.py) ---------- */
function parseNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Valor inválido'); return v; }
  let s = String(v).trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
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
  if (valCol < 0) throw new Error('Coluna "Valor" não encontrada — não parece o export Plano de Contas.');

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

function getCurrentData() {
  try { const s = localStorage.getItem(STORE_KEY); if (s) return JSON.parse(s); } catch (_) {}
  return {company:"Impresilk + Universo",basis:"Caixa gerencial",months:[],accounts:[],registros:[]};
}

// grava o dataset avisando quando o armazenamento do navegador encher —
// antes a falha era silenciosa e o usuário perdia dados sem saber
function salvarLocal(dataset) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(dataset)); return true; }
  catch (e) {
    const cheio = e && (e.name === 'QuotaExceededError' || e.code === 22);
    if (typeof toast === 'function')
      toast(cheio ? 'Armazenamento do navegador CHEIO — os dados não foram salvos! Baixe um backup (💾) e limpe dados antigos.' : 'Falha ao salvar no navegador: ' + (e && e.message || e), 'err');
    return false;
  }
}

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
    company: D.company, basis: D.basis,
    // origem viaja no registro — o robô grava "erp" e o painel PRECISA
    // devolver o mesmo valor ao sincronizar, senão o primeiro sync rebaixa
    // Jul/2026 para "planilha" e as guardas de comparação morrem em silêncio.
    origem: (D.origens || [])[i] || 'planilha',
    // pendências do mês (o que está em conta suspeita DENTRO do Mubisys) viajam
    // junto pelo mesmo motivo: sem devolvê-las, o primeiro sync do painel
    // apagava do servidor a lista que o robô tinha acabado de escrever.
    pendencias: (D.pendencias || [])[i] || [],
    cells: D.accounts.map(a => ({ code: a.code, name: a.names?.[i] || a.name, level: a.level, parent: a.parent, value: a.values[i] || 0 })),
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
    const values = recs.map(r => { const c = (r.cells || []).find(x => x.code === code); return c ? (c.value || 0) : 0; });
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
  salvarLocal(merged);
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
          atual.forEach(it => {if(it.registro?.id === item.registro.id) it.registro.baseAtualizadoEm = stamp;});
          const ts = getMonthTS(); ts[item.registro.label] = stamp; setMonthTS(ts);
          const D=getCurrentData();
          if(D.registros){D.registros=D.registros.map(reg=>reg.id===item.registro.id?{...reg,atualizadoEm:stamp,baseAtualizadoEm:stamp}:reg);if(!salvarLocal(D))throw new Error('A confirmação chegou, mas a cópia local não foi gravada. A fila foi preservada.');}
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
let state={D:null,records:[],cfg:{},permissoes:{leitura:true,edicao:false,admin:false},view:'inicio',periodo:'',comparar:'',consulta:'',grupo:'todos',tipo:'todos',ano:false,detCache:{},updated:null};
const $$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR=s=>s?new Date(s).toLocaleString('pt-BR'):'Não registrada';
const mesHoje=()=>PT_MON[new Date().getMonth()]+'/'+new Date().getFullYear();
function toast(t,kind=''){const el=$$('toast');if(!el)return;el.textContent=t;el.className='show '+kind;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='',6000);}
function dialog(title,html){$$('detailTitle').textContent=title;$$('detailContent').innerHTML=html;const d=$$('detailDialog');if(!d.open)d.showModal();}
const linha=(label,value,total=false)=>`<div class="line ${total?'total':''}"><span>${esc(label)}</span><b>${typeof value==='number'?money(value):esc(value)}</b></div>`;
const card=(title,html,open=true)=>`<details class="card" ${open?'open':''}><summary>${esc(title)}</summary><div class="card-body">${html}</div></details>`;
const metric=(label,value,desc,code='')=>`<${code?'button':'div'} class="metric" ${code?`data-account="${esc(code)}"`:''}><span class="label">${esc(label)}</span><strong>${value==null?'Não apurado':typeof value==='number'?money(value):esc(value)}</strong><small>${esc(desc)}</small></${code?'button':'div'}>`;
function regAtual(){return state.records.find(r=>r.label===state.periodo)||null;}
function boot(D){state.D=D;state.records=(D?.registros||datasetRecords(D||getCurrentData())).filter(r=>!r.apagado);if(!state.periodo)state.periodo=mesHoje();if(!state.comparar)state.comparar=state.records.filter(r=>monthSortKey(r.label)<monthSortKey(state.periodo)).at(-1)?.label||'';render();}
function scopeSession(){let sub='equipe';try {const raw=AUTH.cracha().split('.')[1];sub=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/'))).sub||sub;}catch(_){}const suffix=encodeURIComponent(String(sub));STORE_KEY='dre_v2_data:'+suffix;MONTH_TS_KEY='dre_v2_ts:'+suffix;QUEUE_KEY='dre_v2_queue:'+suffix;}
async function onAuthed(){
  if(!AUTH.temCracha())return;
  const check=await AUTH.conferir();if(check===false){AUTH.esquecer();return;}
  state.permissoes={leitura:true,edicao:false,admin:false};scopeSession();$$('authOverlay').hidden=true;$$('appShell').hidden=false;
  boot(getCurrentData());await pullCloud();
}
async function pullCloud(manual=false){
  if(!AUTH.temCracha())return;
  if(!navigator.onLine){setSyncState('off','Offline · dados locais');return;}
  setSyncState('busy','Lendo a nuvem…');
  try {
    const permissions=await api('permissions');state.permissoes=permissions.permissoes||{leitura:true,edicao:false,admin:false};
    if(state.permissoes.edicao)await trySync();
    let all=[],offset=0,seen=new Set();
    do{if(seen.has(offset))throw new Error('Paginação inconsistente');seen.add(offset);const r=await api('list',{offset});if(!r.ok||!Array.isArray(r.itens))throw new Error(r.erro||'Leitura não confirmada');all.push(...r.itens);offset=r.nextOffset;}while(offset!=null);
    const rc=await api('getCfg');if(!rc.ok)throw new Error('Não foi possível conferir as configurações.');state.cfg=rc.cfg||{};state.cfgVersion=rc.atualizadoEm||null;
    const locais=getCurrentData();const pend=getQueue();const map=new Map(all.filter(r=>!r.apagado).map(r=>[r.id,normalizeRecord(r)]));
    for(const item of pend){if(item.registro){const rem=map.get(item.registro.id);if(rem&&rem.atualizadoEm!==item.registro.baseAtualizadoEm&&!item.conflito)item.conflito={servidor:rem};map.set(item.registro.id,item.registro);}}
    setQueue(pend);
    // Leitura nunca semeia, exclui duplicatas ou reenvia histórico automaticamente.
    const legacy=state.cfg.previaERP;if(legacy?.label)for(const r of map.values())if(r.label===legacy.label&&r.origem==='erp'&&!r.previaERP)r.previaERP=legacy;
    const merged=monthsToDataset([...map.values()]);
    const ts={};all.forEach(r=>ts[r.label]=r.atualizadoEm);setMonthTS(ts);
    if(!salvarLocal(merged))throw new Error('Nuvem lida, mas cópia local não foi salva.');
    state.updated=new Date().toISOString();boot(merged);setSyncState(pend.length?'pending':'ok',pend.length+' edições pendentes · leitura '+new Date().toLocaleTimeString('pt-BR'));
    if(manual)toast('Base salva na nuvem lida. Veja abaixo a data da coleta do ERP.');
  }catch(e){setSyncState('off','Leitura não concluída');toast(e.message||'Não foi possível ler a nuvem.','err');}
}
function periodoOptions(){const labels=[...new Set([...state.records.map(r=>r.label),mesHoje()])].sort((a,b)=>monthSortKey(b)-monthSortKey(a));$$('monthSelect').innerHTML=labels.map(l=>`<option ${state.periodo===l?'selected':''}>${esc(l)}</option>`).join('');$$('compareSelect').innerHTML='<option value="">Sem comparação</option>'+labels.filter(l=>l!==state.periodo).map(l=>`<option ${state.comparar===l?'selected':''}>${esc(l)}</option>`).join('');}
function render(){
  if(!state.D)return;periodoOptions();const reg=regAtual(),q=F.qualidade(reg);const metadata={inicio:['Visão geral','O que aconteceu, o que falta conferir e onde agir.'],caixa:['Caixa','Entradas, saídas e planejamento, com critérios visíveis.'],resultado:['Resultado','Separe o movimento do dinheiro do resultado econômico.'],detalhe:['Detalhamento','Do total à conta, ao produto e à origem do lançamento.'],conferencia:['Conferência','Cobertura, pendências e diferenças antes do fechamento.'],config:['Sistemas e configurações','Integração, importação, backup e acesso.'],ajuda:['Ajuda financeira','Conceitos e regras para ler os números com clareza.']};
  const [title,desc]=metadata[state.view]||metadata.inicio;$$('pageTitle').textContent=title;$$('pageDesc').textContent=desc;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false');});
  $$('qualityBar').innerHTML=`<div class="status ${q.comparavel?'good':''}"><div><h3>${esc(state.periodo)} · ${esc(q.rotulo)}</h3><p>${esc(q.mensagem)}</p><small>Última coleta/registro: ${esc(dataBR(q.coletadoEm))} · Fonte: ${!reg?'Não disponível':reg.origem==='erp'?'Mubisys':'Histórico / planilha'} · Base: caixa filtrado por “compõe DRE”. Conciliação bancária: ${reg?.qualidade?.conciliado?'registrada':'não comprovada'}.</small></div></div>`;
  const pages={inicio:renderInicio,caixa:renderCaixa,resultado:renderResultado,detalhe:renderDetalhe,conferencia:renderConferencia,config:renderConfig,ajuda:renderAjuda};
  $$('pageContent').innerHTML=(pages[state.view]||renderInicio)(reg,q);
  wireContent();$$('footMeta').textContent=`${state.records.length} registros mensais · ${state.D.accounts.length} contas · ${state.periodo} · ${q.rotulo} · Leitura da nuvem: ${dataBR(state.updated)}. Valores não conciliados não representam fechamento.`;
}
function renderInicio(reg,q){
  const r=F.resumo(reg),p=reg?.pendencias||[];
  let h=`<div class="cards">${metric('Entradas consideradas',reg?r.entradas:null,reg?'Valor da base selecionada':'Período ainda sem dados','1')}${metric('Saídas consideradas',reg?r.saidas:null,'Inclui valores aguardando classificação','2')}${metric('Variação de caixa',reg?r.variacao:null,'Entradas − saídas. Não é saldo disponível.','variacao')}</div>`;
  h+=card('O que precisa de atenção',`<div class="line"><span>Atualização e cobertura</span><b>${esc(q.rotulo)}</b></div><div class="line"><span>Pendências de classificação</span><b>${p.length}</b></div>${linha('Saldo bancário disponível','Não apurado')}<p class="hint">Para decidir sobre retirada, contratação ou investimento, precisamos de saldo conciliado e compromissos futuros.</p><div class="actions"><button data-go="conferencia">Conferir a base →</button><button data-go="caixa">Entender o caixa →</button></div>`);
  if(reg&&state.comparar){const other=state.records.find(r=>r.label===state.comparar),cmp=F.comparacao(reg,other);h+=card('Comparação com '+state.comparar,cmp.permitida?linha('Mudança na variação de caixa',cmp.delta)+`<p class="hint">Uma mudança nos pagamentos não comprova economia nem desperdício. Abra as categorias para verificar a causa.</p>`:`<p>${esc(cmp.motivo)}</p>`);}
  return h;
}
function renderCaixa(reg){const r=F.resumo(reg);let h='';
  if(reg)h+=`<div class="cards">${metric('Recebimentos operacionais',r.operacionais,'Pagamentos recebidos de clientes','operacionais')}${metric('Saldo disponível',null,'Exige saldo inicial e conciliação bancária')}${metric('Variação do período',r.variacao,'Movimento da base salva','variacao')}</div>`+`<div class="split">${card('Entradas consideradas',linha('Recebimentos operacionais',r.operacionais)+linha('Empréstimos identificados',r.emprestimos)+linha('Rendimentos',r.rendimentos)+linha('Entradas a identificar',r.naoIdentificadas)+linha('Outras entradas / diferenças de detalhe',r.outrasEntradas)+linha('Total',r.entradas,true))}${card('Saídas consideradas',linha('Pagamentos da operação',r.pagamentosOperacionais)+linha('Sócios e arrendamento',r.socios)+linha('Parcelas de ativos',r.parcelasAtivos)+linha('Dívidas classificadas',r.dividas)+linha('Transferências entre empresas',r.transferencias)+linha('Investimentos classificados',r.investimentos)+linha('Cartão / saídas sem detalhe',r.pendentes)+linha('Total',r.saidas,true))}</div><p class="hint">A classificação histórica foi preservada. Parcelas exigem revisão de principal, juros e contrato; não são tratadas automaticamente como aquisição de patrimônio.</p>`;
  else h+='<div class="empty"><h2>Este mês ainda não foi coletado.</h2><p>Abra um mês do histórico ou confira a integração.</p></div>';
  h+=card('Evolução mensal e acumulado',historicoTabela());
  h+=card('Planejar as próximas 13 semanas',`<p>Simulação local. Informe um saldo de partida e compromissos previstos. Estes dados não alteram o Mubisys nem são enviados ao servidor.</p><div class="form-grid"><label>Saldo inicial considerado (R$)<input id="planSaldo" type="number" step="0.01" placeholder="Informe o saldo" value="${esc(plano.saldo)}"></label><label>Reserva mínima (R$)<input id="planReserva" type="number" step="0.01" min="0" value="${esc(plano.reserva)}"></label><label>Início da projeção<input id="planData" type="date" value="${esc(plano.inicio)}"></label><label>Cenário de recebimento<select id="planCenario"><option value="1">100% dos recebimentos previstos</option><option value="0.8">80% dos recebimentos previstos</option><option value="0.6">60% dos recebimentos previstos</option></select></label></div><div class="actions"><button id="planAdicionar">+ Compromisso previsto</button><button id="planCalcular" class="primary">Calcular cenário</button></div><div id="planMovimentos"></div><div id="planResultado"></div><p class="hint">Valores vencidos não resolvidos são considerados no início da projeção. O cenário reduz os recebimentos previstos; não altera saídas. Revise as premissas.</p>`,false);
  return h;
}
function historicoTabela(){const year=state.periodo.split('/')[1];const recs=state.records.filter(r=>r.label.endsWith('/'+year));if(!recs.length)return '<p>Sem histórico neste ano.</p>';const total=recs.reduce((a,x)=>{const r=F.resumo(x);a.e+=r.entradas;a.s+=r.saidas;return a;},{e:0,s:0});const max=Math.max(...recs.map(r=>F.resumo(r).entradas),1);
 return `<div class="bars" aria-label="Entradas por mês, com valores na tabela abaixo">${recs.map(x=>`<div class="bar-item"><div style="height:${Math.max(1,F.resumo(x).entradas/max*130)}px"></div><span>${esc(x.label)}</span></div>`).join('')}</div><div class="table-scroll"><table><thead><tr><th>Mês</th><th>Cobertura</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Variação</th></tr></thead><tbody>${recs.map(x=>{const r=F.resumo(x);return `<tr><td>${esc(x.label)}</td><td>${esc(F.qualidade(x).rotulo)}</td><td class="num">${money(r.entradas)}</td><td class="num">${money(r.saidas)}</td><td class="num">${money(r.variacao)}</td></tr>`;}).join('')}<tr class="total"><td>Acumulado disponível</td><td>Inclui períodos a conferir</td><td class="num">${money(total.e)}</td><td class="num">${money(total.s)}</td><td class="num">${money(total.e-total.s)}</td></tr></tbody></table></div><p class="hint">A soma do histórico não é saldo bancário. Meses parciais são identificados e não recebem conclusões automáticas de desempenho.</p>`;
}
function renderResultado(reg){const r=F.resumo(reg);return card('Resultado por competência',`<div class="note"><h3>Lucro, EBITDA e margem líquida ainda não apurados</h3><p>Esta base contém recebimentos e pagamentos. Para demonstrar resultado econômico, precisamos de receita reconhecida, custos correspondentes, estoque, depreciação e tributos aplicáveis.</p></div><p>A leitura gerencial de caixa continua disponível abaixo, com critérios e origem explícitos.</p>`)+card('Demonstrativo gerencial de caixa',reg?`<p>${esc(reg.label)} · ${esc(F.qualidade(reg).rotulo)} · ${esc(reg.origem==='erp'?'Impresilk + Universo':reg.company||'Empresa não informada')}</p>${linha('Recebimentos operacionais',r.operacionais)}${linha('Pagamentos classificados na operação',-r.pagamentosOperacionais)}${linha('Saldo antes dos demais grupos',r.saldoOperacional,true)}${linha('Sócios e arrendamento',-r.socios)}${linha('Parcelas de ativos',-r.parcelasAtivos)}${linha('Investimentos classificados',-r.investimentos)}${linha('Dívidas classificadas',-r.dividas)}${linha('Transferências entre empresas',-r.transferencias)}${linha('Entradas de empréstimos',r.emprestimos)}${linha('Rendimentos financeiros',r.rendimentos)}${linha('Entradas a identificar e outras entradas',r.naoIdentificadas+r.outrasEntradas)}${linha('Saídas sem detalhamento',-r.pendentes)}${linha('Variação de caixa',r.variacao,true)}<p class="hint">A decomposição fecha internamente. Não comprova conciliação com extrato nem lucro contábil.</p><div class="actions"><button id="printReport">Imprimir / salvar PDF</button><button data-go="detalhe">Ver contas</button></div>`:'<p>Selecione um período com dados.</p>');}
function renderDetalhe(reg){if(!reg)return '<div class="empty">Este mês não tem dados. Escolha um período do histórico.</div>';const cells=reg.cells||[],groups=cells.filter(c=>c.code.split('.').length===2);const query=state.consulta.toLocaleLowerCase('pt-BR');const filtered=cells.filter(c=>(state.tipo==='todos'||c.code.startsWith(state.tipo))&&(state.grupo==='todos'||c.code===state.grupo||c.code.startsWith(state.grupo+'.'))&&(!query||(c.name+' '+c.code).toLocaleLowerCase('pt-BR').includes(query)));const cmp=state.records.find(r=>r.label===state.comparar),comp=F.comparacao(reg,cmp);const sameMap=(reg.origem||'planilha')===(cmp?.origem||'planilha');
 return card('Contas, produtos e centros',`<div class="filterbar"><input id="searchAccounts" aria-label="Buscar conta ou produto" placeholder="Buscar conta, produto, energia, frota…" value="${esc(state.consulta)}"><select id="accountType" aria-label="Tipo de movimento"><option value="todos">Entradas e saídas</option><option value="1">Entradas</option><option value="2">Saídas</option></select><select id="accountGroup" aria-label="Categoria"><option value="todos">Todas as categorias</option>${groups.map(c=>`<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select></div><p class="hint">${filtered.length} contas. Totais e subcontas são níveis da mesma árvore; não devem ser somados entre si.</p><div class="table-scroll"><table><thead><tr><th>Conta / produto</th><th class="num">${esc(reg.label)}</th><th class="num">${esc(state.comparar||'Comparação')}</th><th class="num">Variação</th></tr></thead><tbody>${filtered.map(c=>{const old=cmp?.cells?.find(x=>x.code===c.code),ok=comp.permitida&&!!old&&(sameMap||c.code.split('.').length<=2)&&old.name===c.name;return `<tr><td style="padding-left:${12+Math.min(c.code.split('.').length-1,5)*12}px"><button data-account="${esc(c.code)}">${esc(c.name)}</button><small> ${esc(c.code)}</small></td><td class="num">${money(c.value)}</td><td class="num">${ok?money(old.value):'—'}</td><td class="num">${ok?money(c.value-old.value):'—'}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">Comparações exigem cobertura válida e conta com significado compatível. Nomes são os de cada mês, preservados no histórico.</p><div class="actions"><button id="exportAccounts">Baixar contas em CSV</button></div>`)+card('Totais sem detalhamento',F.residuos(reg).length?F.residuos(reg).map(x=>linha(x.name+' · '+x.code,x.value)).join('')+'<p class="hint">Pode haver lançamento direto na conta-pai. Conferir antes de distribuir qualquer valor.</p>':'<p>Os totais com filhos fecham com o detalhamento disponível.</p>',false);
}
function renderConferencia(reg,q){const p=reg?.pendencias||[],dup=dedupePeriods(state.records).dropped;let h=card('Saúde da informação',linha('Cobertura do período',q.rotulo)+linha('Última coleta ou registro',dataBR(q.coletadoEm))+linha('Conciliação bancária',reg?.qualidade?.conciliado?'Registrada':'Não comprovada')+linha('Edições locais pendentes',String(getQueue().length))+`<p class="hint">O botão “Ler nuvem” consulta o que foi salvo. A coleta do Mubisys é uma rotina separada. Confira suas últimas execuções em Sistemas e configurações.</p>`);
 h+=card('Pendências para revisar',p.length?p.map(x=>`<div class="line"><span>${esc(x.texto||x.tipo)}<small> ${esc(x.conta||'')}</small></span><b>${money(x.valor)}</b></div>`).join(''):'<p>Nenhuma pendência registrada neste período. Isso não comprova conciliação ou completude.</p>');
 h+=card('Movimentos na origem',reg?.eventos?.length?`<p>${reg.eventos.length} movimentos com empresa, título, pagamento e conta de origem.</p><button id="originEvents">Consultar movimentos</button>`:'<p>A trilha por pagamento estará disponível após uma nova coleta. O histórico atual conserva os totais e as contas.</p>',false);
 h+=card('Conferir com o Mubisys',`<p>Consulta de leitura. Compara o período com o retrato de origem guardado na coleta. Não transforma diferenças em ajustes.</p><div class="actions"><button id="auditMubi" ${!reg?'disabled':''}>Consultar período</button></div><div id="auditResult"></div><p class="hint">Históricos sem retrato de origem recebem somente confronto dos totais, sem comparar códigos antigos com novos.</p>`);
 if(localStorage.getItem('impresilk_dre_queue')&&!['[]','null'].includes(localStorage.getItem('impresilk_dre_queue')))h+=card('Edições da versão anterior',`<p>Este aparelho conserva uma fila da versão anterior. Ela não será enviada automaticamente.</p><button id="legacyBackup">Baixar para revisão</button>`);
 if(getQueue().length)h+=card('Edições preservadas no aparelho',getQueue().map(it=>`<div class="line"><span>${esc(it.registro.label)} · ${it.conflito?'Conflito com a nuvem':esc(it.erro||'Aguardando envio')}</span><button data-conflict="${esc(it.opId)}">Revisar</button></div>`).join(''));
 if(dup.length)h+=card('Períodos com mais de um registro',`<p>${dup.length} registro(s) representam períodos repetidos. Foram preservados. A exclusão exige revisão da origem e do conteúdo.</p>`);
 return h;
}
function renderConfig(){return card('Integração e atualização',`<p>O coletor revisa o mês atual e o anterior, conserva o histórico de planilha e rejeita gravações com totais inconsistentes.</p><div class="actions"><a href="https://github.com/leogpereira-afk/impresilk-dre/actions/workflows/erp-previa.yml" target="_blank" rel="noopener">Ver execuções no GitHub ↗</a></div><p class="hint">O agendamento previsto é de três coletas por dia. Uma execução com falha precisa ser corrigida antes de considerar a base atualizada.</p>`)+card('Importação e recuperação',`<p>Antes de alterar um mês, confira a prévia. Restaurar um backup exige escolher os períodos e confirmar o envio.</p><div class="actions"><button id="backupBtn">💾 Baixar backup do DRE</button><button id="addMonthBtn" ${state.permissoes.edicao?'':'disabled'}>📥 Importar mês</button><button id="restoreBtn" ${state.permissoes.edicao?'':'disabled'}>📂 Revisar backup</button></div><p class="hint">O backup contém meses, metadados, regras de classificação e configurações não secretas. Credenciais não são exportadas.</p>`)+card('Acesso e regras',`<p>Seu acesso permite: ${state.permissoes.admin?'administração e edição':state.permissoes.edicao?'leitura e edição':'leitura'}. As permissões são conferidas no servidor.</p><a href="https://leogpereira-afk.github.io/painel-impresilk/acessos" target="_blank" rel="noopener">Abrir Sistemas e configurações da central ↗</a><p class="hint">A troca de senha permanece na central de acesso. Regras contratuais de arrendamento, dívidas e custos devem ser validadas antes de reclassificação.</p>`,false);}
function renderAjuda(){return [
 ['Caixa realizado','É o movimento efetivo de recebimentos e pagamentos. Este painel ainda filtra “compõe DRE”; por isso os totais não são uma conciliação bancária completa.'],
 ['Resultado por competência','Relaciona receitas reconhecidas com custos e despesas do período econômico. Receber uma venda antiga aumenta o caixa de hoje, mas não cria uma nova venda.'],
 ['Variação e saldo disponível','Variação é entradas menos saídas. Saldo final exige saldo inicial conciliado e todos os movimentos das contas consideradas. Somar variações históricas não prova uma reserva disponível.'],
 ['Sócios, arrendamento e dívidas','Os grupos históricos continuam separados. A classificação gerencial não substitui a revisão de contratos, natureza de retiradas, principal e juros.'],
 ['Comparação e margem','Meses incompletos e códigos que mudaram de significado não recebem comparação automática. Margem consolidada deve dividir resultado total pela receita total comparável.'],
 ['Ponto de equilíbrio e rentabilidade','Exigem custos e receitas correspondentes e classificação validada entre fixos e variáveis. Pagamentos de materiais não comprovam o custo consumido em cada O.S.'],
 ['Onde está cada recurso','Produtos, serviços, pessoal, materiais, máquinas, frota, energia e água estão em Detalhamento. O histórico anual está em Caixa. O demonstrativo para impressão está em Resultado. Backup e importação ficam em Sistemas e configurações.'],
 ['Rotina de conferência','Verifique data da coleta, cobertura, pagamentos, valores sem categoria e diferenças. Corrija a origem com revisão humana; depois confira a nova coleta antes de fechar o mês.']
 ].map(([a,b])=>card(a,`<p>${b}</p>`,false)).join('');}
let plano={saldo:'',reserva:0,inicio:new Date().toLocaleDateString('sv-SE'),cenario:1,movimentos:[]};
function wireContent(){
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{state.view=b.dataset.go;render();});
  document.querySelectorAll('[data-account]').forEach(b=>b.onclick=()=>abrirConta(b.dataset.account));
  document.querySelectorAll('[data-conflict]').forEach(b=>b.onclick=()=>revisarConflito(b.dataset.conflict));
  const on=(id,fn)=>{if($$(id))$$(id).onclick=fn;};
  on('legacyBackup',()=>download('dre-fila-anterior.json',localStorage.getItem('impresilk_dre_queue')));on('printReport',()=>window.print());on('backupBtn',exportarBackup);on('addMonthBtn',()=>$$('monthFileInput').click());on('restoreBtn',()=>$$('restoreInput').click());on('auditMubi',conferirMubi);on('originEvents',()=>mostrarEventos());
  on('exportAccounts',()=>{const r=regAtual();download('dre-contas-'+safeId(r.label)+'.csv','\ufeffConta;Nome;Valor\n'+r.cells.map(c=>[c.code,c.name,Number(c.value).toFixed(2).replace('.',',')].map(v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(';')).join('\n'),'text/csv');});
  if($$('searchAccounts')){$$('accountType').value=state.tipo;$$('accountGroup').value=state.grupo;$$('searchAccounts').oninput=e=>{state.consulta=e.target.value;const pos=e.target.selectionStart;render();$$('searchAccounts').focus();$$('searchAccounts').setSelectionRange(pos,pos);};$$('accountType').onchange=e=>{state.tipo=e.target.value;state.grupo='todos';render();};$$('accountGroup').onchange=e=>{state.grupo=e.target.value;render();};}
  on('planAdicionar',()=>{dialog('Compromisso previsto',`<form id="planForm"><label>Descrição<input name="descricao" required maxlength="120"></label><div class="form-grid"><label>Data<input name="data" type="date" value="${esc(plano.inicio)}" required></label><label>Movimento<select name="tipo"><option value="saida">Saída</option><option value="entrada">Entrada</option></select></label><label>Valor (R$)<input name="valor" type="number" min="0.01" step="0.01" required></label></div><button class="primary" type="submit">Adicionar à simulação</button></form>`);$$('planForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);plano.movimentos.push({id:crypto.randomUUID(),descricao:f.get('descricao'),data:f.get('data'),tipo:f.get('tipo'),valor:Number(f.get('valor'))});$$('detailDialog').close();mostrarPlano();};});
  if($$('planSaldo')){for(const [id,k] of [['planSaldo','saldo'],['planReserva','reserva'],['planData','inicio'],['planCenario','cenario']]){$$(id).value=plano[k];$$(id).oninput=e=>{plano[k]=e.target.value;};}on('planCalcular',mostrarPlano);mostrarPlano();}
}
function mostrarPlano(){if(!$$('planMovimentos'))return;$$('planMovimentos').innerHTML=plano.movimentos.length?`<div class="table-scroll"><table><thead><tr><th>Compromisso</th><th>Data</th><th>Tipo</th><th class="num">Valor</th><th></th></tr></thead><tbody>${plano.movimentos.map(m=>`<tr><td>${esc(m.descricao)}</td><td>${esc(m.data)}</td><td>${m.tipo==='entrada'?'Entrada':'Saída'}</td><td class="num">${money(m.valor)}</td><td><button data-remove-plan="${m.id}" aria-label="Remover ${esc(m.descricao)}">✕</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">Nenhum compromisso adicionado. O cenário ficará limitado ao saldo informado.</p>';document.querySelectorAll('[data-remove-plan]').forEach(b=>b.onclick=()=>{plano.movimentos=plano.movimentos.filter(m=>m.id!==b.dataset.removePlan);mostrarPlano();});
 try{const p=F.projecao({...plano,fatorRecebimento:Number(plano.cenario)});$$('planResultado').innerHTML=p.disponivel?`<div class="cards">${metric('Menor saldo projetado',p.minimo,'Cenário informado, não conciliado')}${metric('Saldo ao final',p.final,'Após 13 semanas')}${metric('Primeiro dia abaixo da reserva',p.primeiroAperto?p.primeiroAperto.split('-').reverse().join('/'):'Nenhum','Considerando apenas os compromissos informados')}</div><div class="table-scroll"><table><thead><tr><th>Semana</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo</th></tr></thead><tbody>${p.semanas.map(s=>`<tr><td>${s.semana}</td><td class="num">${money(s.entradas)}</td><td class="num">${money(s.saidas)}</td><td class="num">${money(s.saldo)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="note">Informe o saldo inicial para calcular. A variação histórica não será usada como dinheiro disponível.</p>';}catch(e){$$('planResultado').textContent=e.message;}}
function abrirConta(code){
 const reg=regAtual();if(!reg)return;
 if(code==='operacionais'){dialog('Recebimentos operacionais',reg.cells.filter(c=>['1.1','1.2','1.5','1.6'].includes(c.code)).map(c=>linha(c.name,c.value)).join('')+linha('Total',F.resumo(reg).operacionais,true));return;}
 const cell=reg.cells.find(c=>c.code===code),filhos=reg.cells.filter(c=>c.code.substring(0,c.code.lastIndexOf('.'))===code),hist=state.records.map(r=>{const c=r.cells.find(x=>x.code===code);return {label:r.label,nome:code==='variacao'?'Variação de caixa':c?.name,valor:code==='variacao'?F.resumo(r).variacao:c?.value};});
 dialog(code==='variacao'?'Variação de caixa':cell?.name||code,`<p>${code==='variacao'?'Entradas consideradas menos saídas consideradas. Não inclui saldo inicial nem comprova saldo disponível.':'Valor da conta na base do período. O código é '+esc(code)+'.'}</p>${code==='variacao'?linha('Entradas',F.resumo(reg).entradas)+linha('Saídas',-F.resumo(reg).saidas)+linha('Variação',F.resumo(reg).variacao,true):linha('Valor no mês',cell?.value||0)}${filhos.length?'<h3>Composição · abra uma categoria para aprofundar</h3>'+filhos.map(c=>`<div class="line"><button data-child-account="${esc(c.code)}">${esc(c.name)}</button><b>${money(c.value)}</b></div>`).join(''):''}<h3 style="margin-top:25px">Histórico por período</h3>${hist.map(h=>linha(h.label+' · '+(h.nome||'Sem conta neste mês'),h.valor==null?'—':h.valor)).join('')}<p class="hint">Rótulos históricos são preservados. Uma alteração de nome ou classificação impede comparação automática entre contas diferentes.</p>`);
 $$('detailContent').querySelectorAll('[data-child-account]').forEach(b=>b.onclick=()=>abrirConta(b.dataset.childAccount));
}
function mostrarEventos(page=0,query=''){
 const reg=regAtual();const events=(reg?.eventos||[]).filter(e=>[e.empresa,e.tituloId,e.contaOrigem,e.nomeConta,...(e.ordensServico||[])].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).sort((a,b)=>a.data.localeCompare(b.data));
 dialog('Movimentos na origem · '+reg.label,`<p>Pagamentos que compõem esta coleta. A conta abaixo é a original do Mubisys, antes da classificação gerencial. Um pagamento sem identificador próprio conserva sua posição na coleta.</p><input id="eventSearch" aria-label="Buscar movimento" placeholder="Empresa, título, conta ou O.S." value="${esc(query)}"><p>${events.length} movimentos · página ${page+1} de ${Math.max(1,Math.ceil(events.length/100))}</p><div class="table-scroll"><table><thead><tr><th>Data</th><th>Empresa / título</th><th>Conta / O.S.</th><th class="num">Movimento</th></tr></thead><tbody>${events.slice(page*100,page*100+100).map(e=>`<tr><td>${esc(e.data.split('-').reverse().join('/'))}</td><td>${esc(e.empresa)}<br>Título ${esc(e.tituloId)} · Pagamento ${esc(e.pagamentoId??'não informado')}</td><td>${esc(e.contaOrigem+' '+e.nomeConta)}<br>${e.ordensServico?.length?'O.S. '+esc(e.ordensServico.join(', ')):''}</td><td class="num">${e.natureza==='entrada'?'Entrada':'Saída'}<br>${money(e.valor)}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button id="eventPrev" ${page?'':'disabled'}>Anterior</button><button id="eventNext" ${(page+1)*100<events.length?'':'disabled'}>Próxima</button></div>`);
 $$('eventSearch').onchange=e=>mostrarEventos(0,e.target.value);$$('eventPrev').onclick=()=>mostrarEventos(page-1,query);$$('eventNext').onclick=()=>mostrarEventos(page+1,query);
}
async function conferirMubi(){const reg=regAtual(),per=F.periodo(reg?.label);if(!per)return;const b=$$('auditMubi'),h=$$('auditResult');b.disabled=true;h.textContent='Consultando o período…';try{const r=await apiFn('financas','importarMes',{datainicial:per.de,datafinal:per.ate},150000);if(!r.ok||r.parcial)throw new Error(r.aviso||r.erro||'Coleta incompleta. Totais não serão comparados.');const salvo=reg.previaERP?.porCodigo;let html=linha('Despesas retornadas pela consulta',r.totais.despesa)+linha('Despesas salvas no mês',F.resumo(reg).saidas)+linha('Diferença bruta, ainda não conciliada',r.totais.despesa-F.resumo(reg).saidas,true);if(salvo){const contas=new Set([...Object.keys(salvo),...Object.keys(r.porCodigo||{})]);html+='<h3 style="margin-top:20px">Diferenças na origem (mesmos códigos do Mubisys)</h3>';let n=0;for(const c of contas){if(c!=='2'&&!c.startsWith('2.'))continue;const a=salvo[c]?.valor||0,v=r.porCodigo?.[c]?.valor||0;if(Math.abs(v-a)>=.009){html+=linha((r.porCodigo?.[c]?.nome||salvo[c]?.nome||c)+' · '+c,v-a);n++;}}if(!n)html+='<p>Nenhuma diferença no retrato das contas de despesa. Ainda falta a conciliação bancária.</p>';}else html+='<p class="note">Este histórico não guarda os códigos de origem. A comparação linha a linha está indisponível para evitar diferenças falsas entre códigos antigos e novos.</p>';html+='<p class="hint">Nenhum ajuste foi feito. Verifique cobertura, datas e natureza dos lançamentos antes de corrigir qualquer valor.</p>';h.innerHTML=html;}catch(e){h.textContent=e.message;}finally{b.disabled=false;}}
function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function configSegura(cfg){const allowed=['produtosCodigo','contasRemanejadas','previaERP','bancos','regras'];return Object.fromEntries(allowed.filter(k=>cfg[k]!=null).map(k=>[k,cfg[k]]));}
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
async function previewImport(file){if(!state.permissoes.edicao)return;try{if(file.size>15*1024*1024)throw new Error('A planilha excede 15 MB. Exporte somente o plano de contas do mês.');toast('Lendo a planilha…');await garantirXLSX();const parsed=parsePlanoContasWorkbook(await file.arrayBuffer());dialog('Revisar importação',`<p>A planilha substitui o mês escolhido. Contas ausentes serão zeradas somente após sua confirmação. O mês passará a ser protegido contra substituição automática do ERP.</p><label>Período<input id="importLabel" value="${esc(state.periodo)}" placeholder="Set/2026"></label><button id="importPreview" class="primary">Conferir diferenças</button><div id="importDiff"></div>`);$$('importPreview').onclick=()=>{try{let label=$$('importLabel').value.trim();if(!F.periodo(label))throw new Error('Use o período no formato Set/2026.');label=findExistingMonth(state.D,label)||label;const r=prepararImportacao(state.records,label,parsed);validarRegistro(r);const old=state.records.find(x=>x.label===label);if(getQueue().some(it=>it.registro?.id===r.id))throw new Error('Revise a edição pendente desse mês antes de importar outra versão.');r.baseAtualizadoEm=old?.atualizadoEm||null;const dif=diffRegistro(old,r);$$('importDiff').innerHTML=`<p class="note">${dif.length} contas novas, alteradas ou ausentes. ${old?'Mês existente será substituído.':'Novo período.'}</p><div class="table-scroll"><table><thead><tr><th>Conta</th><th class="num">Antes</th><th class="num">Depois</th></tr></thead><tbody>${dif.map(x=>`<tr><td>${esc(x.name)} ${x.ausente?'· ausente na planilha':''}</td><td class="num">${money(x.antes)}</td><td class="num">${money(x.depois)}</td></tr>`).join('')}</tbody></table></div><label class="check-label"><input type="checkbox" id="importAgree">Conferi o período, os valores e as contas ausentes</label><button id="importSave" class="primary" disabled>Salvar este mês</button>`;$$('importAgree').onchange=e=>$$('importSave').disabled=!e.target.checked;$$('importSave').onclick=async()=>{if(!$$('importAgree').checked)return;try{await salvarMeses([r]);$$('detailDialog').close();}catch(e){toast(e.message,'err');}};}catch(e){toast(e.message,'err');}};}catch(e){toast(e.message,'err');}}
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
  if($$('cfgAgree')){$$('cfgAgree').onchange=e=>$$('cfgRestore').disabled=!e.target.checked;$$('cfgRestore').onclick=async()=>{if(!state.permissoes.admin||!$$('cfgAgree').checked)return;const b=$$('cfgRestore');b.disabled=true;try{const r=await api('setCfg',{cfg:{...state.cfg,...cfg},baseAtualizadoEm:state.cfgVersion||null});if(!r.ok)throw new Error(r.conflito?'As regras mudaram na nuvem. Leia a base novamente antes de revisar o backup.':r.erro||'Gravação não confirmada.');state.cfg={...state.cfg,...cfg};state.cfgVersion=r.atualizadoEm;$$('cfgResult').textContent='Regras confirmadas na nuvem.';}catch(e){$$('cfgResult').textContent=e.message;b.disabled=false;}};}
 }catch(e){toast(e.message,'err');}
}
function revisarConflito(id){const item=getQueue().find(it=>it.opId===id);if(!item)return;const remote=item.conflito?.servidor;const dif=remote?diffRegistro(remote,item.registro):[];dialog('Revisar edição de '+item.registro.label,`<p>${remote?'Há uma versão diferente na nuvem. Compare os valores antes de escolher.':'A edição foi preservada e ainda não foi confirmada.'}</p>${dif.map(x=>linha(x.name+' · nuvem '+money(x.antes)+' → aparelho',x.depois)).join('')}<div class="actions"><button id="saveConflictCopy">Baixar cópia desta edição</button>${remote?'<button id="adoptRemote">Usar versão da nuvem</button><button id="retryLocal" class="primary">Confirmar versão deste aparelho</button>':'<button id="retryLocal" class="primary">Tentar envio novamente</button>'}</div>`);$$('saveConflictCopy').onclick=()=>download('edicao-'+safeId(item.registro.label)+'.json',JSON.stringify(item,null,2));if($$('adoptRemote'))$$('adoptRemote').onclick=async()=>{download('edicao-preservada-'+safeId(item.registro.label)+'.json',JSON.stringify(item,null,2));setQueue(getQueue().filter(it=>it.opId!==id));$$('detailDialog').close();await pullCloud();};$$('retryLocal').onclick=async()=>{const q=getQueue(),it=q.find(x=>x.opId===id);if(!it)return;it.registro.baseAtualizadoEm=item.conflito?(remote?.atualizadoEm||null):(it.registro.baseAtualizadoEm||null);delete it.conflito;delete it.erro;setQueue(q);$$('detailDialog').close();await trySync();render();};}
function logout(){if(getQueue().length&&!confirm('Há edições pendentes neste aparelho. Elas serão preservadas para o próximo acesso. Sair?'))return;AUTH.esquecer();$$('appShell').hidden=true;$$('authOverlay').hidden=false;$$('loginPass').value='';state.D=null;state.records=[];state.permissoes={leitura:true,edicao:false,admin:false};}
function initApp(){
  $$('loginForm').onsubmit=async e=>{e.preventDefault();$$('loginErr').textContent='';const b=e.target.querySelector('button');b.disabled=true;try{await AUTH.entrar($$('loginPass').value);$$('loginPass').value='';await onAuthed();}catch(err){$$('loginErr').textContent=err.message||'Não foi possível entrar.';}finally{b.disabled=false;}};
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();});$$('settingsBtn').onclick=()=>{state.view='config';render();};$$('helpBtn').onclick=()=>{state.view='ajuda';render();};$$('logoutBtn').onclick=logout;$$('syncBtn').onclick=()=>pullCloud(true);
  $$('monthSelect').onchange=e=>{state.periodo=e.target.value;if(state.comparar===state.periodo)state.comparar='';render();};$$('compareSelect').onchange=e=>{state.comparar=e.target.value;render();};
  $$('detailClose').onclick=()=>$$('detailDialog').close();$$('themeToggle').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem(THEME_KEY,document.body.classList.contains('dark')?'dark':'light');};document.body.classList.toggle('dark',localStorage.getItem(THEME_KEY)==='dark');
  $$('monthFileInput').onchange=async e=>{if(e.target.files[0])await previewImport(e.target.files[0]);e.target.value='';};$$('restoreInput').onchange=async e=>{if(e.target.files[0])await importarBackup(e.target.files[0]);e.target.value='';};
  window.addEventListener('online',()=>pullCloud());window.addEventListener('offline',()=>setSyncState('off','Offline · dados locais'));
  onAuthed().catch(e=>{$$('loginErr').textContent=e.message;});
}
document.addEventListener('DOMContentLoaded',initApp);
