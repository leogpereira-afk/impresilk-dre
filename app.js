/* ====================================================================
   Impresilk · DRE Caixa — dashboard
   Fonte de dados: data.js (padrão) ou planilha .xlsx carregada no navegador.
   ==================================================================== */

const STORE_KEY = 'impresilk_dre_data';
const THEME_KEY = 'impresilk_dre_theme';
const VIEW_KEY = 'impresilk_dre_view';

const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();
let activeRenderAll = null; // permite recolorir após troca de tema

/* ---------- parsing de números pt-BR (espelha o extract.py) ---------- */
function parseNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (s === '') return 0;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (s.includes(',')) s = s.replace(',', '.');                                   // 680,00
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
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
    const na = { ...a, values };
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
  return { company: D.company, basis: D.basis, months, accounts, _replaced: D.months.includes(monthLabel) };
}

function getCurrentData() {
  try { const s = localStorage.getItem(STORE_KEY); if (s) return JSON.parse(s); } catch (_) {}
  return window.DRE_DATA;
}

/* ====================================================================
   Sincronização offline-first (padrão do GUIA-SYNC) — por MÊS
   --------------------------------------------------------------------
   Modelo: CADA MÊS = 1 registro (id estável, atualizadoEm ISO). Assim a
   detecção de conflito por timestamp do os.mjs (upsert) funciona por mês —
   dois aparelhos editando meses DIFERENTES offline nunca se sobrescrevem.
   - grava SEMPRE no localStorage (funciona 100% offline);
   - ao salvar um mês: enfileira um upsert e tenta sincronizar;
   - ao abrir / reconectar: drena a fila pendente e puxa os meses do servidor,
     mesclando por timestamp (last-write-wins por mês);
   - CONFLITO (servidor mais novo): adota a versão do servidor, sem perder dado.
   O contrato de ações é o mesmo do PCP, então o backend pode ser trocado depois. */
const MONTH_TS_KEY = 'impresilk_dre_month_ts'; // { label: atualizadoEm } por mês
const QUEUE_KEY = 'impresilk_dre_queue';       // fila persistente de upserts pendentes
const PT_MES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const MAX_FAILS = 25; // descarta item após N erros permanentes (não inchar o localStorage)

// id de blob estável e seguro a partir do rótulo do mês ("Jun/2026" -> "Jun_2026")
function safeId(label) { return String(label).trim().replace(/[^\w]+/g, '_'); }
// chave de ordenação cronológica a partir do rótulo pt-BR
function monthSortKey(label) {
  const m = String(label).toLowerCase().match(/([a-z]{3})\w*\s*[\/\-]?\s*(\d{4})/);
  if (!m) return -1;
  const mi = PT_MES[m[1]]; return (+m[2]) * 12 + (mi == null ? 0 : mi);
}

function getMonthTS() { try { return JSON.parse(localStorage.getItem(MONTH_TS_KEY)) || {}; } catch (_) { return {}; } }
function setMonthTS(map) { try { localStorage.setItem(MONTH_TS_KEY, JSON.stringify(map)); } catch (_) {} }
function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (_) { return []; } }
function setQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (_) {} }

// dataset (centrado em contas) -> 1 registro por mês (centrado em células)
function monthRecord(D, i, ts) {
  const label = D.months[i];
  return {
    id: safeId(label), label, atualizadoEm: ts,
    company: D.company, basis: D.basis,
    cells: D.accounts.map(a => ({ code: a.code, name: a.name, level: a.level, parent: a.parent, value: a.values[i] || 0 })),
  };
}
// registros por mês -> dataset (reconstrói as contas, em ordem cronológica)
function monthsToDataset(records) {
  const recs = records.slice().sort((a, b) => monthSortKey(a.label) - monthSortKey(b.label));
  const months = recs.map(r => r.label);
  const meta = new Map(); const order = []; // união de códigos preservando a ordem hierárquica
  recs.forEach(r => (r.cells || []).forEach(c => {
    if (!meta.has(c.code)) { meta.set(c.code, { name: c.name, level: c.level, parent: c.parent }); order.push(c.code); }
  }));
  const accounts = order.map(code => {
    const m = meta.get(code);
    const values = recs.map(r => { const c = (r.cells || []).find(x => x.code === code); return c ? (c.value || 0) : 0; });
    return { code, name: m.name, level: m.level, parent: m.parent, values };
  });
  const last = recs[recs.length - 1] || {};
  return { company: last.company, basis: last.basis, months, accounts };
}

// indicador visual no botão de sync: ☁️ ok · ⏳ trabalhando · 📴 offline/erro · ⚠️ pendências
function setSyncState(state, title) {
  const b = document.getElementById('syncBtn');
  if (!b) return;
  const icon = state === 'busy' ? '⏳' : state === 'off' ? '📴' : state === 'pending' ? '⚠️' : '☁️';
  b.textContent = icon;
  b.classList.toggle('busy', state === 'busy');
  if (title) b.title = title;
}

// fila inteligente: upsert do mesmo mês SUBSTITUI o anterior (só a versão mais nova importa)
function enqueueUpsert(record) {
  const q = getQueue().filter(it => !(it.action === 'upsert' && it.registro && it.registro.id === record.id));
  q.push({ action: 'upsert', registro: record, fails: 0 });
  setQueue(q);
}

// adota a versão do servidor de um mês (resolução de conflito) e re-renderiza
function adoptServerMonth(record) {
  const D = getCurrentData();
  const recs = datasetRecords(D);
  const map = new Map(recs.map(r => [r.id, r]));
  map.set(record.id, normalizeRecord(record));
  const merged = monthsToDataset([...map.values()]);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); } catch (_) {}
  const ts = getMonthTS(); ts[record.label || record.id] = record.atualizadoEm; setMonthTS(ts);
  boot(merged);
}
// garante o shape esperado (label/cells) num registro vindo do servidor
function normalizeRecord(r) {
  return { id: r.id, label: r.label || r.id, atualizadoEm: r.atualizadoEm, company: r.company, basis: r.basis, cells: r.cells || [] };
}
// quebra o dataset local atual em registros por mês (usando os timestamps locais)
function datasetRecords(D) {
  const ts = getMonthTS();
  return (D.months || []).map((label, i) => monthRecord(D, i, ts[label] || '1970-01-01T00:00:00.000Z'));
}

let _syncing = false;
// drena a fila pendente (item E/L do guia): chama upsert por mês; trata conflito,
// distingue falha de rede (retenta depois) de erro permanente (descarta após MAX_FAILS)
async function trySync() {
  if (typeof api !== 'function' || _syncing) return;
  const q0 = getQueue();
  if (!q0.length) { setSyncState('ok', 'Tudo sincronizado'); return; }
  if (!navigator.onLine) { setSyncState('off', q0.length + ' mês(es) pendente(s) — offline'); return; }
  _syncing = true; setSyncState('busy', 'Enviando ' + q0.length + ' pendência(s)…');
  try {
    let q = getQueue();
    while (q.length) {
      const item = q[0];
      let r;
      try { r = await api(item.action, { registro: item.registro }); }
      catch (_) { setSyncState('off', q.length + ' pendência(s) — sem rede'); _syncing = false; return; } // rede: para e retenta
      if (r && r.conflito && r.servidor) {            // servidor mais novo: adota e descarta o item
        adoptServerMonth(r.servidor);
        q = getQueue().slice(1); setQueue(q); continue;
      }
      if (r && r.ok) {                                 // sucesso: confirma o carimbo do servidor e remove
        const ts = getMonthTS();
        const lbl = (r.registro && r.registro.label) || item.registro.label;
        if (r.registro && r.registro.atualizadoEm) ts[lbl] = r.registro.atualizadoEm;
        setMonthTS(ts);
        q = getQueue().slice(1); setQueue(q); continue;
      }
      // erro permanente (ex.: 400): conta falhas e descarta após o limite
      item.fails = (item.fails || 0) + 1;
      if (item.fails >= MAX_FAILS) { q = getQueue().slice(1); setQueue(q); }
      else { q = getQueue(); q[0] = item; setQueue(q); _syncing = false; setSyncState('pending', 'Pendência com erro — tentará de novo'); return; }
    }
    setSyncState('ok', 'Tudo sincronizado · ' + new Date().toLocaleString('pt-BR'));
  } finally { _syncing = false; }
}

// puxa os meses do servidor (list paginado) e mescla por timestamp.
// manual=true => avisa por toast mesmo quando nada mudou.
async function pullCloud(manual) {
  if (typeof api !== 'function') return;
  await trySync();                                     // primeiro sobe o que está pendente
  if (!navigator.onLine) { setSyncState('off', 'Offline — usando dados locais'); return; }
  setSyncState('busy', 'Buscando da nuvem…');
  const remote = [];
  let offset = 0, guard = 0;
  try {
    while (true) {
      const r = await api('list', { offset });
      (r.itens || []).forEach(it => remote.push(it));
      if (r.nextOffset == null) break;
      offset = r.nextOffset;
      if (++guard > 100) break;                        // trava de segurança contra loop infinito
    }
  } catch (_) { setSyncState('off', 'Offline — usando dados locais'); return; }

  if (!remote.length) {                                // nuvem vazia
    setSyncState(getQueue().length ? 'pending' : 'ok', 'Nuvem sem dados ainda');
    if (manual) toast('Nuvem ainda sem dados — suba um mês para começar', 'ok');
    return;
  }
  const D = getCurrentData();
  const localMap = new Map(datasetRecords(D).map(r => [r.id, r]));
  const tsMap = getMonthTS();
  let changed = false;
  remote.forEach(rem => {
    const r = normalizeRecord(rem);
    const cur = localMap.get(r.id);
    const tsLocal = cur ? new Date(cur.atualizadoEm).getTime() : 0;
    const tsRemote = new Date(r.atualizadoEm).getTime();
    if (!cur || tsRemote > tsLocal) {                  // novo no remoto, ou remoto mais novo → adota
      localMap.set(r.id, r); tsMap[r.label] = r.atualizadoEm; changed = true;
    }
  });
  if (!changed) {
    setSyncState(getQueue().length ? 'pending' : 'ok', 'Já atualizado · ' + new Date().toLocaleString('pt-BR'));
    if (manual) toast('Tudo já estava atualizado ✓', 'ok');
    return;
  }
  setMonthTS(tsMap);
  const merged = monthsToDataset([...localMap.values()]);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); } catch (_) {}
  boot(merged);
  setSyncState(getQueue().length ? 'pending' : 'ok', 'Atualizado da nuvem · ' + new Date().toLocaleString('pt-BR'));
  toast('Dados atualizados da nuvem ☁️', 'ok');
}

/* ---------- backup local (item N do guia) ----------
   Segurança extra independente da nuvem: baixa/recupera TODOS os meses num
   .json. Útil antes de limpar cache ou para migrar de aparelho sem depender
   do Blobs. O backup carrega os registros por mês + timestamps. */
function exportarBackup() {
  const D = getCurrentData();
  const data = {
    versao: 1, app: 'impresilk-dre', exportadoEm: new Date().toISOString(),
    meses: datasetRecords(D),          // 1 registro por mês (com atualizadoEm)
    monthTS: getMonthTS(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `impresilk-dre-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Backup salvo · ${(D.months || []).length} meses 💾`, 'ok');
}

function importarBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const recs = Array.isArray(data.meses) ? data.meses.map(normalizeRecord) : [];
      if (!recs.length) { toast('Backup sem meses válidos', 'err'); return; }
      const merged = monthsToDataset(recs);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); } catch (_) {}
      // adota os timestamps do backup e enfileira tudo para re-subir à nuvem
      const tsMap = data.monthTS && typeof data.monthTS === 'object' ? data.monthTS : {};
      recs.forEach(r => { if (!tsMap[r.label]) tsMap[r.label] = r.atualizadoEm; });
      setMonthTS(tsMap);
      setQueue([]);                    // limpa a fila: ids antigos virariam erro eterno (item N)
      recs.forEach(r => enqueueUpsert(r));
      boot(merged);
      toast(`Backup restaurado · ${merged.months.length} meses 📂`, 'ok');
      trySync();                       // re-sincroniza o backup para a nuvem
    } catch (err) {
      console.error(err);
      toast('Erro ao ler backup: ' + err.message, 'err');
    }
  };
  reader.onerror = () => toast('Falha ao ler o arquivo', 'err');
  reader.readAsText(file);
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast ' + kind; }, 3800);
}

/* ==================================================================== */
/*  RENDER — recebe o dataset e (re)desenha tudo                          */
/* ==================================================================== */
let _charts = { trend: null, comp: null, opOwner: null, marginLayers: null, center: null, bigCenter: null };
function destroyChart(k) { if (_charts[k]) { _charts[k].destroy(); _charts[k] = null; } }

