// Navegador do portão visual (auditoria v133): abre o app servido localmente com a fixture.
// Supabase interceptado com a fixture SINTÉTICA; qualquer outro host é bloqueado
// na rota E no resolvedor de nomes do Chrome (nenhum pedido escapa para a rede).
// Sem senha, sem login real: crachá falso no localStorage, como no harness.
// Playwright e Chrome vêm do ambiente: PLAYWRIGHT=<caminho do index.mjs> e CHROME=<executável>.
// O Playwright só carrega ao lançar: a lista de estados (ESTADOS) é lida pelos testes sem navegador.
import {performance} from 'node:perf_hooks';
import {AGORA, criarServidor} from './fixture.mjs';
export const BASE = process.env.DRE_URL || 'http://127.0.0.1:8793/';
export const SUPABASE = 'https://heveemylixartyijxewh.supabase.co';
const CHROME = process.env.CHROME || undefined;
export const MES_FECHADO = 'Ago/2026', MES_PARCIAL = 'Set/2026', COMPARAR = 'Jul/2026';
let pendentes = 0, ultimoPedido = 0;
export const bloqueados = new Map();
export const pedidos = [];
export async function estabilizar(page, minimo = 250) {
  const t0 = performance.now();
  while (performance.now() - t0 < 20000) { if (pendentes === 0 && performance.now() - ultimoPedido > minimo) break; await new Promise(r => setTimeout(r, 50)); }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
}
// No CI o servidor estático sobe em segundo plano no passo anterior: espera ele responder (até 10 s) antes de abrir.
export async function esperarServidor(limite = 10000) {
  const t0 = performance.now(); let ultimo = '';
  while (performance.now() - t0 < limite) {
    try { const r = await fetch(BASE, {signal: AbortSignal.timeout(2000)}); if (r.ok) return; ultimo = 'HTTP ' + r.status; } catch (e) { ultimo = e.cause?.code || e.message; }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Servidor do app não respondeu em ${BASE} em ${limite / 1000} s (${ultimo}). Suba: python3 -m http.server 8793 --bind 127.0.0.1`);
}
export async function lancar() {
  const {chromium} = await import(process.env.PLAYWRIGHT || 'playwright');
  return chromium.launch({...(CHROME ? {executablePath: CHROME} : {}), headless: true, args: ['--no-sandbox', `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ${new URL(BASE).hostname}`]});
}
export async function contexto(browser, {mobile = false, sw = 'block', servidor = criarServidor(), cpu = 1} = {}) {
  const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000}, serviceWorkers: sw, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR', deviceScaleFactor: 1, ...(mobile ? {isMobile: true, hasTouch: true} : {})});
  await context.clock.setFixedTime(AGORA);
  await context.route('**/*', async route => {
    const url = route.request().url(), u = new URL(url);
    if (u.origin === new URL(BASE).origin || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    if (u.origin === SUPABASE) {
      pendentes++; ultimoPedido = performance.now();
      try {
        if (route.request().method() === 'OPTIONS') return await route.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}});
        let body = {}; try { body = route.request().postDataJSON() || {}; } catch {}
        pedidos.push({t: performance.now(), fn: u.pathname.split('/').pop(), acao: body?.action || body?.acao || '?', fonte: body?.fonte || ''});
        const r = await servidor.responder(url, body);
        await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(r)});
      } finally { pendentes--; ultimoPedido = performance.now(); }
      return;
    }
    bloqueados.set(u.host, (bloqueados.get(u.host) || 0) + 1);
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    localStorage.setItem('impresilk_dre_cracha', 'fixture.' + btoa(JSON.stringify({sub: 'auditoria', nome: 'Auditoria'})) + '.fixture');
    // Medidas: tarefas longas e tempo síncrono de cada render() do app.
    window.__mc = {longas: [], renders: []};
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__mc.longas.push({ini: e.startTime, dur: e.duration}); }).observe({type: 'longtask', buffered: true}); } catch {}
    const embrulhar = () => {
      if (typeof window.render !== 'function' || window.render.__mc) return;
      const orig = window.render;
      const w = function (...a) { const t = performance.now(); try { return orig.apply(this, a); } finally { window.__mc.renders.push({ini: t, dur: performance.now() - t, tela: (typeof state !== 'undefined' ? state.view : null)}); } };
      w.__mc = true; window.render = w;
    };
    document.addEventListener('DOMContentLoaded', embrulhar);
    window.__mcEmbrulhar = embrulhar;
  });
  if (cpu > 1) { context.on('page', async p => { const s = await context.newCDPSession(p); await s.send('Emulation.setCPUThrottlingRate', {rate: cpu}); }); }
  return context;
}
export async function abrirApp(context, {hash = `#tela=inicio&mes=${encodeURIComponent(MES_FECHADO)}&comparar=${encodeURIComponent(COMPARAR)}`, escuro = false} = {}) {
  const page = await context.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push({tipo: 'pageerror', texto: e.message.slice(0, 300)}));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) erros.push({tipo: m.type(), texto: m.text().slice(0, 300)}); });
  const t0 = performance.now();
  await page.goto(BASE + hash);
  await page.locator('#appShell').waitFor({state: 'visible', timeout: 20000});
  await page.waitForFunction(() => /Dados aplicados/.test(document.querySelector('#syncState')?.textContent || ''), null, {timeout: 30000});
  await estabilizar(page, 500);
  const abertura = Math.round(performance.now() - t0);
  await page.evaluate(() => window.__mcEmbrulhar && window.__mcEmbrulhar());
  if (escuro) { await page.locator('#themeToggle').click(); await page.waitForFunction(() => document.body.classList.contains('dark')); await estabilizar(page); }
  return {page, erros, abertura};
}
export async function clicarSe(page, sel) {
  const el = page.locator(sel).first();
  if (await el.count() && await el.isVisible().catch(() => false)) { await el.click(); await estabilizar(page); return true; }
  return false;
}
export async function irTela(page, tela, mobile) {
  if (tela === 'custos') { await irTela(page, 'inicio', mobile); await page.locator('[data-go="custos"]').first().click(); await estabilizar(page); return; }
  // Composição do caixa não está no menu: chega-se pelo "Veja também" de Caixa e planejamento.
  if (tela === 'resultado') { await irTela(page, 'caixa', mobile); await page.locator('#pageContent [data-go="resultado"]').first().click(); await estabilizar(page); return; }
  const sel = tela === 'config' ? '#settingsBtn' : tela === 'ajuda' ? '#helpBtn' : `#viewTabs [data-view="${tela}"]`;
  if (mobile && !(await page.locator(sel).isVisible())) { await page.locator('#menuToggle').click(); await page.locator(sel).waitFor({state: 'visible'}); }
  await page.locator(sel).click();
  await estabilizar(page);
}
export async function irPeriodo(page, label) {
  if (!label || !(await page.locator('#monthChips').isVisible().catch(() => false))) return;
  const ano = label.split('/')[1];
  if (await page.locator('#yearSelect').inputValue() !== ano) { await page.locator('#yearSelect').selectOption(ano); await estabilizar(page); }
  await page.locator(`#monthChips [data-period="${label}"]`).click(); await estabilizar(page);
}
export async function ligarAno(page, ligado) {
  const b = page.locator('#anoChip [data-ano]');
  if (!(await b.count()) || !(await b.isVisible())) return false;
  if ((await b.getAttribute('aria-pressed')) !== String(ligado)) { await b.click(); await estabilizar(page); }
  return true;
}
// Ano de comparação pelo link (anocomp=AAAA ou nenhum; '' = padrão, o ano anterior), como quem abre um link copiado.
// Devolve se o app ficou com o valor pedido (state.anoComparar).
export async function compararAno(page, valor = '') {
  const lido = () => page.evaluate(() => typeof state === 'undefined' ? null : String(state.anoComparar ?? ''));
  if (await lido() === valor) return true;
  await page.evaluate(v => { const q = new URLSearchParams(location.hash.slice(1)); if (v) q.set('anocomp', v); else q.delete('anocomp'); location.hash = q.toString(); }, valor);
  await estabilizar(page);
  await page.waitForFunction(v => typeof state !== 'undefined' && String(state.anoComparar ?? '') === v, valor, {timeout: 5000}).catch(() => {});
  await estabilizar(page);
  return await lido() === valor;
}
export async function indicadores(page, area, fonte) {
  await page.getByRole('navigation', {name: 'Áreas dos indicadores'}).waitFor({state: 'visible', timeout: 15000});
  const a = page.locator(`[data-area="${area}"]`).first();
  if ((await a.getAttribute('aria-pressed')) !== 'true') { await a.click(); await estabilizar(page); }
  const f = page.locator(`[data-source="${fonte}"]`).first();
  if (await f.count() && (await f.getAttribute('aria-pressed')) !== 'true') { await f.click(); await estabilizar(page); }
  await page.waitForFunction(() => !/Lendo|Consultando|Carregando/i.test(document.querySelector('.ind-analysis, #indicadoresRoot')?.innerText?.slice(0, 400) || ''), null, {timeout: 15000}).catch(() => {});
}
export async function plano(page, aba) {
  if (aba === 'juntas') { await clicarSe(page, '[data-plano-tab="dashboard"]'); await clicarSe(page, '[data-plano-select=""]'); await clicarSe(page, '[data-plano-juntas="sim"]'); return; }
  await clicarSe(page, '[data-plano-juntas="nao"]');
  await clicarSe(page, '[data-plano-select=""]');
  await clicarSe(page, `[data-plano-tab="${aba}"]`);
}
export async function abrirCartoes(page) {
  for (let i = 0; i < 2; i++) { await page.evaluate(() => { for (const d of document.querySelectorAll('#pageContent details:not([open])')) d.open = true; }); await estabilizar(page, 150); }
}
const AREAS = {Receita: ['recebimentos', 'comercial', 'fiscal', 'competencia'], Custos: ['custos', 'compras'], Despesas: ['pagamentos'], Resultado: ['variacao', 'competencia'], Margem: ['margem', 'competencia'], Rentabilidade: ['rentabilidade']};
const PLANILHA = async p => { await plano(p, 'planilha'); await clicarSe(p, '[data-plano-matriz="tudo"]'); };
const DRE_CAIXA = async p => { await clicarSe(p, '[data-dre-base="caixa"]'); };
const RECEBIMENTOS = p => indicadores(p, 'Receita', 'recebimentos');
// Ano em toda tela com a barra de meses (padrão: comparado com o ano anterior), com 2024 escolhido em "Comparar com" e sem comparação.
const ANO = {periodo: MES_FECHADO, ano: true};
export const ESTADOS_ANO = [
  ...['inicio', 'cfo', 'caixa', 'resultado', 'balanco', 'conferencia', 'custos', 'parametros'].map(tela => ({tela, estado: 'ano', ...ANO})),
  ...['inicio', 'cfo', 'dfc', 'caixa', 'custos', 'balanco', 'precos'].map(tela => ({tela, estado: 'ano-comp-2024', ...ANO, anocomp: '2024'})),
  {tela: 'dre', estado: 'caixa-ano-comp-2024', ...ANO, anocomp: '2024', antes: DRE_CAIXA},
  {tela: 'detalhe', estado: 'juntas-ano-comp-2024', ...ANO, anocomp: '2024', antes: p => plano(p, 'juntas')},
  {tela: 'detalhe', estado: 'planilha-ano-comp-2024', ...ANO, anocomp: '2024', antes: PLANILHA},
  {tela: 'indicadores', estado: 'receita-recebimentos-ano-comp-2024', ...ANO, anocomp: '2024', antes: RECEBIMENTOS},
  {tela: 'inicio', estado: 'ano-sem-comparacao', ...ANO, anocomp: 'nenhum'},
  {tela: 'detalhe', estado: 'planilha-ano-sem-comparacao', ...ANO, anocomp: 'nenhum', antes: PLANILHA},
];
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const ESTADOS = [
  {tela: 'inicio', estado: 'padrao', periodo: MES_FECHADO, abrir: false},
  {tela: 'inicio', estado: 'mes-fechado', periodo: MES_FECHADO},
  {tela: 'inicio', estado: 'mes-parcial', periodo: MES_PARCIAL},
  {tela: 'cfo', estado: 'mes-fechado', periodo: MES_FECHADO},
  {tela: 'dre', estado: 'caixa-mes', periodo: MES_FECHADO, antes: async p => { await clicarSe(p, '[data-dre-base="caixa"]'); await clicarSe(p, '[data-dre-visao="mes"]'); }},
  {tela: 'dre', estado: 'caixa-ano', periodo: MES_FECHADO, ano: true, antes: DRE_CAIXA},
  {tela: 'dre', estado: 'competencia', periodo: MES_FECHADO, antes: async p => { await clicarSe(p, '[data-dre-base="competencia"]'); }},
  {tela: 'dfc', estado: 'mes', periodo: MES_FECHADO},
  {tela: 'dfc', estado: 'ano', periodo: MES_FECHADO, ano: true},
  {tela: 'balanco', estado: 'mes', periodo: MES_FECHADO},
  {tela: 'caixa', estado: 'mes-fechado', periodo: MES_FECHADO},
  {tela: 'caixa', estado: 'mes-parcial', periodo: MES_PARCIAL},
  {tela: 'giro', estado: 'posicao', periodo: MES_FECHADO},
  {tela: 'recebiveis', estado: 'posicao', periodo: MES_FECHADO},
  {tela: 'precos', estado: 'mes', periodo: MES_FECHADO},
  {tela: 'precos', estado: 'ano', periodo: MES_FECHADO, ano: true},
  ...Object.entries(AREAS).flatMap(([area, fontes]) => fontes.map(fonte => ({tela: 'indicadores', estado: slug(area) + '-' + fonte, periodo: MES_FECHADO, antes: p => indicadores(p, area, fonte)}))),
  {tela: 'indicadores', estado: 'receita-recebimentos-ano', periodo: MES_FECHADO, ano: true, antes: RECEBIMENTOS},
  {tela: 'detalhe', estado: 'dashboard', periodo: MES_FECHADO, antes: p => plano(p, 'dashboard')},
  {tela: 'detalhe', estado: 'dashboard-conta-impostos', periodo: MES_FECHADO, antes: async p => { await plano(p, 'dashboard'); await p.evaluate(() => planoSelecionar('2.4')); await estabilizar(p); }},
  {tela: 'detalhe', estado: 'planilha', periodo: MES_FECHADO, antes: PLANILHA},
  {tela: 'detalhe', estado: 'juntas-mes', periodo: MES_FECHADO, antes: p => plano(p, 'juntas')},
  {tela: 'detalhe', estado: 'juntas-ano', periodo: MES_FECHADO, ano: true, antes: p => plano(p, 'juntas')},
  {tela: 'parametros', estado: 'mes', periodo: MES_FECHADO},
  {tela: 'conferencia', estado: 'mes-fechado', periodo: MES_FECHADO},
  {tela: 'conferencia', estado: 'mes-parcial', periodo: MES_PARCIAL},
  {tela: 'custos', estado: 'mes-fechado', periodo: MES_FECHADO},
  ...ESTADOS_ANO,
  {tela: 'glossario', estado: 'padrao'},
  {tela: 'config', estado: 'padrao'},
  {tela: 'ajuda', estado: 'padrao'},
];
// Devolve os problemas de chegar ao estado (Ano que não ligou, ano de comparação que não pegou) para o portão listar.
export async function irEstado(page, e, mobile = false) {
  const problemas = [];
  await irTela(page, e.tela, mobile);
  if (e.periodo) await irPeriodo(page, e.periodo);
  if (e.antes) await e.antes(page);
  if (e.ano) {
    if (!(await ligarAno(page, true))) problemas.push({regra: 'ano-nao-ligou'});
    // todo estado do Ano diz o ano comparado: o anterior ('') quando não pede outro, para um estado não herdar o do anterior
    else if (!(await compararAno(page, e.anocomp || ''))) problemas.push({regra: 'ano-comparado-nao-aplicado', anocomp: e.anocomp || 'padrão'});
    if (e.antes && e.tela !== 'dre') await e.antes(page);
  }
  if (e.abrir !== false) await abrirCartoes(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await estabilizar(page, 200);
  return problemas;
}
