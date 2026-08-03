// auth.js — a porta do DRE: UMA senha de entrada, conferida no SERVIDOR.
//
// POR QUE MUDOU
// Até aqui o DRE tinha uma lista de usuários dentro do localStorage de CADA
// navegador, com a senha passada por um embaralhamento caseiro (djb2 com um
// prefixo fixo) que não é hash: quem abrisse o DevTools lia e desfazia. E como
// a lista era por aparelho, "criar acesso" não criava acesso nenhum — criava
// uma anotação naquele celular. Qualquer aparelho novo caía na tela de "criar
// master" e entrava.
//
// Agora a porta é uma senha só, guardada no banco em PBKDF2 (o mesmo mecanismo
// do Painel, do Brief e do PCP) e conferida do outro lado. A senha se troca pela
// Central de Acessos — não de dentro do DRE.
//
// O crachá vale 30 dias: quem entrou uma vez com internet segue trabalhando.

const AUTH = (() => {
  const URL_AUTH = API_BASE + '/equipe-auth';
  const SISTEMA = 'dre';
  const USUARIO = 'equipe';          // é uma porta, não um quadro de gente
  const K_TOKEN = 'impresilk_dre_cracha';

  const pegar = () => localStorage.getItem(K_TOKEN) || '';
  const guardar = t => { if (t) localStorage.setItem(K_TOKEN, t); };
  const esquecer = () => localStorage.removeItem(K_TOKEN);

  async function chamar(acao, corpo, comCracha) {
    const cab = { 'Content-Type': 'application/json' };
    if (comCracha) cab['Authorization'] = 'Bearer ' + pegar();
    const r = await fetch(URL_AUTH, {
      method: 'POST', headers: cab,
      body: JSON.stringify(Object.assign({ acao, sistema: SISTEMA }, corpo || {})),
    });
    let dados = {};
    try { dados = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) throw Object.assign(new Error(dados.erro || ('HTTP ' + r.status)), { status: r.status, erro: dados.erro });
    return dados;
  }

  return {
    temCracha: () => !!pegar(),
    esquecer,
    async entrar(senha) {
      const r = await chamar('login', { usuario: USUARIO, senha });
      guardar(r.token);
      return r;
    },
    // null = sem internet (segue com o crachá do aparelho); false = crachá morto
    async conferir() { try { return await chamar('eu', {}, true); } catch (e) { return e.status === 401 ? false : null; } },
    trocarSenha(senhaAtual, novaSenha) { return chamar('trocarMinhaSenha', { senhaAtual, novaSenha }, true); },
  };
})();
