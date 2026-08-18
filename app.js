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
    s.onload = () => ok();
    s.onerror = () => {
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
  pends[mi] = [];
  return { company: D.company, basis: D.basis, months, accounts, origens, pendencias: pends, _replaced: D.months.includes(monthLabel) };
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
  return window.DRE_DATA;
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
function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (_) { return []; } }
function setQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (_) {} }

// dataset (centrado em contas) -> 1 registro por mês (centrado em células)
function monthRecord(D, i, ts) {
  const label = D.months[i];
  return {
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
    cells: D.accounts.map(a => ({ code: a.code, name: a.name, level: a.level, parent: a.parent, value: a.values[i] || 0 })),
  };
}
// registros por mês -> dataset (reconstrói as contas, em ordem cronológica)
function monthsToDataset(records) {
  const recs = records.slice().sort((a, b) => monthSortKey(a.label) - monthSortKey(b.label));
  const months = recs.map(r => r.label);
  const meta = new Map(); const order = []; // união de códigos preservando a ordem hierárquica
  recs.forEach(r => (r.cells || []).forEach(c => {
    if (!meta.has(c.code)) order.push(c.code);      // ordem hierárquica: 1ª vez
    // nome/nível/pai vêm do mês MAIS RECENTE que tem o código. Pegar do
    // primeiro congelava o rótulo de Dez/25 sobre conteúdo de hoje: depois da
    // renumeração, 2.1.11 aparecia como "Horas Extras" com R$ 8.864,59 dentro.
    meta.set(c.code, { name: c.name, level: c.level, parent: c.parent });
  }));
  const accounts = order.map(code => {
    const m = meta.get(code);
    const values = recs.map(r => { const c = (r.cells || []).find(x => x.code === code); return c ? (c.value || 0) : 0; });
    return { code, name: m.name, level: m.level, parent: m.parent, values };
  });
  const last = recs[recs.length - 1] || {};
  // origem de cada mês: "planilha" (veio do .xlsx) ou "erp" (o robô montou).
  // Os dois têm o MESMO plano de despesa, mas a receita é quebrada de formas
  // diferentes — a planilha usa as subcontas (Acrílicos, Lonas…) e o ERP usa o
  // produto vendido. Comparar folha com folha entre os dois faria a receita
  // inteira "sumir" de um mês e "nascer" no outro.
  return { company: last.company, basis: last.basis, months, accounts,
           origens: recs.map(r => r.origem || 'planilha'),
           pendencias: recs.map(r => r.pendencias || []) };
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
  salvarLocal(merged);
  const ts = getMonthTS(); ts[record.label || record.id] = record.atualizadoEm; setMonthTS(ts);
  boot(merged);
}
// garante o shape esperado (label/cells) num registro vindo do servidor
function normalizeRecord(r) {
  return { id: r.id, label: r.label || r.id, atualizadoEm: r.atualizadoEm, company: r.company, basis: r.basis, origem: r.origem || 'planilha', pendencias: r.pendencias || [], cells: r.cells || [] };
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

  // meses excluídos de propósito (ex.: subido com rótulo errado): o servidor
  // guarda a lista {id: quando}; cada aparelho remove sua cópia local em vez
  // de reenviá-la. Se o mês for editado DEPOIS da exclusão, ele volta a valer.
  let removidos = {};
  try { const rc = await api('getCfg'); removidos = (rc && rc.cfg && rc.cfg.removidos) || {}; } catch (_) {}
  const naoExcluido = r => !(removidos[r.id] && new Date(removidos[r.id]) >= new Date(r.atualizadoEm || 0));

  if (!remote.length) {                                // nuvem vazia
    const dd = dedupePeriods(datasetRecords(getCurrentData()));
    const locais = dd.kept.filter(naoExcluido);
    const fora = dd.dropped.concat(dd.kept.filter(r => !naoExcluido(r)));
    if (fora.length && locais.length) {                // limpa duplicatas/excluídos antes de semear
      const tsM = getMonthTS(); fora.forEach(d => delete tsM[d.label]); setMonthTS(tsM);
      const limpo = monthsToDataset(locais);
      salvarLocal(limpo);
      boot(limpo);
    }
    if (locais.length) {                               // semeia a nuvem com os meses locais
      locais.forEach(enqueueUpsert);
      toast(`Enviando ${locais.length} ${locais.length === 1 ? 'mês' : 'meses'} para a nuvem…`, 'ok');
      await trySync();
      setSyncState(getQueue().length ? 'pending' : 'ok', 'Meses locais enviados para a nuvem');
      return;
    }
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
  // aplica exclusões registradas no servidor: mês apagado de propósito sai
  // daqui também (e da fila), em vez de ser reenviado para a nuvem
  let excluidos = 0;
  localMap.forEach((r, id) => {
    if (!naoExcluido(r)) { localMap.delete(id); delete tsMap[r.label]; excluidos++; }
  });
  if (excluidos) {
    changed = true;
    setQueue(getQueue().filter(q => naoExcluido(q)));
    toast(`${excluidos} ${excluidos === 1 ? 'mês removido' : 'meses removidos'} — exclusão feita na nuvem`, 'ok');
  }
  // remove períodos duplicados (mesmo mês com grafia diferente) — fica a versão mais recente
  const { dropped: dups } = dedupePeriods([...localMap.values()]);
  if (dups.length) {
    changed = true;
    setQueue(getQueue().filter(q => !dups.some(d => d.id === q.id)));
    dups.forEach(d => {
      localMap.delete(d.id);
      delete tsMap[d.label];
      api('delete', { id: d.id }).catch(() => {});     // apaga a duplicata também na nuvem
    });
    toast(`${dups.length} ${dups.length === 1 ? 'período duplicado removido' : 'períodos duplicados removidos'} — mantida a versão mais recente`, 'ok');
  }
  // sobe para a nuvem os meses que só existem localmente (a nuvem não os tem)
  const remoteIds = new Set(remote.map(rem => normalizeRecord(rem).id));
  let soLocais = 0;
  localMap.forEach((r, id) => { if (!remoteIds.has(id)) { enqueueUpsert(r); soLocais++; } });
  if (soLocais) trySync();
  if (!changed) {
    setSyncState(getQueue().length ? 'pending' : 'ok', 'Já atualizado · ' + new Date().toLocaleString('pt-BR'));
    if (manual) toast('Tudo já estava atualizado ✓', 'ok');
    return;
  }
  setMonthTS(tsMap);
  const merged = monthsToDataset([...localMap.values()]);
  salvarLocal(merged);
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
      salvarLocal(merged);
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

/* Detalhe do card: o ouvinte mora aqui fora e é registrado uma vez só; boot()
   apenas aponta esta variável para a sua própria função (ver fim de boot). */
let abrirDetalheAtual = null;
document.addEventListener('click', e => {
  const alvo = e.target.closest && e.target.closest('[data-det]');
  if (alvo && abrirDetalheAtual) abrirDetalheAtual(alvo.dataset.det);
});
document.addEventListener('keydown', e => {
  const m = document.getElementById('detModal');
  if (e.key === 'Escape' && m && !m.hidden) m.hidden = true;
});
document.addEventListener('click', e => {
  // clicar no fundo escuro fecha
  if (e.target && e.target.id === 'detModal') e.target.hidden = true;
});

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

  /* ------------------------------------------------------------------ *
   *  Comparar mês com mês quando o plano de receita mudou de forma
   *  ------------------------------------------------------------------
   *  Mês de planilha quebra a receita nas subcontas do plano (1.1.1.1
   *  Acrílicos, 1.1.1.3 Lonas…). Mês do ERP quebra no PRODUTO vendido
   *  (1.1.1.51 Placa ACM…), porque a API não diz a que subconta cada
   *  produto pertence. Confrontar folha com folha entre os dois faz toda
   *  a receita aparecer como "Acrílicos −100%" e "Placa ACM +∞": foram
   *  76 contas sumindo (R$ 324 mil) e 79 nascendo (R$ 616 mil) na virada
   *  de Jun para Jul. A DESPESA não tem esse problema — o plano é o mesmo
   *  dos dois lados.
   *
   *  Onde a receita ainda é comparável: nos totais de galho, que existem
   *  nas duas formas. Abaixo disso, o painel mostra "—" e explica.       */
  const ORIGENS = D.origens || MONTHS.map(() => 'planilha');
  const RECEITA_COMPARAVEL = new Set(['1', '1.1', '1.1.1', '1.1.2', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7']);
  const mesmaEstrutura = (i, j) => ORIGENS[i] === ORIGENS[j];
  // Depois da renumeração de 02/08 a DESPESA também deixou de ser comparável
  // folha a folha entre um mês de planilha e um do ERP: 66 contas com dinheiro
  // num lado e zero no outro. Acima do nível 2 (os totais de centro) continua
  // valendo dos dois lados; abaixo, não.
  const comparavel = (code, i, j) => {
    if (mesmaEstrutura(i, j)) return true;
    const c = String(code);
    if (c.startsWith('1')) return RECEITA_COMPARAVEL.has(c);
    return c.split('.').length <= 2;          // 2, 2.1, 2.13… sim; 2.1.11 não
  };
  // variação relativa que respeita a regra acima (null = não dá para comparar)
  const ahEntre = (a, code, i, j) => {
    if (!comparavel(code, i, j)) return null;
    const v = val(a, i), vp = val(a, j);
    return vp ? (v - vp) / vp : (v ? 1 : null);
  };
  const AVISO_ESTRUTURA = (i, j) => mesmaEstrutura(i, j) ? '' :
    `<p class="hint" style="margin-top:8px">⚠️ ${MONTHS[i]} e ${MONTHS[j]} quebram a receita de formas diferentes —
     ${ORIGENS[i] === 'erp' ? MONTHS[i] : MONTHS[j]} vem do ERP e lista o <b>produto vendido</b>;
     ${ORIGENS[i] === 'erp' ? MONTHS[j] : MONTHS[i]} veio da planilha e lista as <b>subcontas do plano</b>.
     Por isso a comparação de receita aparece só nos totais, e produto a produto fica "—".
     A despesa compara normal, o plano de contas é o mesmo nos dois.</p>`;

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
  // Se o último mês estiver vazio (ex.: o robô criou o mês corrente no dia 1º
  // antes de existir lançamento), abre no último mês COM movimento — senão o
  // painel abriria com tudo zerado.
  while (cur > 0 && !val(REC, cur) && !val(DESP, cur)) cur--;
  let cmp = MONTHS.length >= 2 ? MONTHS.length - 2 : 0;
  let chartMode = 'bars';

  // ---- selects ----
  const monthSel = document.getElementById('monthSelect');
  const cmpSel = document.getElementById('compareSelect');
  monthSel.innerHTML = ''; cmpSel.innerHTML = '';
  MONTHS.forEach((m, i) => { monthSel.add(new Option(m, i)); cmpSel.add(new Option(m, i)); });
  monthSel.value = cur; cmpSel.value = cmp;
  monthSel.onchange = () => { cur = +monthSel.value; if (cmp === cur) { cmp = cur > 0 ? cur - 1 : Math.min(cur + 1, MONTHS.length - 1); cmpSel.value = cmp; } sincronizaPeriodo(); renderAll(); };
  cmpSel.onchange = () => { cmp = +cmpSel.value; sincronizaPeriodo(); renderAll(); };

  /* ------------------------------------------------------------------ *
   *  BARRA DE PERÍODO — ano + 12 chips de mês (no estilo do Mubisys)
   *  ------------------------------------------------------------------
   *  Dois dropdowns exigiam abrir, procurar e escolher para uma troca que
   *  o dono faz o tempo todo. Os chips mostram o ano inteiro de uma vez:
   *  quais meses existem, qual está aberto e qual é a comparação.        */
  const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const parseLabel = l => {                       // "Jul/2026" -> {m:6, a:2026}
    const [mm, aa] = String(l).split('/');
    const i = MES_CURTO.findIndex(x => x.toLowerCase() === String(mm).slice(0, 3).toLowerCase());
    return { m: i, a: parseInt(aa, 10) };
  };
  const META_MES = MONTHS.map(parseLabel);
  const ANOS = [...new Set(META_MES.map(x => x.a))].filter(Boolean).sort();
  // abre no ano VIGENTE; se o painel ainda não tem esse ano, no mais recente
  const anoHoje = new Date().getFullYear();
  let anoSel = ANOS.includes(anoHoje) ? anoHoje : (ANOS[ANOS.length - 1] || anoHoje);
  if (META_MES[cur] && META_MES[cur].a !== anoSel) anoSel = META_MES[cur].a;

  const elAno = document.getElementById('anoSelect');
  const elChips = document.getElementById('mesChips');
  const elCmp = document.getElementById('compareChip');

  function sincronizaPeriodo() {
    if (!elAno || !elChips) return;
    if (META_MES[cur]) anoSel = META_MES[cur].a;
    elAno.innerHTML = '';
    ANOS.forEach(a2 => elAno.add(new Option(a2, a2)));
    elAno.value = anoSel;

    elChips.innerHTML = MES_CURTO.map((nome, m) => {
      const i = META_MES.findIndex(x => x.a === anoSel && x.m === m);
      const temDado = i >= 0;
      const classes = ['mes-chip'];
      if (i === cur) classes.push('sel');
      if (i === cmp) classes.push('cmp');
      if (!temDado) classes.push('vazio');
      return `<button type="button" class="${classes.join(' ')}" ${temDado ? `data-i="${i}"` : 'disabled'}
        title="${temDado ? MONTHS[i] : nome + '/' + anoSel + ' — sem dados'}">${nome}</button>`;
    }).join('');
    elChips.querySelectorAll('button[data-i]').forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.i;
        if (i === cur) return;
        cur = i;
        if (cmp === cur) cmp = cur > 0 ? cur - 1 : Math.min(cur + 1, MONTHS.length - 1);
        monthSel.value = cur; cmpSel.value = cmp;
        sincronizaPeriodo(); renderAll();
      };
    });

    if (elCmp) {
      elCmp.innerHTML = '';
      MONTHS.forEach((m, i) => { if (i !== cur) elCmp.add(new Option(m, i)); });
      elCmp.value = cmp;
      elCmp.onchange = () => { cmp = +elCmp.value; cmpSel.value = cmp; sincronizaPeriodo(); renderAll(); };
    }
  }
  if (elAno) elAno.onchange = () => {
    anoSel = +elAno.value;
    // ao trocar de ano, abre no último mês COM dado daquele ano
    const doAno = META_MES.map((x, i) => ({ ...x, i })).filter(x => x.a === anoSel);
    if (doAno.length) {
      cur = doAno[doAno.length - 1].i;
      if (cmp === cur) cmp = cur > 0 ? cur - 1 : Math.min(cur + 1, MONTHS.length - 1);
      monthSel.value = cur; cmpSel.value = cmp;
    }
    sincronizaPeriodo(); renderAll();
  };


  // Seletor de lente: o dono alterna entre o resultado REAL da operação e o
  // valor COM os financiamentos. A faixa de conciliação abaixo continua fixa,
  // mostrando a composição das duas leituras ao mesmo tempo.
  const LENTE_KEY = 'impresilk_dre_lente';
  let lente = 'op';
  try { lente = localStorage.getItem(LENTE_KEY) || 'op'; } catch (_) {}
  function aplicaLente(l) {
    lente = l;
    try { localStorage.setItem(LENTE_KEY, l); } catch (_) {}
    document.querySelectorAll('#lenteNav button').forEach(b => b.classList.toggle('active', b.dataset.lente === l));
    renderKPIs();
  }

  // ===== KPIs (duas lentes) =====
  // OPERAÇÃO: só o que a empresa gera — exclui empréstimo captado (1.4/1.3) e
  //           devolução de dívida (2.13.6/2.13.7/2.14.3).
  // CAIXA:    tudo que passou pelo banco, sem exclusão — bate com o extrato.
  function renderKPIs() {
    const opMargem = i => salesAt(i) ? resOperAt(i) / salesAt(i) : 0;
    const cards = lente === 'caixa' ? [
      { cls: 'rev', label: 'Entrou no banco', val: revAt(cur), prev: revAt(cmp), goodUp: true, det: 'entrou' },
      { cls: 'exp', label: 'Saiu do banco', val: expAt(cur), prev: expAt(cmp), goodUp: false, det: 'saiu' },
      { cls: 'res', label: 'Variação de Caixa', val: resAt(cur), prev: resAt(cmp), goodUp: true, det: 'caixa' },
      { cls: 'mar', label: 'Margem de Caixa', val: marginAt(cur), prev: marginAt(cmp), goodUp: true, isPct: true, det: 'margemCaixa' },
    ] : [
      { cls: 'rev', label: 'Vendas', val: salesAt(cur), prev: salesAt(cmp), goodUp: true, det: 'vendas' },
      { cls: 'exp', label: 'Custos da Operação', val: despOperAt(cur), prev: despOperAt(cmp), goodUp: false, det: 'custos' },
      { cls: 'res', label: 'Resultado da Operação', val: resOperAt(cur), prev: resOperAt(cmp), goodUp: true, det: 'resultadoOper' },
      { cls: 'mar', label: 'Margem da Operação', val: opMargem(cur), prev: opMargem(cmp), goodUp: true, isPct: true, det: 'margemOper' },
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
      // A SETA mostra a DIREÇÃO do número; a COR mostra se é bom ou ruim.
      // Antes a seta seguia a cor, então "Custos +28,8%" aparecia com ▼ (para baixo).
      const subiu = c.isPct ? (c.val - c.prev) > 0 : (c.prev ? (c.val - c.prev) > 0 : false);
      const arrow = dClass === 'flat' ? '■' : (subiu ? '▲' : '▼');
      const valTxt = c.isPct ? pct(c.val) : fmt2(c.val);
      const valColor = (c.cls === 'res') ? (c.val >= 0 ? 'pos' : 'neg') : '';
      return `<div class="kpi ${c.cls} clicavel" data-det="${c.det}" role="button" tabindex="0" title="Clique para ver de onde vem este número">
        <div class="label">${c.label}</div>
        <div class="value ${valColor}">${valTxt}</div>
        <div class="delta ${dClass}">${arrow} ${dTxt} <span class="vs">vs ${MONTHS[cmp]}</span></div>
      </div>`;
    }).join('')
    /* Mês em andamento: com a alimentação automática, o mês corrente aparece
       no painel com poucos dias de movimento. Sem este aviso, "Ago caiu 90%
       vs Jul" seria só um mês de 3 dias contra um mês inteiro. */
    + (monthSortKey(MONTHS[cur]) === monthSortKey(
        ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][new Date().getMonth()]
        + '/' + new Date().getFullYear())
      ? `<p class="hint" style="grid-column:1/-1;margin:2px 0 0">⏳ <b>${MONTHS[cur]} está em andamento</b> —
         o robô lê o ERP ao longo do dia e os números crescem conforme os pagamentos entram.
         Comparação com ${MONTHS[cmp]} só vale no fim do mês.</p>` : '');
  }

  // (o antigo card 'Insights do Período' virou a aba 💡 Insights; seus dois
  //  sinais exclusivos — concentração de faturamento e maior peso nos custos —
  //  foram recompostos em sinaisDoMes)


  // ===== DRE por seção =====
  const openSections = new Set();
  function renderDRE() {
    const tb = document.querySelector('#dreTable tbody');
    const rows = [];
    const denom = salesAt(cur) || 1;   // base única: vendas (cabeçalho diz 'sobre as vendas')

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
    // Este número é ENTRADAS − SAÍDAS, ou seja variação de caixa. Chamar de
    // "RESULTADO" fazia a mesma palavra nomear duas coisas na mesma tela: o KPI
    // "Resultado da Operação" (R$ 41.782) e esta linha (R$ 10.358).
    rows.push(`<tr class="result"><td class="t-name">= VARIAÇÃO DE CAIXA <span class="t-nota">entrou − saiu</span></td>
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
    // Sem o filtro, "Bancárias" (que contém devolução de empréstimo) aparecia como
    // a MAIOR despesa da empresa — e o dono cortaria a linha errada.
    const data = expSections.filter(x => !['2.14', '2.16'].includes(x.code)).map(s => ({
      name: s.code === '2.13' ? 'Bancárias (tarifas e juros)' : s.name,
      v: s.code === '2.13' ? val(s, cur) - val(get('2.13.6'), cur) - val(get('2.13.7'), cur) : val(s, cur)
    })).filter(d => d.v > 0).sort((a, b) => b.v - a.v);
    const top = data.slice(0, 8);
    const restV = data.slice(8).reduce((s, d) => s + d.v, 0);
    const labels = top.map(d => d.name.replace(/^Despesas?\s+/i, ''));
    const vals = top.map(d => d.v);
    if (restV > 0) { labels.push('Outras'); vals.push(restV); }
    document.getElementById('compHint').textContent =
      `${MONTHS[cur]} · custos da operação ${fmt(despOperAt(cur))} — fora daqui: retiradas ${fmt(ownerAt(cur))}, máquinas ${fmt(investAt(cur))}, devolução de dívida ${fmt(loanOutAt(cur))}`;

    if (_charts.comp) _charts.comp.destroy();
    _charts.comp = new Chart(document.getElementById('compChart'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: vals, backgroundColor: PALETTE, borderColor: cssVar('--chart-border') || '#161f2e', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { color: cssVar('--chart-tick'), font: { size: 11 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)} (${pct(c.raw / (despOperAt(cur) || 1))})` } } } }
    });
    const maxV = data[0] ? data[0].v : 1;
    document.getElementById('expenseRank').innerHTML = data.slice(0, 6).map(d =>
      `<div class="row"><span class="nm">${d.name}</span>
       <span class="vl">${fmt(d.v)} · ${pct(d.v / (despOperAt(cur) || 1))}</span>
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
    // Além dos centros de DESPESA, entram os dois de RECEITA (Produtos 1.1.1 e
    // Serviços 1.1.2). Sem eles, a quebra interna de Serviços — instalação,
    // pintura, design, hora-máquina — ficava sem tela nenhuma.
    // Centros de RECEITA montados a partir dos dados, não de uma lista fixa:
    // 1.1 abre nos filhos (Produtos/Serviços) e as demais seções de venda entram
    // inteiras. Antes ficavam de fora — Portas/Painéis (R$ 181 mil em 8 meses) e
    // PDV não tinham nenhuma tela de análise.
    const receitaCentros = [
      ...(childrenOf.get('1.1') || []),
      ...(childrenOf.get('1') || []).filter(x => x.code !== '1.1' && !FIN_REV_CODES.includes(x.code)),
    ].filter(x => x && x.values.some(v => v !== 0));
    const centros = [...receitaCentros, ...expSections];
    if (!activeCenter || !get(activeCenter)) activeCenter = centros.length ? centros[0].code : null;
    tabsEl.innerHTML = centros.map(s => {
      const short = s.name.replace(/^Despesas?\s+/i, '');
      const rev = String(s.code).startsWith('1');
      return `<button data-c="${s.code}" class="${s.code === activeCenter ? 'active' : ''} ${rev ? 'is-rev' : ''}">${rev ? '↗ ' : ''}${short}</button>`;
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

    /* Vigia de desvio (pedido do Leonardo em 01/08, quando a Cemig saltou de
       R$ 982 para R$ 2.131): compara o mês atual com a MÉDIA DOS ANTERIORES —
       não com a média geral, que já contém o salto e o disfarça. Estourou
       ±35%, o card ganha um banner que não dá para não ver. */
    const mediaAnterior = vals => {
      const outros = vals.filter((_, i) => i !== cur && vals[i] > 0);
      return outros.length ? outros.reduce((s, v) => s + v, 0) / outros.length : 0;
    };
    const vigia = (nome, emoji, curV, base, contaTxt) => {
      if (!base || !curV) return '';
      const desvio = (curV - base) / base;
      if (Math.abs(desvio) < 0.35) return '';
      const acima = desvio > 0;
      return `<div class="util-alert ${acima ? 'alta' : 'baixa'}">
        <span class="ua-ic">${emoji}</span>
        <div><b>${nome} ${acima ? '' : 'bem '}${signedPct(desvio).replace('+', '')} ${acima ? 'ACIMA' : 'abaixo'} da média</b> —
        ${fmt(curV)} em ${MONTHS[cur]} contra ${fmt(base)} de média dos meses anteriores.
        ${acima ? `Vale conferir a fatura${contaTxt ? ` (${contaTxt})` : ''}: medidor, bandeira tarifária ou consumo mesmo.`
                : 'Confira se todas as contas do mês já entraram no sistema.'}</div>
      </div>`;
    };
    const alertas = vigia('Energia (Cemig)', '⚡', eCur, mediaAnterior(eVals), 'o medidor principal saltou de R$ 505 para R$ 1.522 entre jun e jul')
                  + vigia('Água (Copasa)', '💧', wCur, mediaAnterior(wVals), '');
    const alertBox = document.getElementById('utilitiesAlert');
    if (alertBox) alertBox.innerHTML = alertas;

    kpisEl.innerHTML = (alertBox ? '' : alertas) + `
      <div class="ck clicavel" data-det="cemig" role="button" tabindex="0" title="Clique para ver mês a mês"><span class="ck-l">⚡ Energia · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(eCur)}</span><span class="delta ${dCls(eAh)}">${dArr(eAh)} ${eAh == null ? '—' : signedPct(eAh)} <span class="vs">vs ${MONTHS[cmp]}</span></span></div>
      <div class="ck clicavel" data-det="copasa" role="button" tabindex="0" title="Clique para ver mês a mês"><span class="ck-l">💧 Água · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(wCur)}</span><span class="delta ${dCls(wAh)}">${dArr(wAh)} ${wAh == null ? '—' : signedPct(wAh)} <span class="vs">vs ${MONTHS[cmp]}</span></span></div>
      <div class="ck"><span class="ck-l">Total Utilidades · ${MONTHS[cur]}</span><span class="ck-v">${fmt2(eCur + wCur)}</span><span class="ck-s">energia + água no mês</span></div>
      <div class="ck"><span class="ck-l">Média Energia ${MONTHS.length}m</span><span class="ck-v">${fmt(eAvg)}</span><span class="ck-s">gasto médio mensal</span></div>
      <div class="ck"><span class="ck-l">Média Água ${MONTHS.length}m</span><span class="ck-v">${fmt(wAvg)}</span><span class="ck-s">gasto médio mensal</span></div>`;

    // célula pinta quando o mês desvia ±35% da média dos DEMAIS meses — assim
    // o salto da Cemig aparece na própria tabela, não só no banner
    const eBase = mediaAnterior(eVals), wBase = mediaAnterior(wVals);
    const marca = (v, base) => (v && base && Math.abs(v - base) / base >= 0.35)
      ? (v > base ? 'util-out alta' : 'util-out baixa') : '';
    tbody.innerHTML = MONTHS.map((m, i) => `<tr>
      <td class="t-name">${m}${i === cur ? ' <span class="u-now">atual</span>' : ''}</td>
      <td class="mono ${i === cur ? 'cur-col' : ''} ${marca(eVals[i], eBase)}">${eVals[i] ? fmt(eVals[i]) : '·'}</td>
      <td class="mono ${i === cur ? 'cur-col' : ''} ${marca(wVals[i], wBase)}">${wVals[i] ? fmt(wVals[i]) : '·'}</td>
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
    { key: 'invest',    code: '2.16', emoji: '📈', title: 'Investimentos à vista',    sub: 'Máquinas compradas sem financiamento (as financiadas ficam em Bancárias)' },
    { key: 'taxes',     code: '2.4',  emoji: '🏛️', title: 'Impostos',                sub: 'Carga tributária — DARF, DAS, ICMS, ISSQN, IPTU, IOF' },
    { key: 'banking',   code: '2.13', emoji: '🏦', title: 'Bancárias',               sub: '⚠ inclui devolução de empréstimo e capital de giro — não é tudo custo da operação' },
    { key: 'partners',  code: '2.14', emoji: '👔', title: 'Societárias',             sub: 'Retiradas dos sócios e arrendamento — destino do lucro, não custo' },
  ];
  const BRK_PALETTE = ['#a78bfa', '#38bdf8', '#2dd4bf', '#f59e0b', '#fb7185', '#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#4ade80', '#fca5a5', '#22d3ee'];

  // Os 18 cards de breakdown foram REMOVIDOS: os 16 códigos eram exatamente os
  // filhos da conta '2' — a mesma lista que já vira sub-aba em Centros. O total
  // de um centro chegava a aparecer em 6 telas. Agora o painel do centro é a
  // única fonte; BREAKDOWNS sobrevive só como metadado (emoji/título/descrição).
  const BRK_META = {};
  BREAKDOWNS.forEach(b => { BRK_META[b.code] = b; });

  function buildBreakdownShells() {
    const host = document.getElementById('breakdownCards');
    if (!host) return;
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
    if (!document.getElementById('breakdownCards')) return;   // cards removidos
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
      const base = b.rev ? salesAt(cur) : expAt(cur);   // vendas, não receita total
      const share = base ? totCur / base : 0;
      const shareLabel = b.rev ? '% das vendas' : '% das Despesas';
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

  const CCM_KEY = 'impresilk_dre_center_chart_mode';
  let centerChartMode = 'total';
  try { centerChartMode = localStorage.getItem(CCM_KEY) || 'total'; } catch (_) {}

  function renderCenterPanel() {
    const s = get(activeCenter);
    if (!s) { document.getElementById('centerPanel').innerHTML = '<p class="hint">Sem dados.</p>'; return; }
    const vals = s.values;
    const st = trendStats(vals);
    const v = vals[cur], vp = vals[cmp];
    const ah = vp ? (v - vp) / vp : null;
    const isRev = String(s.code).startsWith('1');   // Produtos/Serviços são RECEITA
    const shareRev = salesAt(cur) ? v / salesAt(cur) : 0;   // base única: vendas (sem empréstimo)
    const shareExp = expAt(cur) ? v / expAt(cur) : 0;

    // tendência textual
    let trendLabel, trendCls;
    if (Math.abs(st.slopePctMonth) < 0.02) { trendLabel = 'Estável'; trendCls = 'flat'; }
    else if (st.slopePctMonth > 0) { trendLabel = 'Em alta'; trendCls = isRev ? 'up' : 'down'; }
    else { trendLabel = 'Em queda'; trendCls = isRev ? 'down' : 'up'; }   // receita caindo = ruim
    const volat = st.cv > 0.4 ? 'Alta' : st.cv > 0.2 ? 'Média' : 'Baixa';

    // subcontas (nível imediatamente abaixo) ordenadas por valor no mês atual
    const kids = (childrenOf.get(s.code) || []).slice().sort((a, b) => val(b, cur) - val(a, cur));
    const kidsRows = kids.filter(k => k.values.some(x => x !== 0)).map(k => {
      const kst = trendStats(k.values);
      const kv = k.values[cur], kvp = k.values[cmp];
      const kah = ahEntre(k, k.code, cur, cmp);
      return `<tr>
        <td class="t-name">${k.name}</td>
        <td class="mono">${fmt(kv)}</td>
        <td class="av">${pct(v ? kv / v : 0)}</td>
        <td class="${kah == null ? 'av' : (isRev ? kah >= 0 : kah <= 0) ? 'pos' : 'neg'}" ${kah == null && !comparavel(k.code, cur, cmp) ? 'title="Os dois meses quebram a receita de formas diferentes — só dá para comparar o total do galho."' : ''}>${kah == null ? '—' : signedPct(kah)}</td>
        <td class="spark-cell">${sparkline(k.values, { w: 90, h: 22 })}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="hint">Sem subcontas com movimento.</td></tr>`;

    document.getElementById('centerPanel').innerHTML = `
      <div class="center-kpis">
        <div class="ck">
          <span class="ck-l">${(BRK_META[s.code] || {}).emoji || ''} ${s.name} · ${MONTHS[cur]}</span>
          <span class="ck-v">${fmt2(v)}</span>
          <span class="delta ${ah == null ? 'flat' : (isRev ? ah >= 0 : ah <= 0) ? 'up' : 'down'}">${ah == null ? '—' : (ah < 0 ? '▼' : '▲') + ' ' + signedPct(ah)} <span class="vs">vs ${MONTHS[cmp]}</span></span>
        </div>
        <div class="ck"><span class="ck-l">% das vendas</span><span class="ck-v">${pct(shareRev)}</span><span class="ck-s">${isRev ? 'fatia do faturamento' : 'peso sobre o que foi vendido'}</span></div>
        <div class="ck"><span class="ck-l">% das Despesas</span><span class="ck-v">${pct(shareExp)}</span><span class="ck-s">peso no total de gastos</span></div>
        <div class="ck"><span class="ck-l">Média ${MONTHS.length}m</span><span class="ck-v">${fmt(st.mean)}</span><span class="ck-s">${isRev ? 'faturamento médio mensal' : 'gasto médio mensal'}</span></div>
        <div class="ck"><span class="ck-l">Tendência</span><span class="ck-v ${trendCls === 'up' ? 'pos' : trendCls === 'down' ? 'neg' : ''}">${trendLabel}</span><span class="ck-s">${(st.slopePctMonth * 100 >= 0 ? '+' : '') + (st.slopePctMonth * 100).toFixed(1)}% por mês</span></div>
        <div class="ck"><span class="ck-l">Oscilação</span><span class="ck-v">${volat}</span><span class="ck-s">varia ${(st.cv * 100).toFixed(0)}% em torno da média</span></div>
      </div>
      ${isRev ? AVISO_ESTRUTURA(cur, cmp) : ''}
      <div class="center-grid">
        <div>
          <div class="seg ccm-seg" id="centerChartMode">
            <button data-m="total" class="${centerChartMode === 'total' ? 'active' : ''}">Total do centro</button>
            <button data-m="item" class="${centerChartMode === 'item' ? 'active' : ''}">Por item</button>
          </div>
          <div class="chart-wrap"><canvas id="centerChart"></canvas></div>
        </div>
        <div class="table-scroll">
          <table class="dre"><thead><tr>
            <th class="t-name">Subconta</th><th>Valor</th><th>% do centro</th><th>Variação</th><th>Histórico</th>
          </tr></thead><tbody>${kidsRows}</tbody></table>
        </div>
      </div>`;

    // modo "Por item": barras EMPILHADAS com os 6 maiores itens + Outros, mês a
    // mês — responde "dentro deste centro, o que cresceu ao longo do período?".
    const kidsAll = (childrenOf.get(s.code) || []).filter(k => k.values.some(x => x !== 0));
    const top6 = [...kidsAll].sort((a, b) => val(b, cur) - val(a, cur)).slice(0, 6);
    const outros = kidsAll.filter(k => !top6.includes(k));
    const dsItem = top6.map((k, n2) => ({
      type: 'bar', label: k.name, stack: 'c',
      data: MONTHS.map((_, i) => val(k, i)),
      backgroundColor: BRK_PALETTE[n2 % BRK_PALETTE.length], borderRadius: 3
    }));
    if (outros.length) dsItem.push({
      type: 'bar', label: `Outros (${outros.length})`, stack: 'c',
      data: MONTHS.map((_, i) => outros.reduce((a, k) => a + val(k, i), 0)),
      backgroundColor: 'rgba(148,163,184,.55)', borderRadius: 3
    });
    const porItem = centerChartMode === 'item' && dsItem.length > 0;

    destroyChart('center');
    _charts.center = new Chart(document.getElementById('centerChart'), {
      type: 'bar',
      data: { labels: MONTHS, datasets: porItem ? dsItem : [
        { type: 'bar', label: s.name, data: vals, backgroundColor: vals.map((_, i) => i === cur ? '#f59e0b' : 'rgba(245,158,158,.55)'), borderRadius: 5, order: 2 },
        { type: 'line', label: '% das vendas', data: MONTHS.map((_, i) => salesAt(i) ? vals[i] / salesAt(i) * 100 : 0), yAxisID: 'y2', borderColor: '#38bdf8', backgroundColor: '#38bdf8', tension: .35, pointRadius: 3, order: 1 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: cssVar('--chart-tick'), boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y2' ? ` ${c.dataset.label}: ${c.raw.toFixed(1)}%` : ` ${c.dataset.label}: ${fmt2(c.raw)}` } } },
        scales: {
          x: { stacked: porItem, ticks: { color: cssVar('--chart-tick') }, grid: { color: cssVar('--chart-grid') } },
          y: { stacked: porItem, ticks: { color: cssVar('--chart-tick'), callback: v => fmt(v) }, grid: { color: cssVar('--chart-grid') } },
          y2: { display: !porItem, position: 'right', ticks: { color: '#38bdf8', callback: v => v.toFixed(0) + '%' }, grid: { drawOnChartArea: false } }
        } }
    });

    const segEl = document.getElementById('centerChartMode');
    if (segEl) segEl.querySelectorAll('button').forEach(b => b.onclick = () => {
      centerChartMode = b.dataset.m;
      try { localStorage.setItem(CCM_KEY, centerChartMode); } catch (_) {}
      renderCenterPanel();
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
    // Quando os dois meses quebram a receita de formas diferentes, a folha do
    // outro mês não existe deste lado: entra só o que tem movimento no mês
    // atual, e a variação sai zerada em vez de fingir uma queda de 100%.
    /* Comparabilidade decidida POR FOLHA, não pelo centro (achado 01/08: a
       flag única zerava a variação de folhas que EXISTEM nos dois meses —
       1.4.2 Pessoal caiu R$ 101 mil e aparecia "R$ 0" verde — e pintava a
       coluna do mês comparado com os valores do mês ATUAL). Uma folha tem par
       quando as origens são iguais, quando não é receita, ou quando o MESMO
       código tem movimento nos dois meses. Folha sem par: mostra o valor real
       do outro mês (zero) e "—" na variação — nunca um número inventado. */
    const estruturaIgual = mesmaEstrutura(cur, cmp);
    const temPar = k => comparavel(k.code, cur, cmp) || (k.values[cur] !== 0 && k.values[cmp] !== 0);
    const items = leavesUnder(s.code)
      .filter(k => (estruturaIgual || !isRev) ? (k.values[cur] !== 0 || k.values[cmp] !== 0) : k.values[cur] !== 0)
      .map(k => {
        const par = temPar(k);
        const v = k.values[cur], vp = k.values[cmp];
        const abs = par ? v - vp : null;
        const rel = par ? (vp ? (v - vp) / vp : (v ? 1 : null)) : null;
        return { name: k.name, code: k.code, v, vp, abs, rel, vals: k.values, semCmp: !par };
      });
    // sem par ordena pelo tamanho no mês atual — variação nula não é "zero"
    items.sort((a, b) => Math.abs(b.abs ?? b.v) - Math.abs(a.abs ?? a.v));

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
        <div class="ck"><span class="ck-l">% das vendas</span><span class="ck-v">${pct(salesAt(cur) ? totCur / salesAt(cur) : 0)}</span><span class="ck-s">${isRev ? 'participação na receita' : 'peso sobre o faturamento'}</span></div>
      </div>`;

    // ---- gráfico de variação produto a produto (barras horizontais, top 12) ----
    const top = items.slice(0, 12);

    // ---- tabela item a item ----
    // sem par: valor real do outro mês e "—" nas variações (nunca 0 verde)
    const rows = items.map(it => `
      <tr>
        <td class="t-name">${it.name}</td>
        <td class="mono">${it.semCmp ? '<span class="av" title="Este mês quebra a receita de outra forma — sem par direto.">—</span>' : fmt(it.vp)}</td>
        <td class="mono">${fmt(it.v)}</td>
        <td class="mono ${it.abs == null ? 'av' : goodCls(it.abs)}">${it.abs == null ? '—' : arrow(it.abs) + ' ' + fmt(Math.abs(it.abs))}</td>
        <td class="${it.rel == null ? 'av' : goodCls(it.abs)}">${it.rel == null ? '—' : signedPct(it.rel)}</td>
        <td class="av">${pct(totCur ? it.v / totCur : 0)}</td>
        <td class="spark-cell">${sparkline(it.vals, { w: 90, h: 22 })}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="hint">Sem itens com movimento.</td></tr>`;

    panel.innerHTML = head + (isRev ? AVISO_ESTRUTURA(cur, cmp) : '') + `
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
    // quando as variações não são calculáveis (estruturas diferentes), o
    // gráfico mostra o VALOR do mês atual — doze barras zeradas não dizem nada
    const temVariacao = top.some(it => it.abs != null);
    _charts.bigCenter = new Chart(document.getElementById('bigCenterChart'), {
      type: 'bar',
      data: { labels: top.map(it => it.name), datasets: [{
        label: temVariacao ? `Variação ${MONTHS[cmp]} → ${MONTHS[cur]}` : `Valor em ${MONTHS[cur]}`,
        data: top.map(it => temVariacao ? (it.abs ?? 0) : it.v),
        backgroundColor: top.map(it => !temVariacao ? okColor
          : (isRev ? (it.abs ?? 0) >= 0 : (it.abs ?? 0) <= 0) ? okColor : badColor),
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
  // 1.7 "Entradas a Identificar" (criada 01/08/2026): Pix ainda sem dono NÃO é
  // venda — fica fora de salesAt até alguém identificar, junto com rendimento
  // e empréstimo. Antes esses valores caíam em conta de produto (Leitoso 3mm).
  const FIN_REV_CODES = ['1.3', '1.4', '1.7'];         // rendimentos + empréstimos + a identificar
  const VAR_COST_CODES = ['2.6', '2.10', '2.11', '2.12']; // custos variáveis ligados à produção/obra
  // 2.14.3 (Empréstimos Bancários) mora dentro de 2.14, mas é DEVOLUÇÃO DE DÍVIDA,
  // não retirada de sócio. Sem descontar, o bloco "Sócios" inflava 46% (R$ 340 mil
  // no acumulado) e o simulador de retiradas simulava em cima de número errado.
  const BANK_DEBT_CODE = '2.14.3';
  // base autoritativa = totais das contas 1 e 2 (batem com a planilha). Vendas = Receita total − receita financeira.
  const finRevAt = i => FIN_REV_CODES.reduce((s, c) => s + val(get(c), i), 0);
  const varCostAt = i => VAR_COST_CODES.reduce((s, c) => s + val(get(c), i), 0);
  // 2.14.3.4 "Nordeste" é FINANCIAMENTO DE MÁQUINA: parcela fixa (~R$ 23 mil) e
  // sem nenhuma captação correspondente em 1.4 — o banco pagou o fornecedor
  // direto. Não é dívida rotativa: é a máquina sendo paga. Vai para Investimentos.
  // O financiamento do Banco do Nordeste MUDOU DE CONTA em jun/2026: saiu de
  // 2.14.3.4 (Societárias) e passou para 2.13.7 (Bancárias). É a MESMA parcela
  // de ~R$ 23 mil/mês pagando máquina — as duas contam como INVESTIMENTO, nunca
  // como devolução de dívida rotativa.
  // A parcela do Banco do Nordeste (2.13.7.1) NÃO é uma coisa só. Lendo lançamento
  // a lançamento no ERP, ela se divide todo mês em três finalidades diferentes:
  //   2.13.7.1.1 máquinas (Jaraguá CNC, Impressora UV, Ninacut, Laser…) → ativo
  //   2.13.7.1.2 veículo (Saveiro)                                       → ativo
  //   2.13.7.1.3 CAPITAL DE GIRO                                         → dívida pura
  // Somar tudo como investimento inflava o ativo em ~R$ 9,6 mil/mês.
  const ATIVO_FIN_CODES = ['2.13.7.1.1', '2.13.7.1.2'];   // financiamento que vira patrimônio
  const GIRO_CODE = '2.13.7.1.3';                          // financiamento que é só dívida
  // A MESMA parcela nos meses ANTIGOS mora em 2.14.3.4 (antes da renumeração).
  // bankRevolvAt já a tirava da dívida rotativa, mas ninguém a colocava no
  // investimento: sobrava dentro de "Custos da Operação" e comia ~R$ 23 mil por
  // mês do resultado em Dez/25→Mai/26 (R$ 164 mil no acumulado). O card
  // "Máquinas e veículo financiados (Nordeste)" mostrava R$ 0 nesses meses.
  const machineOldAt = i => val(get('2.14.3.4'), i);
  const machineFinAt = i => ATIVO_FIN_CODES.reduce((s, c) => s + val(get(c), i), 0) + machineOldAt(i);
  const giroAt = i => val(get(GIRO_CODE), i);
  const bankDebtAt = i => val(get(BANK_DEBT_CODE), i);            // 2.14.3 (histórico antigo)
  const bankRevolvAt = i => bankDebtAt(i) - val(get('2.14.3.4'), i);
  // 2.17 "Devolução de Empréstimo de Sócio" e 2.18 "Transferência entre
  // Empresas" (criadas pelo Leonardo em 01/08/2026): saída que não é custo da
  // operação. Sem elas aqui, o valor cairia em "Custos da Operação" — o mesmo
  // bug do Nordeste sem split. O ERP já usa: Empréstimo Terceiros virou 2.17.3.
  const LOAN_OUT_CODES = ['2.13.6', '2.17', '2.18']; // antecipação/devolução/transferência
  const loanOutAt = i => LOAN_OUT_CODES.reduce((s, c) => s + val(get(c), i), 0) + bankRevolvAt(i) + giroAt(i);
  const investAt = i => val(get('2.16'), i) + machineFinAt(i);    // ativos: à vista + financiados
  const ownerAt = i => val(get('2.14'), i) - bankDebtAt(i);   // retiradas + arrendamento
  const salesAt = i => revAt(i) - finRevAt(i);                 // receita operacional (vendas)
  const cmAt = i => salesAt(i) - varCostAt(i);                 // margem de contribuição
  // estrutura fixa = despesa da operação menos custo variável. NÃO inclui
  // retirada de sócio nem devolução de empréstimo — senão o ponto de equilíbrio
  // sobe artificialmente e o "resultado operacional" daqui diverge do dos KPIs.
  const fixedAt = i => expAt(i) - varCostAt(i) - ownerAt(i) - loanOutAt(i) - investAt(i);
  const opResAt = i => salesAt(i) - varCostAt(i) - fixedAt(i); // resultado operacional (antes de sócios e financ.)

  // ── Visão em 3 blocos (padrão fluxo de caixa) ──────────────────────────────
  // Devolução de empréstimo NÃO é despesa (é o principal voltando) e empréstimo
  // captado NÃO é receita. Somados ao resultado eles mentem sobre a operação:
  // separamos em Operação · Sócios · Financiamento, cuja soma = variação de caixa.
  const despOperAt = i => expAt(i) - loanOutAt(i) - ownerAt(i) - investAt(i); // só a operação
  const resOperAt = i => salesAt(i) - despOperAt(i);            // resultado limpo da operação

  /* ------------------------------------------------------------------ *
   *  DETALHE DO CARD — todo card do painel abre e mostra de onde vem
   *  ------------------------------------------------------------------
   *  Cada card mostrava um número sem dizer de onde ele saiu. Clicando,
   *  abre a conta: a fórmula em palavras, quais contas somam nele e a
   *  série de todos os meses. Um registro por chave; o card só declara
   *  data-det="chave".                                                  */
  const detNoOper = ['2.13', '2.14', '2.16', '2.17', '2.18'];
  const filhosDe = c => (childrenOf.get(c) || []).map(x => x.code);
  const DETALHES = {
    entrou: () => ({ t: 'Entrou no banco', f: i => revAt(i), contas: filhosDe('1'),
      exp: 'Tudo que entrou na conta no mês, sem exclusão nenhuma — bate com o extrato. Inclui empréstimo captado, que não é venda.' }),
    saiu: () => ({ t: 'Saiu do banco', f: i => expAt(i), contas: filhosDe('2'), desp: true,
      exp: 'Tudo que saiu da conta no mês. Inclui retirada de sócio, devolução de empréstimo e compra de máquina — que não são custo da operação.' }),
    caixa: () => ({ t: 'Variação de Caixa', f: i => resAt(i), contas: ['1', '2'],
      exp: 'O que entrou menos o que saiu. É a variação do saldo no mês, não o lucro.' }),
    margemCaixa: () => ({ t: 'Margem de Caixa', f: i => marginAt(i), pct: true,
      exp: 'Variação de caixa dividida pelo que entrou. Quanto sobrou de cada R$ 100 que passaram pela conta.' }),
    vendas: () => ({ t: 'Vendas', f: i => salesAt(i),
      contas: filhosDe('1').filter(c => !FIN_REV_CODES.includes(c)),
      exp: 'Receita de verdade: tudo que entrou MENOS rendimentos (1.3) e empréstimos captados (1.4). Dinheiro emprestado não é venda.' }),
    custos: () => ({ t: 'Custos da Operação', f: i => despOperAt(i), desp: true,
      contas: filhosDe('2').filter(c => !detNoOper.includes(c)),
      exp: 'O que saiu MENOS devolução de empréstimo, retirada de sócio e compra de máquina. Só o que a operação consumiu.' }),
    resultadoOper: () => ({ t: 'Resultado da Operação', f: i => resOperAt(i),
      exp: 'Vendas menos custos da operação. É o que o negócio gerou, limpo de dívida, sócio e máquina.' }),
    margemOper: () => ({ t: 'Margem da Operação', f: i => (salesAt(i) ? resOperAt(i) / salesAt(i) : 0), pct: true,
      exp: 'Resultado da operação dividido pelas vendas. Quanto sobra de cada R$ 100 vendidos.' }),
    blocoOper: () => ({ t: '1 · Operação', f: i => resOperAt(i),
      exp: 'Primeiro dos 4 blocos: vendas menos custos operacionais. Operação − Sócios − Investimentos + Financiamento = variação de caixa.' }),
    // 2.14.3 fica FORA da lista: a fórmula (ownerAt = 2.14 − 2.14.3) o exclui,
    // e listá-lo fazia a tabela somar 50% acima do número grande em Dez/25.
    blocoSocios: () => ({ t: '2 · Sócios', f: i => -ownerAt(i), desp: true,
      contas: filhosDe('2.14').filter(c => c !== '2.14.3'),
      exp: 'Retiradas dos sócios e arrendamento (2.14), fora a devolução de empréstimo bancário que mora no mesmo galho.' }),
    blocoInvest: () => ({ t: '3 · Investimentos', f: i => -investAt(i), contas: ['2.16', ...ATIVO_FIN_CODES, '2.14.3.4'],
      exp: 'Máquinas e veículos, à vista ou financiados. Vira patrimônio — sai do caixa mas não é gasto.' }),
    // Contas COM SINAL, espelhando financAt exatamente — a lista plana somava
    // R$ 280 mil "de onde vem" para um bloco de R$ 24 mil (2.13.6 é subtraído
    // na fórmula mas aparecia como parcela positiva).
    blocoFinanc: () => ({ t: '4 · Financiamento', f: i => financAt(i), contas: [
      { c: '1.3', s: +1 }, { c: '1.4', s: +1 }, { c: '1.7', s: +1 },
      { c: '2.13.6', s: -1 }, { c: '2.17', s: -1 }, { c: '2.18', s: -1 },
      { c: '2.14.3', s: -1 }, { c: '2.14.3.4', s: +1 },
      { c: '2.13.7.1.3', s: -1 },
    ],
      exp: 'Empréstimo entrando (+) menos empréstimo saindo (−). Não é resultado: é dinheiro emprestado indo e voltando. As linhas somam exatamente o número grande.' }),
    cemig: () => ({ t: '⚡ Energia (Cemig)', f: i => val(get('2.5.3'), i), contas: filhosDe('2.5.3'), desp: true,
      exp: 'Conta 2.5.3 do plano. Segue a data de PAGAMENTO: uma conta paga no dia 1º do mês seguinte cai no mês seguinte.' }),
    copasa: () => ({ t: '💧 Água (Copasa)', f: i => val(get('2.5.1'), i), contas: filhosDe('2.5.1'), desp: true,
      exp: 'Conta 2.5.1 do plano. Segue a data de PAGAMENTO, igual à energia.' }),
  };

  function abrirDetalhe(chave) {
    const mk = DETALHES[chave];
    const box = document.getElementById('detBox');
    if (!mk || !box) return;
    const d = mk();
    const serie = MONTHS.map((_, i) => d.f(i));
    const v = serie[cur], vp = serie[cmp];
    const dif = d.pct ? v - vp : (vp ? (v - vp) / Math.abs(vp) : null);
    const st = trendStats(serie);
    const bom = d.desp ? (v <= vp) : (v >= vp);
    // conta pode vir como string ('2.14') ou com sinal ({c:'2.13.6', s:-1}) —
    // o sinal faz a tabela somar exatamente o número grande do card
    const linhas = (d.contas || [])
      .map(e => (typeof e === 'string' ? { c: e, s: +1 } : e))
      .map(e => ({ e, a: get(e.c) })).filter(x => x.a)
      .map(({ e, a }) => ({ a, s: e.s, v: e.s * val(a, cur), ah: ahEntre(a, a.code, cur, cmp) }))
      .filter(x => x.v || x.ah != null)
      .sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    const somaLinhas = linhas.reduce((s, x) => s + Math.abs(x.v), 0);

    box.innerHTML = `
      <div class="modal-head"><strong>${d.t} · ${MONTHS[cur]}</strong>
        <button class="modal-x" id="detClose" aria-label="Fechar">✕</button></div>
      <div class="det-top">
        <div class="det-v ${v >= 0 ? '' : 'neg'}">${d.pct ? pct(v) : fmt2(v)}</div>
        <div class="delta ${dif == null ? 'flat' : bom ? 'up' : 'down'}">
          ${dif == null ? '—' : (v > vp ? '▲' : v < vp ? '▼' : '■') + ' ' +
            (d.pct ? ((dif >= 0 ? '+' : '') + (dif * 100).toFixed(1) + ' p.p.') : signedPct(dif))}
          <span class="vs">vs ${MONTHS[cmp]}</span></div>
      </div>
      <p class="hint">${d.exp}</p>
      ${linhas.length ? `<h3 class="banco-group-title">De onde vem</h3>
      <div class="table-scroll"><table class="dre">
        <thead><tr><th class="t-name">Conta</th><th>${MONTHS[cur]}</th><th>peso</th><th>vs ${MONTHS[cmp]}</th></tr></thead>
        <tbody>${linhas.map(x => `<tr>
          <td class="t-name"><b>${x.a.code}</b> ${escAttr(x.a.name)}</td>
          <td class="mono">${fmt(x.v)}</td>
          <td class="av">${pct(somaLinhas ? Math.abs(x.v) / somaLinhas : 0)}</td>
          <td class="${x.ah == null ? 'av' : (d.desp ? x.ah <= 0 : x.ah >= 0) ? 'pos' : 'neg'}">${x.ah == null ? '—' : signedPct(x.ah)}</td>
        </tr>`).join('')}</tbody></table></div>` : ''}
      ${!mesmaEstrutura(cur, cmp) && linhas.some(x => x.ah == null) ? AVISO_ESTRUTURA(cur, cmp) : ''}
      <h3 class="banco-group-title">Mês a mês</h3>
      <div class="det-spark">${sparkline(serie, { w: 260, h: 40 })}</div>
      <div class="table-scroll"><table class="dre">
        <thead><tr><th class="t-name">Mês</th><th>Valor</th><th>vs mês anterior</th></tr></thead>
        <tbody>${MONTHS.map((m, i) => {
          const ant = i ? serie[i - 1] : null;
          const dd = ant == null ? null : (d.pct ? serie[i] - ant : (ant ? (serie[i] - ant) / Math.abs(ant) : null));
          const okk = d.desp ? serie[i] <= (ant ?? serie[i]) : serie[i] >= (ant ?? serie[i]);
          return `<tr${i === cur ? ' class="cur-row"' : ''}>
            <td class="t-name">${m}${i === cur ? ' <span class="u-now">atual</span>' : ''}</td>
            <td class="mono">${d.pct ? pct(serie[i]) : fmt(serie[i])}</td>
            <td class="${dd == null ? 'av' : okk ? 'pos' : 'neg'}">${dd == null ? '—' :
              d.pct ? ((dd >= 0 ? '+' : '') + (dd * 100).toFixed(1) + ' p.p.') : signedPct(dd)}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="hint" style="margin-top:10px">Média dos ${MONTHS.length} meses: <b>${d.pct ? pct(st.mean) : fmt(st.mean)}</b> ·
      oscila ${(st.cv * 100).toFixed(0)}% em torno dela · tendência de
      ${(st.slopePctMonth * 100 >= 0 ? '+' : '') + (st.slopePctMonth * 100).toFixed(1)}% por mês.</p>`;

    const modal = document.getElementById('detModal');
    modal.hidden = false;
    document.getElementById('detClose').onclick = () => { modal.hidden = true; };
  }

  // boot() roda de novo a cada sincronização; o ouvinte de clique é registrado
  // UMA vez lá fora e só troca de alvo aqui. Registrar aqui dentro empilharia
  // um ouvinte por boot e o detalhe seria remontado várias vezes por clique.
  abrirDetalheAtual = abrirDetalhe;
  const financAt = i => finRevAt(i) - loanOutAt(i);             // saldo de financiamento


  /* ================================================================== */
  /*  ABA INSIGHTS — 3 modos: Mês · Ano · Comparar                       */
  /*  Regra de ouro: o número que manda é o RESULTADO DA OPERAÇÃO.       */
  /*  Empréstimo captado NÃO é venda; devolução NÃO é despesa.           */
  /* ================================================================== */
  const INS_MODO_KEY = 'impresilk_dre_ins_modo';
  let insModo = 'mes';
  try { insModo = localStorage.getItem(INS_MODO_KEY) || 'mes'; } catch (_) {}

  const semaforo = (bom, medio) => bom ? '🟢' : medio ? '🟡' : '🔴';
  const tile = (rot, valor, sub, cls) =>
    `<div class="ins-tile ${cls || ''}"><span class="it-l">${rot}</span><span class="it-v">${valor}</span><span class="it-s">${sub}</span></div>`;

  // sinais candidatos do mês, pontuados por |impacto em R$| — mostramos só os 3 maiores
  function sinaisDoMes(i) {
    const out = [];
    const vendas = salesAt(i), op = resOperAt(i), soc = ownerAt(i);
    const push = (t, tipo, txt, peso) => out.push({ t, tipo, txt, peso: Math.abs(peso || 0) });

    // 1) cobertura das retiradas pela operação
    if (soc > 0) {
      const cob = op / soc;
      push('Retiradas vs. operação', cob >= 1.1 ? 'good' : cob >= 0.9 ? 'warn' : 'bad',
        `A operação gerou <b>${fmt(op)}</b> e os sócios retiraram <b>${fmt(soc)}</b> — cobertura de <b>${pct(cob)}</b>. ${cob >= 1.1 ? 'Sobra caixa depois de remunerar os donos.' : cob >= 0.9 ? 'No limite: quase tudo que a operação gera vai para os sócios.' : 'A operação <b>não cobre</b> as retiradas — a diferença sai de empréstimo ou do caixa.'}`,
        Math.abs(op - soc));
    }
    // 2) margem operacional vs média dos demais meses
    if (vendas > 0) {
      const m = op / vendas;
      const outros = MONTHS.map((_, k) => k !== i && salesAt(k) ? resOperAt(k) / salesAt(k) : null).filter(v => v != null);
      const mediaM = outros.length ? outros.reduce((s, v) => s + v, 0) / outros.length : m;
      const d = m - mediaM;
      push('Margem da operação', m >= 0.15 ? 'good' : m >= 0.05 ? 'warn' : 'bad',
        `Cada R$ 100 vendidos deixaram <b>${fmt(m * 100)}</b> na operação (${pct(m)}). A média dos outros meses é ${pct(mediaM)} — ${d >= 0 ? 'está <b>acima</b>' : 'está <b>abaixo</b>'} em ${(Math.abs(d) * 100).toFixed(1)} p.p.`,
        Math.abs(d) * vendas);
    }
    // 3) maior variação por seção vs mês comparado (receita e despesa)
    if (i !== cmp) {
      // Só entram aqui as seções OPERACIONAIS. Empréstimo captado (1.3/1.4) não é
      // venda — dizer que subiu é "favorável" induziria o dono a achar bom se
      // endividar. E 2.13/2.14/2.16 (dívida, sócios, máquinas) não afetam o
      // resultado da operação: eram reportados como se tivessem "comido" o lucro.
      const NAO_OPER = ['1.3', '1.4', '1.7', '2.13', '2.14', '2.16', '2.17', '2.18'];
      const secs = [...(childrenOf.get('1') || []), ...(childrenOf.get('2') || [])];
      secs.forEach(sec => {
        if (NAO_OPER.includes(sec.code)) return;
        const a = val(sec, i), b = val(sec, cmp), d = a - b;
        if (!b || Math.abs(d) < vendas * 0.01) return;
        const rev = String(sec.code).startsWith('1');
        const bom = rev ? d > 0 : d < 0;
        push(`${rev ? 'Venda' : 'Custo'}: ${sec.name.replace(/^Despesas?\s+/i, '')}`, bom ? 'good' : 'bad',
          `${sec.name.replace(/^Despesas?\s+/i, '')} ${d > 0 ? 'subiu' : 'caiu'} <b>${fmt(Math.abs(d))}</b> (${signedPct(d / b)}) vs ${MONTHS[cmp]} — de ${fmt(b)} para ${fmt(a)}. ${bom ? (rev ? 'Vendeu mais nessa linha.' : 'Economia real na operação.') : rev ? 'Perda de faturamento nessa linha.' : 'Esse aumento comeu o resultado da operação.'}`,
          d);
      });
    }
    // 4) peso do financiamento (destaque pedido pelo dono)
    const fin = financAt(i), inn = finRevAt(i), outv = loanOutAt(i);
    if (inn > 0 || outv > 0) {
      push('Empréstimos no mês', outv > inn ? 'good' : inn > vendas * 0.15 ? 'bad' : 'warn',
        `Entraram <b>${fmt(inn)}</b> de empréstimo/rendimento e saíram <b>${fmt(outv)}</b> de devolução — saldo de <b>${fmt(fin)}</b>. ${inn > vendas * 0.15 ? `A captação equivale a <b>${pct(inn / vendas)}</b> das vendas: parte do que parece receita é <b>dinheiro emprestado</b>.` : outv > inn ? 'Você pagou mais dívida do que pegou — dívida caindo.' : 'Movimento pequeno em relação às vendas.'}`,
        Math.max(inn, outv));
    }
    // 4b) contas de consumo fora do padrão (pedido do Leonardo em 01/08,
    // quando a Cemig saltou de R$ 982 para R$ 2.131 num mês). Compara com a
    // média dos MESES ANTERIORES — a média geral já contém o salto e disfarça.
    // O peso entra em reais de desvio, competindo de igual com os outros sinais.
    [['2.5.3', '⚡ Energia (Cemig)'], ['2.5.1', '💧 Água (Copasa)']].forEach(([code, rot]) => {
      const conta = get(code);
      if (!conta) return;
      const atual = val(conta, i);
      const outros = MONTHS.map((_, k) => val(conta, k)).filter((v, k) => k !== i && v > 0);
      if (!outros.length || !atual) return;
      const base = outros.reduce((s, v) => s + v, 0) / outros.length;
      const desvio = (atual - base) / base;
      if (Math.abs(desvio) < 0.35) return;
      const acima = desvio > 0;
      push(`${rot} fora do padrão`, acima ? 'bad' : 'warn',
        `${rot} veio <b>${fmt(atual)}</b> em ${MONTHS[i]} — a média dos outros meses é <b>${fmt(base)}</b>
         (${signedPct(desvio)}). ${acima
           ? 'Vale abrir a fatura: medidor, bandeira tarifária ou consumo que mudou de patamar.'
           : 'Bem abaixo do normal — confira se todas as contas do mês já entraram no sistema.'}`,
        Math.abs(atual - base) * 4);
      out[out.length - 1].fixo = true;   // anomalia SEMPRE aparece — medido: mesmo ×4 no peso, R$ 1.200 de desvio some atrás de variações de dezenas de milhares
    });

    // 5) concentração de faturamento — risco de depender de um produto só.
    // Voltou do card "Insights do Período": era o único alerta de risco de
    // dependência e não tinha substituto na aba nova.
    const familias = [
      ...(childrenOf.get('1.1.1') || []),
      ...(childrenOf.get('1.1') || []).filter(x => x.code !== '1.1.1'),
      ...(childrenOf.get('1') || []).filter(x => x.code !== '1.1' && !FIN_REV_CODES.includes(x.code)),
    ].map(x => ({ nome: x.name, v: val(x, i) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    if (familias.length && vendas > 0) {
      const top = familias[0], sh = top.v / vendas;
      push('Concentração do faturamento', sh > 0.6 ? 'bad' : sh > 0.4 ? 'warn' : 'good',
        `<b>${top.nome}</b> respondeu por <b>${pct(sh)}</b> das vendas do mês (${fmt(top.v)}) — de ${familias.length} linhas de receita. ${sh > 0.6 ? 'Dependência <b>alta</b>: se essa linha cair, o mês cai junto.' : sh > 0.4 ? 'Concentração relevante — vale desenvolver as outras linhas.' : 'Faturamento bem distribuído.'}`,
        sh > 0.4 ? top.v * (sh - 0.4) : 0);
    }

    // 6) qual centro consome mais da operação (também vinha do card antigo)
    const centrosOper = (childrenOf.get('2') || []).filter(x => !['2.14', '2.16'].includes(x.code))
      .map(sx => ({
        nome: sx.code === '2.13' ? 'Bancárias (tarifas e juros)' : sx.name.replace(/^Despesas?\s+/i, ''),
        v: sx.code === '2.13' ? val(sx, i) - val(get('2.13.6'), i) - val(get('2.13.7'), i) : val(sx, i)
      })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    if (centrosOper.length && despOperAt(i) > 0) {
      const tc = centrosOper[0], shc = tc.v / despOperAt(i);
      push('Maior peso nos custos', shc > 0.35 ? 'warn' : 'good',
        `<b>${tc.nome}</b> é o maior custo do mês: <b>${fmt(tc.v)}</b>, ou <b>${pct(shc)}</b> de tudo que a operação gastou — equivale a <b>${pct(vendas ? tc.v / vendas : 0)}</b> das vendas.`,
        tc.v * shc);
    }

    // 7) ponto de equilíbrio
    const cmPct = vendas ? cmAt(i) / vendas : 0;
    if (cmPct > 0) {
      const be = Math.max(0, fixedAt(i)) / cmPct;
      push('Ponto de equilíbrio', vendas > be ? 'good' : 'bad',
        `Para pagar a estrutura era preciso vender <b>${fmt(be)}</b>. Vendeu <b>${fmt(vendas)}</b> — ${vendas > be ? `<b>${fmt(vendas - be)}</b> acima` : `<b>${fmt(be - vendas)}</b> abaixo`} do equilíbrio.`,
        Math.abs(vendas - be));
    }
    return out.sort((a, b) => b.peso - a.peso);
  }

  function insMes() {
    const i = cur, vendas = salesAt(i), op = resOperAt(i), soc = ownerAt(i), fin = financAt(i), inv = investAt(i);
    const margem = vendas ? op / vendas : 0;
    const cob = soc > 0 ? op / soc : null;
    // caixa negativo no mês, ou margem despencando, obriga vermelho — antes um
    // mês com -R$ 28 mil no banco saía amarelo e tranquilizava o dono
    const outrosM = MONTHS.map((_, k) => k !== i && salesAt(k) ? resOperAt(k) / salesAt(k) : null).filter(v => v != null);
    const mediaM = outrosM.length ? outrosM.reduce((a, v) => a + v, 0) / outrosM.length : margem;
    const ruim = op <= 0 || resAt(i) < 0 || (margem - mediaM) <= -0.10;
    const bom = !ruim && op > 0 && (cob == null || cob >= 1), medio = !ruim && op > 0;
    const sinais = sinaisDoMes(i);
    // top 3 por dinheiro + anomalias fixas (conta de consumo fora do padrão):
    // são tipos diferentes de sinal — magnitude não é o critério de anomalia
    const top = sinais.slice(0, 3);
    sinais.slice(3).filter(s => s.fixo).forEach(s => top.push(s));

    // movimentações que mais mudaram (contas-folha)
    const movs = [];
    if (i !== cmp) {
      ACCS.forEach(a => {
        if ((childrenOf.get(a.code) || []).length) return;
        // folha de receita sem par entre planilha×ERP não entra: "ACM Poliéster
        // −R$ 64 mil" e "Placa ACM +R$ 35 mil" eram troca de estrutura, não
        // movimento de venda (achado 01/08)
        if (!comparavel(a.code, i, cmp)) return;
        const va = val(a, i), vb = val(a, cmp), d = va - vb;
        if (Math.abs(d) > vendas * 0.005) movs.push({ nome: a.name, code: a.code, va, vb, d, rev: String(a.code).startsWith('1') });
      });
      movs.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    }

    return `
      <section class="card ins-head ${bom ? 'g' : medio ? 'w' : 'b'}">
        <div class="ins-manchete">
          <span class="ins-sem">${semaforo(bom, medio)}</span>
          <div>
            <h2>${MONTHS[i]} · a operação ${op >= 0 ? 'gerou' : 'consumiu'} ${fmt(Math.abs(op))}</h2>
            <p>Vendas de <b>${fmt(vendas)}</b> com margem de <b>${pct(margem)}</b>.
            ${soc > 0 ? `Os sócios retiraram <b>${fmt(soc)}</b>${cob != null ? ` — a operação cobriu <b>${pct(cob)}</b> disso.` : '.'}` : ''}
            ${Math.abs(fin) > 1 ? ` O caixa ainda ${fin >= 0 ? 'recebeu' : 'devolveu'} <b>${fmt(Math.abs(fin))}</b> de empréstimos.` : ''}
            ${resAt(i) < 0 ? `<br><b style="color:var(--neg)">Atenção: o banco fechou o mês com ${fmt(Math.abs(resAt(i)))} a menos.</b>` : ''}</p>
          </div>
        </div>
        <div class="ins-tiles">
          ${tile('Resultado da Operação', fmt(op), `margem ${pct(margem)} · ${MONTHS[i]}`, op >= 0 ? 'g' : 'b')}
          ${tile('Retiradas dos Sócios', fmt(-soc), cob != null ? `operação cobre ${pct(cob)}` : 'sem retirada', cob != null && cob < 1 ? 'w' : '')}
          ${tile('Investimentos', fmt(-inv), 'máquinas — vira patrimônio', '')}
          ${tile('Variação de Caixa', fmt(resAt(i)), 'o que sobrou no banco', resAt(i) >= 0 ? 'g' : 'b')}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>🎯 As 3 coisas que mais importam</h2>
          <span class="hint">ordenadas pelo dinheiro em jogo, não por ordem de tela</span></div>
        <div class="insight-grid">
          ${top.map((s, n) => `<div class="insight ${s.tipo}"><span class="it ${s.tipo}">${n + 1}º · ${s.t}</span>${s.txt}</div>`).join('') || '<p class="hint">Sem sinais relevantes neste mês.</p>'}
        </div>
      </section>

      ${movs.length ? `<section class="card">
        <div class="card-head"><h2>🔀 O que mais mudou vs ${MONTHS[cmp]}</h2>
          <span class="hint">as 8 contas com maior variação em reais</span></div>
        <div class="table-scroll"><table class="dre">
          <thead><tr><th class="t-name">Conta</th><th>${MONTHS[cmp]}</th><th>${MONTHS[i]}</th><th>Variação</th></tr></thead>
          <tbody>${movs.slice(0, 8).map(m => {
            // conta de dívida/financiamento não é "melhora" nem "piora" do
            // resultado — fica neutra, senão mais empréstimo aparece em verde
            // 2.14 INTEIRO, não só 2.14.3: sem isso a retirada do Leonardo
            // (−R$ 8.968,10 em jul/26) entrava verde, como economia da operação
            const naoOper = ['1.3', '1.4', '1.7', '2.13.6', '2.13.7', '2.14', '2.16', '2.17', '2.18']
              .some(pf => m.code === pf || String(m.code).startsWith(pf + '.'));
            const bomM = m.rev ? m.d > 0 : m.d < 0;
            return `<tr><td class="t-name">${m.nome}${naoOper ? '<span class="es-obs">dívida/financiamento — não é resultado</span>' : ''}</td><td>${fmt(m.vb)}</td><td>${fmt(m.va)}</td>
              <td class="${naoOper ? 'av' : bomM ? 'v-pos' : 'v-neg'}">${m.d >= 0 ? '+' : ''}${fmt(m.d)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
        ${!mesmaEstrutura(i, cmp) ? AVISO_ESTRUTURA(i, cmp) : ''}
      </section>` : ''}`;
  }

  function insAno() {
    const n = MONTHS.length;
    const T = { op: 0, so: 0, fi: 0, vd: 0, cx: 0, inn: 0, out: 0, inv: 0 };
    MONTHS.forEach((_, k) => {
      T.op += resOperAt(k); T.so += ownerAt(k); T.fi += financAt(k); T.inv += investAt(k);
      T.vd += salesAt(k); T.cx += resAt(k); T.inn += finRevAt(k); T.out += loanOutAt(k);
    });
    const margem = T.vd ? T.op / T.vd : 0;
    const cob = T.so > 0 ? T.op / T.so : null;
    // para onde vai cada R$ 100 vendidos
    // Só CUSTOS DA OPERAÇÃO: sem eles as barras somavam 107 de cada 100 vendidos
    // (entravam retiradas, dívida e máquinas) e ainda diziam "sobraram 20".
    // 2.14 e 2.16 saem inteiros; de 2.13 sai só a parte de devolução de empréstimo.
    const somaM = f => MONTHS.reduce((a, _, k) => a + f(k), 0);
    const secs = (childrenOf.get('2') || []).filter(x => !['2.14', '2.16'].includes(x.code)).map(sx => ({
      nome: sx.name.replace(/^Despesas?\s+/i, ''),
      v: sx.code === '2.13'
        ? somaM(k => val(sx, k) - val(get('2.13.6'), k) - val(get('2.13.7'), k))
        : somaM(k => val(sx, k))
    })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const totSec = secs.reduce((a, x) => a + x.v, 0) || 1;
    const foraOper = [
      { nome: 'Retiradas dos sócios e arrendamento', v: somaM(k => ownerAt(k)) },
      { nome: 'Máquinas e equipamentos', v: somaM(k => investAt(k)) },
      { nome: 'Devolução de empréstimos', v: somaM(k => loanOutAt(k)) },
    ].filter(x => x.v > 0);
    // melhor e pior mês pela operação
    const ops = MONTHS.map((m, k) => ({ m, v: resOperAt(k) })).sort((a, b) => b.v - a.v);

    return `
      <section class="card ins-head ${T.op > 0 && (cob == null || cob >= 1) ? 'g' : T.op > 0 ? 'w' : 'b'}">
        <div class="ins-manchete">
          <span class="ins-sem">${semaforo(T.op > 0 && (cob == null || cob >= 1), T.op > 0)}</span>
          <div>
            <h2>Nos ${n} meses, a operação ${T.op >= 0 ? 'gerou' : 'consumiu'} ${fmt(Math.abs(T.op))}</h2>
            <p>Média de <b>${fmt(T.op / n)}</b> por mês sobre vendas de <b>${fmt(T.vd)}</b> (margem ${pct(margem)}).
            Os sócios retiraram <b>${fmt(T.so)}</b> — <b>${fmt(T.so / n)}</b>/mês${cob != null ? `, e a operação cobriu <b>${pct(cob)}</b> disso` : ''}.</p>
          </div>
        </div>
        <div class="ins-tiles">
          ${tile('Operação · acumulado', fmt(T.op), `${fmt(T.op / n)}/mês`, T.op >= 0 ? 'g' : 'b')}
          ${tile('Retiradas · acumulado', fmt(-T.so), `${fmt(T.so / n)}/mês`, '')}
          ${tile('Investido em máquinas', fmt(T.inv), `${fmt(T.inv / n)}/mês`, '')}
          ${tile('Melhor / pior mês', `${ops[0].m} / ${ops[ops.length - 1].m}`, `${fmt(ops[0].v)} vs ${fmt(ops[ops.length - 1].v)}`, '')}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>💸 Para onde vai cada R$ 100 vendidos</h2>
          <span class="hint">acumulado dos ${n} meses — só os custos da operação; o resto vem logo abaixo</span></div>
        <div class="ins-barras">
          ${secs.slice(0, 12).map(x => {
            const p = x.v / totSec;
            return `<div class="ib-l"><span class="ib-n">${x.nome}</span>
              <span class="ib-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></span>
              <span class="ib-v">${fmt(x.v / T.vd * 100)} <small>de cada R$100</small></span></div>`;
          }).join('')}
        </div>
        <p class="hint" style="margin-top:10px">Somando tudo acima dá <b>${fmt(totSec / T.vd * 100)}</b> de cada R$ 100 — o que <b>sobra na operação são ${fmt(margem * 100)}</b>.</p>
        ${foraOper.length ? `<div class="es-fecha" style="margin-top:14px;display:block">
          <span style="display:block;margin-bottom:8px"><b>Fora da operação</b> — sai do caixa, mas não é custo de produzir:</span>
          ${foraOper.map(x => `<div class="ib-l" style="grid-template-columns:1fr auto"><span class="ib-n">${x.nome}</span><span class="ib-v">${fmt(x.v)} · ${fmt(x.v / T.vd * 100)} de cada R$100</span></div>`).join('')}
        </div>` : ''}
      </section>

      <section class="card">
        <div class="card-head"><h2>📊 Mês a mês · os 3 blocos</h2>
          <span class="hint">operação (azul) contra retiradas (laranja) e financiamento (roxo)</span></div>
        <div class="table-scroll"><table class="dre">
          <thead><tr><th class="t-name">Mês</th><th>Operação</th><th>Sócios</th><th>Investim.</th><th>Financiam.</th><th>= Caixa</th></tr></thead>
          <tbody>${MONTHS.map((m, k) => `<tr>
            <td class="t-name"><b>${m}</b></td>
            <td class="${resOperAt(k) >= 0 ? 'v-pos' : 'v-neg'}">${fmt(resOperAt(k))}</td>
            <td>${fmt(-ownerAt(k))}</td>
            <td>${fmt(-investAt(k))}</td>
            <td>${fmt(financAt(k))}</td>
            <td class="${resAt(k) >= 0 ? 'v-pos' : 'v-neg'}"><b>${fmt(resAt(k))}</b></td></tr>`).join('')}
            <tr class="grp"><td class="t-name"><b>TOTAL</b></td>
            <td class="${T.op >= 0 ? 'v-pos' : 'v-neg'}"><b>${fmt(T.op)}</b></td>
            <td><b>${fmt(-T.so)}</b></td><td><b>${fmt(-T.inv)}</b></td><td><b>${fmt(T.fi)}</b></td>
            <td class="${T.cx >= 0 ? 'v-pos' : 'v-neg'}"><b>${fmt(T.cx)}</b></td></tr>
          </tbody>
        </table></div>
      </section>`;
  }

  function insComp() {
    const a = insCompA, b = insCompB;
    const bloco = k => ({ op: resOperAt(k), so: ownerAt(k), fi: financAt(k), vd: salesAt(k), cx: resAt(k) });
    const A = bloco(a), B = bloco(b);
    const dOp = B.op - A.op;
    // decomposição: efeito volume (vendas) x efeito margem (custos)
    const mA = A.vd ? A.op / A.vd : 0;
    const efVolume = (B.vd - A.vd) * mA;
    const efMargem = dOp - efVolume;
    /* A manchete fala do resultado da OPERAÇÃO — a tabela precisa falar da
       mesma coisa. Antes ela listava childrenOf('2') cru e a "maior causa" era
       Bancárias +R$ 92 mil… que era devolução de empréstimo (2.13.6), fora da
       operação por definição. Agora: 2.14/2.16 saem, 2.13 entra LÍQUIDO de
       dívida (tarifas e juros de verdade), e o que é sócio/máquina/dívida vai
       para um bloco próprio no fim, com rótulo honesto. */
    const bancoOper = k => val(get('2.13'), k) - val(get('2.13.6'), k) - val(get('2.13.7'), k);
    const linhas = (childrenOf.get('2') || [])
      .filter(s => !['2.14', '2.16'].includes(s.code))
      .map(s => s.code === '2.13'
        ? { nome: 'Bancárias (tarifas e juros)', a: bancoOper(a), b: bancoOper(b) }
        : { nome: s.name.replace(/^Despesas?\s+/i, ''), a: val(s, a), b: val(s, b) })
      .filter(x => x.a || x.b).map(x => ({ ...x, d: x.b - x.a })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const foraOper = [
      { nome: 'Retiradas + arrendamento (sócios)', a: ownerAt(a), b: ownerAt(b) },
      { nome: 'Máquinas e veículos (investimento)', a: investAt(a), b: investAt(b) },
      { nome: 'Devolução de empréstimo (dívida)', a: loanOutAt(a), b: loanOutAt(b) },
    ].map(x => ({ ...x, d: x.b - x.a })).filter(x => x.a || x.b);

    return `
      <section class="card">
        <div class="card-head"><h2>⚖️ Comparar dois meses</h2>
          <span class="hint">escolha A e B — a análise recalcula sozinha</span></div>
        <div class="ins-selects">
          <label class="ctrl"><span>Período A</span><select id="insSelA">${MONTHS.map((m, k) => `<option value="${k}" ${k === a ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <span class="ins-vs">vs</span>
          <label class="ctrl"><span>Período B</span><select id="insSelB">${MONTHS.map((m, k) => `<option value="${k}" ${k === b ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        </div>
      </section>

      <section class="card ins-head ${dOp >= 0 ? 'g' : 'b'}">
        <div class="ins-manchete">
          <span class="ins-sem">${dOp >= 0 ? '🟢' : '🔴'}</span>
          <div>
            <h2>De ${MONTHS[a]} para ${MONTHS[b]}, a operação ${dOp >= 0 ? 'melhorou' : 'piorou'} ${fmt(Math.abs(dOp))}</h2>
            <p>Resultado da operação foi de <b>${fmt(A.op)}</b> para <b>${fmt(B.op)}</b>.
            Desse total, <b>${fmt(efVolume)}</b> vieram da <b>mudança no volume de vendas</b> e
            <b>${fmt(efMargem)}</b> da <b>mudança em custos e eficiência</b>.</p>
          </div>
        </div>
        <div class="ins-tiles">
          ${tile('Vendas', `${fmt(A.vd)} → ${fmt(B.vd)}`, signedPct(A.vd ? B.vd / A.vd - 1 : 0), B.vd >= A.vd ? 'g' : 'b')}
          ${tile('Operação', `${fmt(A.op)} → ${fmt(B.op)}`, signedPct(A.op ? B.op / A.op - 1 : 0), dOp >= 0 ? 'g' : 'b')}
          ${tile('Retiradas', `${fmt(A.so)} → ${fmt(B.so)}`, signedPct(A.so ? B.so / A.so - 1 : 0), '')}
          ${tile('Financiamento', `${fmt(A.fi)} → ${fmt(B.fi)}`, 'saldo de empréstimos', '')}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>🧾 Onde a diferença aconteceu — na operação</h2>
          <span class="hint">custos da operação, ordenados pelo tamanho da mudança</span></div>
        <div class="table-scroll"><table class="dre">
          <thead><tr><th class="t-name">Centro</th><th>${MONTHS[a]}</th><th>${MONTHS[b]}</th><th>Variação</th><th>% das vendas A → B</th></tr></thead>
          <tbody>${linhas.slice(0, 12).map(l => `<tr>
            <td class="t-name">${l.nome}</td><td>${fmt(l.a)}</td><td>${fmt(l.b)}</td>
            <td class="${l.d <= 0 ? 'v-pos' : 'v-neg'}">${l.d >= 0 ? '+' : ''}${fmt(l.d)}</td>
            <td>${A.vd ? pct(l.a / A.vd) : '—'} → ${B.vd ? pct(l.b / B.vd) : '—'}</td></tr>`).join('')}</tbody>
        </table></div>
        ${foraOper.length ? `<h3 class="banco-group-title" style="margin-top:14px">Fora da operação (sócios · máquinas · dívida)</h3>
        <div class="table-scroll"><table class="dre">
          <thead><tr><th class="t-name">Bloco</th><th>${MONTHS[a]}</th><th>${MONTHS[b]}</th><th>Variação</th></tr></thead>
          <tbody>${foraOper.map(l => `<tr>
            <td class="t-name">${l.nome}</td><td>${fmt(l.a)}</td><td>${fmt(l.b)}</td>
            <td class="av">${l.d >= 0 ? '+' : ''}${fmt(l.d)}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="hint" style="margin-top:6px">Estes três não entram no resultado da operação — retirada é
        remuneração dos donos, máquina vira patrimônio e devolução de dívida é o empréstimo voltando.
        A variação deles fica <b>neutra</b> (sem verde/vermelho) de propósito.</p>` : ''}
      </section>`;
  }

  let insCompA = 0, insCompB = 0;
  // Re-sincroniza A/B com os seletores GLOBAIS só quando ELES mudarem — a
  // versão anterior comparava com a escolha do usuário e a desfazia a cada
  // render: o dropdown "voltava sozinho" e Comparar só mostrava o par padrão.
  let insLastCur = -1, insLastCmp = -1;
  function renderInsightsTab() {
    const host = document.getElementById('insConteudo');
    if (!host) return;
    if (insLastCur !== cur || insLastCmp !== cmp) {
      insCompA = cmp; insCompB = cur; insLastCur = cur; insLastCmp = cmp;
    }
    host.innerHTML = insModo === 'ano' ? insAno() : insModo === 'comp' ? insComp() : insMes();
    document.querySelectorAll('#insModos button').forEach(b =>
      b.classList.toggle('active', b.dataset.modo === insModo));
    const sa = document.getElementById('insSelA'), sb = document.getElementById('insSelB');
    if (sa) sa.onchange = () => { insCompA = +sa.value; renderInsightsTab(); };
    if (sb) sb.onchange = () => { insCompB = +sb.value; renderInsightsTab(); };
    if (typeof wireCollapsibleCards === 'function') wireCollapsibleCards();
  }
  document.querySelectorAll('#insModos button').forEach(b => b.onclick = () => {
    insModo = b.dataset.modo;
    try { localStorage.setItem(INS_MODO_KEY, insModo); } catch (_) {}
    renderInsightsTab();
  });



  // ===== 💵 Entra e Sai: o extrato do mês, sem exclusão nenhuma =====
  function renderEntraSai() {
    const host = document.getElementById('entraSai');
    if (!host) return;
    const i = cur;
    const linha = (nome, v, tipo, obs) => ({ nome, v, tipo, obs: obs || '' });

    // ENTRADAS: filhos de 1 (destacando o que é empréstimo)
    const ent = (childrenOf.get('1') || []).map(c => linha(
      c.name, val(c, i), 'in',
      FIN_REV_CODES.includes(c.code) ? 'não é venda — é dinheiro emprestado/rendimento' : ''
    )).filter(x => x.v);
    // SAÍDAS: filhos de 2, marcando devolução de dívida e retirada
    const sai = (childrenOf.get('2') || []).map(c => {
      let obs = '';
      if (c.code === '2.13') obs = 'inclui devolução de empréstimo (não é despesa da operação)';
      if (c.code === '2.14') obs = 'retiradas dos sócios + arrendamento + dívida bancária';
      if (c.code === '2.16') obs = 'investimentos — decisão do dono, não custo da operação';
      return linha(c.name, val(c, i), 'out', obs);
    }).filter(x => x.v);

    // resíduo: valor lançado DIRETO na conta-mãe (1 ou 2), sem centro de custo.
    // Sem esta linha a tabela não fecha com o KPI e o painel se contradiz.
    const restoIn = round2(revAt(i) - ent.reduce((a, x) => a + x.v, 0));
    if (Math.abs(restoIn) > 0.5) ent.push(linha('Sem categoria', restoIn, 'in', 'lançado direto na conta 1, sem centro — vale classificar no Mubisys'));
    const restoOut = round2(expAt(i) - sai.reduce((a, x) => a + x.v, 0));
    if (Math.abs(restoOut) > 0.5) sai.push(linha('Sem categoria', restoOut, 'out', 'lançado direto na conta 2 (ex.: fatura de cartão sem rateio)'));
    const totIn = ent.reduce((a, x) => a + x.v, 0);
    const totOut = sai.reduce((a, x) => a + x.v, 0);
    const tabela = (titulo, itens, tot, cls) => `
      <div class="es-bloco">
        <div class="es-head ${cls}"><span>${titulo}</span><b>${fmt(tot)}</b></div>
        <table class="dre es-tab"><tbody>
          ${itens.sort((a, b) => b.v - a.v).map(x => `<tr>
            <td class="t-name">${x.nome}${x.obs ? `<span class="es-obs">${x.obs}</span>` : ''}</td>
            <td class="mono">${fmt(x.v)}</td>
            <td class="av">${tot ? pct(x.v / tot) : '—'}</td></tr>`).join('')}
        </tbody></table>
      </div>`;

    host.innerHTML = `
      <div class="es-grid">
        ${tabela('⬅ ENTROU no caixa', ent, totIn, 'in')}
        ${tabela('SAIU do caixa ➡', sai, totOut, 'out')}
      </div>
      <div class="es-fecha ${resAt(i) >= 0 ? 'pos' : 'neg'}">
        <span>Entrou ${fmt(totIn)} · Saiu ${fmt(totOut)}</span>
        <b>${resAt(i) >= 0 ? 'Sobrou' : 'Faltou'} ${fmt(Math.abs(resAt(i)))} em ${MONTHS[i]}</b>
      </div>
      <p class="hint es-nota">Esta é a visão <b>caixa puro</b>: bate com o extrato bancário. Dentro dela,
      <b>${fmt(finRevAt(i))}</b> que entraram são empréstimo/rendimento (não venda) e
      <b>${fmt(loanOutAt(i))}</b> que saíram são devolução de dívida (não despesa da operação).
      Tirando os dois, a operação ${resOperAt(i) >= 0 ? 'gerou' : 'consumiu'} <b>${fmt(Math.abs(resOperAt(i)))}</b>.</p>`;
  }


  // Faixa de conciliação: substitui a antiga "lente" — mostra de onde veio e para
  // onde foi o dinheiro do banco SEM exigir que o dono troque de modo.
  function renderConcil() {
    const el = document.getElementById('concil');
    if (!el) return;
    const i = cur;
    const parc = (rot, v, cls) => v ? `<span class="cc-p ${cls || ''}">${rot} <b>${fmt(v)}</b></span>` : '';
    el.innerHTML = `
      <div class="cc-l">
        <span class="cc-t">Entrou no banco <b>${fmt(revAt(i))}</b></span>
        <span class="cc-eq">=</span>
        ${parc('vendas', salesAt(i), 'pos')}${parc('+ empréstimo/rendimento', finRevAt(i), 'w')}
      </div>
      <div class="cc-l">
        <span class="cc-t">Saiu do banco <b>${fmt(expAt(i))}</b></span>
        <span class="cc-eq">=</span>
        ${parc('custos da operação', despOperAt(i), '')}${parc('+ retiradas', ownerAt(i), '')}${parc('+ máquinas', investAt(i), '')}${parc('+ devolução de dívida', loanOutAt(i), 'w')}
      </div>
      <div class="cc-l cc-fim ${resAt(i) >= 0 ? 'pos' : 'neg'}">
        <span class="cc-t">${resAt(i) >= 0 ? 'Sobrou' : 'Faltou'} <b>${fmt(Math.abs(resAt(i)))}</b> em ${MONTHS[i]}</span>
      </div>`;
  }


  /* ------------------------------------------------------------------ */
  /*  Estrutura do plano de contas: detecta conta que sumiu, apareceu ou */
  /*  trocou de código. Nasceu de um caso real — o financiamento do      */
  /*  Banco do Nordeste saiu de 2.14.3.4 e virou 2.13.7.1 em jun/2026,   */
  /*  e por dois meses a parcela foi somada como devolução de dívida.    */
  /* ------------------------------------------------------------------ */
  // Migrações já reconhecidas: o painel trata os dois códigos como a mesma coisa.
  const CONTAS_UNIFICADAS = [
    { de: '2.14.3.4', para: '2.13.7.1', o_que: 'Financiamento Banco do Nordeste (histórico migrado para a conta atual)', desde: 'Jun/2026' },
    { de: '2.14.3.5', para: '2.17.3', o_que: 'Empréstimo Terceiros — o Leonardo criou a família 2.17 (Devolução de Empréstimo) em 01/08/2026 e o ERP passou a lançar lá', desde: 'Jul/2026' },
  ];

  function renderEstrutura() {
    const box = document.getElementById('estruturaBox');
    if (!box) return;
    const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const mov = new Map();
    ACCS.forEach(a => {
      const ms = [];
      MONTHS.forEach((_, k) => { if (val(a, k)) ms.push(k); });
      if (ms.length) mov.set(a.code, { a, ini: ms[0], fim: ms[ms.length - 1], n: ms.length });
    });
    const ult = MONTHS.length - 1;
    // `fim < ult - 1` exigia DOIS meses parados e cegava justamente a virada:
    // 56 contas de despesa morreram em Jun/26 (R$ 63.894,72) e não apareciam.
    const trocouPlano = !mesmaEstrutura(ult, ult - 1);
    const pararam = [...mov.values()].filter(x =>
      x.fim <= ult - 1 && x.n >= (trocouPlano ? 2 : 3));
    const surgiram = [...mov.values()].filter(x => x.ini >= ult - 1);

    // casa nome parecido + períodos que se completam + mesma ordem de grandeza
    const migra = [];
    pararam.forEach(p => surgiram.forEach(q => {
      const np = norm(p.a.name), nq = norm(q.a.name);
      if (!(np === nq || np.includes(nq) || nq.includes(np))) return;
      if (p.fim >= q.ini) return;
      const mp = MONTHS.reduce((s, _, k) => s + val(p.a, k), 0) / p.n;
      const mq = MONTHS.reduce((s, _, k) => s + val(q.a, k), 0) / q.n;
      const r = mp ? mq / mp : 0;
      if (r <= 0.4 || r >= 2.5) return;
      const jaSabe = CONTAS_UNIFICADAS.some(u => u.de === p.a.code && u.para === q.a.code);
      migra.push({ p, q, mp, mq, jaSabe });
    }));

    const lista = (titulo, itens, render) => itens.length ? `
      <div class="estr-grp"><h3 class="banco-group-title">${titulo}</h3>
      <div class="table-scroll"><table class="dre"><tbody>${itens.map(render).join('')}</tbody></table></div></div>` : '';

    box.innerHTML = `
      <p class="hint" style="margin-bottom:14px">${ACCS.length} contas na série · ${MONTHS.length} meses.
      Quando o Mubisys reorganiza o plano, uma conta some e outra nasce com o mesmo papel —
      aqui isso fica visível <b>no mês em que acontece</b>.</p>

      ${migra.length ? `<div class="estr-grp"><h3 class="banco-group-title">🔀 Trocaram de código (mesmo item, conta nova)</h3>
      <div class="table-scroll"><table class="dre"><tbody>${migra.map(m => `<tr>
        <td class="t-name"><b>${m.p.a.code}</b> ${m.p.a.name} <span class="es-obs">até ${MONTHS[m.p.fim]} · média ${fmt(m.mp)}</span></td>
        <td class="t-name">➜ <b>${m.q.a.code}</b> ${m.q.a.name} <span class="es-obs">desde ${MONTHS[m.q.ini]} · média ${fmt(m.mq)}</span></td>
        <td>${m.jaSabe ? '<span class="aud-sit">já unificada ✓</span>' : '<span class="aud-sit warn">verificar</span>'}</td>
      </tr>`).join('')}</tbody></table></div></div>` : '<p class="hint">Nenhuma troca de código detectada. ✓</p>'}

      ${lista('⏹ Pararam de aparecer (3+ meses de uso, sem movimento nos últimos 2)', pararam.filter(x => !migra.some(m => m.p.a.code === x.a.code)).sort((a, b) => a.a.code.localeCompare(b.a.code)),
        x => `<tr><td class="t-name"><b>${x.a.code}</b> ${x.a.name}</td><td>${MONTHS[x.ini]} → ${MONTHS[x.fim]}</td><td>${x.n} ${x.n === 1 ? 'mês' : 'meses'}</td></tr>`)}

      ${lista('🆕 Apareceram agora', surgiram.filter(x => !migra.some(m => m.q.a.code === x.a.code)).sort((a, b) => a.a.code.localeCompare(b.a.code)),
        x => `<tr><td class="t-name"><b>${x.a.code}</b> ${x.a.name}</td><td>desde ${MONTHS[x.ini]}</td><td>${fmt(val(x.a, ult))}</td></tr>`)}

      ${CONTAS_UNIFICADAS.length ? `<div class="estr-grp"><h3 class="banco-group-title">🔗 Já integradas pelo painel</h3>
      ${CONTAS_UNIFICADAS.map(u => `<p class="hint"><b>${u.de}</b> ➜ <b>${u.para}</b> — ${u.o_que} <i>(desde ${u.desde})</i>. O histórico é tratado como uma série só.</p>`).join('')}</div>` : ''}`;
  }


  /* ------------------------------------------------------------------ */
  /*  Prévia do ERP: um robô diário lê o mês corrente direto do Mubisys  */
  /*  e grava em cfg.previaERP. Aqui só EXIBIMOS e medimos a diferença   */
  /*  contra o mês oficial (que vem do .xlsx). Nada é sobrescrito.       */
  /* ------------------------------------------------------------------ */
  async function renderPrevia() {
    const box = document.getElementById('previaBox');
    if (!box || typeof api !== 'function') return;
    box.innerHTML = '<p class="hint">Consultando…</p>';
    let p = null;
    try { p = ((await api('getCfg')) || {}).cfg?.previaERP || null; } catch (_) {}
    if (!p) {
      box.innerHTML = `<p class="hint">Ainda não há prévia gravada. O robô roda todo dia às 6h;
        dá para disparar na hora no GitHub (aba <b>Actions</b> → “Prévia do ERP” → Run workflow).</p>`;
      return;
    }
    const D = getCurrentData();
    const mi = (D.months || []).indexOf(p.label);
    const of = mi >= 0 ? { receita: val(get('1'), mi), despesa: val(get('2'), mi) } : null;
    const d = p.diag || {};
    const semQuebra = d.receitaSemCodigo || 0;
    // Se o mês oficial já veio do ERP (planilha aposentada), o detector de
    // corte e a comparação "OS × planilha" viram ERP×ERP — não medem nada.
    const mesEhErp = ((D.origens || [])[mi] || 'planilha') === 'erp';

    // "Para arrumar no Mubisys" segue o MÊS ABERTO no painel, não a prévia.
    // A prévia é sempre o mês corrente: no dia 1º ela vira, e as pendências
    // ainda ABERTAS do mês anterior sumiam da tela como se tivessem sido
    // resolvidas. Cai na prévia só quando o mês aberto não tem lista própria.
    const pendsMes = (D.pendencias || [])[cur] || [];
    const pends = pendsMes.length ? pendsMes
      : (cur === mi ? (p.pendencias || []) : []);
    const pendsLabel = pendsMes.length ? MONTHS[cur] : p.label;

    /* Até que dia a planilha enxerga.
       A planilha é um .xlsx exportado num dia qualquer; o ERP é lido hoje.
       Comparar mês inteiro contra planilha parcial inventa rombo: jul/26
       acusava +21% de receita só porque o export foi feito no dia 23.
       Aqui procuramos o dia em que o acumulado do ERP mais se aproxima do
       total da planilha — é o dia em que ela foi tirada. */
    const alinhar = (serie, alvo) => {
      if (!serie || alvo == null) return null;
      const dias = Object.keys(serie).sort();
      let acc = 0, melhor = null;
      for (const dia of dias) {
        acc += serie[dia] || 0;
        const err = Math.abs(acc - alvo);
        if (!melhor || err < melhor.err) melhor = { dia, acc, err };
      }
      return melhor;
    };
    const aliR = alinhar(p.porDia?.receita, of?.receita);
    const aliD = alinhar(p.porDia?.despesa, of?.despesa);
    // só vale a pena mostrar o corte se as duas linhas apontarem o mesmo dia e
    // ele não for o fim do mês — aí sim a planilha está mesmo defasada
    const ultimoDia = Object.keys(p.porDia?.receita || {}).sort().pop();
    const corte = (!mesEhErp && aliR && aliD && aliR.dia === aliD.dia && aliR.dia !== ultimoDia) ? aliR.dia : null;
    const ptbr = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
    const diasAtras = corte && ultimoDia
      ? Math.round((new Date(ultimoDia) - new Date(corte)) / 86400000) : 0;

    const prodLinhas = Object.entries(p.receitaPorProduto || {})
      .filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => b[1] - a[1]);
    const totProd = prodLinhas.reduce((s, [, v]) => s + v, 0);
    const dOS = p.diagOS || {};
    const semConta = Object.entries(p.produtosSemConta || {}).sort((a, b) => b[1] - a[1]);

    /* As duas leituras da MESMA receita, conta a conta. Comparamos nos grupos
       (1.1.1.x, 1.1.2, 1.2…) porque é o nível em que os dois lados existem: a
       OS conhece o produto, a planilha desce até o modelo. Somamos por subárvore
       dos dois lados para não comparar coisas de profundidade diferente. */
    const NIVEIS = ['1.1.1.1', '1.1.1.2', '1.1.1.3', '1.1.1.4', '1.1.1.5', '1.1.1.6',
      '1.1.1.7', '1.1.1.8', '1.1.1.9', '1.1.1.10', '1.1.1.11', '1.1.1.12', '1.1.1.13',
      '1.1.1.14', '1.1.1.15', '1.1.1.16', '1.1.1.17', '1.1.2', '1.2', '1.3', '1.4', '1.5', '1.6'];
    const porConta = p.receitaPorConta || {};
    // Só compara se os dois lados cobrirem o mesmo período: o ERP é do mês
    // inteiro, então uma planilha exportada no meio do mês faria toda conta
    // parecer inflada. Com `corte` no ar, a tabela some e explica por quê.
    const contaLinhas = (mi < 0 || corte || mesEhErp || !Object.keys(porConta).length) ? [] : NIVEIS.map(code => {
      const no = get(code);
      if (!no) return null;
      const os = Object.entries(porConta)
        .filter(([c]) => c === code || c.startsWith(code + '.'))
        .reduce((s, [, v]) => s + v, 0);
      const pl = val(no, mi);
      return (Math.abs(os) < 0.005 && Math.abs(pl) < 0.005) ? null
        : { code, nome: no.name, os: Math.round(os * 100) / 100, pl };
    }).filter(Boolean).sort((a, b) => Math.abs(b.os - b.pl) - Math.abs(a.os - a.pl));

    const linha = (rot, erp, ofc, ateCorte, obs) => {
      const dif = ofc == null ? null : (corte ? ateCorte : erp) - ofc;
      return `<tr>
        <td class="t-name">${rot}${obs ? `<span class="es-obs">${obs}</span>` : ''}</td>
        <td class="mono">${fmt(erp)}</td>
        ${corte ? `<td class="mono">${fmt(ateCorte)}</td>` : ''}
        <td class="mono">${ofc == null ? '—' : fmt(ofc)}</td>
        <td class="${dif == null ? 'av' : Math.abs(dif) < 1 ? 'v-pos' : 'v-neg'}">${dif == null ? '—' : (dif >= 0 ? '+' : '') + fmt(dif)}</td></tr>`;
    };
    box.innerHTML = `
      <p class="hint" style="margin-bottom:12px">Mês <b>${escAttr(p.label)}</b> lido do Mubisys em
      <b>${new Date(p.geradoEm).toLocaleString('pt-BR')}</b> ·
      ${d.titulosReceita || 0} recebimentos e ${d.titulosDespesa || 0} pagamentos ·
      ${d.contas || 0} contas de despesa</p>
      <div class="table-scroll"><table class="dre">
        <thead><tr><th class="t-name">Total do mês</th><th>ERP (mês inteiro)</th>${corte ? `<th>ERP até ${ptbr(corte)}</th>` : ''}<th>${mesEhErp ? 'Oficial (gravado pelo robô)' : 'Oficial (planilha)'}</th><th>Diferença</th></tr></thead>
        <tbody>
          ${linha('Receitas', p.totais.receita, of?.receita, aliR?.acc)}
          ${linha('Despesas', p.totais.despesa, of?.despesa, aliD?.acc)}
        </tbody>
      </table></div>
      ${pends.length ? (() => {
        const grupos = {};
        pends.forEach(x => {
          const g = grupos[x.tipo] = grupos[x.tipo] || { n: 0, v: 0, itens: [] };
          g.n++; g.v += x.valor || 0; g.itens.push(x);
        });
        const TITULOS = {
          'dois-significados-216': '⚠️ Conta 2.16 com dois significados (investimento no histórico, empréstimo agora)',
          'consumo-fora-do-galho': '⚡ Conta de luz/água lançada fora do galho de energia/água',
          'possivel-duplicidade': '💸 Possível pagamento em duplicidade — conferir com o fornecedor',
          'receita-sem-os': '🧾 Receita sem Ordem de Serviço — está no total, mas fora da quebra por produto',
          'fatura-cartao-em-juros': '💳 Fatura de cartão lançada como juros (infla o custo financeiro)',
          'amil-pedro-henrique': '🩺 AMIL Pedro Henrique na conta do Leonardo (é do Sr. Pedro → 2.14.1.4)',
          'nordeste-sem-descricao': '🏦 Parcela do Nordeste sem descrição',
        };
        return `<h3 class="banco-group-title" style="margin-top:18px">🚧 Para arrumar no Mubisys · ${pendsLabel}</h3>
        <p class="hint" style="margin-bottom:8px">Lançamentos que estão em conta suspeita <b>dentro do ERP</b>.
        O painel não corrige por conta própria — o número mostrado é fiel ao Mubisys; a correção é lá na origem.</p>
        ${Object.entries(grupos).map(([tipo, g]) => `
          <p class="hint" style="margin-top:8px"><b>${TITULOS[tipo] || tipo}</b> — ${g.n} lançamento(s), <b>${fmt(g.v)}</b></p>
          <ul class="hint" style="margin:4px 0 0 18px">${g.itens.slice(0, 6).map(x =>
            `<li>${fmt(x.valor || 0)} — ${escAttr(x.texto || '')}</li>`).join('')}
            ${g.itens.length > 6 ? `<li>… e mais ${g.itens.length - 6}</li>` : ''}</ul>`).join('')}`;
      })() : ''}
      ${corte ? `<p class="hint" style="margin-top:12px">📅 A planilha oficial deste mês bate com o ERP até
      <b>${ptbr(corte)}</b> — ou seja, foi exportada nessa data e está <b>${diasAtras} dia(s) defasada</b>.
      A coluna do meio compara o que dá para comparar; a diferença ao lado é o que sobra depois de igualar a
      data. Para conferir o mês inteiro, exporte o .xlsx de novo e suba na aba Upload.</p>` : ''}
      ${p.empresas && Object.keys(p.empresas).length > 1 ? `<p class="hint" style="margin-top:10px">
      🏢 Somando as <b>${Object.keys(p.empresas).length} empresas</b> do ERP —
      ${Object.entries(p.empresas).map(([n, v]) => `<b>${escAttr(n)}</b> (${fmt(v.receita)} de receita)`).join(' e ')}.
      O caixa é um só e a planilha oficial já vem consolidada.</p>` : ''}
      ${(d.despesaSemQuebra || 0) > 0 ? `<p class="hint" style="margin-top:10px">💳 <b>${fmt(d.despesaSemQuebra)}</b>
      de despesa entrou como <b>fatura de cartão</b>, sem dizer o que foi comprado dentro dela — o ERP joga na conta
      genérica <i>2 · Despesas</i>. O valor está no total, mas não aparece em nenhuma conta de custo. Na planilha
      essa fatura já vem rateada, e é daí que vem quase toda a diferença que sobra.</p>` : ''}
      ${prodLinhas.length ? `
      <h3 class="banco-group-title" style="margin-top:18px">Receita por produto (lida das Ordens de Serviço)</h3>
      <p class="hint" style="margin-bottom:8px">No Mubisys o título de venda diz <i>quanto</i> entrou; só a
      <b>Ordem de Serviço</b> diz <i>de qual produto</i>. Aqui cada real recebido no mês é distribuído entre os
      itens da OS que o originou — por isso a soma bate com a receita, não é estimativa.
      ${dOS.rateados != null ? `<b>${dOS.rateados} de ${dOS.titulos}</b> recebimentos casaram com uma OS.` : ''}
      ${dOS.valorSemOS ? `Sobraram <b>${fmt(dOS.valorSemOS)}</b> sem OS identificada.` : ''}</p>
      <div class="table-scroll"><table class="dre">
        <thead><tr><th class="t-name">Produto</th><th>Receita no mês</th><th>% das vendas</th></tr></thead>
        <tbody>${prodLinhas.map(([nome, v]) => `<tr>
          <td class="t-name">${escAttr(nome)}</td>
          <td class="mono">${fmt(v)}</td>
          <td class="mono">${pct(totProd ? v / totProd : 0)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${contaLinhas.length ? `
      <h3 class="banco-group-title" style="margin-top:18px">A mesma receita, nas contas do DRE</h3>
      <p class="hint" style="margin-bottom:8px">À esquerda, o que as Ordens de Serviço dizem que foi vendido.
      À direita, o que a planilha registrou. <b>O total é o mesmo</b> — o que muda é em que conta cada real caiu.
      Onde as duas discordam, ou o produto está cadastrado na conta errada dentro do Mubisys, ou o de-para que eu
      uso está errado. Vale conferir uma OS do mês para saber qual dos dois.</p>
      <div class="table-scroll"><table class="dre">
        <thead><tr><th class="t-name">Conta</th><th>Pelas Ordens de Serviço</th><th>Pela planilha</th><th>Diferença</th></tr></thead>
        <tbody>${contaLinhas.map(l => `<tr>
          <td class="t-name"><b>${l.code}</b> ${escAttr(l.nome)}</td>
          <td class="mono">${fmt(l.os)}</td>
          <td class="mono">${fmt(l.pl)}</td>
          <td class="${Math.abs(l.os - l.pl) < 1 ? 'v-pos' : 'v-neg'}">${(l.os - l.pl >= 0 ? '+' : '') + fmt(l.os - l.pl)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${semConta.length ? `<p class="hint" style="margin-top:8px">Sem conta no meu de-para:
      ${semConta.map(([n, v]) => `<b>${escAttr(n)}</b> (${fmt(v)})`).join(' · ')}. Me diga a conta certa
      e eu incluo.</p>` : ''}`
      : corte ? `<p class="hint" style="margin-top:8px">Dá para comparar esta receita conta a conta com a
      planilha, mas só quando os dois lados cobrirem o mesmo período — a sua para em ${ptbr(corte)}.
      <b>Suba o .xlsx do mês fechado e a comparação aparece aqui</b>, apontando produto por produto o que está
      caindo em conta diferente no Mubisys.</p>`
      : `<p class="hint" style="margin-top:8px">Esta quebra é por <b>produto do ERP</b>, não pela conta do DRE —
      as duas listas não são a mesma coisa. A árvore oficial de receita continua vindo da planilha.</p>`}`
      : semQuebra > 0 ? (
        // O título de venda não tem plano de contas — isso é NORMAL no Mubisys
        // (a venda é classificada pela OS). Enquanto o rateio das OS cobre
        // tudo, o card confirma; o alerta só aparece se sobrar valor sem OS.
        (dOS.valorSemOS || 0) < 1
          ? `<p class="hint" style="margin-top:10px">✅ <b>${fmt(semQuebra)}</b> da receita não têm plano de
          contas no título — normal no Mubisys, a venda é classificada pela <b>Ordem de Serviço</b>. A quebra
          por produto acima já cobre <b>100%</b> desse valor, rateando cada recebimento entre os itens da OS.</p>`
          : `<p class="hint" style="margin-top:10px">⚠️ <b>${fmt(dOS.valorSemOS)}</b> da receita não casaram com
          nenhuma Ordem de Serviço — esse pedaço está no total, mas sem dizer de qual produto veio. O resto está
          rateado produto a produto acima.</p>`) : ''}
      <p class="hint" style="margin-top:10px">
      ${mesEhErp ? `<b>O mês oficial é montado direto do ERP pelo robô</b> (a planilha foi aposentada).
             Esta leitura confere os totais da última rodada; se divergirem, o robô ainda não rodou hoje —
             dá para disparar no GitHub (Actions → “Prévia do ERP”).`
        : of ? `<b>Este mês veio da planilha</b> — a leitura do ERP serve para acompanhar o andamento
             e conferir o fechamento.`
           : `Este mês ainda não existe no painel, então não há com o que comparar.`}</p>`;
  }


  function renderBlocos3() {
    const host = document.getElementById('blocos3');
    if (!host) return;
    const i = cur;
    const op = resOperAt(i), soc = ownerAt(i), fin = financAt(i), inv = investAt(i), caixa = resAt(i);
    const margem = salesAt(i) ? op / salesAt(i) : 0;
    // conferência: operação − sócios − investimentos + financiamento = caixa
    const bate = Math.abs((op - soc - inv + fin) - caixa) < 1;
    const linha = (rot, v, cls) => `<div class="b3-l"><span>${rot}</span><b class="${cls || ''}">${fmt(v)}</b></div>`;
    host.innerHTML = `
      <div class="b3-grid">
        <div class="b3 op clicavel" data-det="blocoOper" role="button" tabindex="0" title="Clique para ver de onde vem este número">
          <span class="b3-t">1 · Operação</span>
          <span class="b3-v ${op >= 0 ? 'pos' : 'neg'}">${fmt(op)}</span>
          <span class="b3-s">margem ${pct(margem)} sobre vendas</span>
          ${linha('Vendas', salesAt(i))}
          ${linha('− Custos e estrutura', -despOperAt(i), 'neg')}
        </div>
        <div class="b3 soc clicavel" data-det="blocoSocios" role="button" tabindex="0" title="Clique para ver de onde vem este número">
          <span class="b3-t">2 · Sócios</span>
          <span class="b3-v neg">${fmt(-soc)}</span>
          <span class="b3-s">retiradas dos sócios e arrendamento</span>
          ${linha('Retiradas + arrendamento', -soc, 'neg')}
        </div>
        <div class="b3 inv clicavel" data-det="blocoInvest" role="button" tabindex="0" title="Clique para ver de onde vem este número">
          <span class="b3-t">3 · Investimentos</span>
          <span class="b3-v neg">${fmt(-inv)}</span>
          <span class="b3-s">máquinas e equipamentos — vira patrimônio, não é gasto</span>
          ${linha('Máquinas e veículo financiados (Nordeste)', -machineFinAt(i), 'neg')}
          ${linha('Máquinas compradas à vista', -val(get('2.16'), i), 'neg')}
        </div>
        <div class="b3 fin clicavel" data-det="blocoFinanc" role="button" tabindex="0" title="Clique para ver de onde vem este número">
          <span class="b3-t">4 · Financiamento</span>
          <span class="b3-v ${fin >= 0 ? 'pos' : 'neg'}">${fmt(fin)}</span>
          <span class="b3-s">não é resultado — é dinheiro emprestado</span>
          ${linha('+ Empréstimos captados / rendimentos', finRevAt(i), 'pos')}
          ${linha('− Devolução de empréstimos', -(loanOutAt(i) - giroAt(i)), 'neg')}${linha('− Capital de giro (Nordeste)', -giroAt(i), 'neg')}
        </div>
        <div class="b3 cx">
          <span class="b3-t">= Variação de caixa</span>
          <span class="b3-v ${caixa >= 0 ? 'pos' : 'neg'}">${fmt(caixa)}</span>
          <span class="b3-s">${bate ? 'confere com o extrato ✓' : '⚠ não fecha — revisar contas'}</span>
        </div>
      </div>
      <p class="hint b3-nota">O <b>lucro de verdade</b> é o bloco 1. Em ${MONTHS[i]} entraram <b>${fmt(finRevAt(i))}</b> de empréstimos/rendimentos que <b>não são venda</b>, e saíram <b>${fmt(loanOutAt(i))}</b> de devolução que <b>não são despesa</b>.
      ${inv > 0 ? `Os <b>${fmt(inv)}</b> de investimento compraram máquina — sai do caixa, mas <b>vira patrimônio</b>, não prejuízo.` : ''}
      Por isso a variação de caixa (${fmt(caixa)}) difere do resultado da operação (${fmt(op)}).</p>`;
  }

  function renderBuffett() {
    // ---- narrativa ----
    const i = cur;
    const opRes = opResAt(i), opMargin = salesAt(i) ? opRes / salesAt(i) : 0;
    const owner = ownerAt(i), finalRes = resAt(i);
    const cm = cmAt(i), cmPct = salesAt(i) ? cm / salesAt(i) : 0;
    const ownerVsOp = opRes ? owner / opRes : 0;

    const narr = document.getElementById('buffettNarrative');
    narr.innerHTML = `
      <p>No mês de <b>${MONTHS[i]}</b>, a <b>operação</b> da Impresilk ${opRes >= 0 ? 'gerou' : 'consumiu'} <b class="${opRes >= 0 ? 'pos' : 'neg'}">${fmt2(Math.abs(opRes))}</b> de resultado
      operacional sobre <b>${fmt(salesAt(i))}</b> de vendas — uma <b>margem operacional de ${pct(opMargin)}</b>.
      A margem de contribuição foi de <b>${pct(cmPct)}</b>: de cada <b>R$ 100</b> vendidos sobram
      <b>${fmt(cmPct * 100)}</b> para pagar a estrutura fixa e remunerar o dono.</p>
      <p>As <b>retiradas dos sócios</b> consumiram <b class="neg">${fmt2(owner)}</b>
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
    rows.push(L('= RESULTADO OPERACIONAL', resOperAt(i), resOperAt(i) >= 0 ? 'pos' : 'neg', true));
    // Faltavam a devolução de empréstimo e as máquinas: a cascata não fechava e
    // o dono somava com o dedo sem chegar no total (sumiam ~R$ 117 mil em Abr).
    rows.push(L('(−) Retiradas dos sócios e arrendamento', -ownerAt(i), 'neg'));
    if (investAt(i)) rows.push(L('(−) Máquinas e equipamentos (vira patrimônio, não é gasto)', -investAt(i), 'neg'));
    if (finRevAt(i)) rows.push(L('(+) Empréstimos captados e rendimentos (não é venda)', finRevAt(i), 'pos'));
    if (loanOutAt(i)) rows.push(L('(−) Devolução de empréstimos (não é despesa)', -loanOutAt(i), 'neg'));
    rows.push(L('= O QUE SOBROU NO BANCO', resAt(i), resAt(i) >= 0 ? 'pos' : 'neg', true));
    const fecha = Math.abs(resOperAt(i) - ownerAt(i) - investAt(i) + financAt(i) - resAt(i)) < 1;
    if (!fecha) rows.push(`<tr><td colspan="3" style="color:var(--neg)"><b>⚠ a conta não fecha — revisar as contas do mês</b></td></tr>`);
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

    // Razão dos ACUMULADOS, não média das razões mês a mês. A média explodia
    // em mês de operação fraca (Jun/26: retirada 48.144 sobre operação 21.878
    // = 220%) e o sinal dizia 83,1% enquanto o simulador, 30 linhas abaixo,
    // dizia 59,4% para a mesma coisa.
    const ownerTot = MONTHS.reduce((s, _, k) => s + ownerAt(k), 0);
    const opResTot = MONTHS.reduce((s, _, k) => s + opResAt(k), 0);
    const ownerAvg = opResTot ? ownerTot / opResTot : 0;
    signals.push({ type: ownerAvg > 0.8 ? 'bad' : ownerAvg > 0.5 ? 'warn' : 'good', title: 'Disciplina de retirada',
      html: `Em média, as retiradas consomem <b>${pct(ownerAvg)}</b> do resultado operacional. ${ownerAvg > 0.8 ? 'Está <b>alto</b> — limita reinvestimento e reservas.' : 'Espaço razoável para capitalizar a empresa.'}` });

    const cmStab = trendStats(MONTHS.map((_, k) => salesAt(k) ? cmAt(k) / salesAt(k) : 0));
    signals.push({ type: cmStab.cv < 0.1 ? 'good' : 'warn', title: 'Previsibilidade da margem',
      html: `Margem de contribuição com volatilidade <b>${cmStab.cv < 0.1 ? 'baixa' : 'moderada'}</b> (CV ${(cmStab.cv * 100).toFixed(0)}%). ${cmStab.cv < 0.1 ? 'Precificação saudável e estável.' : 'Vale revisar precificação por linha.'}` });

    // ponto de equilíbrio do mês
    const be = cmPct > 0 ? Math.max(0, fixedAt(i)) / cmPct : 0; // nunca negativo (retiradas altas não são "equilíbrio")
    signals.push({ type: salesAt(i) > be ? 'good' : 'bad', title: 'Ponto de equilíbrio',
      html: `Com margem de contribuição de ${pct(cmPct)}, a empresa precisa vender <b>${fmt(be)}</b>/mês para cobrir a estrutura fixa. Vendeu <b>${fmt(salesAt(i))}</b> — <b>${salesAt(i) > be ? 'acima' : 'abaixo'}</b> do equilíbrio (${signedPct(be ? salesAt(i) / be - 1 : 0)}).` });

    // fôlego de caixa (reserva): quantos meses de estrutura fixa o caixa acumulado cobre
    const accReserve = MONTHS.reduce((s, _, k) => s + resAt(k), 0);
    const avgFixed = MONTHS.reduce((s, _, k) => s + fixedAt(k), 0) / MONTHS.length;
    const runway = avgFixed > 0 ? accReserve / avgFixed : 0;
    signals.push({ type: runway >= 3 ? 'good' : runway >= 1 ? 'warn' : 'bad', title: 'Fôlego de caixa (reserva)',
      html: `O caixa acumulado nos ${MONTHS.length} meses (<b>${fmt(accReserve)}</b>) equivale a <b>${runway.toFixed(1)} meses</b> de estrutura fixa (média de <b>${fmt(avgFixed)}</b>/mês). ${runway >= 3 ? 'Reserva <b>confortável</b> — fôlego para meses fracos e oportunidades.' : runway >= 1 ? 'Reserva <b>apertada</b> — convém engordar o colchão antes de distribuir mais.' : 'Reserva <b>insuficiente</b> — risco de aperto num mês fraco.'}` });

    // peso do custo financeiro: juros e tarifas de VERDADE — 2.13 sem a
    // devolução de empréstimo (2.13.6) e sem a parcela do Nordeste (2.13.7).
    // Com o 2.13 cheio o sinal dizia "R$ 166.619 de juros" quando o custo
    // real era R$ 16.456 — o resto era o empréstimo voltando (regra de ouro:
    // nenhum ranking de custo pode conter dívida).
    const finCost = val(get('2.13'), i) - val(get('2.13.6'), i) - val(get('2.13.7'), i);
    const finPct = salesAt(i) ? finCost / salesAt(i) : 0;
    signals.push({ type: finPct > 0.08 ? 'bad' : finPct > 0.04 ? 'warn' : 'good', title: 'Peso do custo financeiro',
      html: `Juros e tarifas bancárias de verdade consumiram <b>${fmt(finCost)}</b> em ${MONTHS[i]} — <b>${pct(finPct)}</b> das vendas (fora daqui: devolução de empréstimo e parcela do Nordeste, que não são custo). ${finPct > 0.08 ? 'Está <b>alto</b>: juros de cartão/empréstimo corroem o resultado — priorize quitar o rotativo.' : finPct > 0.04 ? 'Moderado — vale renegociar tarifas e evitar o rotativo do cartão.' : 'Sob controle.'}` });

    document.getElementById('buffettSignals').innerHTML = signals.map(s => `<div class="insight ${s.type}"><span class="it ${s.type}">${s.title}</span>${s.html}</div>`).join('');

    // ---- simulador de retiradas ----
    renderRetiradaSim();
  }

  function renderRetiradaSim() {
    const slider = document.getElementById('simSlider');
    if (!slider) return;
    // reservas reais (acumuladas) = soma do resultado de caixa real
    const opTotal = MONTHS.reduce((s, _, k) => s + resOperAt(k), 0);
    // O caixa do período obedece: operação − sócios − máquinas + financiamento.
    // Antes só somava o empréstimo captado e nunca descontava a devolução nem as
    // máquinas — a "reserva" saía ~4x maior e sempre empurrava para retirar mais.
    const investTotal = MONTHS.reduce((s, _, k) => s + investAt(k), 0);
    const financTotal = MONTHS.reduce((s, _, k) => s + financAt(k), 0);
    const realReserve = MONTHS.reduce((s, _, k) => s + resAt(k), 0);
    const realOwner = MONTHS.reduce((s, _, k) => s + ownerAt(k), 0);
    const realOwnerPct = opTotal ? realOwner / opTotal : 0;
    const n = MONTHS.length;

    const draw = () => {
      const p = +slider.value / 100;
      document.getElementById('simPctLabel').textContent = (slider.value) + '%';
      // retirada simulada por mês = p × resultado operacional (só quando positivo)
      const simOwner = MONTHS.reduce((s, _, k) => s + Math.max(0, p * resOperAt(k)), 0);
      const simReserve = opTotal - simOwner - investTotal + financTotal;
      const perMonth = simReserve / n;
      const diff = simReserve - realReserve;
      const kp = (lbl, val, cls) => `<div class="ck"><span class="ck-l">${lbl}</span><b class="ck-v ${cls || ''}">${val}</b></div>`;
      // autoconferência: no cenário real o simulado tem de bater com o caixa real
      const confere = Math.abs((opTotal - realOwner - investTotal + financTotal) - realReserve) < 1;
      if (!confere) {
        document.getElementById('simKpis').innerHTML =
          '<p class="hint" style="color:var(--neg)"><b>⚠ Conferência falhou</b> — não use este simulador até revisar as contas.</p>';
        return;
      }
      document.getElementById('simKpis').innerHTML =
        kp(`Retirada total (${n}m)`, fmt(simOwner), 'neg') +
        kp(`Caixa acumulado no período (${n}m)`, fmt(simReserve), simReserve >= 0 ? 'pos' : 'neg') +
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

  /* ------------------------------------------------------------------ *
   *  ABA ANO — acumulado do ano selecionado + resumo de cada mês
   *  ------------------------------------------------------------------
   *  Junta o que estava espalhado: o total do ano e a linha de cada mês
   *  na mesma tela, com os 4 blocos. Clicar no mês abre ele no painel.  */
  function renderAno() {
    const host = document.getElementById('anoTabela');
    const kp = document.getElementById('anoKpis');
    if (!host || !kp) return;
    const idx = META_MES.map((x, i) => ({ ...x, i })).filter(x => x.a === anoSel).map(x => x.i);
    const tit = document.getElementById('anoTitulo');
    if (tit) tit.textContent = `📅 ${anoSel}`;
    if (!idx.length) { kp.innerHTML = ''; host.innerHTML = '<p class="hint">Sem meses deste ano.</p>'; return; }

    const soma = f => idx.reduce((t, i) => t + f(i), 0);
    const vd = soma(salesAt), op = soma(resOperAt), so = soma(ownerAt);
    const inv = soma(investAt), fin = soma(financAt), cx = soma(resAt);
    const margem = vd ? op / vd : 0;
    const meses = idx.length;

    kp.innerHTML = `
      <div class="ck clicavel" data-det="vendas"><span class="ck-l">Vendas · ${anoSel}</span>
        <span class="ck-v">${fmt2(vd)}</span><span class="ck-s">${fmt(vd / meses)}/mês em ${meses} ${meses === 1 ? 'mês' : 'meses'}</span></div>
      <div class="ck"><span class="ck-l">Resultado da Operação</span>
        <span class="ck-v ${op >= 0 ? 'pos' : 'neg'}">${fmt2(op)}</span><span class="ck-s">margem ${pct(margem)} sobre vendas</span></div>
      <div class="ck"><span class="ck-l">Retiradas dos sócios</span>
        <span class="ck-v">${fmt2(so)}</span><span class="ck-s">${op > 0 ? `a operação cobriu ${pct(op / so)}` : 'sem operação positiva'}</span></div>
      <div class="ck"><span class="ck-l">Investimentos</span>
        <span class="ck-v">${fmt2(inv)}</span><span class="ck-s">máquinas e veículos — vira patrimônio</span></div>
      <div class="ck"><span class="ck-l">Financiamento</span>
        <span class="ck-v ${fin >= 0 ? '' : 'neg'}">${fmt2(fin)}</span><span class="ck-s">empréstimo entrando menos saindo</span></div>
      <div class="ck"><span class="ck-l">Variação de Caixa</span>
        <span class="ck-v ${cx >= 0 ? 'pos' : 'neg'}">${fmt2(cx)}</span><span class="ck-s">o que sobrou no banco no ano</span></div>`;

    const linha = i => {
      const v = salesAt(i), o = resOperAt(i), m = v ? o / v : 0;
      // Mês recém-começado (ex.: dia 3 do mês) tem venda quase zero e a margem
      // vira ruído — "−3.588,6%" não diz nada. Some com a % e marca o mês como
      // em andamento em vez de fingir um número.
      const parcial = Math.abs(m) > 3;
      return `<tr class="ano-linha${i === cur ? ' cur-row' : ''}" data-i="${i}">
        <td class="t-name">${MONTHS[i]}${i === cur ? ' <span class="u-now">aberto</span>' : ''}${parcial ? ' <span class="es-obs" style="display:inline;margin-left:6px">mês em andamento</span>' : ''}</td>
        <td class="mono">${fmt(revAt(i))}</td>
        <td class="mono">${fmt(v)}</td>
        <td class="mono">${fmt(despOperAt(i))}</td>
        <td class="mono ${o >= 0 ? 'pos' : 'neg'}">${fmt(o)}</td>
        <td class="${parcial ? 'av' : m >= 0.15 ? 'pos' : m >= 0.05 ? '' : 'neg'}">${parcial ? '—' : pct(m)}</td>
        <td class="mono">${fmt(ownerAt(i))}</td>
        <td class="mono">${fmt(investAt(i))}</td>
        <td class="mono ${resAt(i) >= 0 ? 'pos' : 'neg'}">${fmt(resAt(i))}</td>
      </tr>`;
    };
    host.innerHTML = `
      <p class="hint" style="margin:10px 0 8px">Clique numa linha para abrir o mês no painel inteiro.</p>
      <div class="table-scroll"><table class="dre ano-tab">
        <thead><tr><th class="t-name">Mês</th><th>Entrou</th><th>Vendas</th><th>Custos</th>
          <th>Operação</th><th>Margem</th><th>Sócios</th><th>Máquinas</th><th>Caixa</th></tr></thead>
        <tbody>${idx.map(linha).join('')}
          <tr class="ano-total"><td class="t-name"><b>Acumulado ${anoSel}</b></td>
            <td class="mono"><b>${fmt(soma(revAt))}</b></td>
            <td class="mono"><b>${fmt(vd)}</b></td>
            <td class="mono"><b>${fmt(soma(despOperAt))}</b></td>
            <td class="mono ${op >= 0 ? 'pos' : 'neg'}"><b>${fmt(op)}</b></td>
            <td><b>${pct(margem)}</b></td>
            <td class="mono"><b>${fmt(so)}</b></td>
            <td class="mono"><b>${fmt(inv)}</b></td>
            <td class="mono ${cx >= 0 ? 'pos' : 'neg'}"><b>${fmt(cx)}</b></td></tr>
        </tbody>
      </table></div>`;
    host.querySelectorAll('tr.ano-linha').forEach(tr => {
      tr.onclick = () => {
        const i = +tr.dataset.i;
        if (i === cur) return;
        cur = i;
        if (cmp === cur) cmp = cur > 0 ? cur - 1 : Math.min(cur + 1, MONTHS.length - 1);
        monthSel.value = cur; cmpSel.value = cmp;
        sincronizaPeriodo(); renderAll();
      };
    });
  }

  /* ------------------------------------------------------------------ *
   *  MANUAL — as duas lentes explicadas com os números do mês aberto
   *  ------------------------------------------------------------------
   *  O seletor 🎯 Valor real × 💵 Com financiamentos troca os 4 KPIs do
   *  topo, mas até aqui ninguém dizia QUAIS contas mudam de lado. Este
   *  bloco mostra a escada inteira: quanto entrou no banco, o que é
   *  tirado para virar "Vendas", quanto saiu, o que é tirado para virar
   *  "Custos da Operação", e a ponte entre os dois resultados.
   *
   *  A soma das linhas tiradas é EXATAMENTE loanOutAt + ownerAt +
   *  investAt — se a escada não fechar no centavo, o painel avisa em vez
   *  de fingir que fechou.                                              */

  // Parcela de cada galho de despesa que NÃO entra em "Custos da Operação".
  const foraDaOperAt = (c, i) => {
    switch (c) {
      // 2.13 Bancárias é mista: juros e tarifas são custo de verdade; o resto
      // (antecipação, máquina financiada, capital de giro) é dívida/ativo.
      case '2.13': return val(get('2.13.6'), i) + (machineFinAt(i) - machineOldAt(i)) + giroAt(i);
      case '2.14': return val(get('2.14'), i);   // sócios + dívida bancária + Nordeste
      case '2.16': return val(get('2.16'), i);
      case '2.17': return val(get('2.17'), i);
      case '2.18': return val(get('2.18'), i);
      default: return 0;
    }
  };
  const TAG = { op: ['op', 'operação'], soc: ['soc', 'sócios'], inv: ['inv', 'investimento'],
                div: ['div', 'dívida'], fin: ['div', 'não é venda'] };
  const tag = k => `<span class="man-tag ${TAG[k][0]}">${TAG[k][1]}</span>`;

  function renderManual() {
    const hostL = document.getElementById('manualLente');
    const hostF = document.getElementById('manualFluxo');
    if (!hostL || !hostF) return;
    const i = cur, m = MONTHS[i];
    const tit = document.getElementById('lenteTitulo');
    if (tit) tit.textContent = `🎛️ As duas lentes do painel · ${m}`;
    const tf = document.getElementById('fluxoTitulo');
    if (tf) tf.textContent = `📆 ${m} · o que entrou e o que saiu`;

    /* ---------- 1) as duas lentes lado a lado ---------- */
    const kpi = (rot, v, sub, pctv) =>
      `<div class="lc-k"><span class="lc-kl">${rot}</span>
        <b class="lc-kv ${v < 0 ? 'neg' : ''}">${pctv ? pct(v) : fmt2(v)}</b>
        <span class="lc-ks">${sub}</span></div>`;
    const opMargem = salesAt(i) ? resOperAt(i) / salesAt(i) : 0;

    const colunas = `
      <div class="lente-cmp">
        <div class="lente-col lc-op">
          <div class="lc-h">🎯 Valor real (operação)</div>
          <p class="lc-q">Responde: <b>o negócio, sozinho, deu lucro?</b> Só conta o dinheiro que a
            empresa <i>gerou</i> — empréstimo que entrou não é venda, empréstimo que voltou não é
            despesa, retirada de sócio não é custo e máquina comprada é patrimônio, não gasto.</p>
          ${kpi('Vendas', salesAt(i), 'só receita de verdade')}
          ${kpi('Custos da Operação', despOperAt(i), 'só o que a operação consumiu')}
          ${kpi('Resultado da Operação', resOperAt(i), 'o lucro limpo do mês')}
          ${kpi('Margem da Operação', opMargem, 'sobra de cada R$ 100 vendidos', true)}
          <p class="lc-n">Use para <b>decidir</b>: preço, corte de custo, contratação.</p>
        </div>
        <div class="lente-col lc-cx">
          <div class="lc-h">💵 Com financiamentos (caixa)</div>
          <p class="lc-q">Responde: <b>quanto dinheiro passou pela conta?</b> Não tira nada:
            é o extrato bancário do mês, com empréstimo captado, devolução de dívida, retirada
            de sócio e compra de máquina tudo dentro.</p>
          ${kpi('Entrou no banco', revAt(i), 'todo crédito do mês')}
          ${kpi('Saiu do banco', expAt(i), 'todo débito do mês')}
          ${kpi('Variação de Caixa', resAt(i), 'quanto o saldo mudou')}
          ${kpi('Margem de Caixa', marginAt(i), 'sobra de cada R$ 100 que passaram', true)}
          <p class="lc-n">Use para <b>conferir</b>: esta lente tem que bater com o extrato.</p>
        </div>
      </div>`;

    /* ---------- 2) escada das ENTRADAS ---------- */
    const linEnt = [
      { c: '1.3', por: 'juro que o banco pagou sobre o saldo — não é cliente pagando' },
      { c: '1.4', por: 'dinheiro emprestado: entra hoje e volta depois, com juros' },
      { c: '1.7', por: 'Pix sem dono identificado — só vira venda quando alguém disser de quem é' },
    ].map(x => ({ ...x, a: get(x.c), v: val(get(x.c), i) }));
    const totEntFora = linEnt.reduce((s, x) => s + x.v, 0);
    const fechaEnt = Math.abs(revAt(i) - totEntFora - salesAt(i)) < 0.02;

    /* ---------- 3) escada das SAÍDAS ---------- */
    const linSai = [
      { r: 'Retiradas dos sócios e arrendamento', c: '2.14 menos 2.14.3', k: 'soc',
        v: ownerAt(i), por: 'é o dono levando o lucro para casa, não é a operação gastando' },
      { r: 'Máquinas e equipamentos à vista', c: '2.16', k: 'inv',
        v: val(get('2.16'), i), por: 'sai do caixa mas vira patrimônio — a máquina continua sendo sua' },
      { r: 'Máquinas e veículo financiados (Nordeste)', c: '2.13.7.1.1 · .2 · 2.14.3.4', k: 'inv',
        v: machineFinAt(i), por: 'a mesma coisa, só que parcelada pelo banco' },
      { r: 'Antecipação de recebíveis', c: '2.13.6', k: 'div',
        v: val(get('2.13.6'), i), por: 'custo de receber antes — dívida, não consumo da operação' },
      { r: 'Capital de giro (Nordeste)', c: '2.13.7.1.3', k: 'div',
        v: giroAt(i), por: 'a parte da parcela que é dívida pura, sem máquina do outro lado' },
      { r: 'Empréstimos bancários', c: '2.14.3 menos 2.14.3.4', k: 'div',
        v: bankRevolvAt(i), por: 'principal do empréstimo voltando para o banco' },
      { r: 'Devolução de empréstimo de sócio', c: '2.17', k: 'div',
        v: val(get('2.17'), i), por: 'o sócio emprestou para a empresa e está recebendo de volta' },
      { r: 'Transferência entre empresas', c: '2.18', k: 'div',
        v: val(get('2.18'), i), por: 'dinheiro trocando de bolso dentro do grupo — não sumiu' },
    ];
    const totSaiFora = linSai.reduce((s, x) => s + x.v, 0);
    const fechaSai = Math.abs(expAt(i) - totSaiFora - despOperAt(i)) < 0.02;

    const escada = (titulo, cls, topoRot, topo, itens, baseRot, base, fecha) => `
      <div class="esc ${cls}">
        <div class="esc-top"><span>${topoRot}</span><b>${fmt2(topo)}</b></div>
        <div class="table-scroll"><table class="dre esc-tab"><tbody>
          ${itens.filter(x => Math.abs(x.v) > 0.004).map(x => `<tr>
            <td class="t-name"><span class="esc-menos">−</span> ${x.r}
              ${x.k ? tag(x.k) : ''}
              <span class="esc-cod">${x.c}</span>
              <span class="es-obs">${x.por}</span></td>
            <td class="mono neg">${fmt2(-x.v)}</td></tr>`).join('')
          || `<tr><td class="t-name">Nada a tirar neste mês — as duas lentes dão o mesmo número.</td><td class="mono">—</td></tr>`}
        </tbody></table></div>
        <div class="esc-base"><span>${baseRot}</span><b class="${base < 0 ? 'neg' : ''}">${fmt2(base)}</b></div>
        <div class="esc-ck ${fecha ? 'ok' : 'bad'}">${fecha
          ? '✓ a escada fecha no centavo'
          : '⚠ a escada NÃO fecha — há conta fora das duas listas, avise o Leonardo'}</div>
      </div>`;

    const op = resOperAt(i), soc = ownerAt(i), inv = investAt(i), fin = financAt(i), cx = resAt(i);
    const ponte = Math.abs(op - soc - inv + fin - cx) < 0.02;

    hostL.innerHTML = colunas + `
      <h3 class="banco-group-title">Do extrato até as Vendas — o que a lente 🎯 tira das ENTRADAS</h3>
      ${escada('Entradas', 'in', 'Entrou no banco (lente 💵)', revAt(i), linEnt.map(x => ({
        r: x.a ? x.a.name : x.c, c: x.c, k: 'fin', v: x.v, por: x.por,
      })), 'Vendas (lente 🎯)', salesAt(i), fechaEnt)}

      <h3 class="banco-group-title">Do extrato até os Custos — o que a lente 🎯 tira das SAÍDAS</h3>
      ${escada('Saídas', 'out', 'Saiu do banco (lente 💵)', expAt(i), linSai, 'Custos da Operação (lente 🎯)', despOperAt(i), fechaSai)}

      <h3 class="banco-group-title">A ponte entre os dois resultados</h3>
      <div class="ponte ${ponte ? '' : 'bad'}">
        <div class="pt"><span>1 · Operação</span><b class="${op < 0 ? 'neg' : 'pos'}">${fmt2(op)}</b></div>
        <div class="pop">−</div>
        <div class="pt"><span>2 · Sócios</span><b>${fmt2(soc)}</b></div>
        <div class="pop">−</div>
        <div class="pt"><span>3 · Investimentos</span><b>${fmt2(inv)}</b></div>
        <div class="pop">+</div>
        <div class="pt"><span>4 · Financiamento</span><b class="${fin < 0 ? 'neg' : 'pos'}">${fmt2(fin)}</b></div>
        <div class="pop">=</div>
        <div class="pt fim"><span>Variação de Caixa</span><b class="${cx < 0 ? 'neg' : 'pos'}">${fmt2(cx)}</b></div>
      </div>
      <p class="hint">${ponte ? '' : '<b class="neg">⚠ a conta não fechou neste mês.</b> '}
        Em <b>${m}</b> o negócio ${op >= 0 ? 'gerou' : 'consumiu'} <b>${fmt2(Math.abs(op))}</b>,
        mas o saldo do banco ${cx >= 0 ? 'subiu' : 'caiu'} <b>${fmt2(Math.abs(cx))}</b>.
        A diferença de <b>${fmt2(Math.abs(op - cx))}</b> não é erro: é retirada, máquina e dívida
        entrando e saindo — cada uma no seu bloco acima.</p>`;

    /* ---------- 4) o mês, conta por conta, entradas e saídas separadas ---------- */
    const entradas = (childrenOf.get('1') || []).map(a => ({
      nome: a.name, cod: a.code, v: val(a, i),
      k: FIN_REV_CODES.includes(a.code) ? 'fin' : 'op',
      obs: FIN_REV_CODES.includes(a.code) ? 'não é venda — fica fora da lente 🎯' : '',
    })).filter(x => Math.abs(x.v) > 0.004);
    const restoIn = round2(revAt(i) - entradas.reduce((s, x) => s + x.v, 0));
    if (Math.abs(restoIn) > 0.5) entradas.push({ nome: 'Sem categoria', cod: '1', v: restoIn, k: 'op',
      obs: 'lançado direto na conta 1, sem centro — vale classificar no Mubisys' });

    // etiqueta de cada galho de despesa: 2.13 é misto (juro é custo, o resto
    // não), 2.14/2.16/2.17/2.18 saem inteiros da operação, o resto é custo puro.
    const K_SAIDA = { '2.14': 'soc', '2.16': 'inv', '2.17': 'div', '2.18': 'div' };
    const saidas = (childrenOf.get('2') || []).map(a => {
      const tot = val(a, i), fora = foraDaOperAt(a.code, i), dentro = round2(tot - fora);
      const misto = Math.abs(fora) > 0.004 && Math.abs(dentro) > 0.004;
      const tags = Math.abs(fora) < 0.005 ? tag('op')
        : misto ? tag('op') + tag(a.code === '2.13' ? 'div' : (K_SAIDA[a.code] || 'div'))
        : tag(K_SAIDA[a.code] || 'div');
      const nota = misto
        ? `misto: <b>${fmt2(dentro)}</b> são custo da operação e <b>${fmt2(fora)}</b> ficam fora (dívida/máquina)`
        : (Math.abs(fora) > 0.004 ? 'sai inteiro da lente 🎯 — não é custo da operação' : '');
      return { nome: a.name, cod: a.code, v: tot, fora, dentro, tags, nota };
    }).filter(x => Math.abs(x.v) > 0.004);
    const restoOut = round2(expAt(i) - saidas.reduce((s, x) => s + x.v, 0));
    if (Math.abs(restoOut) > 0.5) saidas.push({ nome: 'Sem categoria', cod: '2', v: restoOut, fora: 0, dentro: restoOut,
      tags: tag('op'), nota: 'lançado direto na conta 2 (ex.: fatura de cartão sem rateio) — vale abrir no Mubisys' });

    const totIn = entradas.reduce((s, x) => s + x.v, 0);
    const totOut = saidas.reduce((s, x) => s + x.v, 0);

    hostF.innerHTML = `
      <div class="es-grid">
        <div class="es-bloco">
          <div class="es-head in"><span>⬅ ENTROU em ${m}</span><b>${fmt2(totIn)}</b></div>
          <table class="dre es-tab"><tbody>
            ${entradas.sort((a, b) => b.v - a.v).map(x => `<tr>
              <td class="t-name"><b>${x.cod}</b> ${escAttr(x.nome)} ${tag(x.k)}
                ${x.obs ? `<span class="es-obs">${x.obs}</span>` : ''}</td>
              <td class="mono">${fmt2(x.v)}</td>
              <td class="av">${totIn ? pct(x.v / totIn) : '—'}</td></tr>`).join('')}
          </tbody></table>
          <div class="es-rod">Vendas (lente 🎯): <b>${fmt2(salesAt(i))}</b></div>
        </div>
        <div class="es-bloco">
          <div class="es-head out"><span>SAIU em ${m} ➡</span><b>${fmt2(totOut)}</b></div>
          <table class="dre es-tab"><tbody>
            ${saidas.sort((a, b) => b.v - a.v).map(x => `<tr>
              <td class="t-name"><b>${x.cod}</b> ${escAttr(x.nome)} ${x.tags}
                ${x.nota ? `<span class="es-obs">${x.nota}</span>` : ''}</td>
              <td class="mono">${fmt2(x.v)}</td>
              <td class="av">${totOut ? pct(x.v / totOut) : '—'}</td></tr>`).join('')}
          </tbody></table>
          <div class="es-rod">Custos da Operação (lente 🎯): <b>${fmt2(despOperAt(i))}</b></div>
        </div>
      </div>
      <div class="es-fecha ${cx >= 0 ? 'pos' : 'neg'}">
        <span>Entrou ${fmt2(totIn)} · Saiu ${fmt2(totOut)}</span>
        <b class="${cx >= 0 ? 'pos' : 'neg'}">${cx >= 0 ? 'sobrou' : 'faltou'} ${fmt2(Math.abs(cx))}</b>
      </div>`;
  }

  /* ------------------------------------------------------------------ *
   *  DRE PADRÃO — a cascata contábil clássica
   *  ------------------------------------------------------------------
   *  O DRE por Seção é o espelho do plano de contas: bom para achar
   *  lançamento, ruim para medir operação, porque o custo de produção
   *  fica espalhado em seis galhos e a MARGEM BRUTA não aparece em
   *  lugar nenhum. Aqui as MESMAS contas viram a cascata clássica —
   *  Receita Bruta → Líquida → Lucro Bruto → EBITDA → Resultado — e no
   *  fim a ponte de volta para a variação de caixa.
   *
   *  REGRA DE CONSTRUÇÃO: a alocação varre TODOS os filhos de "2" e
   *  obriga cada um a cair num balde. O que não for reconhecido vai para
   *  "Outras" COM O NOME, em vez de sumir. Conferido nos 9 meses da
   *  série: a ponte fecha no centavo contra o caixa do painel.        */
  const PAD_CPV       = ['2.12', '2.11', '2.10', '2.6'];  // material, terceirização, obra, máquinas
  const PAD_PESSOAL   = ['2.1', '2.9'];
  const PAD_ADMIN     = ['2.2', '2.3', '2.5'];
  const PAD_VEICULOS  = ['2.7'];
  const PAD_TERCEIROS = ['2.8'];
  const PAD_COMERCIAL = ['2.15'];
  const PAD_DED_IMP   = ['2.4.1', '2.4.8'];   // DAS (Simples) e ISSQN incidem sobre a venda
  const PAD_DED_DEV   = ['2.2.6'];            // devolução a cliente
  const PAD_IOF       = ['2.4.7'];
  const PAD_FIN_TAR   = ['2.13.1', '2.13.2', '2.13.5'];  // tarifas e juros de cartão

  const somaC = (codes, i) => codes.reduce((s, c) => s + val(get(c), i), 0);

  function padraoAt(i) {
    const d = { cpv: 0, pessoal: 0, admin: 0, veiculos: 0, terceiros: 0, comercial: 0,
                tributos: 0, semRateio: 0, outros: 0, despFin: 0, socios: 0,
                maquinas: 0, divOut: 0, outrosLista: [] };
    const f1 = (childrenOf.get('1') || []).map(x => x.code);
    const f2 = (childrenOf.get('2') || []).map(x => x.code);

    d.recFin = val(get('1.3'), i);
    d.divIn = val(get('1.4'), i) + val(get('1.7'), i);
    // valor lançado DIRETO na conta 1, sem centro de custo — nos meses de
    // planilha chega a R$ 8,4 mil; sem esta linha a cascata não fecha
    d.recSemCat = round2(val(get('1'), i) - f1.reduce((s, c) => s + val(get(c), i), 0));
    d.bruta = round2(f1.filter(c => !['1.3', '1.4', '1.7'].includes(c))
      .reduce((s, c) => s + val(get(c), i), 0) + d.recSemCat);

    d.dedImp = somaC(PAD_DED_IMP, i);
    d.dedDev = somaC(PAD_DED_DEV, i);
    d.deducoes = round2(d.dedImp + d.dedDev);
    d.liquida = round2(d.bruta - d.deducoes);

    f2.forEach(c => {
      const tot = val(get(c), i);
      if (!tot) return;
      if (c === '2.4') {                                    // impostos: 3 destinos
        d.tributos += round2(tot - somaC(PAD_DED_IMP, i) - somaC(PAD_IOF, i));
        d.despFin += somaC(PAD_IOF, i);
      } else if (c === '2.13') {                            // bancárias: 3 destinos
        const fin = somaC(PAD_FIN_TAR, i);
        const maq = somaC(['2.13.7.1.1', '2.13.7.1.2'], i);
        d.despFin += fin; d.maquinas += maq;
        d.divOut += round2(tot - fin - maq);                // antecipação + giro
      } else if (c === '2.14') {                            // societárias: 3 destinos
        const maq = val(get('2.14.3.4'), i);
        d.maquinas += maq;
        d.divOut += round2(val(get('2.14.3'), i) - maq);
        d.socios += round2(tot - val(get('2.14.3'), i));
      } else if (c === '2.16') d.maquinas += tot;
      else if (['2.17', '2.18'].includes(c)) d.divOut += tot;
      else if (PAD_CPV.includes(c)) d.cpv += tot;
      else if (PAD_PESSOAL.includes(c)) d.pessoal += tot;
      else if (PAD_ADMIN.includes(c)) d.admin += round2(tot - (c === '2.2' ? somaC(PAD_DED_DEV, i) : 0));
      else if (PAD_VEICULOS.includes(c)) d.veiculos += tot;
      else if (PAD_TERCEIROS.includes(c)) d.terceiros += tot;
      else if (PAD_COMERCIAL.includes(c)) d.comercial += tot;
      else if (c === '2.99') d.semRateio += tot;
      else { d.outros += tot; d.outrosLista.push({ c, nome: (get(c) || {}).name || c, v: round2(tot) }); }
    });
    const despSemCat = round2(val(get('2'), i) - f2.reduce((s, c) => s + val(get(c), i), 0));
    if (Math.abs(despSemCat) > 0.01) {
      d.outros += despSemCat;
      d.outrosLista.push({ c: '2', nome: 'Sem centro de custo', v: despSemCat });
    }
    ['cpv', 'pessoal', 'admin', 'veiculos', 'terceiros', 'comercial', 'tributos',
     'semRateio', 'outros', 'despFin', 'socios', 'maquinas', 'divOut'].forEach(k => d[k] = round2(d[k]));

    d.bruto = round2(d.liquida - d.cpv);
    d.despOper = round2(d.pessoal + d.admin + d.veiculos + d.terceiros + d.comercial
      + d.tributos + d.semRateio + d.outros);
    d.ebitda = round2(d.bruto - d.despOper);
    d.resFin = round2(d.recFin - d.despFin);
    d.resultado = round2(d.ebitda + d.resFin);
    d.caixa = round2(val(get('1'), i) - val(get('2'), i));
    d.conferido = round2(d.resultado - d.socios - d.maquinas + d.divIn - d.divOut);
    d.fecha = Math.abs(d.conferido - d.caixa) < 0.02;
    return d;
  }

  function renderPadrao() {
    const host = document.getElementById('padraoTabela');
    if (!host) return;
    const d = padraoAt(cur), p = padraoAt(cmp);
    const tit = document.getElementById('padraoTitulo');
    if (tit) tit.textContent = `📄 DRE no formato padrão · ${MONTHS[cur]}`;

    // acumulado do ano aberto na barra de período
    const doAno = META_MES.map((x, i) => ({ ...x, i })).filter(x => x.a === anoSel).map(x => x.i);
    const acum = {};
    doAno.forEach(i => { const a = padraoAt(i); Object.keys(a).forEach(k => {
      if (typeof a[k] === 'number') acum[k] = round2((acum[k] || 0) + a[k]); }); });

    const av = (x, base) => base ? pct(x / base) : '—';
    const ah = (a, b) => b ? signedPct((a - b) / Math.abs(b)) : '—';
    const dir = (a, b, custo) => !b ? 'av' : (a > b ? (custo ? 'neg' : 'pos') : (custo ? 'pos' : 'neg'));
    const mg = (x, o) => o.liquida ? x / o.liquida : 0;

    const kpi = (rot, v, sub, cls) =>
      `<div class="ck"><span class="ck-l">${rot}</span>
        <span class="ck-v ${cls || ''}">${pct(v)}</span><span class="ck-s">${sub}</span></div>`;
    document.getElementById('padraoKpis').innerHTML =
      kpi('Margem bruta', mg(d.bruto, d), `era ${av(p.bruto, p.liquida)} em ${MONTHS[cmp]}`,
          mg(d.bruto, d) >= mg(p.bruto, p) ? 'pos' : 'neg') +
      kpi('Margem EBITDA', mg(d.ebitda, d), `era ${av(p.ebitda, p.liquida)} em ${MONTHS[cmp]}`,
          mg(d.ebitda, d) >= mg(p.ebitda, p) ? 'pos' : 'neg') +
      kpi('Margem líquida', mg(d.resultado, d), `era ${av(p.resultado, p.liquida)} em ${MONTHS[cmp]}`,
          mg(d.resultado, d) >= mg(p.resultado, p) ? 'pos' : 'neg');

    const LINHAS = [
      ['RECEITA OPERACIONAL BRUTA', 'bruta', 'grande', false],
      ['(−) Deduções sobre a receita', 'deducoes', 'filha', true],
      ['RECEITA OPERACIONAL LÍQUIDA', 'liquida', 'result', false],
      ['(−) Custo dos produtos e serviços vendidos', 'cpv', 'filha', true],
      ['= LUCRO BRUTO', 'bruto', 'result', false],
      ['(−) Despesas com pessoal', 'pessoal', 'filha', true],
      ['(−) Despesas administrativas', 'admin', 'filha', true],
      ['(−) Despesas com veículos', 'veiculos', 'filha', true],
      ['(−) Serviços de terceiros', 'terceiros', 'filha', true],
      ['(−) Despesas comerciais', 'comercial', 'filha', true],
      ['(−) Tributos fora da venda', 'tributos', 'filha', true],
      ['(−) Fatura de cartão sem rateio', 'semRateio', 'filha', true],
      ['(−) Outras despesas operacionais', 'outros', 'filha', true],
      ['= EBITDA · resultado operacional', 'ebitda', 'result', false],
      ['(+) Receitas financeiras', 'recFin', 'filha', false],
      ['(−) Despesas financeiras', 'despFin', 'filha', true],
      ['= RESULTADO DO EXERCÍCIO', 'resultado', 'grande', false],
    ];
    host.innerHTML = `<div class="table-scroll"><table class="dre pad-tab">
      <thead><tr><th class="t-name">Conta</th><th>${MONTHS[cur]}</th><th>AV</th>
        <th>vs ${MONTHS[cmp]}</th><th>${MONTHS[cmp]}</th><th>Acum. ${anoSel}</th></tr></thead>
      <tbody>${LINHAS.filter(([, k]) => d[k] || p[k] || acum[k]).map(([rot, k, cls, custo]) => `
        <tr class="pad-${cls}">
          <td class="t-name">${rot}</td>
          <td class="mono ${d[k] < 0 ? 'neg' : ''}">${fmt2(d[k])}</td>
          <td class="av">${av(d[k], d.liquida)}</td>
          <td class="${dir(d[k], p[k], custo)}">${ah(d[k], p[k])}</td>
          <td class="mono">${fmt(p[k])}</td>
          <td class="mono">${fmt(acum[k] || 0)}</td>
        </tr>`).join('')}</tbody></table></div>`;

    const PONTE = [
      ['RESULTADO DO EXERCÍCIO', d.resultado, acum.resultado, 'result'],
      ['(−) Retiradas dos sócios e arrendamento', -d.socios, -(acum.socios || 0), 'filha'],
      ['(−) Máquinas e veículos (viram patrimônio)', -d.maquinas, -(acum.maquinas || 0), 'filha'],
      ['(+) Empréstimos captados', d.divIn, acum.divIn, 'filha'],
      ['(−) Empréstimos devolvidos', -d.divOut, -(acum.divOut || 0), 'filha'],
      ['= VARIAÇÃO DE CAIXA DO MÊS', d.caixa, acum.caixa, 'grande'],
    ];
    document.getElementById('padraoPonte').innerHTML = `
      <h3 class="banco-group-title" style="margin-top:20px">Do resultado até o caixa</h3>
      <p class="hint" style="margin-bottom:8px">O que separa o lucro do saldo do banco — nada aqui é despesa da operação.</p>
      <div class="table-scroll"><table class="dre pad-tab">
        <thead><tr><th class="t-name">Conta</th><th>${MONTHS[cur]}</th><th>Acum. ${anoSel}</th></tr></thead>
        <tbody>${PONTE.map(([rot, a, b, cls]) => `<tr class="pad-${cls}">
          <td class="t-name">${rot}</td>
          <td class="mono ${a < 0 ? 'neg' : 'pos'}">${fmt2(a)}</td>
          <td class="mono ${(b || 0) < 0 ? 'neg' : 'pos'}">${fmt(b || 0)}</td></tr>`).join('')}
        </tbody></table></div>
      <p class="hint" style="margin-top:8px">${d.fecha
        ? '✓ a ponte fecha no centavo com a variação de caixa do painel'
        : '<b class="neg">⚠ a ponte NÃO fechou — há conta fora de todos os baldes</b>'}</p>`;

    const MAPA = [
      ['Receita bruta', 'todos os galhos de receita menos 1.3 Rendimentos, 1.4 Empréstimos e 1.7 a Identificar'],
      ['Deduções', '2.4.1 DAS (Simples Nacional) · 2.4.8 ISSQN · 2.2.6 Devolução a cliente'],
      ['Custo dos produtos e serviços', '2.12 Materiais e Insumos · 2.11 Terceirização · 2.10 Instalações Externas · 2.6 Máquinas/Equipamentos'],
      ['Despesas com pessoal', '2.1 Despesas Funcionários · 2.9 Segurança do Trabalho'],
      ['Administrativas', '2.2 Administrativas (fora a devolução) · 2.3 Limpeza · 2.5 Fixas'],
      ['Tributos fora da venda', '2.4.3 DARF'],
      ['Receitas financeiras', '1.3 Rendimentos'],
      ['Despesas financeiras', '2.13.1 Tarifa de Boletos · 2.13.2 Tarifa de Serviços · 2.13.5 Juros Cartão · 2.4.7 IOF'],
      ['Sócios (abaixo da linha)', '2.14.1 Arrendamento · 2.14.2 Retiradas'],
      ['Máquinas (abaixo da linha)', '2.16 Investimentos · 2.13.7.1.1 e .2 Nordeste · 2.14.3.4'],
      ['Empréstimos (abaixo da linha)', '1.4 captado · 2.13.6 Antecipação · 2.13.7.1.3 Giro · 2.14.3 bancários · 2.17 · 2.18'],
    ];
    document.getElementById('padraoMapa').innerHTML = `
      <h3 class="banco-group-title" style="margin-top:20px">De onde vem cada linha</h3>
      <p class="hint" style="margin-bottom:8px">Toda decisão de classificação, à vista, para ser conferida.</p>
      <div class="table-scroll"><table class="dre pad-tab"><tbody>
        ${MAPA.map(([a, b]) => `<tr><td class="t-name"><b>${a}</b></td><td class="pad-mapa">${b}</td></tr>`).join('')}
      </tbody></table></div>`;

    // Fatura de cartão parada em "Juros Cartão" distorce a margem líquida do mês
    // que a carrega. Quando isso acontece no mês COMPARADO, a melhora aparente
    // é correção de classificação, não ganho de operação — avisa em vez de deixar
    // o dono comemorar número errado.
    const jurosCmp = val(get('2.13.5'), cmp), jurosCur = val(get('2.13.5'), cur);
    const alerta = jurosCmp > 5000 || jurosCur > 5000;
    document.getElementById('padraoNotas').innerHTML = `
      ${alerta ? `<div class="aviso-box"><b>⚠ Cuidado ao comparar a margem líquida.</b>
        A conta <b>2.13.5 Juros Cartão</b> está em <b>${fmt2(jurosCmp > 5000 ? jurosCmp : jurosCur)}</b>
        em ${jurosCmp > 5000 ? MONTHS[cmp] : MONTHS[cur]} — juros de verdade não chegam nesse valor.
        É fatura de cartão sem itemizar parada ali dentro, e ela infla a despesa financeira daquele mês.
        Enquanto isso não for arrumado no Mubisys, compare pela <b>margem bruta</b> e pela
        <b>EBITDA</b>, que não passam por essa conta.</div>` : ''}
      ${d.outrosLista.length ? `<p class="hint" style="margin-top:12px">Dentro de <b>Outras despesas
        operacionais</b>: ${d.outrosLista.map(x => `${escAttr(x.nome)} ${fmt2(x.v)}`).join(' · ')}.</p>` : ''}
      <p class="hint" style="margin-top:12px"><b>Três ressalvas.</b>
        <b>1.</b> A base é <b>caixa, não competência</b>: cada valor entra no mês em que o dinheiro
        saiu ou entrou, não no mês da nota — a forma da cascata é a padrão, a data de corte não.
        <b>2.</b> Não há <b>depreciação</b>: máquina comprada sai do caixa de uma vez e fica abaixo
        da linha, então o EBITDA aqui já é praticamente o EBIT.
        <b>3.</b> <b>IR e CSLL</b> estão dentro do DAS do Simples, já deduzido lá em cima — por isso
        não existe linha separada de imposto sobre o lucro.</p>`;
  }

  // Baixar PDF = imprimir. O @media print isola este cartão e o navegador
  // oferece "Salvar como PDF" (no iPhone: Compartilhar → Imprimir → salvar).
  // Sem biblioteca externa: a CSP dos Artifacts e do site bloqueia CDN.
  const btPdf = document.getElementById('padraoPdf');
  if (btPdf) btPdf.onclick = () => {
    // se o cartão estiver recolhido, o PDF sairia em branco: abre antes
    const card = document.getElementById('padraoCard');
    if (card) card.classList.remove('collapsed');
    document.body.classList.add('imprimindo-padrao');
    const limpa = () => document.body.classList.remove('imprimindo-padrao');
    window.addEventListener('afterprint', limpa, { once: true });
    setTimeout(limpa, 60000);        // Safari antigo não dispara afterprint
    window.print();
  };

  function renderAll() {
    sincronizaPeriodo(); renderAno(); renderManual();
    renderKPIs(); renderPadrao(); renderDRE(); renderComposition(); renderRevComposition(); renderTrend(); buildMirrorHead(); renderMirror();
    renderCenters(); renderUtilities(); renderBreakdowns(); renderBigCenter(); renderBuffett(); renderBlocos3(); renderInsightsTab(); renderEntraSai(); renderConcil(); renderEstrutura(); renderPrevia();
    if (typeof wireResGrupos === 'function') wireResGrupos();
    if (typeof renderAuditoria === 'function') renderAuditoria();
    if (typeof wireCollapsibleCards === 'function') wireCollapsibleCards();
    document.getElementById('footMeta').textContent = `${MONTHS.length} meses · ${ACCS.length} contas · ${MONTHS[0]} → ${MONTHS[MONTHS.length - 1]}`;
  }

  document.querySelectorAll('#lenteNav button').forEach(b => { b.onclick = () => aplicaLente(b.dataset.lente); b.classList.toggle('active', b.dataset.lente === lente); });
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


/* ------------------------------------------------------------------ */
/*  Aba 📊 Resultado — seletores internos. Visão Geral e Visão de Dono  */
/*  viraram uma aba só; cada grupo aparece sob demanda.                 */
/* ------------------------------------------------------------------ */
const RES_GRP_KEY = 'impresilk_dre_res_grp';
function wireResGrupos() {
  const nav = document.getElementById('resModos');
  if (!nav || nav._wired) return;
  nav._wired = true;
  let atual = 'resumo';
  try { atual = localStorage.getItem(RES_GRP_KEY) || 'resumo'; } catch (_) {}
  const aplica = g => {
    document.querySelectorAll('.res-grp').forEach(el => el.classList.toggle('hidden', el.dataset.grp !== g));
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.grp === g));
    try { localStorage.setItem(RES_GRP_KEY, g); } catch (_) {}
    window.dispatchEvent(new Event('resize'));   // gráficos recalculam ao aparecer
  };
  nav.querySelectorAll('button').forEach(b => b.onclick = () => aplica(b.dataset.grp));
  aplica(document.querySelector(`.res-grp[data-grp="${atual}"]`) ? atual : 'resumo');
}

/* ==================================================================== */
/*  AUDITORIA — compara o DRE com o financeiro do Mubisys (só leitura)    */
/*  As despesas do ERP vêm com plano de contas + fornecedor, então dá     */
/*  para achar lançamento em conta errada sem abrir o sistema.            */
/* ==================================================================== */
// "Jun/2026" -> { ini:'2026-06-01', fim:'2026-06-30' }
function mesParaDatas(label) {
  const k = monthSortKey(label);
  if (k < 0) return null;
  const ano = Math.floor(k / 12), mi = k % 12;
  const p2 = n => String(n).padStart(2, '0');
  const ultimo = new Date(Date.UTC(ano, mi + 1, 0)).getUTCDate();
  return { ini: `${ano}-${p2(mi + 1)}-01`, fim: `${ano}-${p2(mi + 1)}-${p2(ultimo)}` };
}

// formatadores próprios: fmt/pct do painel vivem dentro de boot() e não
// alcançam esta função (que é global e roda fora daquele escopo).
const _audBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const fmtA = v => _audBRL.format(v || 0);
const pctA = v => (v == null || !isFinite(v)) ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

let _audWired = false;
function renderAuditoria() {
  const sel = document.getElementById('audMes');
  if (!sel || typeof apiFn !== 'function') return;
  const D = getCurrentData();
  const meses = (D && D.months) || [];
  const atual = sel.value;
  sel.innerHTML = meses.map(m => `<option value="${escAttr(m)}">${escAttr(m)}</option>`).join('');
  if (atual && meses.includes(atual)) sel.value = atual;
  else if (meses.length) sel.value = meses[meses.length - 1];
  if (_audWired) return;
  _audWired = true;

  document.getElementById('audRodar').onclick = async () => {
    const label = sel.value;
    const st = document.getElementById('audStatus');
    const resumo = document.getElementById('audResumo');
    const tab = document.getElementById('audTabela');
    const per = mesParaDatas(label);
    if (!per) { st.textContent = 'Não consegui identificar o período.'; return; }
    st.textContent = 'Consultando o Mubisys… (pode levar até 1 min)';
    resumo.innerHTML = ''; tab.innerHTML = '';
    let r;
    try {
      // 150s: o backend agora consulta o Mubisys numa fila de 2 com orcamento de
      // 120s (a rajada antiga afogava o ERP e perdia fatias em silencio). O
      // cliente precisa esperar MAIS que o servidor, senao aborta um resultado
      // que chegaria.
      r = await apiFn('financas', 'importarMes', { datainicial: per.ini, datafinal: per.fim }, 150000);
    } catch (_) { st.textContent = 'Falha ao consultar o Mubisys (timeout ou rede).'; return; }
    if (!r || !r.ok) { st.textContent = 'Erro: ' + ((r && r.erro) || '—'); return; }

    // valores do DRE para o mês escolhido
    const D2 = getCurrentData();
    const mi = (D2.months || []).indexOf(label);
    const dre = {}, nomes = {};
    (D2.accounts || []).forEach(a => { dre[a.code] = +(a.values[mi] || 0); nomes[a.code] = a.name; });

    const api = r.porCodigo || {};
    const codes = [...new Set([...Object.keys(api), ...Object.keys(dre)])];
    const linhas = [];
    let soApi = 0, soDre = 0, difs = 0;
    codes.forEach(c => {
      const temFilho = codes.some(o => o !== c && o.startsWith(c + '.'));
      if (temFilho) return;                       // compara só as folhas
      const va = api[c] ? api[c].valor : null;
      const vd = (c in dre) ? dre[c] : null;
      if (va == null && (vd == null || Math.abs(vd) < 0.01)) return;
      const dif = (va || 0) - (vd || 0);
      if (Math.abs(dif) < 0.5) return;
      if (va != null && vd == null) soApi++;
      else if (va == null) soDre++;
      else difs++;
      linhas.push({ c, nome: nomes[c] || (api[c] && api[c].nome) || '', va, vd, dif });
    });
    linhas.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));

    const dg = r.diag || {};
    const tApi = (r.totais && r.totais.despesa) || 0;
    const tDre = dre['2'] || 0;
    st.textContent = '';
    resumo.innerHTML = `
      <div class="aud-kpis">
        <div class="ak"><span class="ak-l">Despesas · Mubisys</span><span class="ak-v">${fmtA(tApi)}</span><span class="ak-s">${dg.incluidos || 0} lançamentos</span></div>
        <div class="ak"><span class="ak-l">Despesas · DRE</span><span class="ak-v">${fmtA(tDre)}</span><span class="ak-s">painel</span></div>
        <div class="ak"><span class="ak-l">Diferença</span><span class="ak-v ${Math.abs(tApi - tDre) > tDre * 0.02 ? 'neg' : 'pos'}">${fmtA(tApi - tDre)}</span><span class="ak-s">${tDre ? pctA((tApi - tDre) / tDre) : '—'}</span></div>
        <div class="ak"><span class="ak-l">Contas divergentes</span><span class="ak-v">${linhas.length}</span><span class="ak-s">${difs} c/ valor diferente · ${soApi} só no ERP · ${soDre} só no DRE</span></div>
      </div>`;

    tab.innerHTML = linhas.length ? `
      <div class="table-scroll">
        <table class="dre aud-tab">
          <thead><tr><th class="t-name">Conta</th><th>Mubisys</th><th>DRE</th><th>Diferença</th><th class="t-name">Situação</th></tr></thead>
          <tbody>${linhas.map(l => {
            const sit = l.va == null ? 'só no DRE' : l.vd == null ? 'só no Mubisys' : 'valor diferente';
            const cls = l.va == null || l.vd == null ? 'warn' : '';
            return `<tr>
              <td class="t-name"><b>${escAttr(l.c)}</b> ${escAttr(l.nome)}</td>
              <td>${l.va == null ? '—' : fmtA(l.va)}</td>
              <td>${l.vd == null ? '—' : fmtA(l.vd)}</td>
              <td class="${l.dif >= 0 ? 'v-pos' : 'v-neg'}">${fmtA(l.dif)}</td>
              <td class="t-name"><span class="aud-sit ${cls}">${sit}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:12px">Só aparecem contas-folha com diferença acima de R$ 0,50. Diferença positiva = o Mubisys tem mais que o DRE.</p>`
      : '<p class="hint">✅ Nenhuma divergência relevante — o DRE bate com o Mubisys neste mês.</p>';
  };
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
const COLLAPSE_KEY = 'impresilk_dre_collapsed_v2';   // v2: chaves deixaram de ser posicionais
function wireCollapsibleCards() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch (_) {}
  const persist = () => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(saved)); } catch (_) {} };

  document.querySelectorAll('main .card').forEach((card, idx) => {
    const head = card.querySelector('.card-head');
    if (!head || head.querySelector('.card-collapse')) return; // já tem botão
    // id estável derivado do TÍTULO (o índice mudava sempre que um card era
    // inserido/removido, e cards injetados por innerHTML colidiam com os fixos)
    const h2txt = (card.querySelector('h2') || {}).textContent || '';
    const slug = h2txt.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    const key = card.id || slug || ('card-' + idx);
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

// grade de termos agrupados com busca — usada pelo Glossário e pelas Diretrizes
function renderTermGrid(gridId, searchId, items) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const groups = [];
  items.forEach(item => {
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

  const search = document.getElementById(searchId);
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
// Manual = Diretrizes (regras de lançamento) + Glossário (dicionário), num grid só.
function renderGlossary() { renderTermGrid('glossaryGrid', 'glossarySearch', DIRETRIZES.concat(GLOSSARY)); }
function renderDiretrizes() { /* fundido no Manual */ }

/* ==================================================================== */
/*  DIRETRIZES DA DRE — como funciona + regras da casa de classificação   */
/* ==================================================================== */
const DIRETRIZES = [
  { g: 'Como esta DRE funciona', t: 'Regime de caixa', d: 'Esta DRE segue a <b>competência de caixa</b>: cada valor entra no mês em que o dinheiro <b>efetivamente entrou ou saiu</b> da conta — a data do pagamento/recebimento manda, não a data da venda ou da nota. Por isso o resultado pode oscilar conforme <i>quando</i> as contas foram pagas.' },
  { g: 'Como esta DRE funciona', t: 'De onde vêm os números', d: 'Um robô lê o <b>Mubisys direto</b> (3× ao dia: 6h, 12h e 18h) e monta o mês sozinho — a planilha .xlsx foi aposentada em Ago/2026, mas o upload manual continua existindo como opção. O painel não inventa nem corrige nada: <b>classificação errada no sistema aparece errada aqui</b> (e o card “Para arrumar no Mubisys”, na aba Conferência, aponta as suspeitas). Encontrou algo no lugar errado? Corrija <i>na origem</i> — na leitura seguinte o painel atualiza sem duplicar.' },
  { g: 'Como esta DRE funciona', t: 'Estrutura de códigos', d: 'Contas <b>1.x</b> = Receitas (1.1 vendas, 1.3/1.4 rendimentos e empréstimos captados). Contas <b>2.x</b> = Despesas, uma por centro de custo (2.1 Funcionários, 2.12 Materiais, 2.13 Bancárias, 2.14 Societárias…). Os níveis aninham: <i>2.14.2.2</i> está dentro de <i>2.14.2</i>, que está dentro de <i>2.14</i>.' },

  { g: 'Regras da casa · onde classificar', t: 'Retiradas de sócios', d: 'Toda retirada de sócio vai em <b>Despesas Societárias → 2.14.2 Retiradas</b>. <b>Nunca</b> em Despesas Funcionários (2.1) — retirada não é folha de pagamento, é destino do lucro.' },
  { g: 'Regras da casa · onde classificar', t: 'Arrendamento', d: 'O arrendamento vai em <b>Despesas Societárias → 2.14.1 Arrendamento</b>. <b>Nunca</b> em Despesas Funcionários (2.1) ou em custos da operação.' },
  { g: 'Regras da casa · onde classificar', t: 'Plano de saúde — funcionários × arrendamento', d: 'São dois destinos diferentes: o plano de saúde dos <b>funcionários</b> vai em <b>2.1.20 Plano de Saúde</b> (Despesas Funcionários). O plano de saúde de <b>Pedro e Maria (arrendamento)</b> vai em <b>Despesas Societárias (2.14)</b> — <b>não entra</b> em despesas de colaboradores. <i>Atenção: em jun/2026 esse lançamento foi feito em 2.1.20 por engano.</i>' },
  { g: 'Regras da casa · onde classificar', t: 'Serviço extra feito por funcionário da casa', d: 'Quando um <b>funcionário da própria empresa</b> faz um serviço extra (freela interno), o pagamento vai em <b>2.1.16 Prestação de Serviços</b>, dentro de Despesas Funcionários — está certo ali. <b>Terceiro/PJ de fora</b> é outra coisa: vai em <b>2.11 Terceirização de Serviços</b>.' },
  { g: 'Regras da casa · onde classificar', t: 'Antecipação de recebíveis', d: 'Custo de antecipar recebíveis é <b>custo financeiro</b>: vai em <b>Bancárias → 2.13.6 Antecipação de Recebíveis</b>. Não é retirada nem despesa operacional — <b>transferência ou retirada de sócio não entra aqui</b>, vai em 2.14.2 Retiradas.' },
  { g: 'Regras da casa · onde classificar', t: 'Investimentos e aportes', d: 'Aportes e investimentos vão em <b>2.16 Investimentos</b> — separados da operação. Na análise, são tratados como “dinheiro do dono”, junto com as Societárias.' },
  { g: 'Regras da casa · onde classificar', t: 'Empréstimos', d: 'Empréstimo <b>captado</b> (dinheiro que entrou) é receita financeira (<b>1.4</b>). <b>Juros e parcelas</b> pagos são custo financeiro (<b>2.13 Bancárias</b>). Não misturar com receita de vendas — isso inflaria a margem.' },

  { g: 'Rotina de fechamento mensal', t: 'Passo a passo do fechamento', d: '<b>1.</b> Feche o mês no sistema. <b>2.</b> Exporte o “Plano de Contas” (.xlsx). <b>3.</b> No painel, clique <b>+ mês</b> e suba o arquivo. <b>4.</b> Confira no aviso se Receita/Despesa/Resultado batem com o sistema. <b>5.</b> Confirme — o painel sincroniza sozinho (☁️).' },
  { g: 'Rotina de fechamento mensal', t: 'Um upload por mês', d: 'O painel reconhece o período mesmo com grafia diferente (“jun/2026”, “06/2026”) e <b>atualiza o mês existente sem duplicar</b>, avisando quantas contas mudaram. Subiu a planilha errada? Basta subir a certa por cima.' },
  { g: 'Rotina de fechamento mensal', t: 'Confira o rótulo do período', d: 'O campo do período vem <b>preenchido com o mês seguinte</b> da série — se você está reenviando o mês atual corrigido, <b>ajuste o rótulo</b> antes de confirmar, senão os dados entram como um mês novo.' },
  { g: 'Rotina de fechamento mensal', t: 'Backup mensal', d: 'Após o fechamento, clique <b>💾</b> para baixar o backup .json com todos os meses. É a proteção independente da nuvem — guarde numa pasta do Drive.' },

  { g: 'Como ler o resultado', t: 'Resultado do mês ≠ desempenho das vendas', d: 'No caixa, um mês pode fechar apertado só porque muitas contas venceram nele — e folgado porque clientes atrasados pagaram. Antes de concluir, olhe a <b>tendência de 3+ meses</b> e a aba <b>Análise</b>.' },
  { g: 'Como ler o resultado', t: 'Separe a operação do sócio', d: 'O número mais honesto da operação é o <b>Resultado Operacional</b> (aba <b>Resultado</b>): vendas menos custos, <b>antes</b> de retiradas, arrendamento e investimentos. Se a operação dá lucro mas o caixa aperta, o ajuste é nas retiradas — não na produção.' },
  { g: 'Como ler o resultado', t: 'Ponto de equilíbrio', d: 'A aba <b>Insights</b> mostra quanto é preciso <b>vender no mês para não ter prejuízo</b>. Vender acima = lucro; abaixo = prejuízo. Termos completos no <b>📖 Glossário</b>.' },
];

/* ==================================================================== */
/*  USUÁRIOS & PERMISSÕES (controle de acesso no navegador)              */
/*  ATENÇÃO: app estático/público — isto organiza acesso por usuário,    */
/*  mas NÃO é segurança real (dados em data.js são baixáveis). Para       */
/*  proteção de verdade, usar senha/Identity do Netlify.                 */
/* ==================================================================== */
const USERS_KEY = 'impresilk_dre_users';
const SESSION_KEY = 'impresilk_dre_session';
const GATEABLE_VIEWS = [
  { id: 'insights', label: '💡 Insights' },
  { id: 'overview', label: '📊 Resultado' },
  { id: 'centers',  label: '🎯 Centros' },
  { id: 'mirror',   label: '🔎 Conferência' },
  { id: 'manual',   label: '📘 Manual' },
  // sem esta linha o botão 📅 Ano nasce escondido: applyPermissions esconde
  // toda aba que não estiver na lista, e switchView recusa abrir.
  { id: 'ano',      label: '📅 Ano' },
];
const ALL_VIEW_IDS = GATEABLE_VIEWS.map(v => v.id);

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hashPass(s) { // ofuscação (djb2 + sal) — não é hash criptográfico
  let h = 5381; const str = 'impresilk::' + s;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) ^ str.charCodeAt(i); h |= 0; }
  return (h >>> 0).toString(16);
}
// Abas foram renomeadas/fundidas: buffett->overview, diretrizes/glossary->manual,
// e 'insights' passou a existir. Sem esta migração, usuário antigo perde telas.
const PERM_MIGRA = { buffett: 'overview', diretrizes: 'manual', glossary: 'manual', auditoria: 'mirror', bancos: 'mirror' };
function migraPerms(users) {
  let mudou = false;
  (users || []).forEach(u => {
    if (u.role === 'master' || !Array.isArray(u.perms)) return;
    const novas = new Set();
    u.perms.forEach(p => novas.add(PERM_MIGRA[p] || p));
    if (novas.has('overview')) novas.add('insights');   // quem via o resumo vê os insights
    const arr = [...novas].filter(p => ALL_VIEW_IDS.includes(p));
    if (arr.length !== u.perms.length || arr.some(p => !u.perms.includes(p))) { u.perms = arr; mudou = true; }
  });
  return mudou;
}

// A lista por aparelho virou resíduo: ninguém entra por ela. Apagamos o que
// estava gravado, porque guardava a "senha" embaralhada de todo mundo neste
// navegador — e embaralhamento não é hash.
try { localStorage.removeItem('impresilk_dre_users'); } catch (_) {}

function loadUsers() {
  let u = [];
  try { u = JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (_) { return []; }
  if (migraPerms(u)) { try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch (_) {} }
  return u;
}
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
  // a aba de usuários saiu: não há conta por pessoa no DRE
  // (a senha de entrada se troca pela Central de Acessos)
  document.querySelectorAll('#viewTabs button').forEach(b => {
    const v = b.dataset.view;
    const ok = v === 'users' ? false : _allowed.has(v);
    b.style.display = ok ? '' : 'none';
  });
  // O Manual voltou para a barra de abas (ao lado da Conferência); o ícone 📘
  // do topo saiu para não haver duas portas para a mesma tela.
  const ub = document.getElementById('usersBtn');
  if (ub) ub.style.display = isMaster ? '' : 'none';
  const activeBtn = document.querySelector('#viewTabs button.active');
  const cur = activeBtn ? activeBtn.dataset.view : null;
  if (!cur || !_allowed.has(cur)) {
    const first = [...document.querySelectorAll('#viewTabs button')].find(b => b.style.display !== 'none');
    if (first && _switchView) _switchView(first.dataset.view);
  }
}

/* ---------- porta de entrada ----------
   Uma senha só, conferida no servidor (auth.js -> equipe-auth). A lista de
   usuários por aparelho saiu de cena: ela morava no localStorage de cada
   navegador, com um embaralhamento que não era hash, e qualquer aparelho novo
   entrava pela tela de "criar master". */
function showAuth() {
  const overlay = document.getElementById('authOverlay');
  document.getElementById('loginForm').hidden = false;
  const dica = document.getElementById('authDica');
  if (dica) dica.hidden = false;
  overlay.hidden = false;
  document.body.classList.add('locked');
  const f = document.getElementById('loginPass');
  if (f) f.focus();
}
function hideAuth() { document.getElementById('authOverlay').hidden = true; document.body.classList.remove('locked'); }
function onAuthed() {
  if (!AUTH.temCracha()) { showAuth(); return; }
  hideAuth();
  const chip = document.getElementById('userChip');
  chip.hidden = false;
  document.getElementById('ucName').textContent = 'Impresilk';
  document.getElementById('ucRole').textContent = 'DRE';
  document.getElementById('ucAvatar').textContent = 'I';
  // Porta única: quem passou vê tudo. Não há mais permissão por pessoa, porque
  // não há mais pessoa — a senha é da equipe que alimenta o sistema.
  applyPermissions({ role: 'master' });
}
// O DRE é uma PORTA, não um quadro de gente: a senha é UMA e vale para todo
// mundo que alimenta o sistema. Por isso esta tela não diz "minha senha" --
// seria mentira: trocar aqui tranca os colegas até avisá-los. O aviso e a
// confirmação estão no texto de propósito. Quem esquecer, a Central destranca.
async function trocarSenhaDoDre() {
  const atual = prompt('Senha ATUAL do DRE:');
  if (atual === null) return;
  const nova = prompt('Senha NOVA (mínimo 6 caracteres).\n\nATENÇÃO: a senha do DRE é a MESMA para toda a equipe.\nTrocar aqui muda para todo mundo — avise quem usa.');
  if (nova === null) return;
  if (String(nova).length < 6) { alert('A senha nova precisa de ao menos 6 caracteres.'); return; }
  const rep = prompt('Repita a senha nova:');
  if (rep === null) return;
  if (nova !== rep) { alert('As duas senhas novas não são iguais.'); return; }
  if (!confirm('Confirma trocar a senha do DRE para TODA a equipe?')) return;
  try {
    await AUTH.trocarSenha(atual, nova);
    alert('Senha do DRE trocada. Avise a equipe: todos entram com a nova a partir de agora.');
  } catch (e) {
    alert(e.erro || e.message || 'Não consegui trocar a senha agora.');
  }
}

function logout() {
  // dados ainda não sincronizados se perderiam de vista — avisa antes de sair
  const pend = (typeof getQueue === 'function') ? getQueue().length : 0;
  if (pend && !confirm(`Você tem ${pend} ${pend === 1 ? 'mês pendente' : 'meses pendentes'} de sincronização.\nClique em ☁️ para sincronizar antes de sair.\n\nSair mesmo assim?`)) return;
  AUTH.esquecer();          // sem isto, o próximo a pegar o computador entra
  setSession(null);
  document.getElementById('userChip').hidden = true;
  showAuth();
}

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
  wireMubisys();
}

// Tela de integração Mubisys (dentro de Usuários, só master). O token nunca
// volta ao navegador — statusConfig traz apenas os últimos dígitos.
let _mubiWired = false;
function wireMubisys() {
  const card = document.getElementById('mubiCard');
  if (!card || typeof apiFn !== 'function') return;
  const pk = document.getElementById('mubiPublicKey');
  const tk = document.getElementById('mubiToken');
  const st = document.getElementById('mubiStatus');
  const pv = document.getElementById('mubiPreview');
  const setStatus = (msg, kind) => { st.textContent = msg; st.style.color = kind === 'err' ? 'var(--bad,#ef4444)' : kind === 'ok' ? 'var(--good,#22c55e)' : ''; };

  const carregarStatus = async () => {
    try {
      const s = await apiFn('financas', 'statusConfig');
      if (s && s.configurado) { pk.value = s.publicKey || ''; setStatus(`Configurado ✓ (token ${s.tokenMascarado})`, 'ok'); }
      else setStatus('Ainda não configurado — cole a publicKey e o Access-Token.', '');
    } catch (_) { setStatus('Não foi possível checar o status agora.', 'err'); }
  };

  if (!_mubiWired) {
    _mubiWired = true;
    document.getElementById('mubiSalvar').onclick = async () => {
      const publicKey = pk.value.trim(), accessToken = tk.value.trim();
      if (!publicKey) { setStatus('Informe a publicKey.', 'err'); return; }
      setStatus('Salvando…', '');
      try {
        const r = await apiFn('financas', 'salvarConfig', { publicKey, accessToken });
        if (r && r.ok) { tk.value = ''; toast('Credenciais do Mubisys salvas', 'ok'); carregarStatus(); }
        else setStatus('Erro ao salvar: ' + ((r && r.erro) || '—'), 'err');
      } catch (_) { setStatus('Falha de rede ao salvar.', 'err'); }
    };
    document.getElementById('mubiTestar').onclick = async () => {
      setStatus('Consultando o Mubisys…', '');
      pv.hidden = true;
      const hoje = new Date();
      const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
      const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);
      try {
        const r = await apiFn('financas', 'preview', { recurso: 'contas-pagar', datainicial: ini, datafinal: fim }, 30000);
        if (r && r.ok) {
          setStatus(`OK — ${r.total} lançamento(s) em contas a pagar no mês. Campos: ${(r.campos || []).length}`, 'ok');
          pv.textContent = 'CAMPOS DISPONÍVEIS:\n' + (r.campos || []).join(', ') + '\n\nAMOSTRA (1º item):\n' + JSON.stringify((r.amostra || [])[0] || {}, null, 2);
          pv.hidden = false;
        } else if (/\b404\b/.test(String((r && r.erro) || ''))) {
          // O Mubisys devolve 404 para PERÍODO SEM LANÇAMENTO — não é erro de
          // conexão nem de credencial. Dizer "respondeu com erro" aqui fazia o
          // teste acusar queda todo dia 1º, antes do primeiro pagamento do mês.
          setStatus('Conexão OK — o Mubisys respondeu, só não há lançamento pago neste mês ainda.', 'ok');
        } else setStatus('Mubisys respondeu com erro: ' + ((r && r.erro) || '—'), 'err');
      } catch (_) { setStatus('Falha ao consultar o Mubisys (timeout ou rede).', 'err'); }
    };
  }
  carregarStatus();
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
  buildPermChecks(_editUser ? (_editUser.perms || []) : ['insights', 'overview', 'manual']);
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
let _entrandoDre = false;
function initAuth() {
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    if (_entrandoDre) return;                 // Enter duas vezes na rede lenta
    const campo = document.getElementById('loginPass');
    const err = document.getElementById('loginErr');
    const bt = document.querySelector('#loginForm .auth-submit');
    const senha = campo.value;
    if (!senha) { err.textContent = 'Informe a senha.'; err.hidden = false; return; }
    _entrandoDre = true;
    if (bt) { bt.disabled = true; bt.textContent = 'Entrando…'; }
    try {
      await AUTH.entrar(senha);
    } catch (ex) {
      _entrandoDre = false;
      if (bt) { bt.disabled = false; bt.textContent = 'Entrar'; }
      err.textContent = (ex.status === 401 || ex.status === 403)
        ? (ex.erro || 'Senha incorreta.')
        : 'Não consegui falar com o servidor. Entrar precisa de internet uma vez.';
      err.hidden = false;
      return;
    }
    _entrandoDre = false;
    if (bt) { bt.disabled = false; bt.textContent = 'Entrar'; }
    err.hidden = true; campo.value = '';
    onAuthed();
  };
  const _setup = document.getElementById('setupForm');
  if (_setup) _setup.onsubmit = e => {
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
  const btSenha = document.getElementById('senhaBtn');
  if (btSenha) btSenha.onclick = trocarSenhaDoDre;
  document.getElementById('newUserBtn').onclick = () => openUserModal(null);
  wireUserModal();
  // A porta é o crachá do servidor. A lista por aparelho não decide mais nada.
  if (AUTH.temCracha()) {
    onAuthed();
    // confere com o servidor sem travar a tela: crachá revogado ou vencido cai fora
    AUTH.conferir().then(r => { if (r === false) { AUTH.esquecer(); showAuth(); } });
  } else showAuth();
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
    if (file.size > 10 * 1024 * 1024) { toast('Arquivo muito grande (limite 10 MB) — confira se é o export certo', 'err'); return; }
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        // A biblioteca so e buscada aqui, com o arquivo ja escolhido.
        await garantirXLSX();
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
          const ex = findExistingMonth(D, labelInput.value.trim());
          warn.hidden = !ex;
          if (ex) warn.textContent = `⚠ O período “${ex}” já existe — os dados serão atualizados (sem duplicar).`;
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
    // `let`, não `const`: quando o período já existe com outra grafia, o rótulo
    // é trocado pelo existente logo abaixo. Com const isso lançava TypeError e
    // NENHUMA atualização de mês existente funcionava — o modal até avisava
    // "os dados serão atualizados", e o confirmar sempre falhava (achado 01/08).
    let label = labelInput.value.trim();
    if (!label) { toast('Informe o período (mês/ano)', 'err'); labelInput.focus(); return; }
    try {
      const D = getCurrentData();
      // mesmo período com outra grafia ("jun/2026", "06/2026") → atualiza o existente, não duplica
      const existing = findExistingMonth(D, label);
      if (existing) label = existing;
      const merged = upsertMonth(D, label, _pendingMonth);
      const replaced = merged._replaced; delete merged._replaced;
      // se substituiu, mede o que de fato mudou; se nada mudou, não altera nem sincroniza
      let mudadas = 0;
      if (replaced) {
        const miOld = D.months.indexOf(label);
        const miNew = merged.months.indexOf(label);
        const antes = new Map(D.accounts.map(a => [a.code, round2(a.values[miOld] || 0)]));
        merged.accounts.forEach(a => { if (round2(a.values[miNew] || 0) !== (antes.get(a.code) || 0)) mudadas++; });
        if (!mudadas) { closeModal(); toast(`“${label}” já estava idêntico — nada foi alterado ✓`, 'ok'); return; }
      }
      const ts = new Date().toISOString();
      salvarLocal(merged);
      // carimba o timestamp SÓ do mês alterado e enfileira o upsert desse mês
      const tsMap = getMonthTS(); tsMap[label] = ts; setMonthTS(tsMap);
      const mi = merged.months.indexOf(label);
      if (mi >= 0) enqueueUpsert(monthRecord(merged, mi, ts));
      closeModal();
      boot(merged);
      toast(replaced
        ? `Mês atualizado: ${label} · ${mudadas} ${mudadas === 1 ? 'conta alterada' : 'contas alteradas'}`
        : `Mês adicionado: ${label} · ${merged.months.length} meses na série`, 'ok');
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
  // A faixa de lente + 4 KPIs + conciliação fala do MÊS. Ela mora FORA das
  // .view, então aparecia em toda aba — inclusive nas que perguntam outra
  // coisa. Na aba Ano punha os números do mês em cima dos números do ano, com
  // rótulos quase iguais; no Manual e na Conferência não respondia nada; e era
  // a origem do "sobrou R$ 10.358" aparecendo quatro vezes na mesma tela.
  const COM_FAIXA = new Set(['insights', 'overview', 'centers']);
  function switchView(view) {
    if (_allowed.size && !_allowed.has(view)) return; // bloqueia views sem permissão
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    // Manual/Usuários/Conferência-extras não têm botão de aba: nada a marcar
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
    const faixa = COM_FAIXA.has(view);
    ['lenteNav', 'kpis', 'concil'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = !faixa;
    });
    try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    window.dispatchEvent(new Event('resize')); // força os gráficos a recalcular tamanho
  }
  _switchView = switchView;
  tabBtns.forEach(b => b.onclick = () => switchView(b.dataset.view));
  // Abre em Insights: é a tela que responde "como foi o mês?" numa frase. O
  // HTML já marcava esse botão como ativo, mas o JS abria em Resultado — quem
  // entrava pela primeira vez caía numa tabela de 25 linhas. Quem já tem outra
  // aba salva continua nela.
  let startView = 'insights';
  try { startView = localStorage.getItem(VIEW_KEY) || 'insights'; } catch (_) {}
  switchView(startView);

  // glossário (conteúdo estático — independe dos dados)
  renderGlossary();
  renderDiretrizes();
  wireResGrupos();
  renderAuditoria();
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
  const usersBtn = document.getElementById('usersBtn');
  if (usersBtn) usersBtn.onclick = () => switchView('users');
  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) syncBtn.onclick = () => pullCloud(true);
  window.addEventListener('online', () => pullCloud());   // ao voltar a rede: drena a fila e puxa
  window.addEventListener('offline', () => setSyncState('off', 'Offline — usando dados locais'));
  if (!navigator.onLine) setSyncState('off', 'Offline — usando dados locais');
  // retentativa automática: se sobrou fila pendente (rede oscilou), tenta de novo a cada 3 min
  setInterval(() => { if (navigator.onLine && getQueue().length) trySync(); }, 3 * 60 * 1000);

  // sincronização inicial: sobe pendências da fila e puxa os meses do servidor
  pullCloud();

  // controle de acesso (login / usuários / permissões)
  initAuth();
}

document.addEventListener('DOMContentLoaded', initApp);