/* ---------- mini sparkline SVG (sem dependência) ---------- */
function sparkline(values, opts = {}) {
  const w = opts.w || 120, h = opts.h || 30, pad = 2;
  const min = Math.min(...values, 0), max = Math.max(...values, 0);
  const span = (max - min) || 1;
  const n = values.length;
  const x = i => pad + (i * (w - 2 * pad)) / Math.max(n - 1, 1);
  const y = v => h - pad - ((v - min) / span) * (h - 2 * pad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[n - 1], first = values[0];
  const col = opts.color || (last >= first ? '#34d399' : '#f87171');
  const zeroY = y(0);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="0" y1="${zeroY.toFixed(1)}" x2="${w}" y2="${zeroY.toFixed(1)}" class="spark-zero"/>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.8"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.4" fill="${col}"/>
  </svg>`;
}
/* coeficiente de variação e tendência linear simples */
function trendStats(values) {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / (n || 1);
  // regressão linear (slope) sobre índice 0..n-1
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  values.forEach((v, i) => { sx += i; sy += v; sxx += i * i; sxy += i * v; });
  const slope = (n * sxy - sx * sy) / ((n * sxx - sx * sx) || 1);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n || 1);
  const cv = mean ? Math.sqrt(variance) / Math.abs(mean) : 0;
  const slopePctMonth = mean ? slope / Math.abs(mean) : 0; // crescimento médio por mês relativo
  return { mean, slope, slopePctMonth, cv, first: values[0], last: values[n - 1] };
}

function boot(D) {
  const MONTHS = D.months;
  const ACCS = D.accounts;

  const byCode = new Map();
  ACCS.forEach(a => byCode.set(a.code, a));
  const childrenOf = new Map();
  ACCS.forEach(a => {
    if (a.parent) {
      if (!childrenOf.has(a.parent)) childrenOf.set(a.parent, []);
      childrenOf.get(a.parent).push(a);
    }
  });
  const get = c => byCode.get(c);
  const val = (a, i) => (a ? a.values[i] : 0);

  const REC = get('1'), DESP = get('2');
  const revAt = i => val(REC, i);
  const expAt = i => val(DESP, i);
  const resAt = i => revAt(i) - expAt(i);
  const marginAt = i => (revAt(i) ? resAt(i) / revAt(i) : 0);

  const revSections = (childrenOf.get('1') || []).slice();
  const expSections = (childrenOf.get('2') || []).slice();

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const BRL2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = v => BRL.format(v || 0);
  const fmt2 = v => BRL2.format(v || 0);
  const pct = v => (v == null || !isFinite(v)) ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const signedPct = v => (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + pct(v);

  let cur = MONTHS.length - 1;
  let cmp = MONTHS.length >= 2 ? MONTHS.length - 2 : 0;
  let chartMode = 'bars';

  // ---- selects ----
  const monthSel = document.getElementById('monthSelect');
  const cmpSel = document.getElementById('compareSelect');
  monthSel.innerHTML = ''; cmpSel.innerHTML = '';
  MONTHS.forEach((m, i) => { monthSel.add(new Option(m, i)); cmpSel.add(new Option(m, i)); });
  monthSel.value = cur; cmpSel.value = cmp;
  monthSel.onchange = () => { cur = +monthSel.value; if (cmp === cur) { cmp = cur > 0 ? cur - 1 : Math.min(cur + 1, MONTHS.length - 1); cmpSel.value = cmp; } renderAll(); };
  cmpSel.onchange = () => { cmp = +cmpSel.value; renderAll(); };

  // ===== KPIs =====
  function renderKPIs() {
    const cards = [
      { cls: 'rev', label: 'Receita Total', val: revAt(cur), prev: revAt(cmp), goodUp: true },
      { cls: 'exp', label: 'Despesa Total', val: expAt(cur), prev: expAt(cmp), goodUp: false },
      { cls: 'res', label: resAt(cur) >= 0 ? 'Resultado (Lucro)' : 'Resultado (Prejuízo)', val: resAt(cur), prev: resAt(cmp), goodUp: true },
      { cls: 'mar', label: 'Margem Líquida', val: marginAt(cur), prev: marginAt(cmp), goodUp: true, isPct: true },
    ];
    document.getElementById('kpis').innerHTML = cards.map(c => {
      let dClass, dTxt;
      if (c.isPct) {
        const diff = c.val - c.prev;
        dClass = Math.abs(diff) < 1e-9 ? 'flat' : (diff > 0 ? 'up' : 'down');
        dTxt = (diff >= 0 ? '+' : '') + (diff * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' p.p.';
      } else {
        const diff = c.prev ? (c.val - c.prev) / Math.abs(c.prev) : 0;
        const goodDir = c.goodUp ? diff >= 0 : diff <= 0;
        dClass = Math.abs(diff) < 1e-9 ? 'flat' : (goodDir ? 'up' : 'down');
        dTxt = signedPct(diff);
      }
      const arrow = dClass === 'up' ? '▲' : dClass === 'down' ? '▼' : '■';
      const valTxt = c.isPct ? pct(c.val) : fmt2(c.val);
      const valColor = (c.cls === 'res') ? (c.val >= 0 ? 'pos' : 'neg') : '';
      return `<div class="kpi ${c.cls}">
        <div class="label">${c.label}</div>
        <div class="value ${valColor}">${valTxt}</div>
        <div class="delta ${dClass}">${arrow} ${dTxt} <span class="vs">vs ${MONTHS[cmp]}</span></div>
      </div>`;
    }).join('');
  }

  // ===== Insights =====
  function renderInsights() {
    const res = resAt(cur), resP = resAt(cmp);
    const margin = marginAt(cur), marginP = marginAt(cmp);
    const badge = document.getElementById('insightBadge');
    badge.className = 'badge ' + (res >= 0 ? 'pos' : 'neg');
    badge.textContent = res >= 0 ? 'Resultado positivo' : 'Resultado negativo';

    const items = [];
    items.push({ type: res >= 0 ? 'good' : 'bad', title: res >= 0 ? 'Lucro no período' : 'Prejuízo no período',
      html: `Em <b>${MONTHS[cur]}</b> o resultado de caixa foi <b>${fmt2(res)}</b> (margem ${pct(margin)}). ` + (resP !== 0 ? `No mês comparado foi ${fmt2(resP)}.` : '') });

    const dRev = revAt(cmp) ? (revAt(cur) - revAt(cmp)) / revAt(cmp) : 0;
    items.push({ type: dRev >= 0 ? 'good' : 'warn', title: dRev >= 0 ? 'Receita em alta' : 'Receita em queda',
      html: `Receita ${dRev >= 0 ? 'subiu' : 'caiu'} <b>${signedPct(dRev)}</b> vs ${MONTHS[cmp]} (${fmt(revAt(cur))} contra ${fmt(revAt(cmp))}).` });

    const moves = expSections.map(s => { const a = val(s, cur), b = val(s, cmp); return { name: s.name, cur: a, prev: b, abs: a - b, rel: b ? (a - b) / b : (a ? 1 : 0) }; }).filter(m => Math.abs(m.abs) > 1);
    const upMove = [...moves].sort((x, y) => y.abs - x.abs)[0];
    const downMove = [...moves].sort((x, y) => x.abs - y.abs)[0];
    if (upMove && upMove.abs > 0) items.push({ type: 'warn', title: 'Maior aumento de despesa', html: `<b>${upMove.name}</b> subiu <b>${fmt(upMove.abs)}</b> (${signedPct(upMove.rel)}) — de ${fmt(upMove.prev)} para ${fmt(upMove.cur)}.` });
    if (downMove && downMove.abs < 0) items.push({ type: 'good', title: 'Maior redução de despesa', html: `<b>${downMove.name}</b> caiu <b>${fmt(Math.abs(downMove.abs))}</b> (${signedPct(downMove.rel)}) — de ${fmt(downMove.prev)} para ${fmt(downMove.cur)}.` });

    const topExp = [...expSections].map(s => ({ name: s.name, v: val(s, cur) })).sort((a, b) => b.v - a.v)[0];
    if (topExp) items.push({ type: 'warn', title: 'Maior peso nas despesas', html: `<b>${topExp.name}</b> representa <b>${pct(expAt(cur) ? topExp.v / expAt(cur) : 0)}</b> das despesas (${fmt(topExp.v)}), ou ${pct(revAt(cur) ? topExp.v / revAt(cur) : 0)} da receita.` });

    const topRev = [...revSections].map(s => ({ name: s.name, v: val(s, cur) })).sort((a, b) => b.v - a.v)[0];
    if (topRev) items.push({ type: revAt(cur) && topRev.v / revAt(cur) > 0.6 ? 'warn' : 'good', title: 'Concentração de receita', html: `<b>${topRev.name}</b> gera <b>${pct(revAt(cur) ? topRev.v / revAt(cur) : 0)}</b> da receita do mês.` });

    const dM = margin - marginP;
    items.push({ type: dM >= 0 ? 'good' : 'bad', title: 'Tendência de margem', html: `Margem ${dM >= 0 ? 'melhorou' : 'piorou'} <b>${(dM >= 0 ? '+' : '') + (dM * 100).toFixed(1)} p.p.</b> vs ${MONTHS[cmp]} (de ${pct(marginP)} para ${pct(margin)}).` });

    document.getElementById('insights').innerHTML = items.map(it => `<div class="insight ${it.type}"><span class="it ${it.type}">${it.title}</span>${it.html}</div>`).join('');
  }

  // ===== DRE por seção =====
  const openSections = new Set();
  function renderDRE() {
    const tb = document.querySelector('#dreTable tbody');
    const rows = [];
    const denom = revAt(cur) || 1;

    function sectionRows(sections, groupCls) {
      sections.forEach(s => {
        const v = val(s, cur), vp = val(s, cmp);
        const ah = vp ? (v - vp) / vp : (v ? 1 : null);
        const kids = (childrenOf.get(s.code) || []).filter(k => val(k, cur) !== 0 || val(k, cmp) !== 0);
        const hasKids = kids.length > 0;
        const isOpen = openSections.has(s.code);
        rows.push(`<tr class="section ${groupCls} ${isOpen ? 'open' : ''}" data-code="${s.code}">
          <td class="t-name">${hasKids ? '<span class="caret">▸</span>' : '<span class="caret"></span>'}${s.name}</td>
          <td class="mono">${fmt(v)}</td><td class="av">${pct(v / denom)}</td>
          <td class="${ah == null ? 'av' : ah >= 0 ? 'pos' : 'neg'}">${ah == null ? '—' : signedPct(ah)}</td></tr>`);
        if (hasKids && isOpen) {
          kids.sort((a, b) => val(b, cur) - val(a, cur)).forEach(k => {
            const kv = val(k, cur), kvp = val(k, cmp);
            const kah = kvp ? (kv - kvp) / kvp : (kv ? 1 : null);
            rows.push(`<tr class="child" data-parent="${s.code}"><td class="t-name">${k.name}</td>
              <td class="mono">${fmt(kv)}</td><td class="av">${pct(kv / denom)}</td>
              <td class="${kah == null ? 'av' : kah >= 0 ? 'pos' : 'neg'}">${kah == null ? '—' : signedPct(kah)}</td></tr>`);
          });
        }
      });
    }
    rows.push(groupRow('1 · RECEITAS', revAt(cur), denom, revAt(cmp), 'rev'));
    sectionRows(revSections, '');
    rows.push(groupRow('2 · DESPESAS', expAt(cur), denom, expAt(cmp), 'exp'));
    sectionRows(expSections, 'exp');
    const r = resAt(cur), rp = resAt(cmp);
    const rah = rp ? (r - rp) / Math.abs(rp) : null;
    rows.push(`<tr class="result"><td class="t-name">= RESULTADO</td>
      <td class="mono ${r >= 0 ? 'pos' : 'neg'}">${fmt2(r)}</td><td class="av">${pct(r / denom)}</td>
      <td class="${rah == null ? 'av' : rah >= 0 ? 'pos' : 'neg'}">${rah == null ? '—' : signedPct(rah)}</td></tr>`);

    tb.innerHTML = rows.join('');
    tb.querySelectorAll('tr.section[data-code]').forEach(tr => {
      tr.querySelector('.t-name').onclick = () => {
        const c = tr.dataset.code;
        if (openSections.has(c)) openSections.delete(c); else openSections.add(c);
        renderDRE();
      };
    });
  }
  function groupRow(label, v, denom, vp, cls) {
    const ah = vp ? (v - vp) / vp : null;
    return `<tr class="group ${cls}"><td class="t-name">${label}</td><td class="mono">${fmt(v)}</td>
      <td class="av">${pct(v / denom)}</td>
      <td class="${ah == null ? 'av' : ah >= 0 ? 'pos' : 'neg'}">${ah == null ? '—' : signedPct(ah)}</td></tr>`;
  }

  // ===== Composição de despesas =====
  const PALETTE = ['#38bdf8','#2dd4bf','#a78bfa','#f59e0b','#f472b6','#34d399','#fb7185','#60a5fa','#fbbf24','#22d3ee','#c084fc','#4ade80','#fca5a5','#818cf8','#fcd34d','#5eead4'];
  function renderComposition() {
    const data = expSections.map(s => ({ name: s.name, v: val(s, cur) })).filter(d => d.v > 0).sort((a, b) => b.v - a.v);
    const top = data.slice(0, 8);
    const restV = data.slice(8).reduce((s, d) => s + d.v, 0);
    const labels = top.map(d => d.name.replace(/^Despesas?\s+/i, ''));
    const vals = top.map(d => d.v);
    if (restV > 0) { labels.push('Outras'); vals.push(restV); }
    document.getElementById('compHint').textContent = MONTHS[cur] + ' · total ' + fmt(expAt(cur));

    if (_charts.comp) _charts.comp.destroy();
    _charts.comp = new Chart(document.getElementById('compChart'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: vals, backgroundColor: PALETTE, borderColor: cssVar('--chart-border') || '#161f2e', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { color: cssVar('--chart-tick'), font: { size: 11 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)} (${pct(c.raw / (expAt(cur) || 1))})` } } } }
    });
    const maxV = data[0] ? data[0].v : 1;
    document.getElementById('expenseRank').innerHTML = data.slice(0, 6).map(d =>
      `<div class="row"><span class="nm">${d.name}</span>
       <span class="vl">${fmt(d.v)} · ${pct(d.v / (expAt(cur) || 1))}</span>
       <span class="bar"><i style="width:${(d.v / maxV * 100).toFixed(1)}%"></i></span></div>`).join('');
  }

  // ===== Composição de receitas (por produto) =====
  function renderRevComposition() {
    // achata "Comunicação Visual" nos produtos (1.1.1.*) + Serviços, e mantém as demais receitas
    const sources = [];
    revSections.forEach(s => {
      if (s.code === '1.4') return; // Empréstimos não é receita operacional — fora da composição
      if (s.code === '1.1') {
        (childrenOf.get('1.1.1') || []).forEach(p => sources.push({ name: p.name, v: val(p, cur) }));
        const serv = get('1.1.2');
        if (serv) sources.push({ name: 'Serviços', v: val(serv, cur) });
      } else {
        sources.push({ name: s.name.replace(/^Receitas?\s+/i, ''), v: val(s, cur) });
      }
    });
    const data = sources.filter(d => d.v > 0).sort((a, b) => b.v - a.v);
    const totRev = data.reduce((s, d) => s + d.v, 0) || 1;
    const top = data.slice(0, 8);
    const restV = data.slice(8).reduce((s, d) => s + d.v, 0);
    const labels = top.map(d => d.name);
    const vals = top.map(d => d.v);
    if (restV > 0) { labels.push('Outras'); vals.push(restV); }
    document.getElementById('revCompHint').textContent = MONTHS[cur] + ' · total ' + fmt(totRev);

    if (_charts.revComp) _charts.revComp.destroy();
    _charts.revComp = new Chart(document.getElementById('revCompChart'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: vals, backgroundColor: PALETTE, borderColor: cssVar('--chart-border') || '#161f2e', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { color: cssVar('--chart-tick'), font: { size: 11 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)} (${pct(c.raw / totRev)})` } } } }
    });
    const maxV = data[0] ? data[0].v : 1;
    document.getElementById('revenueRank').innerHTML = data.slice(0, 6).map(d =>
      `<div class="row"><span class="nm">${d.name}</span>
       <span class="vl">${fmt(d.v)} · ${pct(d.v / totRev)}</span>
       <span class="bar pos"><i style="width:${(d.v / maxV * 100).toFixed(1)}%"></i></span></div>`).join('');
  }

  // ===== Comparativo mensal =====
  function renderTrend() {
    const labels = MONTHS;
    const rev = MONTHS.map((_, i) => revAt(i));
    const exp = MONTHS.map((_, i) => expAt(i));
    const result = MONTHS.map((_, i) => resAt(i));
    const margin = MONTHS.map((_, i) => marginAt(i) * 100);
    let cfg;
    if (chartMode === 'bars') {
      cfg = { type: 'bar', data: { labels, datasets: [
        { label: 'Receita', data: rev, backgroundColor: '#38bdf8', borderRadius: 5 },
        { label: 'Despesa', data: exp, backgroundColor: '#f59e9e', borderRadius: 5 }] }, options: baseOpts(v => fmt(v)) };
    } else if (chartMode === 'result') {
      cfg = { type: 'bar', data: { labels, datasets: [{ label: 'Resultado', data: result, borderRadius: 5,
        backgroundColor: result.map(v => v >= 0 ? '#34d399' : '#f87171') }] }, options: baseOpts(v => fmt(v)) };
    } else {
      cfg = { type: 'line', data: { labels, datasets: [{ label: 'Margem %', data: margin, borderColor: '#fbbf24',
        backgroundColor: 'rgba(251,191,36,.15)', fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: '#fbbf24' }] },
        options: baseOpts(v => v.toFixed(1) + '%', true) };
    }
    if (_charts.trend) _charts.trend.destroy();
    _charts.trend = new Chart(document.getElementById('trendChart'), cfg);
  }
  function baseOpts(tickFmt, isPct) {
    const tick = cssVar('--chart-tick'), grid = cssVar('--chart-grid');
    return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: tick, font: { size: 12 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${isPct ? c.raw.toFixed(1) + '%' : fmt2(c.raw)}` } } },
      scales: { x: { ticks: { color: tick }, grid: { color: grid } },
        y: { ticks: { color: tick, callback: tickFmt }, grid: { color: grid } } } };
  }
  document.querySelectorAll('#chartToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === chartMode);
    b.onclick = () => { document.querySelectorAll('#chartToggle button').forEach(x => x.classList.remove('active')); b.classList.add('active'); chartMode = b.dataset.mode; renderTrend(); };
  });

  // ===== Espelho completo =====
  const collapsed = new Set();
  function buildMirrorHead() {
    document.getElementById('mirrorHead').innerHTML =
      `<th class="t-name">Conta</th>` + MONTHS.map((m, i) => `<th data-mi="${i}" class="${i === cur ? 'cur-h' : ''}">${m}</th>`).join('') + `<th>Média</th>`;
  }
  function renderMirror() {
    const tb = document.querySelector('#mirrorTable tbody');
    const rows = [];
    ACCS.forEach(a => {
      const kids = childrenOf.get(a.code);
      const hasKids = kids && kids.length > 0;
      let hidden = false, p = a.parent;
      while (p) { if (collapsed.has(p)) { hidden = true; break; } p = get(p) ? get(p).parent : null; }
      const avg = a.values.reduce((s, v) => s + v, 0) / a.values.length;
      const cells = a.values.map((v, i) => `<td class="mono ${i === cur ? 'cur-col' : ''}">${v ? fmt(v) : '·'}</td>`).join('');
      const twig = hasKids ? `<span class="twiggle" data-code="${a.code}">${collapsed.has(a.code) ? '▸' : '▾'}</span>` : `<span class="leaf-dot">·</span>`;
      const indent = 'padding-left:' + (8 + (a.level - 1) * 16) + 'px';
      rows.push(`<tr class="lvl-${a.level} ${hidden ? 'hidden' : ''}" data-code="${a.code}" data-name="${a.name.toLowerCase()}">
        <td class="t-name" style="${indent}">${twig}<span class="nm">${a.name}</span></td>${cells}<td class="mono">${fmt(avg)}</td></tr>`);
    });
    tb.innerHTML = rows.join('');
    tb.querySelectorAll('.twiggle').forEach(t => {
      t.onclick = () => { const c = t.dataset.code; if (collapsed.has(c)) collapsed.delete(c); else collapsed.add(c); renderMirror(); };
    });
    applySearch();
  }
  function applySearch() {
    const q = (document.getElementById('treeSearch').value || '').trim().toLowerCase();
    const tb = document.querySelector('#mirrorTable tbody');
    tb.querySelectorAll('tr').forEach(tr => tr.classList.remove('match'));
    if (!q) return;
    tb.querySelectorAll('tr').forEach(tr => {
      if (tr.dataset.name && tr.dataset.name.includes(q)) {
        tr.classList.remove('hidden'); tr.classList.add('match');
        let p = get(tr.dataset.code).parent;
        while (p) { const pr = tb.querySelector(`tr[data-code="${cssEsc(p)}"]`); if (pr) pr.classList.remove('hidden'); p = get(p) ? get(p).parent : null; }
      }
    });
  }
  const cssEsc = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  document.getElementById('treeSearch').oninput = () => { if (document.getElementById('treeSearch').value.trim()) collapsed.clear(); renderMirror(); };
  document.getElementById('expandAll').onclick = () => { collapsed.clear(); renderMirror(); };
  document.getElementById('collapseAll').onclick = () => { collapsed.clear(); ACCS.forEach(a => { if ((childrenOf.get(a.code) || []).length && a.level >= 2) collapsed.add(a.code); }); renderMirror(); };

  // ===== CENTROS DE CUSTO =====
  // cada seção de despesa (2.x) é um centro de custo
  let activeCenter = null;
  function renderCenters() {
    const tabsEl = document.getElementById('centerTabs');
    if (!activeCenter || !get(activeCenter)) activeCenter = expSections.length ? expSections[0].code : null;
    tabsEl.innerHTML = expSections.map(s => {
      const short = s.name.replace(/^Despesas?\s+/i, '');
      return `<button data-c="${s.code}" class="${s.code === activeCenter ? 'active' : ''}">${short}</button>`;
    }).join('');
    tabsEl.querySelectorAll('button').forEach(b => b.onclick = () => { activeCenter = b.dataset.c; renderCenters(); });
    renderCenterPanel();
  }

  // ===== UTILIDADES: Energia (Cemig 2.5.3) × Água (Copasa 2.5.1) =====
  function renderUtilities() {
    const energy = get('2.5.3'), water = get('2.5.1');
    const kpisEl = document.getElementById('utilitiesKpis');
    const tbody = document.querySelector('#utilitiesTable tbody');
    if (!kpisEl || !tbody) return;
    if (!energy && !water) { kpisEl.innerHTML = '<p class="hint">Contas de energia/água não encontradas nos dados.</p>'; tbody.innerHTML = ''; destroyChart('utilities'); return; }
    const eVals = MONTHS.map((_, i) => val(energy, i));
    const wVals = MONTHS.map((_, i) => val(water, i));
    const tVals = MONTHS.map((_, i) => eVals[i] + wVals[i]);
    const eCur = eVals[cur], eCmp = eVals[cmp], wCur = wVals[cur], wCmp = wVals[cmp];
    const eAh = eCmp ? (eCur - eCmp) / eCmp : null;
    const wAh = wCmp ? (wCur - wCmp) / wCmp : null;
    const eAvg = eVals.reduce((s, v) => s + v, 0) / MONTHS.length;
    const wAvg = wVals.reduce((s, v) => s + v, 0) / MONTHS.length;
    // despesa: cair é bom (verde, ▼); subir é ruim (vermelho, ▲)
    const dCls = ah => ah == null ? 'flat' : ah <= 0 ? 'up' : 'down';
    const dArr = ah => ah == null ? '■' : ah <= 0 ? '▼' : '▲';

    kpisEl.innerHTML = `
      <div class="ck"><span class="ck-l">⚡ Energia · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(eCur)}</span><span class="delta ${dCls(eAh)}">${dArr(eAh)} ${eAh == null ? '—' : signedPct(eAh)} <span class="vs">vs ${MONTHS[cmp]}</span></span></div>
      <div class="ck"><span class="ck-l">💧 Água · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(wCur)}</span><span class="delta ${dCls(wAh)}">${dArr(wAh)} ${wAh == null ? '—' : signedPct(wAh)} <span class="vs">vs ${MONTHS[cmp]}</span></span></div>
      <div class="ck"><span class="ck-l">Total Utilidades · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(eCur + wCur)}</span><span class="ck-s">energia + água no mês</span></div>
      <div class="ck"><span class="ck-l">Média Energia ${MONTHS.length}m</span><span class="ck-v">${fmt(eAvg)}</span><span class="ck-s">gasto médio mensal</span></div>
      <div class="ck"><span class="ck-l">Média Água ${MONTHS.length}m</span><span class="ck-v">${fmt(wAvg)}</span><span class="ck-s">gasto médio mensal</span></div>`;

    tbody.innerHTML = MONTHS.map((m, i) => `<tr>
      <td class="t-name">${m}${i === cur ? ' <span class="u-now">atual</span>' : ''}</td>
      <td class="mono ${i === cur ? 'cur-col' : ''}">${eVals[i] ? fmt(eVals[i]) : '·'}</td>
      <td class="mono ${i === cur ? 'cur-col' : ''}">${wVals[i] ? fmt(wVals[i]) : '·'}</td>
      <td class="mono">${tVals[i] ? fmt(tVals[i]) : '·'}</td>
    </tr>`).join('');

    destroyChart('utilities');
    _charts.utilities = new Chart(document.getElementById('utilitiesChart'), {
      type: 'bar',
      data: { labels: MONTHS, datasets: [
        { label: '⚡ Energia (Cemig)', data: eVals, backgroundColor: '#fbbf24', borderRadius: 5 },
        { label: '💧 Água (Copasa)', data: wVals, backgroundColor: '#38bdf8', borderRadius: 5 },
        { type: 'line', label: 'Total', data: tVals, borderColor: '#34d399', backgroundColor: '#34d399', tension: .35, pointRadius: 3 }
      ] },
      options: baseOpts(v => fmt(v))
    });
  }

  // ===== Detalhamento por tema (Funcionários, Equipamentos, Produtos, Impostos, Veículos…) =====
  const BREAKDOWNS = [
    // ---- Receitas ----
    { key: 'revprod',   code: '1.1.1', rev: true, emoji: '🏷️', title: 'Receita por Produto',     sub: 'Mix de faturamento — placas, adesivos, lonas, acrílicos, letra caixa' },
    { key: 'revserv',   code: '1.1.2', rev: true, emoji: '🔧', title: 'Receita por Serviço',     sub: 'Serviços prestados — instalação, pintura, design, hora-máquina, deslocamento' },
    // ---- Despesas (centros de custo) ----
    { key: 'staff',     code: '2.1',  emoji: '👥', title: 'Funcionários',            sub: 'Folha completa — salários, FGTS, comissões, benefícios e rescisões' },
    { key: 'materials', code: '2.12', emoji: '📦', title: 'Materiais e Insumos',     sub: 'Custo direto de produção — serralheria, acabamento, impressão, usinagem, portas ACM' },
    { key: 'equip',     code: '2.6',  emoji: '🛠️', title: 'Máquinas & Equipamentos', sub: 'Custeio e manutenção do parque — Ampla, Myprinter, Roland, Router, laser' },
    { key: 'vehicles',  code: '2.7',  emoji: '🚚', title: 'Veículos · Frota',        sub: 'Combustível (maior peso), manutenção, licenciamento, IPVA, multas e seguro' },
    { key: 'outsource', code: '2.11', emoji: '🤝', title: 'Terceirização de Serviços', sub: 'Capacidade extra — frete, gráfica rápida, freelancer, munk/guindaste' },
    { key: 'thirdpty',  code: '2.8',  emoji: '📋', title: 'Terceiros',               sub: 'Serviços profissionais — consultoria, contabilidade, advogados e comissão de agência' },
    { key: 'admin',     code: '2.2',  emoji: '🗂️', title: 'Administrativas',         sub: 'Estrutura administrativa — manutenção predial, contribuição sindical, escritório, seguros' },
    { key: 'fixed',     code: '2.5',  emoji: '🏠', title: 'Custos Fixos · Estrutura', sub: 'Custos fixos — aluguel, telefonia/internet, T.I, softwares (água e energia no card acima)' },
    { key: 'safety',    code: '2.9',  emoji: '🦺', title: 'Segurança do Trabalho',   sub: 'Saúde ocupacional (NR) — medicina ocupacional e EPIs' },
    { key: 'external',  code: '2.10', emoji: '🪜', title: 'Instalações Externas',    sub: 'Despesas em obra — material de construção, viagem, estacionamento, andaimes' },
    { key: 'cleaning',  code: '2.3',  emoji: '🧹', title: 'Limpeza',                 sub: 'Conservação — material de limpeza e limpeza terceirizada' },
    { key: 'ads',       code: '2.15', emoji: '📣', title: 'Publicidade & Marketing', sub: 'Marketing — mídia paga (Meta), videomaker e desenvolvimento' },
    { key: 'invest',    code: '2.16', emoji: '📈', title: 'Investimentos',           sub: 'Aportes e investimentos no período' },
    { key: 'taxes',     code: '2.4',  emoji: '🏛️', title: 'Impostos',                sub: 'Carga tributária — DARF, DAS, ICMS, ISSQN, IPTU, IOF' },
    { key: 'banking',   code: '2.13', emoji: '🏦', title: 'Bancárias',               sub: 'Custo financeiro — juros de cartão (maior peso), tarifas e manutenção de conta' },
    { key: 'partners',  code: '2.14', emoji: '👔', title: 'Societárias',             sub: 'Sócios & dívida — retiradas, empréstimos bancários e arrendamento' },
  ];
  const BRK_PALETTE = ['#a78bfa', '#38bdf8', '#2dd4bf', '#f59e0b', '#fb7185', '#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#4ade80', '#fca5a5', '#22d3ee'];

  function buildBreakdownShells() {
    const host = document.getElementById('breakdownCards');
    if (!host || host.childElementCount) return;
    host.innerHTML = BREAKDOWNS.map(b => `
      <section class="card brk-card ${b.rev ? 'brk-rev' : ''}" id="brk-${b.key}" data-default-collapsed>
        <div class="card-head">
          <h2>${b.emoji} ${b.title}</h2>
          <span class="hint">${b.sub}</span>
        </div>
        <div class="center-kpis" id="brk-${b.key}-kpis"></div>
        <div class="util-grid">
          <div class="chart-wrap"><canvas id="brk-${b.key}-chart"></canvas></div>
          <div id="brk-${b.key}-rank" class="rank"></div>
        </div>
      </section>`).join('');
  }

  function renderBreakdowns() {
    buildBreakdownShells();

    BREAKDOWNS.forEach(b => {
      const parent = get(b.code);
      const kpisEl = document.getElementById('brk-' + b.key + '-kpis');
      const rankEl = document.getElementById('brk-' + b.key + '-rank');
      const cv = document.getElementById('brk-' + b.key + '-chart');
      if (!parent || !kpisEl || !rankEl || !cv) return;

      // receita: subir é bom (verde, ▲). despesa: cair é bom (verde, ▼)
      const dCls = ah => ah == null ? 'flat' : (b.rev ? ah >= 0 : ah <= 0) ? 'up' : 'down';
      const dArr = ah => ah == null ? '■' : ah >= 0 ? '▲' : '▼';

      const totVals = MONTHS.map((_, i) => val(parent, i));
      const totCur = totVals[cur], totCmp = totVals[cmp];
      const ah = totCmp ? (totCur - totCmp) / totCmp : null;
      const avg = totVals.reduce((s, v) => s + v, 0) / MONTHS.length;
      const base = b.rev ? revAt(cur) : expAt(cur);
      const share = base ? totCur / base : 0;
      const shareLabel = b.rev ? '% da Receita' : '% das Despesas';
      const shareSub = b.rev ? 'peso no faturamento do mês' : 'peso no total de despesas';
      const avgSub = b.rev ? 'receita média mensal' : 'gasto médio mensal';

      // filhos com algum movimento no período
      const kids = (childrenOf.get(b.code) || [])
        .map(k => ({ name: k.name, vals: MONTHS.map((_, i) => val(k, i)), cur: val(k, cur) }))
        .filter(k => k.vals.some(v => v !== 0));
      const ranked = [...kids].sort((a, c) => c.cur - a.cur);
      const top = ranked.slice(0, 6);
      const topName = ranked[0] && ranked[0].cur > 0 ? ranked[0].name : '—';
      const topVal = ranked[0] ? ranked[0].cur : 0;

      kpisEl.innerHTML = `
        <div class="ck"><span class="ck-l">${b.emoji} Total · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(totCur)}</span><span class="delta ${dCls(ah)}">${dArr(ah)} ${ah == null ? '—' : signedPct(ah)} <span class="vs">vs ${MONTHS[cmp]}</span></span></div>
        <div class="ck"><span class="ck-l">Média ${MONTHS.length}m</span><span class="ck-v">${fmt(avg)}</span><span class="ck-s">${avgSub}</span></div>
        <div class="ck"><span class="ck-l">Maior item · ${MONTHS[cur]}</span><span class="ck-v" style="font-size:15px">${topName}</span><span class="ck-s">${topVal ? fmt(topVal) : '—'}</span></div>
        <div class="ck"><span class="ck-l">${shareLabel}</span><span class="ck-v">${pct(share)}</span><span class="ck-s">${shareSub}</span></div>`;

      // ranking do mês atual
      const maxV = ranked[0] && ranked[0].cur > 0 ? ranked[0].cur : 1;
      const visible = ranked.filter(k => k.cur > 0).slice(0, 8);
      rankEl.innerHTML = visible.length
        ? visible.map(k => `<div class="row"><span class="nm">${k.name}</span>
            <span class="vl">${fmt(k.cur)} · ${pct(totCur ? k.cur / totCur : 0)}</span>
            <span class="bar ${b.rev ? 'pos' : ''}"><i style="width:${(k.cur / maxV * 100).toFixed(1)}%"></i></span></div>`).join('')
        : '<p class="hint">Sem lançamentos neste mês.</p>';

      // gráfico: barras empilhadas por item (top 6) + Outros, mês a mês
      const restVals = MONTHS.map((_, i) => kids.reduce((s, k) => s + k.vals[i], 0) - top.reduce((s, k) => s + k.vals[i], 0));
      const datasets = top.map((k, idx) => ({ label: k.name, data: k.vals, backgroundColor: BRK_PALETTE[idx % BRK_PALETTE.length], borderRadius: 4, stack: 's' }));
      if (restVals.some(v => v > 0.5)) datasets.push({ label: 'Outros', data: restVals, backgroundColor: '#64748b', borderRadius: 4, stack: 's' });

      destroyChart('brk-' + b.key);
      const opts = baseOpts(v => fmt(v));
      opts.scales.x.stacked = true; opts.scales.y.stacked = true;
      _charts['brk-' + b.key] = new Chart(cv, { type: 'bar', data: { labels: MONTHS, datasets }, options: opts });
    });
  }

  function renderCenterPanel() {
    const s = get(activeCenter);
    if (!s) { document.getElementById('centerPanel').innerHTML = '<p class="hint">Sem dados.</p>'; return; }
    const vals = s.values;
    const st = trendStats(vals);
    const v = vals[cur], vp = vals[cmp];
    const ah = vp ? (v - vp) / vp : null;
    const shareRev = revAt(cur) ? v / revAt(cur) : 0;
    const shareExp = expAt(cur) ? v / expAt(cur) : 0;

    // tendência textual
    let trendLabel, trendCls;
    if (Math.abs(st.slopePctMonth) < 0.02) { trendLabel = 'Estável'; trendCls = 'flat'; }
    else if (st.slopePctMonth > 0) { trendLabel = 'Em alta'; trendCls = 'down'; } // despesa subindo = ruim
    else { trendLabel = 'Em queda'; trendCls = 'up'; }
    const volat = st.cv > 0.4 ? 'Alta' : st.cv > 0.2 ? 'Média' : 'Baixa';

    // subcontas (nível imediatamente abaixo) ordenadas por valor no mês atual
    const kids = (childrenOf.get(s.code) || []).slice().sort((a, b) => val(b, cur) - val(a, cur));
    const kidsRows = kids.filter(k => k.values.some(x => x !== 0)).map(k => {
      const kst = trendStats(k.values);
      const kv = k.values[cur], kvp = k.values[cmp];
      const kah = kvp ? (kv - kvp) / kvp : (kv ? 1 : null);
      return `<tr>
        <td class="t-name">${k.name}</td>
        <td class="mono">${fmt(kv)}</td>
        <td class="av">${pct(v ? kv / v : 0)}</td>
        <td class="${kah == null ? 'av' : kah <= 0 ? 'pos' : 'neg'}">${kah == null ? '—' : signedPct(kah)}</td>
        <td class="spark-cell">${sparkline(k.values, { w: 90, h: 22 })}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="hint">Sem subcontas com movimento.</td></tr>`;

    document.getElementById('centerPanel').innerHTML = `
      <div class="center-kpis">
        <div class="ck">
          <span class="ck-l">${s.name} · ${MONTHS[cur]}</span>
          <span class="ck-v">${fmt2(v)}</span>
          <span class="delta ${ah == null ? 'flat' : ah <= 0 ? 'up' : 'down'}">${ah == null ? '—' : (ah <= 0 ? '▼' : '▲') + ' ' + signedPct(ah)} <span class="vs">vs ${MONTHS[cmp]}</span></span>
        </div>
        <div class="ck"><span class="ck-l">% da Receita</span><span class="ck-v">${pct(shareRev)}</span><span class="ck-s">do faturamento do mês</span></div>
        <div class="ck"><span class="ck-l">% das Despesas</span><span class="ck-v">${pct(shareExp)}</span><span class="ck-s">peso no total de gastos</span></div>
        <div class="ck"><span class="ck-l">Média ${MONTHS.length}m</span><span class="ck-v">${fmt(st.mean)}</span><span class="ck-s">gasto médio mensal</span></div>
        <div class="ck"><span class="ck-l">Tendência</span><span class="ck-v ${trendCls === 'up' ? 'pos' : trendCls === 'down' ? 'neg' : ''}">${trendLabel}</span><span class="ck-s">${(st.slopePctMonth * 100 >= 0 ? '+' : '') + (st.slopePctMonth * 100).toFixed(1)}% por mês</span></div>
        <div class="ck"><span class="ck-l">Volatilidade</span><span class="ck-v">${volat}</span><span class="ck-s">CV ${(st.cv * 100).toFixed(0)}%</span></div>
      </div>
      <div class="center-grid">
        <div class="chart-wrap"><canvas id="centerChart"></canvas></div>
        <div class="table-scroll">
          <table class="dre"><thead><tr>
            <th class="t-name">Subconta</th><th>Valor</th><th>% centro</th><th>AH</th><th>6m</th>
          </tr></thead><tbody>${kidsRows}</tbody></table>
        </div>
      </div>`;

    destroyChart('center');
    _charts.center = new Chart(document.getElementById('centerChart'), {
      type: 'bar',
      data: { labels: MONTHS, datasets: [
        { type: 'bar', label: s.name, data: vals, backgroundColor: vals.map((_, i) => i === cur ? '#f59e0b' : 'rgba(245,158,158,.55)'), borderRadius: 5, order: 2 },
        { type: 'line', label: '% da receita', data: MONTHS.map((_, i) => revAt(i) ? vals[i] / revAt(i) * 100 : 0), yAxisID: 'y2', borderColor: '#38bdf8', backgroundColor: '#38bdf8', tension: .35, pointRadius: 3, order: 1 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: cssVar('--chart-tick'), boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y2' ? ` ${c.dataset.label}: ${c.raw.toFixed(1)}%` : ` ${c.dataset.label}: ${fmt2(c.raw)}` } } },
        scales: {
          x: { ticks: { color: cssVar('--chart-tick') }, grid: { color: cssVar('--chart-grid') } },
          y: { ticks: { color: cssVar('--chart-tick'), callback: v => fmt(v) }, grid: { color: cssVar('--chart-grid') } },
          y2: { position: 'right', ticks: { color: '#38bdf8', callback: v => v.toFixed(0) + '%' }, grid: { drawOnChartArea: false } }
        } }
    });
  }

  // ===== DASH GRANDE (Espelho): variação produto a produto por centro =====
  // folhas (contas sem filhos) sob um código qualquer
  function leavesUnder(code) {
    const out = [];
    (function rec(c) {
      const kids = childrenOf.get(c);
      if (!kids || !kids.length) { const a = get(c); if (a) out.push(a); return; }
      kids.forEach(k => rec(k.code));
    })(code);
    return out;
  }
  let bigCenter = null;
  function renderBigCenter() {
    const chipsEl = document.getElementById('bigCenterChips');
    if (!chipsEl) return;
    // centros = seções de receita (1.x) + seções de despesa (2.x)
    const centers = [...revSections, ...expSections];
    if (!bigCenter || !get(bigCenter)) bigCenter = centers.length ? centers[0].code : null;
    chipsEl.innerHTML = centers.map(s => {
      const isRev = s.code.startsWith('1');
      const short = s.name.replace(/^Despesas?\s+/i, '');
      return `<button data-c="${s.code}" class="chip ${isRev ? 'rev' : 'exp'} ${s.code === bigCenter ? 'active' : ''}">${isRev ? '▲' : '▼'} ${short}</button>`;
    }).join('');
    chipsEl.querySelectorAll('button').forEach(b => b.onclick = () => { bigCenter = b.dataset.c; renderBigCenter(); });
    renderBigCenterPanel();
  }
  function renderBigCenterPanel() {
    const panel = document.getElementById('bigCenterPanel');
    const s = get(bigCenter);
    if (!s) { panel.innerHTML = '<p class="hint">Sem dados.</p>'; return; }
    const isRev = s.code.startsWith('1');

    // itens = folhas do centro (produto a produto). Ordena pela maior variação absoluta.
    const items = leavesUnder(s.code)
      .filter(k => k.values[cur] !== 0 || k.values[cmp] !== 0)
      .map(k => {
        const v = k.values[cur], vp = k.values[cmp];
        const abs = v - vp;
        const rel = vp ? abs / vp : (v ? 1 : null);
        return { name: k.name, code: k.code, v, vp, abs, rel, vals: k.values };
      });
    items.sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs));

    const totCur = s.values[cur], totPrev = s.values[cmp];
    const totAbs = totCur - totPrev, totRel = totPrev ? totAbs / totPrev : null;
    // para a despesa, queda é boa (pos/verde); para a receita, alta é boa.
    const goodCls = (abs) => isRev ? (abs >= 0 ? 'pos' : 'neg') : (abs <= 0 ? 'pos' : 'neg');
    const arrow = (abs) => abs > 0 ? '▲' : abs < 0 ? '▼' : '■';

    // ---- topo: KPIs do centro ----
    const head = `
      <div class="bc-kpis">
        <div class="ck"><span class="ck-l">${s.name} · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(totCur)}</span><span class="ck-s">era ${fmt(totPrev)} em ${MONTHS[cmp]}</span></div>
        <div class="ck"><span class="ck-l">Variação no período</span><span class="ck-v ${goodCls(totAbs)}">${arrow(totAbs)} ${fmt(Math.abs(totAbs))}</span><span class="ck-s">${totRel == null ? '—' : signedPct(totRel)} vs ${MONTHS[cmp]}</span></div>
        <div class="ck"><span class="ck-l">Itens com movimento</span><span class="ck-v">${items.length}</span><span class="ck-s">produtos/contas no centro</span></div>
        <div class="ck"><span class="ck-l">% da Receita do mês</span><span class="ck-v">${pct(revAt(cur) ? totCur / revAt(cur) : 0)}</span><span class="ck-s">${isRev ? 'participação na receita' : 'peso sobre o faturamento'}</span></div>
      </div>`;

    // ---- gráfico de variação produto a produto (barras horizontais, top 12) ----
    const top = items.slice(0, 12);

    // ---- tabela item a item ----
    const rows = items.map(it => `
      <tr>
        <td class="t-name">${it.name}</td>
        <td class="mono">${fmt(it.vp)}</td>
        <td class="mono">${fmt(it.v)}</td>
        <td class="mono ${goodCls(it.abs)}">${arrow(it.abs)} ${fmt(Math.abs(it.abs))}</td>
        <td class="${it.rel == null ? 'av' : goodCls(it.abs)}">${it.rel == null ? '—' : signedPct(it.rel)}</td>
        <td class="av">${pct(totCur ? it.v / totCur : 0)}</td>
        <td class="spark-cell">${sparkline(it.vals, { w: 90, h: 22 })}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="hint">Sem itens com movimento.</td></tr>`;

    panel.innerHTML = head + `
      <div class="bc-chart-wrap"><canvas id="bigCenterChart"></canvas></div>
      <div class="table-scroll">
        <table class="dre bc-table">
          <thead><tr>
            <th class="t-name">Produto / Conta</th>
            <th>${MONTHS[cmp]}</th>
            <th>${MONTHS[cur]}</th>
            <th>Variação R$</th>
            <th>Variação %</th>
            <th>% centro</th>
            <th>Histórico</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    // barras horizontais de variação (verde=bom, vermelho=ruim conforme receita/despesa)
    destroyChart('bigCenter');
    const okColor = cssVar('--pos') || '#34d399', badColor = cssVar('--neg') || '#f87171';
    _charts.bigCenter = new Chart(document.getElementById('bigCenterChart'), {
      type: 'bar',
      data: { labels: top.map(it => it.name), datasets: [{
        label: `Variação ${MONTHS[cmp]} → ${MONTHS[cur]}`,
        data: top.map(it => it.abs),
        backgroundColor: top.map(it => (isRev ? it.abs >= 0 : it.abs <= 0) ? okColor : badColor),
        borderRadius: 4
      }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: cssVar('--chart-tick'), boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => ` ${c.raw >= 0 ? '+' : ''}${fmt2(c.raw)}` } } },
        scales: {
          x: { ticks: { color: cssVar('--chart-tick'), callback: v => fmt(v) }, grid: { color: cssVar('--chart-grid') } },
          y: { ticks: { color: cssVar('--chart-tick'), font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  }

  // ===== ANÁLISE FUNDAMENTALISTA (estilo Buffett / Owner Earnings) =====
  // Classificação econômica das contas
  const FIN_REV_CODES = ['1.3', '1.4'];                // rendimentos + empréstimos captados
  const VAR_COST_CODES = ['2.6', '2.10', '2.11', '2.12']; // custos variáveis ligados à produção/obra
  const OWNER_CODES = ['2.14', '2.16'];                // retiradas sócios + investimentos (não operacional)
  // base autoritativa = totais das contas 1 e 2 (batem com a planilha). Vendas = Receita total − receita financeira.
  const finRevAt = i => FIN_REV_CODES.reduce((s, c) => s + val(get(c), i), 0);
  const varCostAt = i => VAR_COST_CODES.reduce((s, c) => s + val(get(c), i), 0);
  const ownerAt = i => OWNER_CODES.reduce((s, c) => s + val(get(c), i), 0);
  const salesAt = i => revAt(i) - finRevAt(i);                 // receita operacional (vendas)
  const cmAt = i => salesAt(i) - varCostAt(i);                 // margem de contribuição
  const fixedAt = i => expAt(i) - varCostAt(i) - ownerAt(i);   // estrutura fixa (sem retiradas)
  const opResAt = i => salesAt(i) - varCostAt(i) - fixedAt(i); // resultado operacional (antes de sócios e financ.)

  function renderBuffett() {
    // ---- narrativa ----
    const i = cur;
    const opRes = opResAt(i), opMargin = salesAt(i) ? opRes / salesAt(i) : 0;
    const owner = ownerAt(i), finalRes = resAt(i);
    const cm = cmAt(i), cmPct = salesAt(i) ? cm / salesAt(i) : 0;
    const ownerVsOp = opRes ? owner / opRes : 0;

    const narr = document.getElementById('buffettNarrative');
    narr.innerHTML = `
      <p>No mês de <b>${MONTHS[i]}</b>, a <b>operação</b> da Impresilk gerou <b class="pos">${fmt2(opRes)}</b> de resultado
      operacional sobre <b>${fmt(salesAt(i))}</b> de vendas — uma <b>margem operacional de ${pct(opMargin)}</b>.
      A margem de contribuição foi de <b>${pct(cmPct)}</b>, indicando que cada real vendido deixa
      <b>${fmt(cmPct)}</b> para cobrir estrutura fixa e remunerar o dono.</p>
      <p>As <b>retiradas dos sócios e investimentos</b> consumiram <b class="neg">${fmt2(owner)}</b>
      — equivalente a <b>${pct(ownerVsOp)}</b> de todo o resultado operacional.
      ${finalRes >= 0
        ? `Mesmo após essa distribuição, o caixa fechou <b class="pos">positivo em ${fmt2(finalRes)}</b>.`
        : `Por isso o caixa fechou <b class="neg">negativo em ${fmt2(finalRes)}</b> — não por falha da operação, mas pela distribuição ao dono.`}</p>
      <p class="buffett-quote">"O preço é o que você paga; o valor é o que você recebe." — A operação aqui <b>tem valor</b>:
      ela é consistentemente lucrativa. O desafio é disciplina na <b>retirada de capital</b>.</p>`;

    // ---- tabela gerencial reorganizada ----
    const rows = [];
    const tb = document.querySelector('#buffettTable tbody');
    const denom = salesAt(i) || 1;
    const L = (label, v, cls, strong) => `<tr class="${strong ? 'result' : ''}"><td class="t-name">${label}</td>
      <td class="mono ${cls || ''}">${fmt2(v)}</td><td class="av">${pct(v / denom)}</td></tr>`;
    rows.push(`<tr class="group rev"><td class="t-name">RECEITA OPERACIONAL (Vendas)</td><td class="mono">${fmt(salesAt(i))}</td><td class="av">100,0%</td></tr>`);
    rows.push(L('(−) Custos Variáveis (insumos, máquinas, obra, terceiros)', -varCostAt(i), 'neg'));
    rows.push(L('= Margem de Contribuição', cmAt(i), 'pos', true));
    rows.push(L('(−) Estrutura Fixa (pessoal, admin, impostos, etc.)', -fixedAt(i), 'neg'));
    rows.push(L('= RESULTADO OPERACIONAL', opResAt(i), opResAt(i) >= 0 ? 'pos' : 'neg', true));
    rows.push(L('(−) Retiradas Sócios + Investimentos', -ownerAt(i), 'neg'));
    const finRev = finRevAt(i);
    if (finRev) rows.push(L('(+) Rendimentos / Empréstimos captados', finRev, 'pos'));
    rows.push(L('= RESULTADO DE CAIXA (final)', resAt(i), resAt(i) >= 0 ? 'pos' : 'neg', true));
    tb.innerHTML = rows.join('');

    // ---- gráfico operação vs retiradas ----
    destroyChart('opOwner');
    _charts.opOwner = new Chart(document.getElementById('opVsOwnerChart'), {
      type: 'bar',
      data: { labels: MONTHS, datasets: [
        { label: 'Resultado Operacional', data: MONTHS.map((_, k) => opResAt(k)), backgroundColor: '#34d399', borderRadius: 5 },
        { label: 'Retiradas Sócios', data: MONTHS.map((_, k) => ownerAt(k)), backgroundColor: '#a78bfa', borderRadius: 5 },
        { type: 'line', label: 'Resultado Final', data: MONTHS.map((_, k) => resAt(k)), borderColor: '#fbbf24', backgroundColor: '#fbbf24', tension: .35, pointRadius: 4 }
      ] },
      options: baseOpts(v => fmt(v))
    });

    // ---- camadas de margem ----
    destroyChart('marginLayers');
    _charts.marginLayers = new Chart(document.getElementById('marginLayersChart'), {
      type: 'line',
      data: { labels: MONTHS, datasets: [
        { label: 'Margem Contribuição %', data: MONTHS.map((_, k) => salesAt(k) ? cmAt(k) / salesAt(k) * 100 : 0), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.1)', tension: .35, fill: true, pointRadius: 3 },
        { label: 'Margem Operacional %', data: MONTHS.map((_, k) => salesAt(k) ? opResAt(k) / salesAt(k) * 100 : 0), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.1)', tension: .35, fill: true, pointRadius: 3 },
        { label: 'Margem Final (caixa) %', data: MONTHS.map((_, k) => revAt(k) ? resAt(k) / revAt(k) * 100 : 0), borderColor: '#fbbf24', tension: .35, pointRadius: 3 }
      ] },
      options: baseOpts(v => v.toFixed(0) + '%', true)
    });

    // ---- sinais ----
    const signals = [];
    const opSt = trendStats(MONTHS.map((_, k) => salesAt(k) ? opResAt(k) / salesAt(k) : 0));
    signals.push({ type: opSt.slope >= 0 ? 'good' : 'warn', title: 'Margem operacional',
      html: `Tendência de margem operacional <b>${opSt.slope >= 0 ? 'crescente' : 'decrescente'}</b> nos ${MONTHS.length} meses (média <b>${pct(opSt.mean)}</b>). A operação é o <b>ativo forte</b> do negócio.` });

    const ownerSeries = MONTHS.map((_, k) => opResAt(k) ? ownerAt(k) / opResAt(k) : 0);
    const ownerAvg = ownerSeries.reduce((s, v) => s + v, 0) / ownerSeries.length;
    signals.push({ type: ownerAvg > 0.8 ? 'bad' : ownerAvg > 0.5 ? 'warn' : 'good', title: 'Disciplina de retirada',
      html: `Em média, as retiradas consomem <b>${pct(ownerAvg)}</b> do resultado operacional. ${ownerAvg > 0.8 ? 'Está <b>alto</b> — limita reinvestimento e reservas.' : 'Espaço razoável para capitalizar a empresa.'}` });

    const cmStab = trendStats(MONTHS.map((_, k) => salesAt(k) ? cmAt(k) / salesAt(k) : 0));
    signals.push({ type: cmStab.cv < 0.1 ? 'good' : 'warn', title: 'Previsibilidade da margem',
      html: `Margem de contribuição com volatilidade <b>${cmStab.cv < 0.1 ? 'baixa' : 'moderada'}</b> (CV ${(cmStab.cv * 100).toFixed(0)}%). ${cmStab.cv < 0.1 ? 'Precificação saudável e estável.' : 'Vale revisar precificação por linha.'}` });

    // ponto de equilíbrio do mês
    const be = cmPct ? fixedAt(i) / cmPct : 0;
    signals.push({ type: salesAt(i) > be ? 'good' : 'bad', title: 'Ponto de equilíbrio',
      html: `Com margem de contribuição de ${pct(cmPct)}, a empresa precisa vender <b>${fmt(be)}</b>/mês para cobrir a estrutura fixa. Vendeu <b>${fmt(salesAt(i))}</b> — <b>${salesAt(i) > be ? 'acima' : 'abaixo'}</b> do equilíbrio (${signedPct(be ? salesAt(i) / be - 1 : 0)}).` });

    // fôlego de caixa (reserva): quantos meses de estrutura fixa o caixa acumulado cobre
    const accReserve = MONTHS.reduce((s, _, k) => s + resAt(k), 0);
    const avgFixed = MONTHS.reduce((s, _, k) => s + fixedAt(k), 0) / MONTHS.length;
    const runway = avgFixed > 0 ? accReserve / avgFixed : 0;
    signals.push({ type: runway >= 3 ? 'good' : runway >= 1 ? 'warn' : 'bad', title: 'Fôlego de caixa (reserva)',
      html: `O caixa acumulado nos ${MONTHS.length} meses (<b>${fmt(accReserve)}</b>) equivale a <b>${runway.toFixed(1)} meses</b> de estrutura fixa (média de <b>${fmt(avgFixed)}</b>/mês). ${runway >= 3 ? 'Reserva <b>confortável</b> — fôlego para meses fracos e oportunidades.' : runway >= 1 ? 'Reserva <b>apertada</b> — convém engordar o colchão antes de distribuir mais.' : 'Reserva <b>insuficiente</b> — risco de aperto num mês fraco.'}` });

    // peso do custo financeiro: juros e tarifas bancárias (2.13) sobre a receita
    const finCost = val(get('2.13'), i);
    const finPct = revAt(i) ? finCost / revAt(i) : 0;
    signals.push({ type: finPct > 0.08 ? 'bad' : finPct > 0.04 ? 'warn' : 'good', title: 'Peso do custo financeiro',
      html: `Juros e tarifas bancárias consumiram <b>${fmt(finCost)}</b> em ${MONTHS[i]} — <b>${pct(finPct)}</b> da receita. ${finPct > 0.08 ? 'Está <b>alto</b>: juros de cartão/empréstimo corroem o resultado — priorize quitar o rotativo.' : finPct > 0.04 ? 'Moderado — vale renegociar tarifas e evitar o rotativo do cartão.' : 'Sob controle.'}` });

    document.getElementById('buffettSignals').innerHTML = signals.map(s => `<div class="insight ${s.type}"><span class="it ${s.type}">${s.title}</span>${s.html}</div>`).join('');

    // ---- simulador de retiradas ----
    renderRetiradaSim();
  }

  function renderRetiradaSim() {
    const slider = document.getElementById('simSlider');
    if (!slider) return;
    // reservas reais (acumuladas) = soma do resultado de caixa real
    const opTotal = MONTHS.reduce((s, _, k) => s + opResAt(k), 0);
    const finRevTotal = MONTHS.reduce((s, _, k) => s + finRevAt(k), 0);
    const realReserve = MONTHS.reduce((s, _, k) => s + resAt(k), 0);
    const realOwner = MONTHS.reduce((s, _, k) => s + ownerAt(k), 0);
    const realOwnerPct = opTotal ? realOwner / opTotal : 0;
    const n = MONTHS.length;

    const draw = () => {
      const p = +slider.value / 100;
      document.getElementById('simPctLabel').textContent = (slider.value) + '%';
      // retirada simulada por mês = p × resultado operacional (só quando positivo)
      const simOwner = MONTHS.reduce((s, _, k) => s + Math.max(0, p * opResAt(k)), 0);
      // reserva acumulada = operação + receita financeira − retiradas simuladas
      const simReserve = opTotal + finRevTotal - simOwner;
      const perMonth = simReserve / n;
      const diff = simReserve - realReserve;
      const kp = (lbl, val, cls) => `<div class="ck"><span class="ck-l">${lbl}</span><b class="ck-v ${cls || ''}">${val}</b></div>`;
      document.getElementById('simKpis').innerHTML =
        kp(`Retirada total (${n}m)`, fmt(simOwner), 'neg') +
        kp(`Reserva acumulada (${n}m)`, fmt(simReserve), simReserve >= 0 ? 'pos' : 'neg') +
        kp('Média por mês', fmt(perMonth), perMonth >= 0 ? 'pos' : 'neg') +
        kp('vs. cenário real', (diff >= 0 ? '+' : '') + fmt(diff), diff >= 0 ? 'pos' : 'neg');

      let msg;
      if (Math.abs(p - realOwnerPct) < 0.03) {
        msg = `Este é praticamente o <b>cenário real</b>: as retiradas vêm consumindo <b>${pct(realOwnerPct)}</b> do resultado operacional, deixando <b>${fmt(realReserve)}</b> de reserva em ${n} meses.`;
      } else if (simReserve > realReserve) {
        msg = `Retirando <b>${slider.value}%</b> da operação, a reserva em ${n} meses seria <b class="pos">${fmt(simReserve)}</b> — <b>${fmt(diff)} a mais</b> que o cenário real (retirada média de ${pct(realOwnerPct)}). Esse caixa retido capitaliza a empresa e reduz dependência de empréstimos.`;
      } else {
        msg = `Retirando <b>${slider.value}%</b>, a reserva cairia para <b class="neg">${fmt(simReserve)}</b> — <b>${fmt(-diff)} a menos</b> que hoje. Acima da geração operacional, a empresa passa a <b>descapitalizar</b>.`;
      }
      document.getElementById('simNote').innerHTML = `<p>${msg}</p>`;
    };

    slider.oninput = draw;
    draw();
  }

  function renderAll() {
    renderKPIs(); renderInsights(); renderDRE(); renderComposition(); renderRevComposition(); renderTrend(); buildMirrorHead(); renderMirror();
    renderCenters(); renderUtilities(); renderBreakdowns(); renderBigCenter(); renderBuffett();
    if (typeof wireCollapsibleCards === 'function') wireCollapsibleCards();
    document.getElementById('footMeta').textContent = `${MONTHS.length} meses · ${ACCS.length} contas · ${MONTHS[0]} → ${MONTHS[MONTHS.length - 1]}`;
  }

  ACCS.forEach(a => { if ((childrenOf.get(a.code) || []).length && a.level >= 2) collapsed.add(a.code); });
  activeRenderAll = renderAll;
  renderAll();
}

/* ==================================================================== */
/*  BANCOS — contas para consulta. Dados fixos, agrupados por empresa.    */
/* ==================================================================== */
const BANCOS_OPEN_KEY = 'impresilk_dre_bancos_open';
const BANCOS = [
  // Impresilk e Universo
  { grupo: 'Impresilk e Universo', banco: 'BTG 208',           titular: 'Impresilk', doc: '20.789.673/0001-80', agencia: '1',    conta: '907063-6', pix: '5307f7f3-f4d1-4e82-8ba8-95ce448c194b', pixTipo: 'Aleatória' },
  { grupo: 'Impresilk e Universo', banco: 'Sicoob Credinor',   titular: 'Impresilk', doc: '20.789.673/0001-80', agencia: '3144', conta: '16.814-9', pix: '20.789.673/0001-80', pixTipo: 'CNPJ' },
  { grupo: 'Impresilk e Universo', banco: 'BNB',               titular: 'Impresilk', doc: '20.789.673/0001-80', agencia: '34',   conta: '42501-4',  pix: '', pixTipo: 'Conta e agência' },
  { grupo: 'Impresilk e Universo', banco: 'BB',                titular: 'Impresilk', doc: '20.789.673/0001-80', agencia: '1479-6', conta: '10541-4', pix: '', pixTipo: 'Conta e agência' },
  { grupo: 'Impresilk e Universo', banco: 'Sicoob Credinor',   titular: 'Universo',  doc: '26.521.684/0001-60', agencia: '3144', conta: '90.028-1', pix: '26.521.684/0001-60', pixTipo: 'CNPJ' },
  { grupo: 'Impresilk e Universo', banco: 'Sicoob Credinosso', titular: 'Universo',  doc: '26.521.684/0001-60', agencia: '3327', conta: '5.136-5',  pix: '', pixTipo: 'Conta e agência' },
  // Leonardo Gonçalves (PF)
  { grupo: 'Leonardo Gonçalves (PF)', banco: 'BTG 208',                titular: 'Leonardo Gonçalves', doc: '078.565.336-84',    agencia: '20',   conta: '908210-8',  pix: '11 972746113', pixTipo: 'Telefone' },
  { grupo: 'Leonardo Gonçalves (PF)', banco: 'BTG 208 · Investimento', titular: 'Leonardo Gonçalves', doc: '078.565.336-84',    agencia: '1',    conta: '908210-8',  pix: '', pixTipo: 'Conta e agência' },
  { grupo: 'Leonardo Gonçalves (PF)', banco: 'Itaú',                   titular: 'Leonardo Gonçalves', doc: '078.565.336-84',    agencia: '341',  conta: '',          pix: '9278fa29-e71e-48ed-b733-25ac3338d2c3', pixTipo: 'Aleatória' },
  { grupo: 'Leonardo Gonçalves (PF)', banco: 'Caixa · Léo PF',         titular: 'Leonardo Gonçalves', doc: '078.565.336-84',    agencia: '3115', conta: '580779854-2', pix: '07856533684', pixTipo: 'CPF' },
  { grupo: 'Leonardo Gonçalves (PF)', banco: 'Santander',              titular: 'Leonardo Gonçalves', doc: '078.565.336-84',    agencia: '3504', conta: '01001895-6', pix: 'e5c64f17-642b-43bb-b5ef-1fdce9b52978', pixTipo: 'Aleatória' },
  // LGP
  { grupo: 'LGP',  banco: 'Sicoob Credinor',   titular: 'LGP',      doc: '12.228.048/0001-30', agencia: '3144', conta: '47.892-0',  pix: 'leonardo@fortemais.com', pixTipo: 'E-mail' },
  { grupo: 'LGP',  banco: 'Sicoob Credinor',   titular: 'LGP II',   doc: '12.228.048/0001-30', agencia: '3144', conta: '70.104-1',  pix: '12.228.048/0001-30', pixTipo: 'CNPJ' },
  { grupo: 'LGP',  banco: 'Caixa · LGP',       titular: 'LGP',      doc: '12.228.048/0001-30', agencia: '3115', conta: '578893015-0', pix: '1222804800130', pixTipo: 'CNPJ' },
  // LG
  { grupo: 'LG',   banco: 'Sicoob Credinor',   titular: 'LG',       doc: '50.788.526/0001-56', agencia: '3144', conta: '63.300-3',  pix: '50.788.526/0001-56', pixTipo: 'CNPJ' },
  // Domo
  { grupo: 'Domo', banco: 'Sicoob Credinor',   titular: 'SPE Domo', doc: '55.981.504/0001-21', agencia: '3144', conta: '74.188-4',  pix: '55.981.504/0001-21', pixTipo: 'CNPJ' },
  { grupo: 'Domo', banco: 'Sicoob Credinor',   titular: 'Domo',     doc: '55.941.523/0001-24', agencia: '3144', conta: '74.448-4',  pix: '55.941.523/0001-24', pixTipo: 'CNPJ' },
  // Zeus
  { grupo: 'Zeus', banco: 'Sicoob Credinor',   titular: 'Zeus',     doc: '37.571.480/0001-50', agencia: '3144', conta: '64.881-7',  pix: '37.571.480/0001-50', pixTipo: 'CNPJ' },
  // Neon
  { grupo: 'Neon', banco: 'Sicoob Credinosso', titular: 'Neon',     doc: '42.836.150/0001-80', agencia: '3327', conta: '8.342-9',   pix: '42.836.150/0001-80', pixTipo: 'CNPJ' },
];

function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function copiar(texto, label) {
  const ok = () => toast(`${label} copiado ✓`, 'ok');
  const fail = () => toast('Não foi possível copiar', 'err');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(ok).catch(fail);
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); ok();
    } catch (_) { fail(); }
  }
}

function renderBancos() {
  const grid = document.getElementById('bancosGrid');
  if (!grid) return;
  const linha = (label, valor, copyLabel) => {
    if (!valor) return '';
    return `<div class="banco-row">
      <span class="banco-k">${label}</span>
      <button class="banco-v" data-copy="${escAttr(valor)}" data-label="${escAttr(copyLabel || label)}" title="Copiar ${escAttr(copyLabel || label)}">
        <span class="banco-val">${escAttr(valor)}</span><span class="banco-copy">⧉</span>
      </button>
    </div>`;
  };
  const card = (b) => {
    const blob = `${b.banco} ${b.titular} ${b.doc} ${b.agencia} ${b.conta} ${b.pix} ${b.pixTipo}`.toLowerCase();
    const docLabel = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(b.doc) ? 'CPF' : 'CNPJ';
    const pixRow = b.pix
      ? linha(`Pix · ${b.pixTipo}`, b.pix, 'Chave Pix')
      : `<div class="banco-row banco-row--note"><span class="banco-k">Pix</span><span class="banco-note">${escAttr(b.pixTipo)}</span></div>`;
    return `<div class="banco-card" data-search="${escAttr(blob)}">
      <div class="banco-head">
        <span class="banco-nome">${escAttr(b.banco)}</span>
        <span class="banco-titular">${escAttr(b.titular)}</span>
      </div>
      ${linha(docLabel, b.doc, docLabel)}
      ${linha('Agência', b.agencia, 'Agência')}
      ${linha('Conta', b.conta, 'Conta')}
      ${pixRow}
    </div>`;
  };
  const grupos = [];
  BANCOS.forEach(b => {
    let g = grupos.find(x => x.name === b.grupo);
    if (!g) { g = { name: b.grupo, items: [] }; grupos.push(g); }
    g.items.push(b);
  });
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(BANCOS_OPEN_KEY) || '{}'); } catch (_) {}
  grid.innerHTML = grupos.map((g, i) => {
    const open = g.name in saved ? !!saved[g.name] : i === 0; // 1º grupo aberto por padrão
    return `<div class="banco-group ${open ? '' : 'collapsed'}" data-group="${escAttr(g.name)}">
      <button class="banco-group-head" type="button" aria-expanded="${open}">
        <span class="banco-caret">▾</span>
        <span class="banco-group-title">${escAttr(g.name)}</span>
        <span class="banco-group-count">${g.items.length} ${g.items.length === 1 ? 'conta' : 'contas'}</span>
      </button>
      <div class="banco-cards">${g.items.map(card).join('')}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.banco-v').forEach(btn => {
    btn.onclick = () => copiar(btn.dataset.copy, btn.dataset.label);
  });

  grid.querySelectorAll('.banco-group-head').forEach(head => {
    head.onclick = () => {
      const grp = head.closest('.banco-group');
      const nowOpen = grp.classList.toggle('collapsed') === false;
      head.setAttribute('aria-expanded', nowOpen);
      saved[grp.dataset.group] = nowOpen;
      try { localStorage.setItem(BANCOS_OPEN_KEY, JSON.stringify(saved)); } catch (_) {}
    };
  });

  const search = document.getElementById('bancosSearch');
  if (search && !search._wired) {
    search._wired = true;
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      grid.querySelectorAll('.banco-card').forEach(el => {
        el.classList.toggle('hidden', !!q && !el.dataset.search.includes(q));
      });
      grid.querySelectorAll('.banco-group').forEach(g => {
        const cards = [...g.querySelectorAll('.banco-card')];
        const anyVisible = cards.some(el => !el.classList.contains('hidden'));
        g.classList.toggle('hidden', !anyVisible);
        // durante a busca, expande grupos com resultado para mostrar as contas
        if (q && anyVisible) g.classList.remove('collapsed');
      });
    };
  }
}

