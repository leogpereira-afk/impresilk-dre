/* ===========================================================
   Impresilk · Controle de Instalação
   App estático: dados/config/usuário em localStorage, fotos em IndexedDB.
   =========================================================== */

/* ---------- Config padrão (da planilha LISTAS) ---------- */
const CFG_PADRAO = {
  veiculos: ['Strada Fire Flex 50', 'Strada Fire Flex 20', 'Uno Mille 10', 'Serviço Interno'],
  instaladores: ['Adriano', 'Sidney', 'Douglas', 'Osmane', 'Charles'],
  responsaveis: ['Saulo Rodrigues Ferreira', 'Adriano Nunes', 'Adriano Pinheiro', 'Osmane'],
  ferramentas: ['Furadeira', 'Parafusadeira', 'Escada', 'Andaime', 'Nível a laser', 'Trena',
    'Rebitadeira', 'Chave de fenda', 'Martelo', 'Silicone / Cola', 'Soprador térmico',
    'Espátula', 'Gerador', 'Extensão elétrica', 'EPIs (capacete, luvas, óculos, cinto)'],
  usuarios: [
    { id: 'u0', nome: 'Administrador', papel: 'Admin', senha: 'admin' },
    { id: 'u1', nome: 'Saulo Rodrigues Ferreira', papel: 'Operação' },
    { id: 'u2', nome: 'Adriano Nunes', papel: 'Montagem' },
    { id: 'u3', nome: 'Adriano Pinheiro', papel: 'Montagem' },
    { id: 'u4', nome: 'PCP', papel: 'PCP' },
    { id: 'u5', nome: 'Comercial', papel: 'Comercial', senha: 'comercial' },
  ],
};

/* ---------- Permissões por papel ---------- */
const PERMISSOES = {
  Admin:     { abas: ['painel', 'pcp', 'programacao', 'execucao', 'retrabalho', 'controle', 'instrucoes'], editar: true, cadastrar: true },
  Operação:  { abas: ['painel', 'pcp', 'programacao', 'execucao', 'retrabalho', 'instrucoes'], editar: true, cadastrar: false },
  Montagem:  { abas: ['painel', 'pcp', 'programacao', 'execucao', 'retrabalho', 'instrucoes'], editar: true, cadastrar: false },
  PCP:       { abas: ['painel', 'pcp', 'programacao', 'execucao', 'retrabalho', 'instrucoes'], editar: true, cadastrar: false },
  Comercial: { abas: ['painel', 'pcp', 'programacao', 'execucao', 'instrucoes'], editar: false, cadastrar: false },
};
function perm() { return PERMISSOES[USER && USER.papel] || PERMISSOES['Operação']; }

/* ---------- Dados de exemplo (da aba PROGRAMAÇÃO) ---------- */
const SEED = [
  { os: '00000', data: '2026-06-22', cliente: 'Clínica Carol - Shopping', servico: 'A confirmar', equipe: 'Adriano e Sidney', veiculo: 'Strada Fire Flex 50', hora: '07:30' },
  { os: '22165', data: '2026-06-22', cliente: 'Cardio Pulmonar', servico: 'Higienização letras', equipe: 'Adriano e Douglas', veiculo: 'Strada Fire Flex 20', hora: '07:30' },
  { os: '22342', data: '2026-06-22', cliente: 'Fio Laser', servico: 'Adesivo jateado', equipe: 'Osmane e Charles', veiculo: 'Uno Mille 10', hora: '07:30' },
  { os: '22262', data: '2026-06-22', cliente: 'Guilherme Folgado', servico: 'Letreiros', equipe: 'Adriano e Douglas', veiculo: 'Strada Fire Flex 20', hora: '13:10' },
  { os: '22386', data: '2026-06-22', cliente: 'Ciclos Lavanderia', servico: 'Plotagem interno', equipe: 'Osmane e Charles', veiculo: 'Serviço Interno', hora: '' },
];

/* ===========================================================
   IndexedDB (fotos)
   =========================================================== */
const DB_NAME = 'impresilk_inst', STORE = 'fotos';
let _db = null;
function db() {
  return new Promise((res, rej) => {
    if (_db) return res(_db);
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
async function putFoto(id, blob) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function getFoto(id) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); }); }
async function delFoto(id) { const d = await db(); return new Promise((res) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = res; }); }

/* ===========================================================
   Estado (localStorage)
   =========================================================== */
const LS_OS = 'impresilk_inst_os', LS_CFG = 'impresilk_inst_cfg', LS_USER = 'impresilk_inst_user';
let lista = [], CFG = null, USER = null;

function carregarCfg() {
  const raw = localStorage.getItem(LS_CFG);
  CFG = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(CFG_PADRAO));
  // garante chaves
  for (const k in CFG_PADRAO) if (!CFG[k]) CFG[k] = JSON.parse(JSON.stringify(CFG_PADRAO[k]));
  // garante usuários de acesso protegido (Admin / Comercial) em bases já existentes
  ['u0', 'u5'].forEach(id => {
    if (!CFG.usuarios.some(u => u.id === id)) {
      const seed = CFG_PADRAO.usuarios.find(u => u.id === id);
      if (seed) CFG.usuarios.push(JSON.parse(JSON.stringify(seed)));
    }
  });
  salvarCfg(); // persiste para o espelho da equipe ler as listas
}
function salvarCfg() { localStorage.setItem(LS_CFG, JSON.stringify(CFG)); }

function carregar() {
  const raw = localStorage.getItem(LS_OS);
  if (raw) {
    const arr = JSON.parse(raw);
    // normaliza registros antigos: garante campos novos e libera os legados p/ instalação
    lista = arr.map(o => {
      const legado = o.dataEntrada === undefined;
      const reg = novoRegistro(o, o.id);
      if (legado) { reg.apto = true; reg.dataLiberacao = reg.dataLiberacao || reg.data; }
      return reg;
    });
    salvar();
    return;
  }
  lista = SEED.map((s, i) => novoRegistro({ ...s, apto: true, dataLiberacao: s.data }, Date.now() + i));
  salvar();
}
function salvar() { localStorage.setItem(LS_OS, JSON.stringify(lista)); }

function novoRegistro(d = {}, id = Date.now()) {
  return Object.assign({
    id, os: '', data: hoje(), duracaoDias: 1, cliente: '', servico: '', equipe: '', veiculo: '',
    hora: '', endereco: '', telefone: '', whatsapp: '', obsCliente: '', itens: [], ferramentas: [], acesso: '', fixacao: '', layoutFoto: null,
    dataEntrada: hoje(), material: false, medida: false, dataLiberacao: '', responsavelPcp: '',
    apto: false, aptoPor: '', aptoEm: null,
    gerenteInstalacao: '',
    gerenteMontagem: '', ferramentasConferidas: false, embarqueFotos: [],
    carroLiberado: false, carroLiberadoPor: '', carroLiberadoEm: null,
    horaCheckout: '', checkoutOk: false, checkoutPor: '', checkoutSituacao: '', checkoutObs: '',
    confirmacao: 'Pendente', canal: '', horaConfirm: '', confirmadoPor: '', confirmObs: '',
    horaSaida: '', horaRetorno: '', instalacaoOK: '', conferido: '',
    retrabalho: false, problema: '', quemResolveu: '', dataResolvida: '',
    obs: '', checkinFotos: [], finalizadoPor: '', finalizadaEm: null,
    criadoPor: USER ? USER.nome : '', criadoEm: new Date().toISOString(),
    atualizadoPor: '', atualizadoEm: null,
  }, d);
}

/* ===========================================================
   Utils
   =========================================================== */
