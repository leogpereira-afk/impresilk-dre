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

/* ---------- transforma a aba "Base" (array de linhas) em DRE_DATA ---------- */
function buildDataFromRows(rows) {
  if (!rows || !rows.length) throw new Error('Planilha vazia.');
  const header = rows[0].map(c => (c == null ? '' : String(c)));

  // detecta colunas de mês: a partir da col 1 até achar "Média"/"Total"/vazio
  const monthCols = [], months = [];
  for (let c = 1; c < header.length; c++) {
    const h = header[c].trim();
    if (h === '' || /m[eé]dia|total|acumulad/i.test(h)) break;
    monthCols.push(c);
    months.push(h);
  }
  if (!monthCols.length) throw new Error('Nenhuma coluna de mês encontrada no cabeçalho.');

  const accounts = [];
  const codeRe = /^([\d\s.]+?)\s*-\s*(.+)$/;
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r][0];
    if (raw == null) continue;
    const name0 = String(raw).trim();
    if (!name0 || ['Receitas', 'Despesas', 'Resultado'].includes(name0)) continue;
    const m = name0.match(codeRe);
    if (!m) continue;
    const segs = m[1].split('.').map(s => s.trim()).filter(Boolean);
    if (!segs.length) continue;
    const code = segs.join('.');
    const level = segs.length;
    const parent = level > 1 ? segs.slice(0, -1).join('.') : null;
    const values = monthCols.map(c => round2(parseNum(rows[r][c])));
    accounts.push({ code, name: m[2].trim(), level, parent, values });
  }
  if (!accounts.find(a => a.code === '1') || !accounts.find(a => a.code === '2'))
    throw new Error('Não encontrei as contas 1-Receitas e 2-Despesas. Confira a aba "Base".');

  return { company: 'Impresilk', basis: 'Competência de Caixa', months, accounts };
}

/* ---------- lê um arquivo .xlsx e devolve DRE_DATA ---------- */
function readWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  // procura a aba "Base" (case-insensitive); senão usa a primeira
  let sheetName = wb.SheetNames.find(n => /^base$/i.test(n.trim())) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  return buildDataFromRows(rows);
}

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
let _charts = { trend: null, comp: null, opOwner: null, marginLayers: null, center: null };
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
    renderKPIs(); renderInsights(); renderDRE(); renderComposition(); renderTrend(); buildMirrorHead(); renderMirror();
    renderCenters(); renderBuffett();
    document.getElementById('footMeta').textContent = `${MONTHS.length} meses · ${ACCS.length} contas · ${MONTHS[0]} → ${MONTHS[MONTHS.length - 1]}`;
  }

  ACCS.forEach(a => { if ((childrenOf.get(a.code) || []).length && a.level >= 2) collapsed.add(a.code); });
  activeRenderAll = renderAll;
  renderAll();
}

/* ==================================================================== */
/*  UPLOAD / DRAG-DROP / PERSISTÊNCIA                                     */
/* ==================================================================== */
function loadFromFile(file) {
  if (!file) return;
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) { toast('Envie um arquivo .xlsx', 'err'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = readWorkbook(e.target.result);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {}
      boot(data);
      toast(`Planilha carregada · ${data.months.length} meses, ${data.accounts.length} contas`, 'ok');
    } catch (err) {
      console.error(err);
      toast('Erro ao ler: ' + err.message, 'err');
    }
  };
  reader.onerror = () => toast('Falha ao ler o arquivo', 'err');
  reader.readAsArrayBuffer(file);
}

function applyTheme(mode) {
  const light = mode === 'light';
  document.body.classList.toggle('theme-light', light);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = light ? '☀️' : '🌙';
  try { localStorage.setItem(THEME_KEY, mode); } catch (_) {}
  if (activeRenderAll) activeRenderAll(); // recolore gráficos conforme o tema
}

/* ---------- fluxo "Subir mês" (modal de confirmação) ---------- */
let _pendingMonth = null; // contas parseadas aguardando confirmação
function wireMonthUpload() {
  const btn = document.getElementById('addMonthBtn');
  const input = document.getElementById('monthFileInput');
  const modal = document.getElementById('monthModal');
  if (!btn || !input || !modal) return;

  const labelInput = document.getElementById('monthLabelInput');
  const warn = document.getElementById('monthWarn');

  const closeModal = () => { modal.hidden = true; _pendingMonth = null; };

  btn.onclick = () => input.click();
  input.onchange = () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) { toast('Envie um arquivo .xlsx', 'err'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parsePlanoContasWorkbook(e.target.result);
        const get = c => { const a = parsed.find(x => x.code === c); return a ? a.value : 0; };
        const rec = get('1'), desp = get('2'), res = round2(rec - desp);
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

  document.getElementById('monthConfirm').onclick = () => {
    if (!_pendingMonth) return;
    const label = labelInput.value.trim();
    if (!label) { toast('Informe o período (mês/ano)', 'err'); labelInput.focus(); return; }
    try {
      const D = getCurrentData();
      const merged = upsertMonth(D, label, _pendingMonth);
      const replaced = merged._replaced; delete merged._replaced;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); } catch (_) {}
      closeModal();
      boot(merged);
      toast(`${replaced ? 'Mês atualizado' : 'Mês adicionado'}: ${label} · ${merged.months.length} meses na série`, 'ok');
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
  // tema (claro/escuro) — restaura preferência salva
  let theme = 'dark';
  try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) {}
  document.body.classList.toggle('theme-light', theme === 'light');
  const themeBtn = document.getElementById('themeToggle');
  themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  themeBtn.onclick = () => applyTheme(document.body.classList.contains('theme-light') ? 'dark' : 'light');

  // logo oficial: usa logo.png se existir na pasta, senão mantém o SVG
  const probe = new Image();
  probe.onload = () => {
    const img = document.getElementById('brandImg'), svg = document.getElementById('brandSvg');
    img.src = 'logo.png'; img.hidden = false; if (svg) svg.style.display = 'none';
  };
  probe.src = 'logo.png';

  // botão + input (substitui a planilha inteira — formato "Base" multi-mês)
  const fileInput = document.getElementById('fileInput');
  document.getElementById('uploadBtn').onclick = () => fileInput.click();
  fileInput.onchange = () => { loadFromFile(fileInput.files[0]); fileInput.value = ''; };

  // ícone "Subir mês" (conexão MubySys — export Plano de Contas de 1 mês)
  wireMonthUpload();

  // drag & drop em toda a página
  const overlay = document.getElementById('dropOverlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; overlay.classList.add('show'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('show'); } });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; overlay.classList.remove('show');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFromFile(e.dataTransfer.files[0]);
  });

  // navegação por abas
  const tabBtns = document.querySelectorAll('#viewTabs button');
  function switchView(view) {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
    try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    window.dispatchEvent(new Event('resize')); // força os gráficos a recalcular tamanho
  }
  tabBtns.forEach(b => b.onclick = () => switchView(b.dataset.view));
  let startView = 'overview';
  try { startView = localStorage.getItem(VIEW_KEY) || 'overview'; } catch (_) {}
  switchView(startView);

  // dataset inicial: localStorage > data.js embutido
  let initial = window.DRE_DATA;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) { initial = JSON.parse(saved); }
  } catch (_) {}
  boot(initial);
}

document.addEventListener('DOMContentLoaded', initApp);
