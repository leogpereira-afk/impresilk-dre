// Portão visual do DRE (auditoria v133): percorre as telas com dados SINTÉTICOS e falha (saída 1) quando
//  1. um elemento com tom-sai/tom-entra não pinta na cor do token (CSS que venceu o tom);
//  2. valor em R$ ligado a conta 2.x (saída) não está vermelho ou ligado a 1.x (entrada) não está azul
//     (valor negativo inverte: estorno de saída fica azul);
//  3. valor em R$ cujo rótulo diz saída (pagamento, despesa, custo, imposto…) não está vermelho, ou
//     cujo rótulo diz entrada (recebimento, receita, venda…) não está azul;
//  4. variação marcada como boa (delta-bom) não está azul ou ruim (delta-ruim) não está vermelha;
//  5. a página rola para o lado no celular; 6. erro de console;
//  7. no celular, o chip do mês escolhido fica fora da parte visível da faixa de meses (ao abrir e a cada tela);
//  8. id repetido no documento (id-duplicado); 9. botão, link, campo ou lista visível sem nome para o leitor de tela
//     (controle-sem-nome). As regras 8 e 9 (acessibilidade, N26) entram no resumo mas ainda não mudam a saída.
// Uso: servidor local do repositório em DRE_URL (padrão http://127.0.0.1:8793/), depois
//   PLAYWRIGHT=<.../playwright/index.mjs> CHROME=<executável> node tests/visual/regra-cores.mjs [--json saida.json]
// Nenhum pedido sai para a rede: o Supabase é respondido pela fixture e os outros hosts são bloqueados.
import fs from 'node:fs/promises';
import {esperarServidor, lancar, contexto, abrirApp, irEstado, ESTADOS, MES_PARCIAL} from './base.mjs';
// Acessibilidade: lista no resumo sem reprovar (nesta versão).
const SO_AVISO = new Set(['id-duplicado', 'controle-sem-nome']);