/* ==================================================================== */
/*  GLOSSÁRIO — explicações em linguagem simples (independe dos dados)    */
/* ==================================================================== */
const GLOSSARY = [
  { g: 'Conceitos básicos', t: 'Competência de Caixa', d: 'Forma de medir o resultado pelo que <b>efetivamente entrou e saiu do caixa</b> no mês — segue a data do pagamento/recebimento, não a data da venda. Por isso o lucro de um mês pode oscilar conforme <i>quando</i> as contas foram pagas, e não só pelo volume vendido.' },
  { g: 'Conceitos básicos', t: 'Receita (Faturamento)', d: 'Todo o dinheiro que <b>entrou</b> no período: vendas de produtos e serviços, e também rendimentos e empréstimos captados. É o ponto de partida do resultado.' },
  { g: 'Conceitos básicos', t: 'Despesa', d: 'Todo o dinheiro que <b>saiu</b>: salários, materiais, impostos, retiradas dos sócios, etc. Quanto menor em relação à receita, melhor.' },
  { g: 'Conceitos básicos', t: 'Resultado (Lucro ou Prejuízo)', d: 'Receita menos Despesa. Se positivo, sobrou dinheiro (<b>lucro</b>); se negativo, faltou (<b>prejuízo</b>). É o número final do caixa no mês.' },
  { g: 'Conceitos básicos', t: 'Centro de Custo', d: 'Um “grupo” de gastos ou receitas que se acompanha junto (ex.: Despesas com Funcionários, Materiais e Insumos, Comunicação Visual). Ajuda a enxergar <b>onde</b> o dinheiro é gerado e consumido.' },

  { g: 'Indicadores de margem', t: 'Margem Líquida', d: 'Quanto sobra de <b>cada R$ 100 de receita</b> depois de pagar tudo. Margem de 10% significa que de cada R$ 100 faturados, R$ 10 viram resultado de caixa.' },
  { g: 'Indicadores de margem', t: 'Margem de Contribuição', d: 'Quanto sobra de cada venda <b>depois de pagar só os custos que variam com a produção</b> (insumos, máquinas, terceiros de obra). É o dinheiro que “contribui” para cobrir a estrutura fixa e remunerar o dono. Quanto maior, mais saudável é a precificação.' },
  { g: 'Indicadores de margem', t: 'Resultado Operacional', d: 'O lucro <b>só da operação</b> — vendas menos custos variáveis menos estrutura fixa, <b>antes</b> de retiradas dos sócios e de empréstimos. Mostra se o negócio em si dá lucro, separando isso das decisões dos donos.' },
  { g: 'Indicadores de margem', t: 'Margem Operacional', d: 'O Resultado Operacional dividido pelas vendas, em %. Diz quão eficiente é a operação em transformar venda em lucro, ignorando retiradas e financiamento.' },

  { g: 'Análise vertical e horizontal', t: 'AV (Análise Vertical)', d: 'Mostra o <b>peso de cada conta dentro do total</b>, em %. Na DRE, é a fatia de cada item sobre a receita. Ex.: se “Salários” tem AV de 20%, consome 20% de tudo que entra.' },
  { g: 'Análise vertical e horizontal', t: 'AH (Análise Horizontal)', d: 'Mostra a <b>variação de um período para outro</b>, em %. Compara o mês escolhido com o mês de comparação. Ex.: AH de +15% significa que o valor cresceu 15% em relação ao mês comparado.' },
  { g: 'Análise vertical e horizontal', t: 'Variação R$ / Variação %', d: 'A diferença, em reais e em porcentagem, de um item entre os dois meses comparados. Para <b>despesas</b>, cair é bom (verde); para <b>receitas</b>, subir é bom (verde).' },

  { g: 'Tendência e estatística', t: 'Tendência', d: 'A direção geral de um número ao longo dos meses (subindo, estável ou caindo), calculada por uma <b>linha de tendência</b> (regressão linear). Suaviza os altos e baixos para mostrar o rumo.' },
  { g: 'Tendência e estatística', t: 'Volatilidade (CV)', d: 'O quanto um valor <b>oscila</b> mês a mês. CV (coeficiente de variação) baixo = previsível e estável; alto = irregular. Despesas voláteis dificultam o planejamento.' },
  { g: 'Tendência e estatística', t: 'Média', d: 'A soma dos valores dividida pelo número de meses. Dá uma referência do “normal” daquele item no período.' },
  { g: 'Tendência e estatística', t: 'Sparkline (Histórico)', d: 'O mini-gráfico em cada linha da tabela. Mostra, num relance, o comportamento do item ao longo dos meses — se vem subindo, caindo ou estável.' },

  { g: 'Visão de dono (Buffett)', t: 'Owner Earnings (Lucro do Dono)', d: 'Olhar para o negócio como um dono faria: separar o <b>lucro real da operação</b> das <b>retiradas dos sócios</b> e do <b>financiamento</b>. Revela se o que aperta o caixa é a operação ou a distribuição de dinheiro aos donos.' },
  { g: 'Visão de dono (Buffett)', t: 'Retiradas dos Sócios', d: 'O dinheiro que os donos tiram da empresa (pró-labore, distribuição de lucros) mais investimentos. Não é custo da operação — é <b>destino</b> do lucro. Retiradas altas demais descapitalizam a empresa.' },
  { g: 'Visão de dono (Buffett)', t: 'Ponto de Equilíbrio', d: 'O quanto a empresa precisa <b>vender no mês para não ter prejuízo</b> — o ponto onde a margem de contribuição cobre exatamente a estrutura fixa. Vender acima dele gera lucro; abaixo, prejuízo.' },
  { g: 'Visão de dono (Buffett)', t: 'Estrutura Fixa', d: 'Os gastos que existem <b>independente do volume de vendas</b>: aluguel, salários administrativos, impostos fixos, etc. Não variam (muito) se você vende mais ou menos no mês.' },
  { g: 'Visão de dono (Buffett)', t: 'Custos Variáveis', d: 'Gastos que <b>sobem e descem junto com a produção</b>: matéria-prima, insumos, máquinas e serviços terceirizados ligados às obras. Mais produção = mais custo variável.' },
  { g: 'Visão de dono (Buffett)', t: 'Simulador de Retiradas', d: 'Ferramenta que mostra <b>quanto de reserva sobraria</b> se as retiradas dos sócios fossem uma % fixa do resultado operacional. Ajuda a decidir quanto distribuir sem descapitalizar a empresa.' },

  { g: 'Retorno e investimento', t: 'ROI (Retorno sobre o Investimento)', d: 'Quanto um investimento <b>devolveu</b> em relação ao que custou. Fórmula: <i>(ganho − custo) ÷ custo</i>. Ex.: comprou uma máquina por R$ 20 mil e ela gerou R$ 26 mil de lucro extra → ROI de 30%. Acima de 0% já houve retorno; quanto maior, melhor o uso do dinheiro.' },
  { g: 'Retorno e investimento', t: 'TIR (Taxa Interna de Retorno)', d: 'A <b>taxa de rentabilidade anual</b> que um projeto rende, considerando que o dinheiro entra ao longo do tempo. Serve para comparar com o custo do dinheiro: se a TIR de comprar uma plotter nova é 25% ao ano e o empréstimo custa 18%, vale a pena. Se a TIR for menor que o custo do capital, o projeto destrói valor.' },
  { g: 'Retorno e investimento', t: 'VPL (Valor Presente Líquido)', d: 'Quanto um projeto vale <b>hoje</b>, somando todas as entradas e saídas futuras trazidas para o presente (porque R$ 1.000 daqui a um ano valem menos que hoje). VPL <b>positivo</b> = o projeto gera mais do que custa → faça; negativo → não compensa.' },
  { g: 'Retorno e investimento', t: 'Payback (Tempo de Retorno)', d: 'Em <b>quanto tempo</b> um investimento se paga. Ex.: uma máquina de R$ 24 mil que gera R$ 2 mil/mês de economia tem payback de 12 meses. Quanto mais curto, menor o risco. Simples de entender, mas ignora o que acontece depois que o valor se paga.' },
  { g: 'Retorno e investimento', t: 'TMA / Custo de Oportunidade', d: 'A <b>mínima rentabilidade aceitável</b> para topar um investimento — normalmente o que você ganharia na alternativa mais segura (render no banco, quitar uma dívida). Todo projeto deve render <b>acima</b> da TMA, senão era melhor deixar o dinheiro parado rendendo.' },

  { g: 'Saúde financeira e liquidez', t: 'Fluxo de Caixa', d: 'O <b>mapa das entradas e saídas</b> de dinheiro ao longo do tempo. Diferente do lucro, mostra se vai <b>faltar dinheiro em caixa</b> num determinado dia, mesmo a empresa sendo lucrativa. É o que evita o aperto de “lucro no papel, conta no vermelho”.' },
  { g: 'Saúde financeira e liquidez', t: 'Capital de Giro', d: 'O dinheiro necessário para <b>tocar o dia a dia</b> — pagar material, salários e contas enquanto os clientes ainda não pagaram. Capital de giro curto é a causa nº 1 de aperto: você vendeu, mas o dinheiro só entra depois e as contas vencem antes.' },
  { g: 'Saúde financeira e liquidez', t: 'Liquidez', d: 'A capacidade de <b>honrar as contas no prazo</b>. Alta liquidez = sobra caixa para os compromissos próximos; baixa = risco de atrasar pagamentos mesmo com a empresa indo bem no resultado.' },
  { g: 'Saúde financeira e liquidez', t: 'Reserva de Caixa', d: 'Um <b>colchão de dinheiro guardado</b> para meses fracos, imprevistos ou oportunidades. Costuma-se mirar de 3 a 6 meses de estrutura fixa. É o que dá fôlego para não recorrer a empréstimo caro na primeira turbulência.' },
  { g: 'Saúde financeira e liquidez', t: 'Endividamento', d: 'O quanto a empresa <b>deve</b> (empréstimos, financiamentos, parcelamentos) em relação ao que ela tem ou fatura. Dívida não é vilã se o dinheiro rende mais que o juro pago — vira problema quando o custo da dívida supera o retorno que ela financia.' },
  { g: 'Saúde financeira e liquidez', t: 'Inadimplência', d: 'A fatia de vendas <b>já faturadas mas não recebidas</b> no prazo. Alta inadimplência trava o caixa: o serviço foi feito, o custo já saiu, mas o dinheiro do cliente não entrou.' },

  { g: 'Custos e precificação', t: 'Markup', d: 'O <b>fator que se aplica sobre o custo</b> para chegar ao preço de venda, cobrindo despesas, impostos e lucro. Ex.: custo de R$ 100 com markup 2,5 → preço R$ 250. Cuidado: markup de 150% <b>não</b> é o mesmo que margem de 60% (ver Margem vs. Markup).' },
  { g: 'Custos e precificação', t: 'Margem vs. Markup', d: 'Confusão comum. <b>Markup</b> mede o acréscimo <i>sobre o custo</i>; <b>margem</b> mede o lucro <i>sobre o preço de venda</i>. Vender a R$ 250 algo que custou R$ 100: markup de 150%, mas margem de 60% (os R$ 150 de lucro sobre os R$ 250 do preço).' },
  { g: 'Custos e precificação', t: 'CMV / CPV (Custo da Mercadoria/Produto Vendido)', d: 'Quanto custou <b>produzir exatamente o que foi vendido</b> no período: chapas, lonas, adesivos, tinta, acabamento. Não inclui aluguel nem administrativo. Comparar CMV com a receita mostra se a precificação dos produtos está saudável.' },
  { g: 'Custos e precificação', t: 'Ticket Médio', d: 'O <b>valor médio por venda/pedido</b> no período (receita ÷ número de pedidos). Subir o ticket médio — vendendo serviços junto com o produto, por exemplo — aumenta o faturamento sem precisar de mais clientes.' },

  { g: 'Eficiência e crescimento', t: 'EBITDA', d: 'O lucro <b>só da operação</b>, antes de juros, impostos sobre o lucro, depreciação e amortização. Aproxima a <b>geração de caixa operacional</b> e permite comparar empresas ignorando dívida e regime tributário. Margem EBITDA alta = operação eficiente em gerar caixa.' },
  { g: 'Eficiência e crescimento', t: 'Depreciação', d: 'O <b>desgaste contábil dos bens</b> (máquinas, veículos, computadores) distribuído ao longo da vida útil. Mesmo sem saída de caixa no mês, reconhece que o equipamento perde valor e precisará ser reposto. Lembra de reservar para a troca futura.' },
  { g: 'Eficiência e crescimento', t: 'ROE (Retorno sobre o Patrimônio)', d: 'Quanto a empresa gera de lucro para <b>cada R$ 1 que os sócios investiram</b> nela. ROE de 20% = o capital dos donos rende 20% ao ano dentro do negócio. Útil para comparar com deixar o dinheiro em outra aplicação.' },
  { g: 'Eficiência e crescimento', t: 'ROA (Retorno sobre os Ativos)', d: 'Quanto de lucro a empresa tira de <b>tudo que ela possui</b> (máquinas, estoque, caixa). Mede a eficiência em usar os bens para gerar resultado — independente de quanto disso é próprio ou financiado.' },
  { g: 'Eficiência e crescimento', t: 'Giro de Estoque', d: 'Quantas vezes o estoque é <b>vendido e reposto</b> no período. Giro alto = material entra e sai rápido, menos dinheiro parado em prateleira; giro baixo = capital preso em insumo encalhado (chapas, tintas paradas).' },
  { g: 'Eficiência e crescimento', t: 'CAC (Custo de Aquisição de Cliente)', d: 'Quanto se gasta em <b>marketing e vendas para conquistar um cliente novo</b> (mídia paga, comissões, tempo). Se cada cliente custa R$ 300 para entrar, ele precisa gerar lucro acima disso para valer a pena.' },
  { g: 'Eficiência e crescimento', t: 'LTV (Valor do Cliente no Tempo)', d: 'O <b>lucro total que um cliente deixa</b> enquanto compra da empresa, somando todos os pedidos ao longo dos anos. A conta de ouro: o LTV precisa ser bem maior que o CAC — um cliente recorrente de comunicação visual vale muito mais que uma venda única.' },
];