function hoje() { return new Date().toISOString().slice(0, 10); }
function agoraHora() { return new Date().toTimeString().slice(0, 5); }
function fmtData(d) { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }
function fmtDataHora(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toTimeString().slice(0, 5); }
function $(s) { return document.querySelector(s); }
function $all(s) { return [...document.querySelectorAll(s)]; }
function uid() { return Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const STATUS_LABEL = { aguardando_producao: 'Aguardando PCP', apto: 'Apto p/ instalação', agendada: 'Agendada', confirmada: 'Confirmada', em_andamento: 'Em andamento', finalizada: 'Finalizada' };

function calcStatus(o) {
  if (o.finalizadaEm) return 'finalizada';
  if (o.horaSaida) return 'em_andamento';
  if (o.confirmacao === 'Confirmado') return 'confirmada';
  if (o.apto && o.data && o.equipe) return 'agendada';
  if (o.apto) return 'apto';
  return 'aguardando_producao';
}
function splitEquipe(s) { return (s || '').split(/\s+e\s+|,|\/|&|\+/i).map(x => x.trim()).filter(Boolean); }
function horasExec(o) {
  if (!o.horaSaida || !o.horaRetorno) return null;
  const [h1, m1] = o.horaSaida.split(':').map(Number), [h2, m2] = o.horaRetorno.split(':').map(Number);
  let d = (h2 * 60 + m2) - (h1 * 60 + m1); if (d < 0) d += 1440;
  return d / 60;
}
function fmtHoras(h) { if (h == null) return '—'; const t = Math.round(h * 60); return `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}`; }

/* ---- datas / spans (calendário) ---- */
function isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDias(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return isoLocal(dt); }
function fimSpan(o) { return addDias(o.data, Math.max(1, o.duracaoDias || 1) - 1); }
function spanOcupa(o, dia) { return !!o.data && dia >= o.data && dia <= fimSpan(o); }

/* ===========================================================
   Usuário / login
   =========================================================== */
function carregarUser() { const raw = localStorage.getItem(LS_USER); USER = raw ? JSON.parse(raw) : null; }
function setUser(u) { USER = u; localStorage.setItem(LS_USER, JSON.stringify(u)); renderUserChip(); }
function iniciais(nome) { return (nome || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
function renderUserChip() {
  $('#userName').textContent = USER ? USER.nome : '—';
  $('#userRole').textContent = USER ? USER.papel : '—';
  $('#userAvatar').textContent = USER ? iniciais(USER.nome) : '?';
}
function abrirLogin() {
  const box = $('#loginUsers');
  box.innerHTML = CFG.usuarios.map(u =>
    `<button class="login-user" data-id="${u.id}"><span class="avatar">${iniciais(u.nome)}</span><span><b>${esc(u.nome)}</b><small>${esc(u.papel)}</small></span>${u.senha ? '<span class="lock">🔒</span>' : ''}</button>`
  ).join('');
  $('#loginSenha').hidden = true; $('#loginUsers').hidden = false;
  $all('#loginUsers .login-user').forEach(b => b.onclick = () => {
    const u = CFG.usuarios.find(x => x.id === b.dataset.id);
    if (u.senha) pedirSenha(u);
    else fazerLogin(u);
  });
  $('#modalLogin').hidden = false; document.body.style.overflow = 'hidden';
}
function pedirSenha(u) {
  $('#loginUsers').hidden = true;
  const p = $('#loginSenha'); p.hidden = false;
  $('#loginSenhaNome').textContent = `${u.nome} · ${u.papel}`;
  $('#loginSenhaInput').value = ''; $('#loginSenhaErro').hidden = true;
  $('#loginSenhaInput').focus();
  $('#loginSenhaOk').onclick = () => {
    if ($('#loginSenhaInput').value === u.senha) fazerLogin(u);
    else { $('#loginSenhaErro').hidden = false; $('#loginSenhaInput').focus(); }
  };
  $('#loginSenhaInput').onkeydown = e => { if (e.key === 'Enter') $('#loginSenhaOk').click(); };
  $('#loginSenhaVoltar').onclick = abrirLogin;
}
function fazerLogin(u) {
  setUser(u);
  $('#modalLogin').hidden = true; document.body.style.overflow = '';
  aplicarPermissoes(); renderTudo();
}
function aplicarPermissoes() {
  const p = perm();
  $all('.tab').forEach(t => { t.hidden = !p.abas.includes(t.dataset.tab); });
  const ativa = $('.tab.active');
  if (!ativa || ativa.hidden) { const primeira = $all('.tab').find(t => !t.hidden); if (primeira) primeira.click(); }
  const editar = p.editar;
  $('#btnNova').style.display = editar ? '' : 'none';
  $('#btnNovaPcp').style.display = editar ? '' : 'none';
  const dd = $('#ddNova'); if (dd) dd.style.display = editar ? '' : 'none';
  document.body.classList.toggle('somente-leitura', !editar);
}

/* ===========================================================
   Painel: filtros + KPIs + estatísticas
   =========================================================== */
let modoPainel = 'dia';

function registrosNoPeriodo() {
  if (modoPainel === 'dia') {
    const dia = $('#filtroData').value || hoje();
    return lista.filter(o => o.data === dia);
  }
  const de = $('#filtroDe').value, ate = $('#filtroAte').value;
  return lista.filter(o => o.data && (!de || o.data >= de) && (!ate || o.data <= ate));
}

function renderPainel() {
  const arr = registrosNoPeriodo();
  const n = arr.length;
  const confirmadas = arr.filter(o => o.confirmacao === 'Confirmado').length;
  const pendentes = arr.filter(o => o.confirmacao !== 'Confirmado').length;
  const aptas = arr.filter(o => o.apto).length;
  const ok = arr.filter(o => o.instalacaoOK === 'Sim').length;
  const parciais = arr.filter(o => o.instalacaoOK === 'Parcial').length;
  const finalizadas = arr.filter(o => o.finalizadaEm).length;
  const retrab = arr.filter(o => o.retrabalho).length;
  const comFoto = arr.filter(o => o.checkinFotos.length).length;
  const horas = arr.map(horasExec).filter(h => h != null);
  const mediaHoras = horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : null;

  const cards = [
    { l: 'O.S no período', v: n },
    { l: 'Aptas (PCP liberou)', v: aptas },
    { l: 'Confirmadas c/ cliente', v: confirmadas, c: 'ok' },
    { l: 'Pendentes de confirmação', v: pendentes, c: pendentes ? 'warn' : '' },
    { l: 'Finalizadas', v: finalizadas, c: 'ok' },
    { l: 'Instalações parciais', v: parciais, c: parciais ? 'warn' : '' },
    { l: 'Com retrabalho', v: retrab, c: retrab ? 'bad' : '' },
    { l: 'Média h execução', v: fmtHoras(mediaHoras) },
  ];
  $('#cards').innerHTML = cards.map(k => `<div class="kpi ${k.c || ''}"><div class="v">${k.v}</div><div class="l">${k.l}</div></div>`).join('');

  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const inds = [
    { l: '% Instalações OK', v: pct(ok, n) },
    { l: '% Com retrabalho', v: pct(retrab, n) },
    { l: '% Check-in enviado', v: pct(comFoto, n) },
    { l: '% Finalizadas', v: pct(finalizadas, n) },
  ];
  $('#indicadores').innerHTML = inds.map(i => `<div class="bar-wrap"><div class="l"><span>${i.l}</span><b>${i.v}%</b></div><div class="bar"><i style="width:${i.v}%"></i></div></div>`).join('');

  renderEstatisticasEquipe(arr);
}

function renderEstatisticasEquipe(arr) {
  const map = {};
  arr.forEach(o => {
    const h = horasExec(o);
    splitEquipe(o.equipe).forEach(nome => {
      const m = map[nome] || (map[nome] = { nome, prog: 0, fin: 0, retr: 0, foto: 0, horas: [] });
      m.prog++;
      if (o.finalizadaEm) m.fin++;
      if (o.retrabalho) m.retr++;
      if (o.checkinFotos.length) m.foto++;
      if (h != null) m.horas.push(h);
    });
  });
  const linhas = Object.values(map).sort((a, b) => b.fin - a.fin || a.retr - b.retr);
  const tb = $('#tabelaEquipes').querySelector('tbody');
  if (!linhas.length) { tb.innerHTML = ''; $('#emptyEquipes').hidden = false; $('#tabelaEquipes').hidden = true; return; }
  $('#emptyEquipes').hidden = true; $('#tabelaEquipes').hidden = false;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  tb.innerHTML = linhas.map((m, i) => {
    const tx = pct(m.retr, m.prog);
    const medal = i === 0 ? '🏆 ' : '';
    const mh = m.horas.length ? m.horas.reduce((a, b) => a + b, 0) / m.horas.length : null;
    return `<tr>
      <td>${medal}${esc(m.nome)}</td>
      <td>${m.prog}</td>
      <td><b>${m.fin}</b></td>
      <td>${m.retr}</td>
      <td><span class="pill ${tx === 0 ? 'good' : tx > 25 ? 'bad' : 'mid'}">${tx}%</span></td>
      <td>${pct(m.foto, m.prog)}%</td>
      <td>${fmtHoras(mh)}</td>
    </tr>`;
  }).join('');
}

/* ===========================================================
   Cards de O.S
   =========================================================== */
function osCardHTML(o) {
  const st = calcStatus(o);
  const cls = ['os-card', 'st-' + st, o.retrabalho ? 'retrab' : ''].join(' ');
  const badges = [`<span class="badge ${st}">${STATUS_LABEL[st]}</span>`];
  if (o.retrabalho) badges.unshift(`<span class="badge retrab">⚠ Retrabalho</span>`);
  if (o.apto) badges.push(`<span class="badge apto">✓ Apto</span>`);
  if (o.checkinFotos.length) badges.push(`<span class="badge foto">📷 ${o.checkinFotos.length}</span>`);
  const quem = o.atualizadoPor || o.criadoPor;
  return `<div class="${cls}" data-id="${o.id}">
    <div class="os-main">
      <div class="os-top"><span class="os-num">O.S ${esc(o.os) || '—'}</span><span class="os-cliente">${esc(o.cliente) || 'Sem cliente'}</span></div>
      <div class="os-servico">${esc(o.servico) || '—'}</div>
      <div class="os-meta">
        <span>📅 <b>${fmtData(o.data)}</b>${o.hora ? ' ' + o.hora : ''}</span>
        ${o.equipe ? `<span>👷 <b>${esc(o.equipe)}</b></span>` : ''}
        ${o.veiculo ? `<span>🚚 ${esc(o.veiculo)}</span>` : ''}
        ${(o.whatsapp || o.telefone) ? `<span>📞 ${esc(o.whatsapp || o.telefone)}</span>` : ''}
        ${quem ? `<span>✍️ ${esc(quem)}</span>` : ''}
      </div>
    </div>
    <div class="os-side">${badges.join('')}</div>
  </div>`;
}
function bindCards(sel) { $all(sel + ' .os-card').forEach(el => el.onclick = () => abrirModal(+el.dataset.id)); }

function progFiltradas() {
  const q = ($('#busca').value || '').toLowerCase();
  const fs = $('#filtroStatus').value;
  const dia = $('#progData').value;
  let arr = lista.filter(o => o.apto); // só liberadas pelo PCP
  if (dia) arr = arr.filter(o => o.data === dia);
  if (q) arr = arr.filter(o => [o.os, o.cliente, o.servico, o.equipe].join(' ').toLowerCase().includes(q));
  if (fs) arr = arr.filter(o => calcStatus(o) === fs);
  return arr.sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.hora || '').localeCompare(b.hora || ''));
}
function renderLista() {
  const arr = progFiltradas();
  $('#listaOS').innerHTML = arr.map(osCardHTML).join('');
  $('#emptyLista').hidden = arr.length > 0;
  bindCards('#listaOS');
}
/* ---- Calendário da Instalação ---- */
let progView = 'calendario';
let calRef = new Date(); calRef.setDate(1);
let diaSel = null;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function aptasOrdenadas() {
  const q = ($('#calBusca')?.value || '').toLowerCase();
  return lista.filter(o => o.apto && buscaMatch(o, q)).sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.hora || '').localeCompare(b.hora || ''));
}

function renderCalendario() {
  $('#calTitulo').textContent = `${MESES[calRef.getMonth()]} ${calRef.getFullYear()}`;
  const ini = new Date(calRef.getFullYear(), calRef.getMonth(), 1);
  const inicioGrade = new Date(ini); inicioGrade.setDate(1 - ini.getDay()); // domingo anterior
  const hojeIso = hoje();
  const mesAtual = calRef.getMonth();
  const aptas = aptasOrdenadas();

  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicioGrade); d.setDate(inicioGrade.getDate() + i);
    const iso = isoLocal(d);
    const doMes = d.getMonth() === mesAtual;
    const noDia = aptas.filter(o => spanOcupa(o, iso));
    const cls = ['cal-cell', doMes ? '' : 'fora', iso === hojeIso ? 'hoje' : '', iso === diaSel ? 'sel' : '', noDia.length ? 'tem' : ''].join(' ');
    const chips = noDia.slice(0, 3).map(o => {
      const st = calcStatus(o);
      const ini2 = o.data === iso, fim2 = fimSpan(o) === iso, multi = (o.duracaoDias || 1) > 1;
      const pos = multi ? (ini2 ? 'span-ini' : fim2 ? 'span-fim' : 'span-mid') : '';
      const rot = o.retrabalho ? '⚠ ' : '';
      return `<span class="cal-chip ${st} ${pos}" title="${esc(o.cliente)}">${rot}${esc(o.hora ? o.hora + ' ' : '')}${esc(o.cliente || ('O.S ' + o.os))}</span>`;
    }).join('');
    const mais = noDia.length > 3 ? `<span class="cal-mais">+${noDia.length - 3}</span>` : '';
    html += `<div class="${cls}" data-dia="${iso}"><span class="cal-num">${d.getDate()}</span>${chips}${mais}</div>`;
  }
  $('#calGrid').innerHTML = html;
  $all('#calGrid .cal-cell').forEach(c => c.onclick = () => { diaSel = c.dataset.dia; renderCalendario(); renderDiaDetalhe(); });
  renderDiaDetalhe();
}

