# Publicar a função `dre-financas` (Supabase)

O código já está commitado. Falta **publicar** a Edge Function — isso exige uma
credencial do Supabase que eu não tenho. São 3 comandos, uma vez só.

---

## O que muda nesta publicação

Duas alterações pequenas em `supabase/functions/dre-financas/index.ts`:

1. **O extrator passa a entender resposta de item único.** Hoje
   `contas-receber/{id}` e `ordem-servico/numero/{n}` respondem certo, mas a
   função devolve lista vazia porque só sabia ler array ou `{data:[...]}`.
2. **Nova ação `raw`** — devolve a resposta do Mubisys sem interpretar. Serve
   para eu mapear endpoint novo sem ficar adivinhando.

Nada existente muda de comportamento. É seguro.

---

## Como publicar

### 1. Instalar a CLI do Supabase (só na primeira vez)

```bash
brew install supabase/tap/supabase
```

### 2. Entrar na conta

```bash
supabase login
```

Abre o navegador e você autoriza. A credencial fica salva no seu Mac.

### 3. Publicar a função

```bash
supabase functions deploy dre-financas --project-ref heveemylixartyijxewh
```

Rode de dentro da pasta do projeto (onde está a pasta `supabase/`).

---

## Conferir se deu certo

```bash
curl -s -X POST https://heveemylixartyijxewh.supabase.co/functions/v1/dre-financas -H 'content-type: application/json' -H 'x-token: tok_55606031e843116d7d944c7c1503afd663e742cc' -d '{"action":"raw","recurso":"ordem-servico/numero/22381"}'
```

Se voltar um JSON com os dados da OS (e não `{"erro":...}`), funcionou. Pode me
mandar a resposta que eu sigo daqui.

---

## Por que isso destrava a alimentação automática

Descobri a regra que explica tudo (medido em 258 recebimentos de julho):

| `tipo` do título | tem plano de contas? | quantos |
|---|---|---:|
| Receita **operacional** | ❌ nunca | 228 |
| Receita **não operacional** | ✅ sempre | 30 |

Não é cadastro incompleto. No Mubisys a **venda é classificada pela Ordem de
Serviço**, não pelo título financeiro — o título só aponta para a OS (campo
`despesa` guarda o número). Os produtos vendidos moram nos **itens da OS**.

Com o extrator corrigido eu consigo ler a OS, casar recebimento → OS → itens, e
aí a receita fica classificada. Hoje o robô só enxerga os 30 títulos não
operacionais, por isso a prévia mostra R$ 205 mil de receita em vez de R$ 460 mil.

---

## Alternativa, se preferir não instalar nada

Dá para publicar pelo painel do Supabase (Edge Functions → dre-financas → editar
e colar o arquivo), mas pela CLI é mais seguro: publica exatamente o que está no
Git, sem risco de colar errado.
