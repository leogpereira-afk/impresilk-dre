/* ===========================================================
   Impresilk · Espelho da Equipe (instaladores)
   Lê os mesmos dados da gestão (localStorage + IndexedDB).
   Instalador só edita a execução e anexa fotos de check-in.
   =========================================================== */

const LS_OS = 'impresilk_inst_os', LS_CFG = 'impresilk_inst_cfg', LS_ME = 'impresilk_inst_instalador';
const DB_NAME = 'impresilk_inst', STORE = 'fotos';
const INSTALADORES_PADRAO = ['Adriano', 'Sidney', 'Douglas', 'Osmane', 'Charles'];

let lista = [], CFG = null, ME = null;
let exId = null, fotosTmp = [];

/* ---- IndexedDB ---- */
let _db = null;
function db() { return new Promise((res, rej) => { if (_db) return res(_db); const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => { _db = r.result; res(_db); }; r.onerror = () => rej(r.error); }); }
async function putFoto(id, b) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(b, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function getFoto(id) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); }); }
async function delFoto(id) { const d = await db(); return new Promise((res) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = res; }); }

/* ---- utils ---- */
function $(s) { return document.querySelector(s); }
function $all(s) { return [...document.querySelectorAll(s)]; }
function hoje() { return new Date().toISOString().slice(0, 10); }
function uid() { return Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtData(d) { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }
function iniciais(n) { return (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
function splitEquipe(s) { return (s || '').split(/\s+e\s+|,|\/|&|\+/i).map(x => x.trim()).filter(Boolean); }

/* ---- carga ---- */
function carregar() {
  CFG = JSON.parse(localStorage.getItem(LS_CFG) || '{}');
  if (!CFG.instaladores || !CFG.instaladores.length) CFG.instaladores = INSTALADORES_PADRAO.slice();
  if (!CFG.responsaveis) CFG.responsaveis = [];
  lista = JSON.parse(localStorage.getItem(LS_OS) || '[]');
  ME = localStorage.getItem(LS_ME) || null;
}
function salvarLista() { localStorage.setItem(LS_OS, JSON.stringify(lista)); }

/* ---- identidade ---- */
function renderMe() { $('#meName').textContent = ME || '—'; $('#meAvatar').textContent = ME ? iniciais(ME) : '?'; }
function abrirEscolha() {
  const arr = (CFG.instaladores || []);
  $('#meUsers').innerHTML = arr.length
    ? arr.map(n => `<button class="login-user" data-n="${esc(n)}"><span class="avatar">${iniciais(n)}</span><span><b>${esc(n)}</b><small>Instalador</small></span></button>`).join('')
    : '<p class="muted">Nenhum instalador cadastrado. Peça ao gestor para cadastrar no Painel de Controle.</p>';
  $all('#meUsers .login-user').forEach(b => b.onclick = () => { ME = b.dataset.n; localStorage.setItem(LS_ME, ME); renderMe(); $('#modalMe').hidden = true; document.body.style.overflow = ''; renderLista(); });
  $('#modalMe').hidden = false; document.body.style.overflow = 'hidden';
}

/* ---- status ---- */
function calcStatus(o) {
  if (o.finalizadaEm) return 'finalizada';
  if (o.horaSaida) return 'em_andamento';
  if (o.confirmacao === 'Confirmado') return 'confirmada';
  return 'apto';
}
const STATUS_LABEL = { apto: 'A confirmar', confirmada: 'Confirmada', em_andamento: 'Em andamento', finalizada: 'Finalizada' };

/* ---- lista ---- */
function minhas() {
  const dia = $('#meData').value;
  const q = ($('#meBusca')?.value || '').toLowerCase();
  return lista.filter(o => o.apto && splitEquipe(o.equipe).includes(ME) && (!dia || o.data === dia)
      && (!q || [o.os, o.cliente, o.servico, o.equipe].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.hora || '').localeCompare(b.hora || ''));
}
function cardHTML(o) {
  const st = calcStatus(o);
  const cls = ['os-card', 'st-' + st, o.retrabalho ? 'retrab' : ''].join(' ');
  const badges = [`<span class="badge ${st}">${STATUS_LABEL[st]}</span>`];
  if (o.confirmacao === 'Confirmado') badges.unshift(`<span class="badge confirmada">✓ Cliente confirmado</span>`);
  else badges.unshift(`<span class="badge em_andamento">⚠ ${esc(o.confirmacao)}</span>`);
  if (o.checkinFotos && o.checkinFotos.length) badges.push(`<span class="badge foto">📷 ${o.checkinFotos.length}</span>`);
  return `<div class="${cls}" data-id="${o.id}">
    <div class="os-main">
      <div class="os-top"><span class="os-num">O.S ${esc(o.os) || '—'}</span><span class="os-cliente">${esc(o.cliente) || ''}</span></div>
      <div class="os-servico">${esc(o.servico) || '—'}</div>
      <div class="os-meta">
        <span>📅 <b>${fmtData(o.data)}</b>${o.hora ? ' ' + o.hora : ''}</span>
        ${o.veiculo ? `<span>🚚 ${esc(o.veiculo)}</span>` : ''}
        ${o.endereco ? `<span>📍 ${esc(o.endereco)}</span>` : ''}
      </div>
    </div>
    <div class="os-side">${badges.join('')}</div>
  </div>`;
}
function renderLista() {
  if (!ME) { $('#meLista').innerHTML = ''; $('#meEmpty').hidden = false; return; }
  const arr = minhas();
  $('#meLista').innerHTML = arr.map(cardHTML).join('');
  $('#meEmpty').hidden = arr.length > 0;
  $all('#meLista .os-card').forEach(el => el.onclick = () => abrirExec(+el.dataset.id));
}

/* ---- modal execução ---- */
function abrirExec(id) {
  const o = lista.find(x => x.id === id); if (!o) return;
  exId = id; fotosTmp = [];
  $('#exTitulo').textContent = `O.S ${o.os || ''} — ${o.cliente || ''}`;

  const mapa = o.endereco ? `<a class="mini-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.endereco)}">📍 Abrir mapa</a>` : '';
  const contato = o.whatsapp || o.telefone;
  const zap = contato ? `<a class="mini-link" target="_blank" rel="noopener" href="https://wa.me/55${contato.replace(/\D/g, '')}">💬 WhatsApp</a>` : '';
  const ferr = (o.ferramentas && o.ferramentas.length) ? o.ferramentas.map(f => `<span class="chip on">${esc(f)}</span>`).join('') : '<span class="muted">—</span>';
  const conf = o.confirmacao === 'Confirmado'
    ? `<span class="pill good">Cliente confirmado${o.horaConfirm ? ' ' + esc(o.horaConfirm) : ''}</span>`
    : `<span class="pill bad">${esc(o.confirmacao)}</span>`;

  $('#exInfo').innerHTML = `
    <div class="ro-grid">
      <div><span class="ro-l">Serviço</span><span class="ro-v">${esc(o.servico) || '—'}</span></div>
      <div><span class="ro-l">Data / Hora</span><span class="ro-v">${fmtData(o.data)} ${esc(o.hora) || ''}</span></div>
      <div><span class="ro-l">Equipe</span><span class="ro-v">${esc(o.equipe) || '—'}</span></div>
      <div><span class="ro-l">Veículo</span><span class="ro-v">${esc(o.veiculo) || '—'}</span></div>
      <div class="col-2"><span class="ro-l">Endereço</span><span class="ro-v">${esc(o.endereco) || '—'}</span></div>
      <div><span class="ro-l">Contato</span><span class="ro-v">${esc(o.whatsapp || o.telefone) || '—'}</span></div>
      <div><span class="ro-l">Confirmação</span><span class="ro-v">${conf}</span></div>
      ${o.obsCliente ? `<div class="col-2"><span class="ro-l">Observação do cliente</span><span class="ro-v">${esc(o.obsCliente)}</span></div>` : ''}
      <div class="col-2 links">${mapa} ${zap}</div>
      <div class="col-2"><span class="ro-l">Ferramentas</span><div class="chips">${ferr}</div></div>
      <div class="col-2" id="ro-itens"></div>
      <div class="col-2" id="ro-layout"></div>
    </div>`;

  set('#x_saida', o.horaSaida); set('#x_retorno', o.horaRetorno); set('#x_ok', o.instalacaoOK);
  set('#x_conferido', o.conferido); set('#x_problema', o.problema); set('#x_obs', o.obs);
  $('#x_retrab').checked = !!o.retrabalho;
  toggleRetro(); $('#x_fotos').value = ''; $('#exError').hidden = true;
  renderItensExec(o); renderLayout(o); renderFotos(o);

  $('#modalExec').hidden = false; document.body.style.overflow = 'hidden';
}
function fecharExec() { $('#modalExec').hidden = true; document.body.style.overflow = ''; }
function set(s, v) { $(s).value = v == null ? '' : v; }
function get(s) { return $(s).value.trim(); }
function toggleRetro() { $('.modal').classList.toggle('show-retro', $('#x_retrab').checked); }

function renderItensExec(o) {
  const box = $('#ro-itens'); if (!box) return;
  const itens = Array.isArray(o.itens) ? o.itens : [];
  if (!itens.length) { box.innerHTML = ''; return; }
  const prontos = itens.filter(it => it.pronto).length;
  box.innerHTML = `
    <span class="ro-l">Itens do serviço (${prontos}/${itens.length} prontos) — marque conforme instala</span>
    <table class="itens-tab">
      <thead><tr><th>✓</th><th>#</th><th>Descrição</th><th>Medidas</th><th>Qtde</th></tr></thead>
      <tbody>${itens.map((it, i) => `
        <tr class="${it.pronto ? 'item-pronto' : ''}">
          <td><input type="checkbox" class="ex-it-chk" data-i="${i}" ${it.pronto ? 'checked' : ''}></td>
          <td>${esc(it.item || (i + 1))}</td>
          <td>${esc(it.descricao || '')}</td>
          <td>${esc(it.medidas || '')}</td>
          <td>${esc(it.qtde || '')}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  box.querySelectorAll('.ex-it-chk').forEach(c => c.onchange = () => {
    o.itens[+c.dataset.i].pronto = c.checked;
    o.atualizadoPor = ME; o.atualizadoEm = new Date().toISOString();
    salvarLista(); renderItensExec(o); renderLista();
  });
}

async function renderLayout(o) {
  const box = $('#ro-layout'); if (!box) return;
  if (!o.layoutFoto) { box.innerHTML = ''; return; }
  const b = await getFoto(o.layoutFoto); if (!b) { box.innerHTML = ''; return; }
  const src = URL.createObjectURL(b);
  box.innerHTML = `<span class="ro-l">Layout de instalação</span><div class="img-preview"><img src="${src}" alt="Layout"></div>`;
  box.querySelector('img').onclick = () => abrirLightbox(src);
}
async function renderFotos(o) {
  const box = $('#x_preview'); box.innerHTML = '';
  const itens = [];
  for (const id of (o.checkinFotos || [])) { const b = await getFoto(id); if (b) itens.push({ id, blob: b, salvo: true }); }
  for (const t of fotosTmp) itens.push({ id: t.id, blob: t.blob, salvo: false });
  for (const it of itens) {
    const src = URL.createObjectURL(it.blob);
    const div = document.createElement('div'); div.className = 'thumb';
    div.innerHTML = `<img src="${src}" alt="Check-in"><button class="del">✕</button>`;
    div.querySelector('img').onclick = () => abrirLightbox(src);
    div.querySelector('.del').onclick = () => {
      if (it.salvo) { o.checkinFotos = o.checkinFotos.filter(x => x !== it.id); delFoto(it.id); salvarLista(); }
      else fotosTmp = fotosTmp.filter(x => x.id !== it.id);
      renderFotos(o);
    };
    box.appendChild(div);
  }
}
function abrirLightbox(src) { $('#lbImg').src = src; $('#lightbox').hidden = false; }

/* ---- salvar / finalizar ---- */
function coletarExec(o) {
  o.horaSaida = get('#x_saida'); o.horaRetorno = get('#x_retorno'); o.instalacaoOK = get('#x_ok');
  o.conferido = get('#x_conferido'); o.retrabalho = $('#x_retrab').checked; o.problema = get('#x_problema');
  o.obs = get('#x_obs');
  o.atualizadoPor = ME; o.atualizadoEm = new Date().toISOString();
}
function exErro(m) { const e = $('#exError'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

async function salvarExec(finalizar) {
  const o = lista.find(x => x.id === exId); if (!o) return;
  // Regra crítica do POP: não registrar saída sem o cliente confirmado pela gestão.
  if (get('#x_saida') && o.confirmacao !== 'Confirmado') return exErro('Não registre a saída: o cliente ainda não foi confirmado pela gestão (regra crítica do POP).');
  if (finalizar) {
    const total = (o.checkinFotos ? o.checkinFotos.length : 0) + fotosTmp.length;
    if (o.confirmacao !== 'Confirmado') return exErro('Não pode finalizar: o cliente ainda não foi confirmado pela gestão (regra do POP).');
    if (!get('#x_ok')) return exErro('Informe se a instalação ficou OK.');
    if (!get('#x_conferido')) return exErro('Informe quem conferiu.');
    if (total === 0) return exErro('Anexe ao menos 1 foto de check-in para finalizar.');
    if ($('#x_retrab').checked && !get('#x_problema')) return exErro('Descreva o problema do retrabalho.');
  }
  coletarExec(o);
  for (const t of fotosTmp) { await putFoto(t.id, t.blob); (o.checkinFotos = o.checkinFotos || []).push(t.id); }
  fotosTmp = [];
  if (finalizar) { o.finalizadaEm = new Date().toISOString(); o.finalizadoPor = ME; }
  salvarLista(); renderLista();
  if (finalizar) { fecharExec(); flash('Instalação finalizada ✓'); }
  else { renderFotos(o); flash('Salvo'); }
}

/* ---- toast ---- */
let flashT;
function flash(msg) {
  let el = $('#flash');
  if (!el) { el = document.createElement('div'); el.id = 'flash'; document.body.appendChild(el); el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1c2430;color:#fff;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:600;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.3);transition:.2s;opacity:0'; }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(flashT); flashT = setTimeout(() => el.style.opacity = '0', 2200);
}

/* ---- eventos ---- */
function init() {
  $('#meData').value = hoje();
  $('#meData').onchange = renderLista;
  $('#meBusca').oninput = renderLista;
  $('#meChip').onclick = abrirEscolha;
  $('#exFechar').onclick = fecharExec;
  $('#modalExec').onclick = e => { if (e.target.id === 'modalExec') fecharExec(); };
  $('#exSalvar').onclick = () => salvarExec(false);
  $('#exFinalizar').onclick = () => salvarExec(true);
  $('#x_retrab').onchange = toggleRetro;
  $('#x_fotos').onchange = e => { [...e.target.files].forEach(f => fotosTmp.push({ id: uid(), blob: f })); e.target.value = ''; const o = lista.find(x => x.id === exId); renderFotos(o); };
  $('#lbClose').onclick = () => $('#lightbox').hidden = true;
  $('#lightbox').onclick = e => { if (e.target.id === 'lightbox') $('#lightbox').hidden = true; };
  document.onkeydown = e => { if (e.key === 'Escape') { $('#lightbox').hidden = true; if (!$('#modalExec').hidden) fecharExec(); } };
  $('#dl_resp').innerHTML = (CFG.responsaveis || []).map(v => `<option value="${esc(v)}">`).join('');
}

carregar();
init();
renderMe();
renderLista();
if (!ME) abrirEscolha();