function osDoDia(iso) {
  return aptasOrdenadas().filter(o => spanOcupa(o, iso));
}
function renderDiaDetalhe() {
  const box = $('#diaDetalhe');
  if (!diaSel) { box.hidden = true; return; }
  box.hidden = false;
  $('#ddTitulo').textContent = fmtData(diaSel);
  const arr = osDoDia(diaSel);
  $('#ddLista').innerHTML = arr.map(osCardHTML).join('');
  $('#ddEmpty').hidden = arr.length > 0;
  bindCards('#ddLista');
}

function aplicarProgView() {
  $('#progCalView').hidden = progView !== 'calendario';
  $('#progListView').hidden = progView !== 'lista';
  if (progView === 'calendario') renderCalendario(); else renderLista();
}

function buscaMatch(o, q) { return !q || [o.os, o.cliente, o.servico, o.equipe, o.veiculo].join(' ').toLowerCase().includes(q); }
function renderRetrabalho() {
  const q = ($('#retrabBusca')?.value || '').toLowerCase();
  const arr = lista.filter(o => o.retrabalho && buscaMatch(o, q)).sort((a, b) => (a.dataResolvida ? 1 : 0) - (b.dataResolvida ? 1 : 0));
  $('#listaRetrabalho').innerHTML = arr.map(osCardHTML).join('');
  $('#emptyRetrabalho').hidden = arr.length > 0;
  bindCards('#listaRetrabalho');
}
/* ===========================================================
   Execução — o que está na rua + liberação de carros
   =========================================================== */
function execNaRua(o) { return !o.finalizadaEm && (o.carroLiberado || o.horaSaida) && !o.horaRetorno; }
function execStatus(o) {
  if (o.horaRetorno) return { cls: 'volta', txt: '↩ De volta' };
  if (execNaRua(o)) return { cls: 'rua', txt: '🚚 Na rua' };
  if (o.carroLiberado) return { cls: 'lib', txt: '🚚 Carro liberado' };
  return { cls: 'aguarda', txt: '⏳ Aguardando saída' };
}
function execCardHTML(o) {
  const st = calcStatus(o);
  const es = execStatus(o);
  const cls = ['os-card', 'exec-card', 'st-' + st, execNaRua(o) ? 'na-rua' : '', o.retrabalho ? 'retrab' : ''].join(' ');
  let acts;
  if (!o.carroLiberado) {
    acts = `<button class="btn small primary exec-act" data-act="liberar" data-id="${o.id}">🚚 Liberar carro</button>`;
  } else if (!o.horaRetorno) {
    acts = `<span class="exec-stamp">🚚 Liberado${o.carroLiberadoPor ? ' por ' + esc(o.carroLiberadoPor) : ''}${o.carroLiberadoEm ? ' · ' + fmtDataHora(o.carroLiberadoEm) : ''}</span>
            <button class="btn small exec-act" data-act="checkout" data-id="${o.id}">↩ Check-out na volta</button>`;
  } else {
    acts = `<span class="exec-stamp ok">✔ De volta${o.horaRetorno ? ' · ' + esc(o.horaRetorno) : ''}</span>`;
  }
  return `<div class="${cls}" data-id="${o.id}">
    <div class="os-main">
      <div class="os-top"><span class="os-num">O.S ${esc(o.os) || '—'}</span><span class="os-cliente">${esc(o.cliente) || 'Sem cliente'}</span></div>
      <div class="os-servico">${esc(o.servico) || '—'}</div>
      <div class="os-meta">
        <span>📅 <b>${fmtData(o.data)}</b>${o.hora ? ' ' + o.hora : ''}</span>
        ${o.equipe ? `<span>👷 <b>${esc(o.equipe)}</b></span>` : ''}
        ${o.veiculo ? `<span>🚚 ${esc(o.veiculo)}</span>` : ''}
        ${o.gerenteMontagem ? `<span>🧰 ${esc(o.gerenteMontagem)}</span>` : ''}
      </div>
      <div class="exec-actions">${acts}</div>
    </div>
    <div class="os-side"><span class="badge exec-${es.cls}">${es.txt}</span><span class="badge ${st}">${STATUS_LABEL[st]}</span></div>
  </div>`;
}
function execFiltradas() {
  const q = ($('#execBusca')?.value || '').toLowerCase();
  const dia = $('#execData')?.value;
  let arr = lista.filter(o => o.apto && !o.finalizadaEm);
  if (dia) arr = arr.filter(o => o.data === dia);
  if (q) arr = arr.filter(o => buscaMatch(o, q));
  const rank = o => execNaRua(o) ? 0 : (o.carroLiberado && !o.horaRetorno ? 1 : (o.horaRetorno ? 3 : 2));
  return arr.sort((a, b) => rank(a) - rank(b) || (a.data || '').localeCompare(b.data || '') || (a.hora || '').localeCompare(b.hora || ''));
}
function renderExecucao() {
  const arr = execFiltradas();
  $('#listaExecucao').innerHTML = arr.map(execCardHTML).join('');
  $('#emptyExecucao').hidden = arr.length > 0;
  const naRua = arr.filter(execNaRua).length;
  const aLiberar = arr.filter(o => !o.carroLiberado).length;
  $('#execResumo').textContent = `${arr.length} em execução · ${naRua} na rua · ${aLiberar} aguardando liberação`;
  $all('#listaExecucao .exec-card').forEach(el => {
    el.onclick = e => {
      const act = e.target.closest('.exec-act');
      if (act) { e.stopPropagation(); execAcao(act.dataset.act, +act.dataset.id); return; }
      abrirModal(+el.dataset.id);
    };
  });
}
function execAcao(act, id) {
  if (!USER) return abrirLogin();
  if (!perm().editar) { flash('Sem permissão para editar'); return; }
  const o = lista.find(x => x.id === id); if (!o) return;
  if (act === 'liberar') liberarCarroOS(o);
  else if (act === 'checkout') checkoutOS(o);
}
function liberarCarroOS(o) {
  if (o.confirmacao !== 'Confirmado') { flash('Confirme o cliente antes de liberar o carro (regra crítica do POP)'); return; }
  o.carroLiberado = true; o.carroLiberadoPor = USER.nome; o.carroLiberadoEm = new Date().toISOString();
  o.atualizadoPor = USER.nome; o.atualizadoEm = new Date().toISOString();
  salvar(); renderTudo();
  flash('Carro liberado para a O.S ' + (o.os || ''));
}
function checkoutOS(o) {
  if (!o.horaRetorno) o.horaRetorno = agoraHora();
  o.checkoutOk = true; o.checkoutPor = USER.nome; if (!o.horaCheckout) o.horaCheckout = agoraHora();
  o.atualizadoPor = USER.nome; o.atualizadoEm = new Date().toISOString();
  salvar(); renderTudo();
  flash('Check-out registrado — O.S ' + (o.os || ''));
}

let modoPcp = 'pendente', pcpModo = 'dia';
function pcpDataRef(o) { return modoPcp === 'apto' ? (o.dataLiberacao || o.data) : (o.dataEntrada || o.data); }
function renderPcp() {
  const q = ($('#pcpBusca')?.value || '').toLowerCase();
  let arr = lista.filter(o => (modoPcp === 'pendente' ? !o.apto && !o.finalizadaEm : o.apto) && buscaMatch(o, q));
  if (pcpModo === 'dia') {
    const d = $('#pcpData').value;
    if (d) arr = arr.filter(o => pcpDataRef(o) === d);
  } else {
    const de = $('#pcpDe').value, ate = $('#pcpAte').value;
    arr = arr.filter(o => { const f = pcpDataRef(o); return (!de || f >= de) && (!ate || f <= ate); });
  }
  arr.sort((a, b) => (pcpDataRef(a) || '').localeCompare(pcpDataRef(b) || ''));
  $('#listaPcp').innerHTML = arr.map(osCardHTML).join('');
  $('#emptyPcp').hidden = arr.length > 0;
  bindCards('#listaPcp');
}

function renderTudo() { renderPainel(); if (progView === 'calendario') renderCalendario(); else renderLista(); renderExecucao(); renderRetrabalho(); renderPcp(); }

/* ===========================================================
   Painel de Controle (config)
   =========================================================== */
function renderControle() {
  $all('.ctrl-card').forEach(card => {
    const key = card.dataset.cfg;
    const ul = card.querySelector('.ctrl-list');
    if (key === 'usuarios') {
      ul.innerHTML = CFG.usuarios.map(u =>
        `<li><span>${esc(u.nome)} <small class="tag">${esc(u.papel)}</small>${u.senha ? ' 🔒' : ''}</span><button class="del-x" data-id="${u.id}" title="Remover">✕</button></li>`
      ).join('');
      ul.querySelectorAll('.del-x').forEach(b => b.onclick = () => { CFG.usuarios = CFG.usuarios.filter(x => x.id !== b.dataset.id); salvarCfg(); renderControle(); refreshDatalists(); });
    } else {
      ul.innerHTML = CFG[key].map((v, i) =>
        `<li><span>${esc(v)}</span><button class="del-x" data-i="${i}" title="Remover">✕</button></li>`
      ).join('');
      ul.querySelectorAll('.del-x').forEach(b => b.onclick = () => { CFG[key].splice(+b.dataset.i, 1); salvarCfg(); renderControle(); refreshDatalists(); });
    }
  });
}
function initControle() {
  $all('.ctrl-card').forEach(card => {
    const key = card.dataset.cfg;
    const inp = card.querySelector('.ctrl-add input');
    const btn = card.querySelector('.ctrl-add button');
    const senhaInp = card.querySelector('.senha-add');
    const add = () => {
      const v = inp.value.trim(); if (!v) return;
      if (key === 'usuarios') {
        const papel = card.querySelector('.papel-sel').value;
        const senha = (senhaInp?.value || '').trim();
        if ((papel === 'Admin' || papel === 'Comercial') && !senha) { flash('Defina uma senha para ' + papel); return; }
        const u = { id: uid(), nome: v, papel };
        if (senha) u.senha = senha;
        CFG.usuarios.push(u);
        if (senhaInp) senhaInp.value = '';
      }
      else if (!CFG[key].includes(v)) CFG[key].push(v);
      inp.value = ''; salvarCfg(); renderControle(); refreshDatalists();
    };
    btn.onclick = add;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    if (senhaInp) senhaInp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  });
}
function refreshDatalists() {
  $('#dl_veiculos').innerHTML = CFG.veiculos.map(v => `<option value="${esc(v)}">`).join('');
  $('#dl_instaladores').innerHTML = CFG.instaladores.map(v => `<option value="${esc(v)}">`).join('');
  $('#dl_responsaveis').innerHTML = CFG.responsaveis.map(v => `<option value="${esc(v)}">`).join('');
  $('#dl_usuarios').innerHTML = CFG.usuarios.map(v => `<option value="${esc(v.nome)}">`).join('');
}