/* ==================================================================== */
/*  CARDS RECOLHÍVEIS — injeta um botão de recolher em cada card          */
/* ==================================================================== */
const COLLAPSE_KEY = 'impresilk_dre_collapsed';
function wireCollapsibleCards() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch (_) {}
  const persist = () => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(saved)); } catch (_) {} };

  document.querySelectorAll('main .card').forEach((card, idx) => {
    const head = card.querySelector('.card-head');
    if (!head || head.querySelector('.card-collapse')) return; // já tem botão
    // id estável: usa o id da section, senão o índice
    const key = card.id || ('card-' + idx);
    card.dataset.collapseKey = key;

    const btn = document.createElement('button');
    btn.className = 'card-collapse';
    btn.type = 'button';
    btn.title = 'Recolher / expandir';
    btn.setAttribute('aria-label', 'Recolher ou expandir');
    btn.textContent = '▾';
    head.insertBefore(btn, head.firstChild); // caret antes do título (evita sobrepor controles à direita)

    const apply = () => {
      const c = key in saved ? !!saved[key] : card.hasAttribute('data-default-collapsed');
      card.classList.toggle('collapsed', c);
      btn.textContent = c ? '▸' : '▾';
    };
    btn.onclick = () => {
      saved[key] = !saved[key];
      apply(); persist();
      window.dispatchEvent(new Event('resize')); // gráficos recalculam ao reabrir
    };
    // clicar no título também recolhe
    const h2 = head.querySelector('h2');
    if (h2) { h2.style.cursor = 'pointer'; h2.onclick = () => btn.click(); }
    apply();
  });
}

