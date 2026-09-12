// A fila acompanha o coletor existente; não calcula nem grava valores financeiros.
type Store = {read: () => Promise<any>; save: (value: any, version: any) => Promise<boolean>};
type Identity = {configured: boolean; editor?: boolean; collector?: boolean};
const LEASE_MS = 95 * 60 * 1000;

function mesesSeguros(meses: any) {
  return (Array.isArray(meses) ? meses : []).slice(0, 24)
    .filter((m: any) => /^[A-Za-zçÇ]{3}\/\d{4}$/.test(String(m?.label)) &&
      ['gravado', 'preservado', 'vazio', 'simulado'].includes(m?.estado))
    .map((m: any) => ({label: m.label, estado: m.estado}));
}
function tentativaSegura(t: any) {
  return t ? {em: t.em, runId: t.runId, ok: t.ok === true, meses: mesesSeguros(t.meses)} : null;
}
function statusColeta(r: any, configured: boolean, now: Date) {
  const expirou = r.estado === 'executando' && !(Date.parse(r.limiteEm) > now.getTime());
  return {configurada: configured, ativa: configured && r.enabled === true,
    estado: expirou ? 'interrompido' : (r.estado || 'inativa'),
    pedidoId: r.pedidoId || null, solicitadoEm: r.solicitadoEm || null,
    iniciadoEm: r.iniciadoEm || null, runId: r.runId || null,
    rotinaVistaEm: r.rotinaVistaEm || null,
    ultimaConclusao: tentativaSegura(r.ultimaConclusao), ultimaTentativa: tentativaSegura(r.ultimaTentativa),
    horarios: ['06:00', '12:00', '18:00'], fuso: 'America/Sao_Paulo'};
}
function janela(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'})
    .formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(p.hour), day = `${p.year}-${p.month}-${p.day}`;
  if (hour >= 6) return `${day}/${hour >= 18 ? 18 : hour >= 12 ? 12 : 6}`;
  const prev = new Date(`${day}T12:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 1);
  return `${prev.toISOString().slice(0, 10)}/18`;
}

export async function coleta(body: any, who: Identity, store: Store, now = new Date()) {
  const reply = (body: any, code = 200) => ({body, code});
  const action = body.action;
  if (action === 'solicitarColeta' && !who.editor) return reply({erro: 'Sem permissão para solicitar coleta.'}, 403);
  if (['coletaIniciar', 'coletaConcluir'].includes(action) && !who.collector)
    return reply({erro: 'Ação exclusiva da rotina de coleta.'}, 403);
  if (!['coletaStatus', 'solicitarColeta', 'coletaIniciar', 'coletaConcluir'].includes(action))
    return reply({erro: 'Ação de coleta inválida.'}, 400);
  if (who.collector && ['coletaIniciar', 'coletaConcluir'].includes(action) && !/^\d{1,30}$/.test(String(body.runId || '')))
    return reply({erro: 'Execução da rotina inválida.'}, 400);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await store.read();
    const r = {...(current?.valor || {})};
    const result = (extra = {}) => reply({ok: true, status: statusColeta(r, who.configured, now), ...extra});
    if (action === 'coletaStatus') return result();
    const busy = r.estado === 'executando' && Date.parse(r.limiteEm) > now.getTime();
    let executar: boolean | undefined;
    if (action === 'solicitarColeta') {
      if (!who.configured || !r.enabled) return reply({erro: 'A rotina automática ainda precisa ser ativada.', status: statusColeta(r, who.configured, now)}, 503);
      if (busy || r.estado === 'aguardando') return result();
      Object.assign(r, {estado: 'aguardando', pedidoId: crypto.randomUUID(), solicitadoEm: now.toISOString()});
    } else if (action === 'coletaIniciar') {
      if (busy && r.runId === String(body.runId)) return result({executar:true});
      r.enabled = true; r.rotinaVistaEm = now.toISOString();
      executar = !busy && (body.forcar === true || r.estado === 'aguardando' ||
        r.estado === 'executando' || r.ultimaJanela !== janela(now));
      if (executar) Object.assign(r, {estado: 'executando', runId: String(body.runId),
        iniciadoEm: now.toISOString(), limiteEm: new Date(now.getTime() + LEASE_MS).toISOString(),
        ultimaJanela: janela(now)});
    } else {
      if (r.runId === String(body.runId) && r.estado !== 'executando' && r.ultimaTentativa?.runId === String(body.runId)) return result();
      if (r.estado !== 'executando' || r.runId !== String(body.runId)) return reply({erro: 'Outra execução assumiu esta coleta.'}, 409);
      const t = {em: now.toISOString(), runId: r.runId, ok: body.ok === true, meses: mesesSeguros(body.meses)};
      Object.assign(r, {estado: t.ok ? 'concluido' : 'erro', ultimaTentativa: t, limiteEm: null});
      if (t.ok) r.ultimaConclusao = t;
    }
    if (await store.save(r, current?.version ?? null)) return result(executar === undefined ? {} : {executar});
  }
  return reply({erro: 'Outra solicitação chegou ao mesmo tempo. Tente novamente.'}, 409);
}