function verificar() {
  const tok = n => { const s = document.createElement('span'); s.style.color = `var(${n})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
  const AZUL = tok('--blue'), VERM = tok('--red');
  const vis = el => el.getClientRects().length && (el.checkVisibility ? el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) : true);
  const proprio = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  const onde = el => { const parts = []; let e = el; for (let i = 0; i < 4 && e && e.id !== 'pageContent'; i++, e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map(c => '.' + c).join('')); return parts.join(' > '); };
  const secao = el => el.closest('details,section,.card,figure')?.querySelector('summary,h2,h3,figcaption')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) || '';
  const dinheiro = t => t.match(/^(−|-)?\s?R?\$?\s?(−|-)?\s?[\d.]+,\d\d$/);
  const falhas = [];
  // 1. a classe de tom precisa vencer a cascata
  for (const el of document.querySelectorAll('#pageContent .tom-sai, #pageContent .tom-entra, #detailContent .tom-sai, #detailContent .tom-entra')) {
    if (!vis(el) || !/\d/.test(proprio(el))) continue;
    const esperado = el.classList.contains('tom-sai') ? VERM : AZUL, cor = getComputedStyle(el).color;
    if (cor !== esperado) falhas.push({regra: 'classe-de-tom-perdeu', onde: onde(el), secao: secao(el), texto: proprio(el).slice(0, 30), cor, esperado});
  }
  // 4. variação boa ou ruim com a cor da casa
  for (const el of document.querySelectorAll('#pageContent .delta-bom, #pageContent .delta-ruim')) {
    if (!vis(el) || !/\d/.test(el.innerText || '')) continue;
    const esperado = el.classList.contains('delta-ruim') ? VERM : AZUL, cor = getComputedStyle(el).color;
    if (cor !== esperado) falhas.push({regra: 'variacao-fora-da-cor', onde: onde(el), secao: secao(el), texto: (el.innerText || '').trim().slice(0, 30), cor, esperado});
  }
  // Rótulo de um valor: cabeçalho da linha, rótulo do cartão ou cabeçalho da coluna.
  const cabecalhoDaColuna = td => { const tab = td.closest('table'); if (!tab?.tHead) return ''; let idx = 0; for (const c of td.parentElement.cells) { if (c === td) break; idx += c.colSpan || 1; } const cab = tab.tHead.rows[tab.tHead.rows.length - 1]; let k = 0; for (const c of cab.cells) { if (k <= idx && idx < k + (c.colSpan || 1)) return c.innerText; k += c.colSpan || 1; } return ''; };
  const rotulos = el => { const td = el.closest('td'), tr = el.closest('tr'), card = el.closest('.metric,.ind-metric,.plano-stats>div,.expense-row,.line,.kpi');
    const linha = tr ? (tr.querySelector('th')?.innerText || tr.cells?.[0]?.innerText || '') : '';
    return {linha, coluna: td ? cabecalhoDaColuna(td) : '', cartao: card ? (card.querySelector('.label,small,span,dt,th')?.innerText || '') : ''}; };
  const SAI = /\b(sa[ií]das?|pagamentos?|pago|despesas?|custos?|impostos?|folha|juros|retiradas?|d[ií]vidas? pagas?|devolu[cç][aãõ]o|devolu[cç][oõ]es|parcelas?|para onde foi)\b/i;
  const ENTRA = /\b(entradas?|recebimentos?|recebido|receitas?|vendas?|de onde veio)\b/i;
  const NEUTRO = /saldo|resultado|margem|varia|diferen|menos|equil[ií]brio|%|m[eé]dia|meta|or[cç]ad|projet|limite|ticket|a receber|a pagar|em aberto|vencid|estoque|patrim|ativo|passivo|ncg|capital|total geral|ponto|acumulad|anterior|Δ|×/i;
  // rótulos e resumos dentro dos gráficos seguem a cor da marca (subtotal neutro), não a do rótulo da linha
  const NEUTRAS = '.plano-ano-anterior, [data-neutro], .chart-tooltip, .chart-y, option, .g-rotulos, .g-resumo-estreito, .g-dica';
  for (const el of document.querySelectorAll('#pageContent td, #pageContent strong, #pageContent b, #pageContent button, #pageContent span, #detailContent td, #detailContent b, #detailContent strong')) {
    const t = proprio(el); const m = dinheiro(t); if (!m || !vis(el) || el.closest(NEUTRAS)) continue;
    const neg = !!(m[1] || m[2]); if (/^[−-]?\s?R?\$?\s?[−-]?\s?0,00$/.test(t)) continue;
    const cor = getComputedStyle(el).color;
    // 2. valores ligados a contas do plano (fora das colunas de comparação)
    const td = el.closest('td'); const col = td ? cabecalhoDaColuna(td) : '';
    const ano = document.getElementById('yearSelect')?.value, anos = col.match(/\b20\d\d\b/g) || [];
    const comparacao = /Δ|×|anterior|diferen|varia/i.test(col) || (anos.length && !anos.includes(ano));
    const conta = el.closest('[data-account],[data-plano-linha],[data-plano-select],[data-cfo-account]');
    const code = conta && (conta.getAttribute('data-account') || conta.getAttribute('data-plano-linha') || conta.getAttribute('data-plano-select') || conta.getAttribute('data-cfo-account'));
    if (code && /^[12](\.|$)/.test(code) && !comparacao) {
      let esperado = code.startsWith('2') ? VERM : AZUL; if (neg) esperado = esperado === VERM ? AZUL : VERM;
      if (cor !== esperado) falhas.push({regra: 'valor-da-conta-fora-da-cor', conta: code, onde: onde(el), secao: secao(el), texto: t, cor, esperado});
      continue;
    }
    if (comparacao) continue;
    // 3. valores cujo rótulo diz o sentido do dinheiro. Ordem: marcador (−)/(+)/(=) do rótulo, código da conta
    //    citado no rótulo e, por fim, as palavras. Aqui o sinal não inverte: "(−) Custos: -R$ 10" é saída do mesmo jeito.
    //    Saldos (a pagar, a receber, posição, balanço) ainda não têm regra única de cor e ficam fora.
    const r = rotulos(el), texto = [r.linha, r.cartao, r.coluna].join(' | '), principal = (r.linha || r.cartao || '').trim();
    // Saldos (v134, decisão do dono): a receber, estoque e ativo em azul; a pagar, passivo, vencido e provisão em vermelho;
    // necessidade de giro, patrimônio e endividamento pelo sinal ou neutros. Saldo negativo inverte.
    if (['giro', 'recebiveis', 'balanco'].includes(document.body.dataset.screen)) {
      const base = `${principal} ${r.coluna} ${secao(el)}`;
      // linhas fora do balanço não somam e ficam neutras
      if (/necessidade|sem estoque|patrim|endivid|ciclo|prazo|dias/i.test(`${principal} ${r.coluna}`) || /fora do balan/i.test(el.closest('tbody')?.querySelector('.dre-composicao-grupo')?.innerText || '')) continue;
      // primeiro a linha e a coluna; só sem resposta, o título do gráfico ou da seção
      const sentido = x => /vencid|provis|devedor|a pagar|o que eu devo|passivo|fornecedor|empr[eé]stimo|banco no vermelho|parcelamento|d[ií]vida|impostos e taxas|s[oó]cios|sem classifica|projetad|\(\d\.(xx|\d\d)\)/i.test(x) ? -1
        : /a receber|vou receber|estoque|\bativo\b|caixa e bancos|imobilizado/i.test(x) ? 1 : 0;
      const titulo = el.closest('.chart-card,section')?.querySelector('h2,h3')?.innerText || '';
      // "a vencer" é a receber em Recebíveis e a pagar no Capital de giro
      const tela = document.body.dataset.screen;
      let s = sentido(`${principal} ${r.coluna}`);
      if (!s && /a vencer/i.test(`${principal} ${r.coluna}`)) s = tela === 'recebiveis' ? 1 : tela === 'giro' ? -1 : 0;
      if (!s) s = sentido(`${titulo} ${secao(el)}`);
      if (!s) continue;
      // "-R$" de quem desconta (a pagar na cascata) continua vermelho; saldo de ativo negativo inverte
      const esperado = s < 0 ? VERM : neg ? VERM : AZUL;
      if (cor !== esperado) falhas.push({regra: 'saldo-fora-da-cor', rotulo: texto.replace(/\s+/g, ' ').slice(0, 80), onde: onde(el), secao: secao(el), texto: t, cor, esperado});
      continue;
    }
    if (NEUTRO.test(principal || r.coluna) || /desvio|previst/i.test(r.coluna) || /a pagar|a receber|posi[cç][aã]o|saldo|balan[cç]o|aging|vencid/i.test(secao(el))) continue;
    let sentido = 0;
    const marca = principal.match(/^\(([−+=-])\)/);
    if (marca) sentido = marca[1] === '+' ? 1 : marca[1] === '=' ? 0 : -1;
    else { const cod = principal.match(/\b([12])(?:\.\d+)+\b/); if (cod) sentido = cod[1] === '1' ? 1 : -1;
      else { const base = principal || r.coluna, sai = SAI.test(base), entra = ENTRA.test(base); sentido = sai === entra ? 0 : sai ? -1 : 1; } }
    if (!sentido) continue;
    const esperado = sentido < 0 ? VERM : AZUL;
    if (cor !== esperado) falhas.push({regra: 'valor-do-rotulo-fora-da-cor', rotulo: texto.replace(/\s+/g, ' ').slice(0, 80), onde: onde(el), secao: secao(el), texto: t, cor, esperado});
  }
  // 8. id repetido entre elementos visíveis (getElementById e aria-* passam a apontar para o primeiro)
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) if (el.id && vis(el)) ids.set(el.id, [...(ids.get(el.id) || []), el]);
  for (const [id, els] of ids) if (els.length > 1) falhas.push({regra: 'id-duplicado', id, vezes: els.length, onde: onde(els[1]), secao: secao(els[1])});
  // 9. controle visível sem nome: nem texto (fora do aria-hidden), nem aria-label, aria-labelledby, title ou label
  const textoAcessivel = el => [...el.childNodes].map(n => n.nodeType === 3 ? n.textContent : n.nodeType !== 1 || n.hidden || n.getAttribute('aria-hidden') === 'true' ? '' : n.tagName === 'IMG' ? n.getAttribute('alt') || '' : n.tagName.toLowerCase() === 'svg' ? n.querySelector('title')?.textContent || '' : textoAcessivel(n)).join('');
  const temNome = el => {
    if ((el.getAttribute('aria-label') || '').trim() || (el.getAttribute('title') || '').trim()) return true;
    const lb = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(i => document.getElementById(i)?.textContent || '').join('').trim(); if (lb) return true;
    if (el.labels && [...el.labels].some(l => textoAcessivel(l).trim())) return true;
    if (el.tagName === 'INPUT') return /^(button|submit|reset)$/i.test(el.type) ? !!(el.value || '').trim() || el.type !== 'button' : el.type === 'image' && !!(el.getAttribute('alt') || '').trim();
    if (el.tagName === 'SELECT') return false;
    return !!textoAcessivel(el).trim();
  };
  for (const el of document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select')) {
    if (!vis(el) || temNome(el)) continue;
    falhas.push({regra: 'controle-sem-nome', onde: onde(el), secao: secao(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 120)});
  }
  return falhas;
}

// 7. a faixa rola para o lado no celular: o mês aceso precisa estar na parte visível dela
const chipForaDaFaixa = () => { const b = document.querySelector('#monthChips'), s = b?.querySelector('[aria-pressed="true"]'); if (!s || !b.getClientRects().length) return null;
  const rb = b.getBoundingClientRect(), rs = s.getBoundingClientRect(); return rs.left < rb.left - 1 || rs.right > rb.right + 1 ? {mes: s.dataset.period, chip: [Math.round(rs.left), Math.round(rs.right)], faixa: [Math.round(rb.left), Math.round(rb.right)]} : null; };
await esperarServidor();
const browser = await lancar();
const todas = [];
try {
  for (const m of [{id: 'desktop-claro', mobile: false, escuro: false}, {id: 'desktop-escuro', mobile: false, escuro: true}, {id: 'celular-claro', mobile: true, escuro: false}, {id: 'celular-escuro', mobile: true, escuro: true}]) {
    const ctx = await contexto(browser, {mobile: m.mobile});
    const {page, erros} = await abrirApp(ctx, {escuro: m.escuro});
    if (m.mobile) {
      const c = await page.evaluate(chipForaDaFaixa); if (c) todas.push({modo: m.id, tela: 'abertura', regra: 'mes-escolhido-fora-da-faixa', ...c});
      const link = await abrirApp(ctx, {hash: `#tela=dre&mes=${encodeURIComponent(MES_PARCIAL)}`});
      const c2 = await link.page.evaluate(chipForaDaFaixa); if (c2) todas.push({modo: m.id, tela: 'abertura pelo link', regra: 'mes-escolhido-fora-da-faixa', ...c2});
      for (const x of link.erros.filter(x => x.tipo !== 'warning')) todas.push({modo: m.id, regra: 'erro-de-console', ...x});
      await link.page.close();
    }
    for (const e of ESTADOS) {
      await irEstado(page, e, m.mobile);
      const f = await page.evaluate(verificar);
      if (m.mobile) {
        const w = await page.evaluate(() => ({pagina: document.documentElement.scrollWidth, aparelho: Math.round(window.visualViewport?.width || screen.width)}));
        if (w.pagina > w.aparelho + 1) f.push({regra: 'rolagem-lateral-no-celular', ...w});
        const c = await page.evaluate(chipForaDaFaixa); if (c) f.push({regra: 'mes-escolhido-fora-da-faixa', ...c});
      }
      for (const x of f) todas.push({modo: m.id, tela: e.tela, estado: e.estado, ...x});
    }
    for (const x of erros.filter(x => x.tipo !== 'warning')) todas.push({modo: m.id, regra: 'erro-de-console', ...x});
    await ctx.close();
  }
} finally { await browser.close(); }
const resumo = todas.reduce((r, x) => { const k = `${x.regra} · ${x.tela || ''}${x.secao ? ' · ' + x.secao : ''}`; r[k] = (r[k] || 0) + 1; return r; }, {});
if (process.argv[2] === '--json') await fs.writeFile(process.argv[3], JSON.stringify({resumo, avisos: [...SO_AVISO], falhas: todas}, null, 1));
const reprovam = todas.filter(x => !SO_AVISO.has(x.regra));
const linhas = (lista, prefixo = '') => Object.entries(lista.reduce((r, x) => { const k = `${x.regra} · ${x.tela || ''}${x.secao ? ' · ' + x.secao : ''}`; r[k] = (r[k] || 0) + 1; return r; }, {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)}  ${prefixo}${k}`);
console.log([...linhas(reprovam), ...linhas(todas.filter(x => SO_AVISO.has(x.regra)), 'aviso · ')].join('\n') || 'Regra das cores e largura: tudo certo.');
process.exitCode = reprovam.length ? 1 : 0;