function renderGlossary() {
  const grid = document.getElementById('glossaryGrid');
  if (!grid) return;
  const groups = [];
  GLOSSARY.forEach(item => {
    let gr = groups.find(x => x.name === item.g);
    if (!gr) { gr = { name: item.g, items: [] }; groups.push(gr); }
    gr.items.push(item);
  });
  grid.innerHTML = groups.map(gr => `
    <div class="gloss-group">
      <h3 class="gloss-group-title">${gr.name}</h3>
      <div class="gloss-items">
        ${gr.items.map(it => `<div class="gloss-item" data-term="${(it.t + ' ' + it.d).toLowerCase().replace(/<[^>]+>/g, '')}">
          <span class="gloss-term">${it.t}</span>
          <p class="gloss-def">${it.d}</p>
        </div>`).join('')}
      </div>
    </div>`).join('');

  const search = document.getElementById('glossarySearch');
  if (search && !search._wired) {
    search._wired = true;
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      grid.querySelectorAll('.gloss-item').forEach(el => {
        el.classList.toggle('hidden', !!q && !el.dataset.term.includes(q));
      });
      grid.querySelectorAll('.gloss-group').forEach(g => {
        const anyVisible = [...g.querySelectorAll('.gloss-item')].some(el => !el.classList.contains('hidden'));
        g.classList.toggle('hidden', !anyVisible);
      });
    };
  }
}