/* ===========================================================
   Modal O.S
   =========================================================== */
let editId = null, ferramentasSel = [], layoutTmp = null, checkinTmp = [], layoutRemovido = false, aptoTmp = null, embarqueTmp = [], carroTmp = null, itensSel = [], modalOrigem = '';

/* Etapas do modal: ordem sequencial + a qual grupo (aba) cada quadrante pertence.
   PCP edita 1·2·3, Instalação edita 4·5 (agendamento+confirmação), Execução edita 6·7 (embarque/carro + execução).
   Cada etapa só libera quando a anterior está concluída. */
const FS_ORDEM = { pcp: 1, ferr: 2, itens: 3, agenda: 4, conf: 5, emb: 6, exec: 7 };
const FS_GRUPO = { pcp: 'pcp', ferr: 'pcp', itens: 'pcp', agenda: 'instalacao', conf: 'instalacao', emb: 'execucao', exec: 'execucao' };
const ORIGEM_GRUPO = { pcp: 'pcp', programacao: 'instalacao', execucao: 'execucao', retrabalho: 'execucao' };
function abaAtiva() { const v = document.querySelector('.view.active'); return v ? v.id : ''; }
function etapaLiberada(key) {
  const ord = FS_ORDEM[key];
  const prevDone = Object.keys(FS_ORDEM).filter(k => FS_ORDEM[k] < ord).every(k => fsDone(k));
  // Handoff: para editar Instalação/Confirmação/Execução, o PCP precisa ter LIBERADO a O.S (apto).
  if (FS_GRUPO[key] !== 'pcp' && !(aptoTmp && aptoTmp.apto)) return false;
  return prevDone;
}
function fsEditavel(key) {
  if (!perm().editar) return false;
  if (!editId) return true;                 // O.S nova: tudo liberado para o cadastro inicial
  const grupo = ORIGEM_GRUPO[modalOrigem];
  if (grupo && FS_GRUPO[key] !== grupo) return false;  // só edita os quadrantes da aba de origem
  return etapaLiberada(key);                // e só depois de concluir a etapa anterior
}

function abrirModal(id, origem) {
  const o = id ? lista.find(x => x.id === id) : null;
  editId = id || null;
  modalOrigem = origem || abaAtiva();
  ferramentasSel = o ? [...o.ferramentas] : [];
  itensSel = o && Array.isArray(o.itens) ? o.itens.map(it => ({ ...it })) : [];
  layoutTmp = null; checkinTmp = []; layoutRemovido = false; embarqueTmp = [];
  aptoTmp = o ? { apto: o.apto, aptoPor: o.aptoPor, aptoEm: o.aptoEm } : { apto: false, aptoPor: '', aptoEm: null };
  carroTmp = o ? { lib: o.carroLiberado, por: o.carroLiberadoPor, em: o.carroLiberadoEm } : { lib: false, por: '', em: null };

  $('#modalTitulo').textContent = o ? `O.S ${o.os || ''} — ${o.cliente || ''}` : 'Nova O.S';
  $('#btnExcluir').hidden = !o;
  $('#btnPdfOS').hidden = !o;

  set('#f_os', o?.os); set('#f_data', o?.data || hoje()); set('#f_hora', o?.hora);
  set('#f_duracao', o?.duracaoDias || 1);
  set('#f_cliente', o?.cliente); set('#f_servico', o?.servico); set('#f_equipe', o?.equipe);
  set('#f_veiculo', o?.veiculo); set('#f_endereco', o?.endereco);
  set('#f_whatsapp', o?.whatsapp); set('#f_obsCliente', o?.obsCliente);
  set('#f_dataEntrada', o?.dataEntrada || hoje()); set('#f_dataLiberacao', o?.dataLiberacao);
  set('#f_responsavelPcp', o?.responsavelPcp); set('#f_gerenteInstalacao', o?.gerenteInstalacao);
  set('#f_gerenteMontagem', o?.gerenteMontagem); set('#f_horaCheckout', o?.horaCheckout); set('#f_checkoutPor', o?.checkoutPor);
  set('#f_checkoutSituacao', o?.checkoutSituacao); set('#f_checkoutObs', o?.checkoutObs);
  $('#f_ferramentasConferidas').checked = !!o?.ferramentasConferidas;
  $('#f_checkoutOk').checked = !!o?.checkoutOk;
  $('#f_carroLiberado').checked = carroTmp.lib;
  $('#f_embarque').value = '';
  set('#f_confirmacao', o?.confirmacao || 'Pendente'); set('#f_canal', o?.canal);
  set('#f_horaConfirm', o?.horaConfirm); set('#f_confirmadoPor', o?.confirmadoPor); set('#f_confirmObs', o?.confirmObs);
  set('#f_horaSaida', o?.horaSaida);
  set('#f_horaRetorno', o?.horaRetorno); set('#f_instalacaoOK', o?.instalacaoOK);
  set('#f_conferido', o?.conferido); set('#f_problema', o?.problema);
  set('#f_quemResolveu', o?.quemResolveu); set('#f_dataResolvida', o?.dataResolvida); set('#f_obs', o?.obs);
  $('#f_retrabalho').checked = !!o?.retrabalho;
  set('#f_acesso', o?.acesso); set('#f_fixacao', o?.fixacao);
  $('#f_novaFerramenta').value = ''; $('#f_layout').value = ''; $('#f_checkin').value = '';
  $('#formError').hidden = true;

  toggleRetrab(); renderFerramentas(); renderItens(); renderLayoutPreview(o); renderCheckinPreview(o); renderEmbarquePreview(o);
  atualizarLinks(); renderCarroStamp(); renderAptoStamp(); renderAudit(o);
  atualizarFieldsets();
  // ao abrir uma O.S existente, recolhe os quadrantes já concluídos para visão geral
  $all('#modalOS .card-fs').forEach(fs => fs.classList.toggle('collapsed', !!o && fsDone(fs.dataset.fs)));
  aplicarLeituraModal();

  $('#modalOS').hidden = false; document.body.style.overflow = 'hidden';
}
function aplicarLeituraModal() {
  const ro = !perm().editar;
  $('#btnSalvar').hidden = ro; $('#btnFinalizar').hidden = ro; $('#btnExcluir').hidden = ro || !editId;
  $('#modalOS .modal').classList.toggle('ro-modal', ro);
}
/* Habilita/bloqueia cada quadrante conforme a aba de origem e o avanço sequencial das etapas. */
function aplicarEtapasModal() {
  const podeEditar = perm().editar;
  $all('#modalOS .card-fs').forEach(fs => {
    const key = fs.dataset.fs;
    const edit = fsEditavel(key);
    const liberada = !editId || etapaLiberada(key);
    fs.classList.toggle('etapa-bloq', podeEditar && !!editId && !liberada);
    fs.classList.toggle('etapa-ro', podeEditar && !!editId && liberada && !edit);
    fs.querySelectorAll('input, select, textarea, button').forEach(el => { el.disabled = !edit; });
  });
}
function fecharModal() { $('#modalOS').hidden = true; document.body.style.overflow = ''; }
function set(sel, v) { $(sel).value = v == null ? '' : v; }
function get(sel) { return $(sel).value.trim(); }
function toggleRetrab() { $('.modal').classList.toggle('has-retrab', $('#f_retrabalho').checked); }

function renderCarroStamp() {
  const el = $('#carroStamp');
  if (carroTmp.lib && carroTmp.por) el.textContent = `Carro liberado por ${carroTmp.por} em ${fmtDataHora(carroTmp.em)}`;
  else el.textContent = carroTmp.lib ? 'Carro liberado' : 'Carro ainda não liberado pela montagem';
}
/* ---- Liberação para instalação (PCP) — ação explícita ---- */
function renderAptoStamp() {
  const el = $('#aptoStamp');
  if (el) {
    if (aptoTmp && aptoTmp.apto) el.textContent = `✓ Liberada para instalação por ${aptoTmp.aptoPor || '—'}${aptoTmp.aptoEm ? ' em ' + fmtDataHora(aptoTmp.aptoEm) : ''}`;
    else el.textContent = 'Ainda não liberada. Preencha o PCP e clique em “Liberar para instalação”.';
  }
  const b = $('#btnLiberarInstalacao'), c = $('#btnCancelarLiberacao');
  if (b) b.hidden = !!(aptoTmp && aptoTmp.apto);
  if (c) c.hidden = !(aptoTmp && aptoTmp.apto);
}
function marcarApto(val) {
  if (val) {
    if (!(get('#f_os') && get('#f_cliente') && get('#f_servico') && get('#f_responsavelPcp'))) {
      flash('Preencha O.S, cliente, serviço e responsável antes de liberar'); return false;
    }
    aptoTmp = { apto: true, aptoPor: USER ? USER.nome : '', aptoEm: new Date().toISOString() };
    if (!get('#f_dataLiberacao')) set('#f_dataLiberacao', hoje());
  } else {
    aptoTmp = { apto: false, aptoPor: '', aptoEm: null };
  }
  renderAptoStamp(); atualizarFieldsets();
  return true;
}
/* ---- Quadrantes: verde quando preenchidos + recolher ---- */
function fsDone(key) {
  switch (key) {
    case 'pcp': return !!(get('#f_os') && get('#f_cliente') && get('#f_servico') && get('#f_responsavelPcp'));
    case 'ferr': return !!(get('#f_acesso') && get('#f_fixacao'));
    case 'itens': return itensSel.length > 0;
    case 'agenda': return !!(get('#f_data') && get('#f_equipe'));
    case 'conf': return get('#f_confirmacao') === 'Confirmado';
    case 'emb': return !!(carroTmp && carroTmp.lib);
    case 'exec': return !!(get('#f_instalacaoOK') && get('#f_conferido'));
  }
  return false;
}
function atualizarFieldsets() {
  $all('#modalOS .card-fs').forEach(fs => fs.classList.toggle('done', fsDone(fs.dataset.fs)));
  aplicarEtapasModal();
}
async function renderEmbarquePreview(o) {
  const box = $('#embarquePreview'); box.innerHTML = '';
  const itens = [];
  if (o) for (const id of o.embarqueFotos) { const b = await getFoto(id); if (b) itens.push({ id, blob: b, salvo: true }); }
  for (const t of embarqueTmp) itens.push({ id: t.id, blob: t.blob, salvo: false });
  for (const it of itens) {
    const src = URL.createObjectURL(it.blob);
    const div = document.createElement('div'); div.className = 'thumb';
    div.innerHTML = `<img src="${src}" alt="Embarque"><button class="del" title="Remover">✕</button>`;
    div.querySelector('img').onclick = () => abrirLightbox(src);
    div.querySelector('.del').onclick = () => removerEmbarque(it, o);
    box.appendChild(div);
  }
}
function removerEmbarque(it, o) {
  if (it.salvo && o) { o.embarqueFotos = o.embarqueFotos.filter(x => x !== it.id); delFoto(it.id); salvar(); }
  else embarqueTmp = embarqueTmp.filter(x => x.id !== it.id);
  renderEmbarquePreview(o);
}
function renderAudit(o) {
  if (!o) { $('#auditInfo').textContent = USER ? `Será criada por ${USER.nome} (${USER.papel}).` : ''; return; }
  let t = `Criada por ${o.criadoPor || '—'} em ${fmtDataHora(o.criadoEm)}.`;
  if (o.atualizadoPor) t += ` Última edição: ${o.atualizadoPor} em ${fmtDataHora(o.atualizadoEm)}.`;
  if (o.finalizadoPor) t += ` Finalizada por ${o.finalizadoPor}.`;
  $('#auditInfo').textContent = t;
}