/* ==================================================================== */
/*  USUÁRIOS & PERMISSÕES (controle de acesso no navegador)              */
/*  ATENÇÃO: app estático/público — isto organiza acesso por usuário,    */
/*  mas NÃO é segurança real (dados em data.js são baixáveis). Para       */
/*  proteção de verdade, usar senha/Identity do Netlify.                 */
/* ==================================================================== */
const USERS_KEY = 'impresilk_dre_users';
const SESSION_KEY = 'impresilk_dre_session';
const GATEABLE_VIEWS = [
  { id: 'overview', label: '📊 Visão Geral' },
  { id: 'centers',  label: '🎯 Centros de Custo' },
  { id: 'buffett',  label: '🧠 Análise Fundamentalista' },
  { id: 'mirror',   label: '🗂️ Espelho' },
  { id: 'bancos',   label: '🏦 Bancos' },
  { id: 'glossary', label: '📖 Glossário' },
];
const ALL_VIEW_IDS = GATEABLE_VIEWS.map(v => v.id);

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hashPass(s) { // ofuscação (djb2 + sal) — não é hash criptográfico
  let h = 5381; const str = 'impresilk::' + s;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) ^ str.charCodeAt(i); h |= 0; }
  return (h >>> 0).toString(16);
}
function loadUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (_) { return []; } }
function saveUsers(u) { try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch (_) {} }
function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function setSession(s) { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (_) {} }
function findUser(username) { return loadUsers().find(u => u.user.toLowerCase() === String(username || '').toLowerCase()); }
function currentUser() { const s = getSession(); return s ? (findUser(s.user) || null) : null; }

let _switchView = null;       // definido em initApp (fecha sobre tabs/views)
let _allowed = new Set();      // views permitidas ao usuário logado

function applyPermissions(user) {
  const isMaster = user.role === 'master';
  const allowed = isMaster ? ALL_VIEW_IDS.slice() : (user.perms || []);
  _allowed = new Set(allowed);
  if (isMaster) _allowed.add('users');
  document.querySelectorAll('#viewTabs button').forEach(b => {
    const v = b.dataset.view;
    const ok = v === 'users' ? isMaster : _allowed.has(v);
    b.style.display = ok ? '' : 'none';
  });
  const activeBtn = document.querySelector('#viewTabs button.active');
  const cur = activeBtn ? activeBtn.dataset.view : null;
  if (!cur || !_allowed.has(cur)) {
    const first = [...document.querySelectorAll('#viewTabs button')].find(b => b.style.display !== 'none');
    if (first && _switchView) _switchView(first.dataset.view);
  }
}

/* ---------- login / setup ---------- */
function showAuth() {
  const overlay = document.getElementById('authOverlay');
  const hasMaster = loadUsers().some(u => u.role === 'master');
  document.getElementById('loginForm').hidden = !hasMaster;
  document.getElementById('setupForm').hidden = hasMaster;
  overlay.hidden = false;
  document.body.classList.add('locked');
  const f = hasMaster ? document.getElementById('loginUser') : document.getElementById('setupName');
  if (f) f.focus();
}
function hideAuth() { document.getElementById('authOverlay').hidden = true; document.body.classList.remove('locked'); }
function onAuthed() {
  const u = currentUser();
  if (!u) { showAuth(); return; }
  hideAuth();
  const chip = document.getElementById('userChip');
  chip.hidden = false;
  document.getElementById('ucName').textContent = u.name || u.user;
  document.getElementById('ucRole').textContent = u.role === 'master' ? 'Master' : 'Usuário';
  document.getElementById('ucAvatar').textContent = (u.name || u.user).trim().charAt(0).toUpperCase() || '·';
  applyPermissions(u);
  if (u.role === 'master') renderUsersAdmin();
}
function logout() { setSession(null); document.getElementById('userChip').hidden = true; showAuth(); }