/* ---- Ferramentas ---- */
function renderFerramentas() {
  const todas = [...new Set([...CFG.ferramentas, ...ferramentasSel])];
  $('#ferramentasChips').innerHTML = todas.map(f => {
    const on = ferramentasSel.includes(f);
    return `<span class="chip ${on ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}${on ? ' <span class="x">✓</span>' : ''}</span>`;
  }).join('');
  $all('#ferramentasChips .chip').forEach(ch => ch.onclick = () => {
    const f = ch.dataset.f, i = ferramentasSel.indexOf(f);
    if (i >= 0) ferramentasSel.splice(i, 1); else ferramentasSel.push(f);
    renderFerramentas();
  });
}

/* ---- Itens do serviço ---- */
function renderItens() {
  const box = $('#itensLista'); if (!box) return;
  if (!itensSel.length) {
    box.innerHTML = '<div class="itens-vazio">Nenhum item. Importe a O.S em PDF ou adicione manualmente.</div>';
  } else {
    const prontos = itensSel.filter(it => it.pronto).length;
    box.innerHTML = `
      <div class="itens-resumo">${prontos}/${itensSel.length} itens prontos</div>
      <table class="itens-tab">
        <thead><tr><th>✓</th><th>#</th><th>Descrição</th><th>Medidas</th><th>Qtde</th><th></th></tr></thead>
        <tbody>${itensSel.map((it, i) => `
          <tr class="${it.pronto ? 'item-pronto' : ''}">
            <td><input type="checkbox" class="it-chk" data-i="${i}" ${it.pronto ? 'checked' : ''}></td>
            <td>${esc(it.item || (i + 1))}</td>
            <td><input class="input it-desc" data-i="${i}" value="${esc(it.descricao || '')}"></td>
            <td><input class="input it-med" data-i="${i}" value="${esc(it.medidas || '')}"></td>
            <td><input class="input it-qtd" data-i="${i}" value="${esc(it.qtde || '')}" style="max-width:60px"></td>
            <td><button type="button" class="btn ghost it-del" data-i="${i}" title="Remover">✕</button></td>
          </tr>`).join('')}</tbody>
      </table>`;
    $all('#itensLista .it-chk').forEach(c => c.onchange = () => { itensSel[+c.dataset.i].pronto = c.checked; renderItens(); });
    $all('#itensLista .it-desc').forEach(c => c.oninput = () => itensSel[+c.dataset.i].descricao = c.value);
    $all('#itensLista .it-med').forEach(c => c.oninput = () => itensSel[+c.dataset.i].medidas = c.value);
    $all('#itensLista .it-qtd').forEach(c => c.oninput = () => itensSel[+c.dataset.i].qtde = c.value);
    $all('#itensLista .it-del').forEach(c => c.onclick = () => { itensSel.splice(+c.dataset.i, 1); renderItens(); });
  }
  if (typeof aplicarEtapasModal === 'function' && USER) aplicarEtapasModal();
}
function addItemManual() {
  itensSel.push({ item: itensSel.length + 1, descricao: '', medidas: '', qtde: '', valorUnit: '', subtotal: '', pronto: false });
  renderItens();
}

/* ---- Layout ---- */
async function renderLayoutPreview(o) {
  const box = $('#layoutPreview'); box.innerHTML = '';
  let src = null;
  if (layoutTmp) src = URL.createObjectURL(layoutTmp.blob);
  else if (o?.layoutFoto && !layoutRemovido) { const b = await getFoto(o.layoutFoto); if (b) src = URL.createObjectURL(b); }
  if (!src) return;
  box.innerHTML = `<div class="thumb"><img src="${src}" alt="Layout"><button class="del" title="Remover">✕</button></div>`;
  box.querySelector('img').onclick = () => abrirLightbox(src);
  box.querySelector('.del').onclick = () => { layoutTmp = null; layoutRemovido = true; renderLayoutPreview(o); };
}

/* ---- Check-in ---- */
async function renderCheckinPreview(o) {
  const box = $('#checkinPreview'); box.innerHTML = '';
  const itens = [];
  if (o) for (const id of o.checkinFotos) { const b = await getFoto(id); if (b) itens.push({ id, blob: b, salvo: true }); }
  for (const t of checkinTmp) itens.push({ id: t.id, blob: t.blob, salvo: false });
  for (const it of itens) {
    const src = URL.createObjectURL(it.blob);
    const div = document.createElement('div'); div.className = 'thumb';
    div.innerHTML = `<img src="${src}" alt="Check-in"><button class="del" title="Remover">✕</button>`;
    div.querySelector('img').onclick = () => abrirLightbox(src);
    div.querySelector('.del').onclick = () => removerCheckin(it, o);
    box.appendChild(div);
  }
}
function removerCheckin(it, o) {
  if (it.salvo && o) { o.checkinFotos = o.checkinFotos.filter(x => x !== it.id); delFoto(it.id); salvar(); }
  else checkinTmp = checkinTmp.filter(x => x.id !== it.id);
  renderCheckinPreview(o);
}

function abrirLightbox(src) { $('#lbImg').src = src; $('#lightbox').hidden = false; }

function atualizarLinks() {
  const end = get('#f_endereco'), tel = get('#f_whatsapp');
  const mapa = $('#lnkMapa'), zap = $('#lnkZap');
  if (end) { mapa.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(end); mapa.setAttribute('aria-disabled', 'false'); } else mapa.setAttribute('aria-disabled', 'true');
  const num = tel.replace(/\D/g, '');
  if (num) { zap.href = 'https://wa.me/55' + num; zap.setAttribute('aria-disabled', 'false'); } else zap.setAttribute('aria-disabled', 'true');
}

/* ===========================================================
   Salvar / validar
   =========================================================== */