/* ---------- painel de usuários (somente master) ---------- */
function permLabels(perms) {
  const names = GATEABLE_VIEWS.filter(v => (perms || []).includes(v.id)).map(v => v.label.replace(/^\S+\s/, ''));
  return names.length ? names.join(', ') : '—';
}
function renderUsersAdmin() {
  const tb = document.querySelector('#usersTable tbody');
  if (!tb) return;
  const me = currentUser();
  const users = loadUsers();
  tb.innerHTML = users.map(u => {
    const isMaster = u.role === 'master';
    const can = isMaster ? 'Tudo (master)' : permLabels(u.perms);
    const isSelf = me && u.user === me.user;
    return `<tr>
      <td class="t-name"><b>${esc(u.name || u.user)}</b> <span class="u-login">@${esc(u.user)}</span></td>
      <td class="t-name"><span class="u-badge ${isMaster ? 'master' : ''}">${isMaster ? 'Master' : 'Usuário'}</span></td>
      <td class="t-name u-can">${esc(can)}</td>
      <td><button class="ghost u-edit" data-u="${esc(u.user)}">Editar</button>
          <button class="ghost u-del" data-u="${esc(u.user)}"${isSelf ? ' disabled title="Você não pode excluir a si mesmo"' : ''}>Excluir</button></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('.u-edit').forEach(b => b.onclick = () => openUserModal(b.dataset.u));
  tb.querySelectorAll('.u-del').forEach(b => b.onclick = () => {
    if (b.disabled) return;
    const users2 = loadUsers();
    const target = users2.find(x => x.user === b.dataset.u);
    if (!target) return;
    if (target.role === 'master' && users2.filter(x => x.role === 'master').length <= 1) { toast('Não dá para excluir o único master', 'err'); return; }
    if (!confirm(`Excluir o usuário "${target.user}"?`)) return;
    saveUsers(users2.filter(x => x.user !== b.dataset.u));
    renderUsersAdmin();
    toast('Usuário excluído', 'ok');
  });
}

let _editUser = null;
function buildPermChecks(perms) {
  document.querySelector('#umPerms .um-perms-grid').innerHTML =
    GATEABLE_VIEWS.map(v => `<label class="um-check"><input type="checkbox" value="${v.id}" ${(perms || []).includes(v.id) ? 'checked' : ''}/> ${v.label}</label>`).join('');
}
function togglePermVisibility(role) { document.getElementById('umPerms').style.display = role === 'master' ? 'none' : ''; }
function openUserModal(username) {
  const modal = document.getElementById('userModal');
  if (!modal) return;
  _editUser = username ? loadUsers().find(u => u.user === username) : null;
  document.getElementById('userModalTitle').textContent = _editUser ? 'Editar usuário' : 'Novo usuário';
  document.getElementById('umName').value = _editUser ? (_editUser.name || '') : '';
  const userInput = document.getElementById('umUser');
  userInput.value = _editUser ? _editUser.user : ''; userInput.disabled = !!_editUser;
  document.getElementById('umPass').value = '';
  document.getElementById('umPassLabel').textContent = _editUser ? 'Nova senha (em branco mantém a atual)' : 'Senha';
  const role = document.getElementById('umRole'); role.value = _editUser ? _editUser.role : 'user';
  buildPermChecks(_editUser ? (_editUser.perms || []) : ['overview', 'glossary']);
  togglePermVisibility(role.value);
  document.getElementById('umErr').hidden = true;
  modal.hidden = false;
  document.getElementById('umName').focus();
}
function saveUserFromModal() {
  const name = document.getElementById('umName').value.trim();
  const user = document.getElementById('umUser').value.trim().toLowerCase();
  const pass = document.getElementById('umPass').value;
  const role = document.getElementById('umRole').value;
  const err = document.getElementById('umErr');
  const show = m => { err.textContent = m; err.hidden = false; };
  if (!user) return show('Informe o usuário (login).');
  if (!/^[a-z0-9._-]+$/.test(user)) return show('Usuário: use letras, números, ponto, hífen ou _.');
  const users = loadUsers();
  if (!_editUser && users.some(u => u.user === user)) return show('Já existe um usuário com esse login.');
  if (!_editUser && pass.length < 4) return show('Senha de no mínimo 4 caracteres.');
  if (_editUser && pass && pass.length < 4) return show('Senha de no mínimo 4 caracteres.');
  const perms = role === 'master' ? ALL_VIEW_IDS.slice() : [...document.querySelectorAll('#umPerms input:checked')].map(c => c.value);
  if (role !== 'master' && !perms.length) return show('Selecione ao menos uma tela que o usuário pode ver.');
  if (_editUser) {
    if (_editUser.role === 'master' && role !== 'master' && users.filter(u => u.role === 'master').length <= 1) return show('Não dá para rebaixar o único master.');
    _editUser.name = name || user; _editUser.role = role; _editUser.perms = perms;
    if (pass) _editUser.pass = hashPass(pass);
  } else {
    users.push({ name: name || user, user, pass: hashPass(pass), role, perms });
  }
  saveUsers(users);
  document.getElementById('userModal').hidden = true;
  renderUsersAdmin();
  const me = currentUser(); if (me) applyPermissions(me);
  toast(_editUser ? 'Usuário atualizado' : 'Usuário criado', 'ok');
}
function wireUserModal() {
  const modal = document.getElementById('userModal');
  if (!modal) return;
  document.getElementById('umRole').onchange = e => togglePermVisibility(e.target.value);
  document.getElementById('umSave').onclick = saveUserFromModal;
  document.getElementById('umCancel').onclick = () => modal.hidden = true;
  document.getElementById('userModalClose').onclick = () => modal.hidden = true;
  modal.onclick = e => { if (e.target === modal) modal.hidden = true; };
}
function initAuth() {
  document.getElementById('loginForm').onsubmit = e => {
    e.preventDefault();
    const u = findUser(document.getElementById('loginUser').value.trim());
    const ok = u && u.pass === hashPass(document.getElementById('loginPass').value);
    const err = document.getElementById('loginErr');
    if (!ok) { err.textContent = 'Usuário ou senha inválidos.'; err.hidden = false; return; }
    err.hidden = true; document.getElementById('loginPass').value = '';
    setSession({ user: u.user, t: Date.now() });
    onAuthed();
  };
  document.getElementById('setupForm').onsubmit = e => {
    e.preventDefault();
    const name = document.getElementById('setupName').value.trim();
    const user = document.getElementById('setupUser').value.trim().toLowerCase();
    const pass = document.getElementById('setupPass').value;
    const err = document.getElementById('setupErr');
    const show = m => { err.textContent = m; err.hidden = false; };
    if (!user || !/^[a-z0-9._-]+$/.test(user)) return show('Informe um usuário válido (letras/números).');
    if (pass.length < 4) return show('Senha de no mínimo 4 caracteres.');
    const users = loadUsers();
    users.push({ name: name || user, user, pass: hashPass(pass), role: 'master', perms: ALL_VIEW_IDS.slice() });
    saveUsers(users);
    setSession({ user, t: Date.now() });
    err.hidden = true; onAuthed();
  };
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('newUserBtn').onclick = () => openUserModal(null);
  wireUserModal();
  if (currentUser()) onAuthed(); else showAuth();
}

/* ==================================================================== */
/*  UPLOAD / DRAG-DROP / PERSISTÊNCIA                                     */
/* ==================================================================== */
function applyTheme(mode, persist = true) {
  const light = mode === 'light';
  document.body.classList.toggle('theme-light', light);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = light ? '☀️' : '🌙';
  if (persist) { try { localStorage.setItem(THEME_KEY, mode); } catch (_) {} }
  if (activeRenderAll) activeRenderAll(); // recolore gráficos conforme o tema
}

/* ---------- fluxo "Subir mês" (modal de confirmação) ---------- */
let _pendingMonth = null;      // contas parseadas aguardando confirmação
let handleMonthFile = null;    // definido em wireMonthUpload; usado também no drag-drop
function wireMonthUpload() {
  const btn = document.getElementById('addMonthBtn');
  const input = document.getElementById('monthFileInput');
  const modal = document.getElementById('monthModal');
  if (!btn || !input || !modal) return;

  const labelInput = document.getElementById('monthLabelInput');
  const warn = document.getElementById('monthWarn');

  const closeModal = () => { modal.hidden = true; _pendingMonth = null; };

  handleMonthFile = file => {
    if (!file) return;
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) { toast('Envie o export .xlsx “Plano de Contas”', 'err'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parsePlanoContasWorkbook(e.target.result);
        const g = c => { const a = parsed.find(x => x.code === c); return a ? a.value : 0; };
        const rec = g('1'), desp = g('2'), res = round2(rec - desp);
        const D = getCurrentData();
        const fmtBRL = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const card = (lbl, v, cls) => `<div class="mp"><span class="mp-l">${lbl}</span><b class="mp-v ${cls}">${fmtBRL(v)}</b></div>`;
        document.getElementById('monthPreview').innerHTML =
          card('Receitas', rec, 'pos') + card('Despesas', desp, 'neg') +
          card('Resultado', res, res >= 0 ? 'pos' : 'neg') +
          `<div class="mp"><span class="mp-l">Contas lidas</span><b class="mp-v">${parsed.length}</b></div>`;
        labelInput.value = nextMonthLabel(D && D.months ? D.months[D.months.length - 1] : '');
        const checkWarn = () => {
          const exists = D && D.months && D.months.includes(labelInput.value.trim());
          warn.hidden = !exists;
          if (exists) warn.textContent = `⚠ O período “${labelInput.value.trim()}” já existe — os dados desse mês serão substituídos.`;
        };
        labelInput.oninput = checkWarn; checkWarn();
        _pendingMonth = parsed;
        modal.hidden = false;
        labelInput.focus(); labelInput.select();
      } catch (err) {
        console.error(err);
        toast('Erro ao ler export: ' + err.message, 'err');
      }
    };
    reader.onerror = () => toast('Falha ao ler o arquivo', 'err');
    reader.readAsArrayBuffer(file);
  };

  btn.onclick = () => input.click();
  input.onchange = () => { handleMonthFile(input.files[0]); input.value = ''; };

  document.getElementById('monthConfirm').onclick = () => {
    if (!_pendingMonth) return;
    const label = labelInput.value.trim();
    if (!label) { toast('Informe o período (mês/ano)', 'err'); labelInput.focus(); return; }
    try {
      const D = getCurrentData();
      const merged = upsertMonth(D, label, _pendingMonth);
      const replaced = merged._replaced; delete merged._replaced;
      const ts = new Date().toISOString();
      try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); } catch (_) {}
      // carimba o timestamp SÓ do mês alterado e enfileira o upsert desse mês
      const tsMap = getMonthTS(); tsMap[label] = ts; setMonthTS(tsMap);
      const mi = merged.months.indexOf(label);
      if (mi >= 0) enqueueUpsert(monthRecord(merged, mi, ts));
      closeModal();
      boot(merged);
      toast(`${replaced ? 'Mês atualizado' : 'Mês adicionado'}: ${label} · ${merged.months.length} meses na série`, 'ok');
      // sobe para a nuvem (best-effort, pela fila): aparece nos outros aparelhos
      trySync();
    } catch (err) {
      console.error(err);
      toast('Erro ao adicionar mês: ' + err.message, 'err');
    }
  };

  document.getElementById('monthCancel').onclick = closeModal;
  document.getElementById('monthModalClose').onclick = closeModal;
  modal.onclick = e => { if (e.target === modal) closeModal(); };
}

function initApp() {
  // tema (claro/escuro) — preferência salva; na 1ª visita, segue o sistema (iOS/macOS)
  let theme = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch (_) {}
  if (!theme) {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    theme = prefersLight ? 'light' : 'dark';
    // acompanha a troca de tema do sistema enquanto o usuário não escolher manualmente
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onSysTheme = e => { let saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch (_) {} if (!saved) applyTheme(e.matches ? 'light' : 'dark', false); };
      mq.addEventListener ? mq.addEventListener('change', onSysTheme) : mq.addListener && mq.addListener(onSysTheme);
    }
  }
  document.body.classList.toggle('theme-light', theme === 'light');
  const themeBtn = document.getElementById('themeToggle');
  themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  themeBtn.onclick = () => applyTheme(document.body.classList.contains('theme-light') ? 'dark' : 'light');

  // logo oficial: usa logo.png se existir na pasta, senão mantém o SVG
  const probe = new Image();
  probe.onload = () => {
    const img = document.getElementById('brandImg'), svg = document.getElementById('brandSvg');
    img.src = 'logo.png'; img.hidden = false; if (svg) svg.style.display = 'none';
    document.querySelector('.brand')?.classList.add('has-logo');
  };
  probe.src = 'logo.png';

  // "Subir mês" (conexão MubySys — export Plano de Contas de 1 mês)
  wireMonthUpload();

  // drag & drop em toda a página → fluxo "Subir mês"
  const overlay = document.getElementById('dropOverlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; overlay.classList.add('show'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('show'); } });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; overlay.classList.remove('show');
    if (e.dataTransfer.files && e.dataTransfer.files[0] && handleMonthFile) handleMonthFile(e.dataTransfer.files[0]);
  });

  // navegação por abas
  const tabBtns = document.querySelectorAll('#viewTabs button');
  function switchView(view) {
    if (_allowed.size && !_allowed.has(view)) return; // bloqueia views sem permissão
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
    try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    window.dispatchEvent(new Event('resize')); // força os gráficos a recalcular tamanho
  }
  _switchView = switchView;
  tabBtns.forEach(b => b.onclick = () => switchView(b.dataset.view));
  let startView = 'overview';
  try { startView = localStorage.getItem(VIEW_KEY) || 'overview'; } catch (_) {}
  switchView(startView);

  // glossário (conteúdo estático — independe dos dados)
  renderGlossary();
  renderBancos();

  // botões de recolher em cada card
  wireCollapsibleCards();

  // dataset inicial: localStorage > data.js embutido
  let initial = window.DRE_DATA;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) { initial = JSON.parse(saved); }
  } catch (_) {}
  boot(initial);

  // backup local (exportar / importar .json)
  const backupBtn = document.getElementById('backupBtn');
  if (backupBtn) backupBtn.onclick = () => exportarBackup();
  const restoreBtn = document.getElementById('restoreBtn');
  const restoreInput = document.getElementById('restoreInput');
  if (restoreBtn && restoreInput) {
    restoreBtn.onclick = () => restoreInput.click();
    restoreInput.onchange = () => { if (restoreInput.files[0]) importarBackup(restoreInput.files[0]); restoreInput.value = ''; };
  }

  // botão "Sincronizar agora" (pull manual) + reconexão automática
  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) syncBtn.onclick = () => pullCloud(true);
  window.addEventListener('online', () => pullCloud());   // ao voltar a rede: drena a fila e puxa
  window.addEventListener('offline', () => setSyncState('off', 'Offline — usando dados locais'));
  if (!navigator.onLine) setSyncState('off', 'Offline — usando dados locais');

  // sincronização inicial: sobe pendências da fila e puxa os meses do servidor
  pullCloud();

  // controle de acesso (login / usuários / permissões)
  initAuth();
}

document.addEventListener('DOMContentLoaded', initApp);