function coletar() {
  // A liberação (apto) é uma ação EXPLÍCITA do PCP (botão "Liberar para instalação"), guardada em aptoTmp.
  const resp = get('#f_responsavelPcp');
  const aptoNow = !!(aptoTmp && aptoTmp.apto);
  return {
    os: get('#f_os'), data: get('#f_data'), hora: get('#f_hora'),
    duracaoDias: Math.max(1, parseInt($('#f_duracao').value, 10) || 1),
    cliente: get('#f_cliente'), servico: get('#f_servico'), equipe: get('#f_equipe'),
    veiculo: get('#f_veiculo'), endereco: get('#f_endereco'),
    whatsapp: get('#f_whatsapp'), obsCliente: get('#f_obsCliente'),
    dataEntrada: get('#f_dataEntrada'),
    dataLiberacao: get('#f_dataLiberacao') || (aptoNow ? hoje() : ''), responsavelPcp: resp,
    apto: aptoNow, aptoPor: aptoNow ? (aptoTmp.aptoPor || resp) : '', aptoEm: aptoNow ? (aptoTmp.aptoEm || new Date().toISOString()) : null,
    gerenteInstalacao: get('#f_gerenteInstalacao'),
    gerenteMontagem: get('#f_gerenteMontagem'), ferramentasConferidas: $('#f_ferramentasConferidas').checked,
    carroLiberado: carroTmp.lib, carroLiberadoPor: carroTmp.por, carroLiberadoEm: carroTmp.em,
    horaCheckout: get('#f_horaCheckout'), checkoutOk: $('#f_checkoutOk').checked, checkoutPor: get('#f_checkoutPor'),
    checkoutSituacao: get('#f_checkoutSituacao'), checkoutObs: get('#f_checkoutObs'),
    confirmacao: get('#f_confirmacao'), canal: get('#f_canal'), horaConfirm: get('#f_horaConfirm'),
    confirmadoPor: get('#f_confirmadoPor'), confirmObs: get('#f_confirmObs'),
    horaSaida: get('#f_horaSaida'), horaRetorno: get('#f_horaRetorno'),
    instalacaoOK: get('#f_instalacaoOK'), conferido: get('#f_conferido'),
    retrabalho: $('#f_retrabalho').checked, problema: get('#f_problema'),
    quemResolveu: get('#f_quemResolveu'), dataResolvida: get('#f_dataResolvida'),
    obs: get('#f_obs'), ferramentas: [...ferramentasSel],
    acesso: get('#f_acesso'), fixacao: get('#f_fixacao'),
    itens: itensSel.map(it => ({ ...it })),
  };
}
function erro(msg) { const e = $('#formError'); e.textContent = msg; e.hidden = false; e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
function validarBasico(d) {
  if (!d.os) return 'Informe o número da O.S.';
  if (!d.data) return 'Informe a data.';
  if (!d.cliente) return 'Informe o cliente / local.';
  if (!d.servico) return 'Informe o serviço.';
  return null;
}
function validarFinalizar(d, o) {
  const totalFotos = (o ? o.checkinFotos.length : 0) + checkinTmp.length;
  if (!d.apto) return 'Não é possível finalizar: o PCP ainda não marcou o serviço como APTO para instalação.';
  if (d.confirmacao !== 'Confirmado') return 'Não é possível finalizar: a confirmação com o cliente precisa estar "Confirmado" (regra crítica do POP).';
  if (!d.instalacaoOK) return 'Informe se a instalação ficou OK (Sim, Parcial ou Não).';
  if (!d.conferido) return 'Informe quem conferiu o retorno.';
  if (totalFotos === 0) return 'Obrigatório anexar ao menos 1 foto de check-in para finalizar.';
  if (d.retrabalho && !d.problema) return 'Há retrabalho marcado: descreva o problema / causa.';
  return null;
}
async function persistirFotos(o) {
  if (layoutRemovido && o.layoutFoto && !layoutTmp) { await delFoto(o.layoutFoto); o.layoutFoto = null; }
  if (layoutTmp) { if (o.layoutFoto) await delFoto(o.layoutFoto); await putFoto(layoutTmp.id, layoutTmp.blob); o.layoutFoto = layoutTmp.id; }
  for (const t of checkinTmp) { await putFoto(t.id, t.blob); o.checkinFotos.push(t.id); }
  for (const t of embarqueTmp) { await putFoto(t.id, t.blob); o.embarqueFotos.push(t.id); }
}

async function salvarOS(finalizar) {
  if (!USER) { abrirLogin(); return; }
  const d = coletar();
  let err = validarBasico(d);
  if (!err && finalizar) err = validarFinalizar(d, editId ? lista.find(x => x.id === editId) : { checkinFotos: [] });
  if (err) { erro(err); return; }

  let o = editId ? lista.find(x => x.id === editId) : null;
  const novo = !o;
  if (!o) { o = novoRegistro({}, Date.now()); lista.push(o); editId = o.id; }
  Object.assign(o, d);
  if (!novo) { o.atualizadoPor = USER.nome; o.atualizadoEm = new Date().toISOString(); }

  await persistirFotos(o);
  layoutTmp = null; checkinTmp = []; layoutRemovido = false; embarqueTmp = [];

  if (finalizar) { o.finalizadaEm = new Date().toISOString(); o.finalizadoPor = USER.nome; }

  salvar(); renderTudo();
  if (finalizar) { fecharModal(); flash('O.S finalizada com sucesso ✓'); }
  else { renderLayoutPreview(o); renderCheckinPreview(o); renderEmbarquePreview(o); renderAudit(o); $('#btnExcluir').hidden = false; $('#btnPdfOS').hidden = false; flash('Rascunho salvo'); }
}

function excluirOS() {
  if (!editId) return;
  if (!confirm('Excluir esta O.S? Esta ação não pode ser desfeita.')) return;
  const o = lista.find(x => x.id === editId);
  if (o) { if (o.layoutFoto) delFoto(o.layoutFoto); o.checkinFotos.forEach(delFoto); (o.embarqueFotos || []).forEach(delFoto); }
  lista = lista.filter(x => x.id !== editId);
  salvar(); renderTudo(); fecharModal(); flash('O.S excluída');
}

/* ---- toast ---- */
let flashT;
function flash(msg) {
  let el = $('#flash');
  if (!el) { el = document.createElement('div'); el.id = 'flash'; document.body.appendChild(el);
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1c2430;color:#fff;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:600;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.3);transition:.2s;opacity:0'; }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(flashT); flashT = setTimeout(() => el.style.opacity = '0', 2200);
}

/* ===========================================================
   Eventos
   =========================================================== */
function initEventos() {
  $all('.tab').forEach(t => t.onclick = () => {
    $all('.tab').forEach(x => x.classList.remove('active'));
    $all('.view').forEach(x => x.classList.remove('active'));
    t.classList.add('active'); $('#' + t.dataset.tab).classList.add('active');
  });

  $('#btnNova').onclick = () => { if (!USER) return abrirLogin(); abrirModal(null); };
  $('#btnNovaPcp').onclick = () => { if (!USER) return abrirLogin(); abrirModal(null); };
  $('#userChip').onclick = abrirLogin;
  $('#btnFechar').onclick = fecharModal;
  $('#modalOS').onclick = e => { if (e.target.id === 'modalOS') fecharModal(); };
  $('#btnSalvar').onclick = () => salvarOS(false);
  $('#btnFinalizar').onclick = () => salvarOS(true);
  $('#btnExcluir').onclick = excluirOS;
  $('#btnPdfOS').onclick = () => exportarPDFFicha(editId ? lista.find(x => x.id === editId) : null);

  $('#f_retrabalho').onchange = toggleRetrab;
  $('#f_endereco').oninput = atualizarLinks;
  $('#f_whatsapp').oninput = atualizarLinks;

  // liberação para instalação (PCP) — ação explícita
  $('#btnLiberarInstalacao').onclick = () => { if (!USER) return abrirLogin(); if (marcarApto(true)) salvarOS(false); };
  $('#btnCancelarLiberacao').onclick = () => { if (!USER) return abrirLogin(); marcarApto(false); salvarOS(false); };

  // carro liberado (Gerente de Montagem) — bloqueado sem confirmação do cliente (POP)
  const marcarCarro = (val) => {
    if (val && get('#f_confirmacao') !== 'Confirmado') {
      $('#f_carroLiberado').checked = false;
      flash('Confirme o cliente antes de liberar o carro (regra crítica do POP)');
      return;
    }
    carroTmp.lib = val;
    if (val) { carroTmp.por = USER ? USER.nome : ''; carroTmp.em = new Date().toISOString(); }
    else { carroTmp.por = ''; carroTmp.em = null; }
    renderCarroStamp(); atualizarFieldsets();
  };
  $('#f_carroLiberado').onchange = e => marcarCarro(e.target.checked);
  $('#btnLiberarCarroEu').onclick = () => { if (!USER) return abrirLogin(); $('#f_carroLiberado').checked = true; marcarCarro(true); if ($('#f_carroLiberado').checked) flash('Carro liberado'); };

  // confirmação com o cliente (regra do POP) — independente da liberação interna do PCP
  $('#btnConfirmarEu').onclick = () => {
    if (!USER) return abrirLogin();
    set('#f_confirmacao', 'Confirmado');
    set('#f_confirmadoPor', USER.nome); if (!get('#f_horaConfirm')) set('#f_horaConfirm', agoraHora());
    atualizarFieldsets(); flash('Confirmação registrada');
  };

  // recolher/expandir quadrante ao clicar no título + marcar verde ao preencher
  $all('#modalOS .card-fs > legend').forEach(lg => lg.onclick = () => lg.parentElement.classList.toggle('collapsed'));
  const mb = $('#modalOS .modal-body');
  if (mb) { mb.addEventListener('input', atualizarFieldsets); mb.addEventListener('change', atualizarFieldsets); }

  $('#btnAddFerramenta').onclick = () => {
    const v = $('#f_novaFerramenta').value.trim();
    if (v && !ferramentasSel.includes(v)) ferramentasSel.push(v);
    $('#f_novaFerramenta').value = ''; renderFerramentas();
  };
  $('#f_novaFerramenta').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#btnAddFerramenta').click(); } };

  // itens do orçamento + importação de PDF da O.S
  $('#btnAddItem').onclick = () => addItemManual();
  $('#btnImportItensPdf').onclick = () => $('#fileImportItens').click();
  $('#fileImportItens').onchange = e => { const f = e.target.files[0]; if (f) importarOSPdf(f, false); e.target.value = ''; };
  $('#btnImportar').onclick = () => { if (!USER) return abrirLogin(); $('#fileImportPdf').click(); };
  $('#fileImportPdf').onchange = e => { const f = e.target.files[0]; if (f) importarOSPdf(f, true); e.target.value = ''; };

  $('#f_layout').onchange = e => { const f = e.target.files[0]; if (!f) return; layoutTmp = { id: uid(), blob: f }; layoutRemovido = false; renderLayoutPreview(editId ? lista.find(x => x.id === editId) : null); };
  $('#f_checkin').onchange = e => { [...e.target.files].forEach(f => checkinTmp.push({ id: uid(), blob: f })); e.target.value = ''; renderCheckinPreview(editId ? lista.find(x => x.id === editId) : null); };
  $('#f_embarque').onchange = e => { [...e.target.files].forEach(f => embarqueTmp.push({ id: uid(), blob: f })); e.target.value = ''; renderEmbarquePreview(editId ? lista.find(x => x.id === editId) : null); };

  $('#lbClose').onclick = () => $('#lightbox').hidden = true;
  $('#lightbox').onclick = e => { if (e.target.id === 'lightbox') $('#lightbox').hidden = true; };
  document.onkeydown = e => { if (e.key === 'Escape') { $('#lightbox').hidden = true; if (!$('#modalOS').hidden) fecharModal(); } };

  // painel: modo dia/periodo
  $all('#segModo .seg-btn').forEach(b => b.onclick = () => {
    $all('#segModo .seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
    modoPainel = b.dataset.modo;
    const per = modoPainel === 'periodo';
    $('#campoDia').classList.toggle('hidden', per);
    $('#campoDe').classList.toggle('hidden', !per);
    $('#campoAte').classList.toggle('hidden', !per);
    $('#quickPeriodos').classList.toggle('hidden', !per);
    renderPainel();
  });
  $('#filtroData').value = hoje();
  $('#pcpData').value = hoje();
  $('#progData').value = hoje();
  diaSel = hoje();
  $('#filtroData').onchange = renderPainel;
  $('#filtroDe').onchange = renderPainel;
  $('#filtroAte').onchange = renderPainel;
  $all('#quickPeriodos [data-q]').forEach(b => b.onclick = () => {
    let de, ate = new Date();
    if (b.dataset.q === 'mes') de = new Date(ate.getFullYear(), ate.getMonth(), 1);
    else if (b.dataset.q === 'ano') { de = new Date(ate.getFullYear(), 0, 1); ate = new Date(ate.getFullYear(), 11, 31); }
    else { de = new Date(); de.setDate(ate.getDate() - (+b.dataset.q - 1)); }
    $('#filtroDe').value = de.toISOString().slice(0, 10);
    $('#filtroAte').value = ate.toISOString().slice(0, 10);
    renderPainel();
  });
  // seletor de ano
  const anoSel = $('#filtroAno'); const anoAtual = new Date().getFullYear();
  let anosOpt = '<option value="">Ano…</option>';
  for (let y = anoAtual + 1; y >= anoAtual - 4; y--) anosOpt += `<option value="${y}">${y}</option>`;
  anoSel.innerHTML = anosOpt;
  anoSel.onchange = () => {
    if (!anoSel.value) return;
    $('#filtroDe').value = `${anoSel.value}-01-01`;
    $('#filtroAte').value = `${anoSel.value}-12-31`;
    renderPainel();
  };

  // pcp tabs
  $all('#segPcp .seg-btn').forEach(b => b.onclick = () => {
    $all('#segPcp .seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
    modoPcp = b.dataset.pcp; renderPcp();
  });
  // pcp filtro dia/periodo
  $all('#segPcpModo .seg-btn').forEach(b => b.onclick = () => {
    $all('#segPcpModo .seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
    pcpModo = b.dataset.pm;
    const per = pcpModo === 'periodo';
    $('#pcpCampoDia').classList.toggle('hidden', per);
    $('#pcpCampoDe').classList.toggle('hidden', !per);
    $('#pcpCampoAte').classList.toggle('hidden', !per);
    $('#pcpQuick').classList.toggle('hidden', !per);
    renderPcp();
  });
  $('#pcpData').onchange = renderPcp;
  $('#pcpDe').onchange = renderPcp;
  $('#pcpAte').onchange = renderPcp;
  $all('#pcpQuick [data-q]').forEach(b => b.onclick = () => {
    const ate = new Date(); let de = new Date();
    if (b.dataset.q === 'mes') de = new Date(ate.getFullYear(), ate.getMonth(), 1);
    else de.setDate(ate.getDate() - (+b.dataset.q - 1));
    $('#pcpDe').value = de.toISOString().slice(0, 10);
    $('#pcpAte').value = ate.toISOString().slice(0, 10);
    renderPcp();
  });
  $('#pcpLimpar').onclick = () => { $('#pcpData').value = ''; $('#pcpDe').value = ''; $('#pcpAte').value = ''; renderPcp(); };
  $('#pcpBusca').oninput = renderPcp;
  $('#retrabBusca').oninput = renderRetrabalho;
  $('#execBusca').oninput = renderExecucao;
  $('#execData').onchange = renderExecucao;

  $('#busca').oninput = renderLista;
  $('#filtroStatus').onchange = renderLista;
  $('#progData').onchange = renderLista;
  $('#btnPDF').onclick = exportarPDF;
  $('#btnZap').onclick = exportarWhatsApp;

  // instalação: alternar calendário / lista
  $all('#segProgView .seg-btn').forEach(b => b.onclick = () => {
    $all('#segProgView .seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
    progView = b.dataset.pv; aplicarProgView();
  });
  // navegação do calendário
  $('#calBusca').oninput = renderCalendario;
  $('#calPrev').onclick = () => { calRef.setMonth(calRef.getMonth() - 1); renderCalendario(); };
  $('#calNext').onclick = () => { calRef.setMonth(calRef.getMonth() + 1); renderCalendario(); };
  $('#calHoje').onclick = () => { calRef = new Date(); calRef.setDate(1); diaSel = hoje(); renderCalendario(); };
  // ações do dia selecionado
  $('#ddNova').onclick = () => {
    if (!USER) return abrirLogin();
    abrirModal(null);
    if (diaSel) { set('#f_data', diaSel); if (!get('#f_responsavelPcp')) set('#f_responsavelPcp', USER.nome); aptoTmp = { apto: true, aptoPor: USER.nome, aptoEm: new Date().toISOString() }; renderAptoStamp(); atualizarFieldsets(); }
  };
  $('#ddPDF').onclick = () => { if (diaSel) exportarPDFDe(osDoDia(diaSel), fmtData(diaSel)); };
  $('#ddZap').onclick = () => { if (diaSel) exportarWhatsAppDe(osDoDia(diaSel), fmtData(diaSel)); };
}

/* ===========================================================
   Exportações (PDF + WhatsApp) da Instalação
   =========================================================== */
function tituloDia() { const d = $('#progData').value; return d ? fmtData(d) : 'Todas as datas'; }

function exportarWhatsApp() { exportarWhatsAppDe(progFiltradas(), tituloDia()); }
function exportarPDF() { exportarPDFDe(progFiltradas(), tituloDia()); }

function exportarWhatsAppDe(arr, titulo) {
  if (!arr.length) { flash('Nenhuma O.S para exportar'); return; }
  let t = `*PROGRAMAÇÃO DE INSTALAÇÃO — IMPRESILK*\n${titulo}\n`;
  t += `_POP: confirmar o horário com o cliente antes de sair._\n\n`;
  arr.forEach(o => {
    t += `🔧 *O.S ${o.os || '—'}* — ${o.cliente || ''}\n`;
    t += `🕒 ${o.hora || 'a confirmar'}  |  📅 ${fmtData(o.data)}\n`;
    t += `• Serviço: ${o.servico || '—'}\n`;
    if (o.equipe) t += `• Equipe: ${o.equipe}\n`;
    if (o.veiculo) t += `• Veículo: ${o.veiculo}\n`;
    if ((o.duracaoDias || 1) > 1) t += `• Duração: ${o.duracaoDias} dias (até ${fmtData(fimSpan(o))})\n`;
    if (o.endereco) t += `• Local: ${o.endereco}\n`;
    if (o.whatsapp || o.telefone) t += `• Contato: ${o.whatsapp || o.telefone}\n`;
    t += `• Confirmação: ${o.confirmacao}\n`;
    if (o.ferramentas && o.ferramentas.length) t += `• Ferramentas: ${o.ferramentas.join(', ')}\n`;
    if (o.obsCliente) t += `• Obs.: ${o.obsCliente}\n`;
    t += `\n`;
  });
  const abrir = () => window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => { flash('Texto copiado! Abrindo WhatsApp…'); abrir(); }).catch(abrir);
  } else abrir();
}

function exportarPDFDe(arr, titulo) {
  if (!arr.length) { flash('Nenhuma O.S para exportar'); return; }
  const linhas = arr.map(o => `<tr>
    <td>${esc(o.hora || '')}</td><td><b>${esc(o.os || '')}</b></td>
    <td>${esc(o.cliente || '')}</td><td>${esc(o.servico || '')}</td>
    <td>${esc((o.duracaoDias || 1) > 1 ? o.duracaoDias + 'd' : '')}</td>
    <td>${esc(o.equipe || '')}</td><td>${esc(o.veiculo || '')}</td>
    <td>${esc(o.endereco || '')}</td><td>${esc(o.whatsapp || o.telefone || '')}</td>
    <td>${esc(o.confirmacao || '')}</td></tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Instalação ${titulo}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1c2430;margin:24px}
    h1{font-size:18px;margin:0 0 2px;color:#0b3d91}
    .sub{font-size:12px;color:#666;margin-bottom:4px}
    .pop{font-size:11px;background:#fff8e1;border:1px solid #f0e0a0;padding:6px 10px;border-radius:6px;margin:8px 0 14px}
    table{width:100%;border-collapse:collapse;font-size:11.5px}
    th,td{border:1px solid #ccc;padding:6px 7px;text-align:left;vertical-align:top}
    th{background:#0b3d91;color:#fff;font-size:10.5px;text-transform:uppercase}
    tr:nth-child(even) td{background:#f5f7fb}
    @media print{button{display:none}}
  </style></head><body>
  <h1>IMPRESILK — Instalação</h1>
  <div class="sub">${titulo} · ${arr.length} O.S · gerado em ${new Date().toLocaleString('pt-BR')}</div>
  <div class="pop"><b>REGRA CRÍTICA (POP EXI-002):</b> proibido sair para instalar sem confirmar o horário com o cliente no dia.</div>
  <table><thead><tr><th>Hora</th><th>O.S</th><th>Cliente</th><th>Serviço</th><th>Dias</th><th>Equipe</th><th>Veículo</th><th>Endereço</th><th>Contato</th><th>Confirmação</th></tr></thead>
  <tbody>${linhas}</tbody></table>
  <p style="margin-top:24px"><button onclick="window.print()">Imprimir / Salvar PDF</button></p>
  <script>setTimeout(function(){window.print()},400)<\/script>
  </body></html>`);
  w.document.close();
}

/* ---- PDF completo de uma única O.S (ficha) ---- */
/* ===========================================================
   Importação da O.S em PDF (gerada pelo ERP)
   =========================================================== */
async function importarOSPdf(file, abrirNova) {
  if (!window.pdfjsLib) {
    alert('Leitor de PDF indisponível agora (sem internet para carregar a biblioteca). Você pode preencher a O.S manualmente.');
    return;
  }
  try {
    flash('Lendo PDF da O.S…');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1); // os dados ficam na 1ª página
    const tc = await page.getTextContent();
    const dados = parseOSPdf(tc.items);
    aplicarImportacao(dados, abrirNova);
  } catch (e) {
    console.error('importarOSPdf', e);
    alert('Não foi possível ler este PDF. Confira se é a O.S gerada pelo sistema, ou preencha manualmente.');
  }
}

function parseOSPdf(items) {
  const toks = items
    .filter(t => t.str && t.str.trim() !== '')
    .map(t => ({ s: t.str.trim(), x: t.transform[4], y: t.transform[5] }));
  // agrupa tokens em linhas por coordenada Y (tolerância de 3pt)
  const linhas = [];
  toks.forEach(t => {
    let L = linhas.find(l => Math.abs(l.y - t.y) <= 3);
    if (!L) { L = { y: t.y, toks: [] }; linhas.push(L); }
    L.toks.push(t);
  });
  linhas.forEach(l => l.toks.sort((a, b) => a.x - b.x));
  linhas.sort((a, b) => b.y - a.y); // topo → base
  const texto = l => l.toks.map(t => t.s).join(' ').replace(/\s+/g, ' ').trim();
  const full = linhas.map(texto);
  const colX = (linha, label) => {
    const t = linha.toks.find(t => t.s.toLowerCase().replace(/\s/g, '').startsWith(label.toLowerCase()));
    return t ? t.x : null;
  };
  const d = { os: '', servico: '', cliente: '', contato: '', telefone: '', cnpj: '', endereco: '', entrega: '', itens: [] };

  // O.S (primeiro número isolado de 4-6 dígitos)
  for (const s of full) { if (/^\d{4,6}$/.test(s)) { d.os = s; break; } }
  // Referência → serviço
  for (const s of full) { const m = s.match(/Ref\.?:\s*(.+)/i); if (m) { d.servico = m[1].trim(); break; } }
  // Data de entrega
  { const m = full.join(' ').match(/Entrega:\s*(\d{2})\/(\d{2})\/(\d{4})/); if (m) d.entrega = `${m[3]}-${m[2]}-${m[1]}`; }

  // Cliente / Contato / Telefone (por coluna)
  const hCli = linhas.find(l => /Cliente/.test(texto(l)) && /Telefone/.test(texto(l)));
  if (hCli) {
    const xCont = colX(hCli, 'Contato'), xTel = colX(hCli, 'Telefone');
    const dl = linhas[linhas.indexOf(hCli) + 1];
    if (dl) {
      const nome = [], cont = [], tel = [];
      dl.toks.forEach(t => {
        if (xTel != null && t.x >= xTel - 2) tel.push(t.s);
        else if (xCont != null && t.x >= xCont - 2) cont.push(t.s);
        else nome.push(t.s);
      });
      d.cliente = nome.join(' ').trim();
      d.contato = cont.join(' ').trim();
      d.telefone = tel.join(' ').trim();
    }
  }
  if (!d.telefone) { const m = full.join(' ').match(/\(\d{2}\)\s?\d{4,5}-?\d{4}/); if (m) d.telefone = m[0]; }

  // CNPJ / Endereço (por coluna; endereço pode ocupar 2 linhas)
  const hEnd = linhas.find(l => /CNPJ/.test(texto(l)) && /Endere/.test(texto(l)));
  if (hEnd) {
    const xEnd = colX(hEnd, 'Endere');
    const idx = linhas.indexOf(hEnd);
    const cnpj = [], end = [];
    for (let k = idx + 1; k < linhas.length && k <= idx + 2; k++) {
      const dl = linhas[k]; const s = texto(dl);
      if (/Entrega:|Aprova|Item\s+Imagem/.test(s)) break;
      dl.toks.forEach(t => { if (xEnd != null && t.x >= xEnd - 2) end.push(t.s); else cnpj.push(t.s); });
    }
    d.cnpj = cnpj.join(' ').trim();
    d.endereco = end.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Itens — por texto de linha + regex (robusto p/ descrição × medida)
  const iHdr = full.findIndex(s => /Item/.test(s) && /Descri/.test(s) && /Medidas/.test(s));
  if (iHdr >= 0) {
    const buffers = []; // { num, buf }
    let atual = null;
    for (let k = iHdr + 1; k < full.length; k++) {
      const s = full[k];
      if (/^Descontos|^Total:|Faturamento|Logística|Observa/i.test(s)) break;
      const novo = /^\d+(?:\s|$)/.test(s) && !/^[\d.,]+\s*[xX]\b/.test(s); // nº de item, não uma medida "21.58 x..."
      if (novo) {
        const m = s.match(/^(\d+)\s*/);
        atual = { num: m[1], buf: s.slice(m[0].length) };
        buffers.push(atual);
      } else if (atual) {
        atual.buf += ' ' + s;
      }
    }
    d.itens = buffers.map(b => parseItemBuffer(b.num, b.buf));
  }
  return d;
}

function parseItemBuffer(num, buf) {
  buf = (buf || '').replace(/\s+/g, ' ').trim();
  const it = { item: num, descricao: '', medidas: '', qtde: '', valorUnit: '', subtotal: '', pronto: false };
  // medida + qtde + valor unit + subtotal (ancorado no R$)
  const re = /([\d.,]+\s*[xX]\s*[\d.,]+)\s+(\d+)\s+([\d.,]+)\s+(R\$\s*[\d.,]+)/;
  let m = buf.match(re);
  if (m) {
    it.medidas = m[1].replace(/\s+/g, ' ').trim();
    it.qtde = m[2]; it.valorUnit = m[3]; it.subtotal = m[4].replace(/\s+/g, ' ').trim();
    it.descricao = buf.slice(0, m.index).trim();
  } else {
    const mm = buf.match(/([\d.,]+\s*[xX]\s*[\d.,]+)/);
    if (mm) {
      it.medidas = mm[1].replace(/\s+/g, ' ').trim();
      it.descricao = buf.slice(0, mm.index).trim();
      const tail = buf.slice(mm.index + mm[0].length).trim().split(/\s+/).filter(Boolean);
      if (tail[0]) it.qtde = tail[0];
    } else {
      it.descricao = buf;
    }
  }
  return it;
}

function aplicarImportacao(d, abrirNova) {
  if (abrirNova) abrirModal(null);
  const setIf = (sel, val) => { if (val && (abrirNova || !get(sel))) set(sel, val); };
  setIf('#f_os', d.os);
  setIf('#f_cliente', d.cliente);
  setIf('#f_servico', d.servico);
  setIf('#f_endereco', d.endereco);
  setIf('#f_whatsapp', d.telefone);
  setIf('#f_data', d.entrega);
  atualizarLinks();
  if (d.itens && d.itens.length) {
    itensSel = abrirNova ? d.itens : itensSel.concat(d.itens);
    renderItens();
  }
  atualizarFieldsets();
  if (abrirNova && d.cliente) $('#modalTitulo').textContent = `Nova O.S ${d.os || ''} — ${d.cliente}`;
  flash(`O.S ${d.os || ''} importada — ${d.itens ? d.itens.length : 0} item(ns).`);
}

function exportarPDFFicha(o) {
  if (!o) { flash('Salve a O.S antes de gerar o PDF'); return; }
  const lin = (rot, val) => val ? `<tr><th>${esc(rot)}</th><td>${esc(val)}</td></tr>` : '';
  const sim = b => b ? 'Sim' : 'Não';
  const bloco = (titulo, linhas) => { const c = linhas.filter(Boolean).join(''); return c ? `<h2>${esc(titulo)}</h2><table class="kv">${c}</table>` : ''; };
  const conteudo =
    bloco('1 · PCP', [
      lin('O.S', o.os), lin('Cliente / Local', o.cliente), lin('Serviço', o.servico),
      lin('Entrou no PCP', fmtData(o.dataEntrada)), lin('Liberado p/ instalação', fmtData(o.dataLiberacao)),
      lin('Responsável', o.responsavelPcp),
      lin('Apto p/ instalação', o.apto ? `Sim — ${o.aptoPor || ''} ${o.aptoEm ? 'em ' + fmtDataHora(o.aptoEm) : ''}` : 'Não'),
      lin('Endereço', o.endereco), lin('WhatsApp', o.whatsapp),
    ]) +
    (o.itens && o.itens.length ? (() => {
      const prontos = o.itens.filter(it => it.pronto).length;
      const rows = o.itens.map(it => `<tr><td>${it.pronto ? '✔' : '—'}</td><td>${esc(it.item || '')}</td><td>${esc(it.descricao || '')}</td><td>${esc(it.medidas || '')}</td><td>${esc(it.qtde || '')}</td></tr>`).join('');
      return `<h2>3 · Itens do serviço (${prontos}/${o.itens.length} prontos)</h2><table class="kv it"><tr><th>Pronto</th><th>#</th><th>Descrição</th><th>Medidas</th><th>Qtde</th></tr>${rows}</table>`;
    })() : '') +
    bloco('2 · Ferramentas do serviço', [
      lin('Acesso / altura', o.acesso), lin('Fixação', o.fixacao),
      lin('Ferramentas', (o.ferramentas || []).join(', ')),
    ]) +
    bloco('4 · Agendamento', [
      lin('Data instalação', fmtData(o.data)), lin('Hora agendada', o.hora),
      lin('Duração', (o.duracaoDias || 1) > 1 ? o.duracaoDias + ' dias (até ' + fmtData(fimSpan(o)) + ')' : '1 dia'),
      lin('Responsável pela liberação', o.gerenteInstalacao), lin('Equipe', o.equipe), lin('Veículo', o.veiculo),
      lin('Observação', o.obsCliente),
    ]) +
    bloco('5 · Confirmação com o cliente', [
      lin('Confirmação', o.confirmacao),
      lin('Canal', o.canal), lin('Hora', o.horaConfirm), lin('Confirmado por', o.confirmadoPor),
      lin('Observação', o.confirmObs),
    ]) +
    bloco('6 · Embarque e liberação do carro', [
      lin('Gerente de montagem', o.gerenteMontagem), lin('Ferramentas conferidas', o.ferramentasConferidas ? 'Sim' : ''),
      lin('Carro liberado', o.carroLiberado ? `Sim — ${o.carroLiberadoPor || ''} ${o.carroLiberadoEm ? 'em ' + fmtDataHora(o.carroLiberadoEm) : ''}` : 'Não'),
    ]) +
    bloco('7 · Execução pela equipe', [
      lin('Hora saída', o.horaSaida), lin('Hora retorno', o.horaRetorno), lin('Instalação OK?', o.instalacaoOK),
      lin('Conferido por', o.conferido), lin('Retrabalho', o.retrabalho ? 'Sim' : ''),
      lin('Problema / Causa', o.problema), lin('Quem resolveu', o.quemResolveu), lin('Data resolvida', fmtData(o.dataResolvida)),
      lin('Observações técnicas', o.obs),
      lin('Situação do check-out', o.checkoutSituacao), lin('Hora check-out (volta)', o.horaCheckout), lin('Check-out por', o.checkoutPor),
      lin('Observação do check-out', o.checkoutObs), lin('Check-out confirmado', o.checkoutOk ? 'Sim' : ''),
      lin('Finalizada por', o.finalizadoPor), lin('Finalizada em', o.finalizadaEm ? fmtDataHora(o.finalizadaEm) : ''),
    ]);
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>O.S ${esc(o.os || '')} — ${esc(o.cliente || '')}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1c2430;margin:28px;max-width:760px}
    h1{font-size:19px;margin:0 0 2px;color:#0b3d91}
    .sub{font-size:12px;color:#666;margin-bottom:10px}
    h2{font-size:12.5px;text-transform:uppercase;letter-spacing:.5px;color:#0b3d91;margin:18px 0 6px;border-bottom:2px solid #e3e9f5;padding-bottom:3px}
    table.kv{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:4px}
    table.kv th{width:200px;text-align:left;background:#f5f7fb;border:1px solid #dde3ee;padding:6px 9px;font-weight:700;color:#333;vertical-align:top}
    table.kv td{border:1px solid #dde3ee;padding:6px 9px;vertical-align:top}
    .pop{font-size:11px;background:#fff8e1;border:1px solid #f0e0a0;padding:6px 10px;border-radius:6px;margin:8px 0 6px}
    @media print{button{display:none}}
  </style></head><body>
  <h1>IMPRESILK — Ficha da O.S ${esc(o.os || '')}</h1>
  <div class="sub">${esc(o.cliente || '')} · ${esc(o.servico || '')} · gerado em ${new Date().toLocaleString('pt-BR')}</div>
  <div class="pop"><b>REGRA CRÍTICA (POP EXI-002):</b> proibido sair para instalar sem confirmar o horário com o cliente no dia.</div>
  ${conteudo}
  <p style="margin-top:24px"><button onclick="window.print()">Imprimir / Salvar PDF</button></p>
  <script>setTimeout(function(){window.print()},400)<\/script>
  </body></html>`);
  w.document.close();
}

/* ---- start ---- */
carregarCfg();
carregarUser();
carregar();
initEventos();
initControle();
refreshDatalists();
renderControle();
renderUserChip();
aplicarPermissoes();
renderTudo();
if (!USER) abrirLogin();
