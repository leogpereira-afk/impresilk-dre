-- ============================================================================
-- DRE Caixa no Supabase (substitui o Netlify Blobs).
--
-- PROJETO COMPARTILHADO: aqui moram RH (nomes CRUS), Brief (brief_*), PCP
-- (pcp_*), Central do Leo (leo_*) e Painel (painel_*). Tudo daqui leva o
-- prefixo dre_.
--
-- De-para dos stores:
--   os-registros -> dre_registros (colecao='os')   [as tabelas mensais da DRE]
--   os-config    -> dre_config_global
--   os-fotos     -> bucket dre-arquivos            [kit padrao; quase nao usado]
--   integracoes  -> dre_meta (credenciais do Mubisys)
--
-- O cron @hourly do Netlify era so keepalive dos Blobs ("manter quente").
-- No Postgres nada esfria: ele morre SEM substituto, de proposito.
-- ============================================================================

create table if not exists public.dre_registros (
  colecao       text not null,
  id            text not null,
  registro      jsonb not null,
  atualizado_em timestamptz not null default now(),
  apagado       boolean not null default false,
  primary key (colecao, id)
);
create index if not exists dre_registros_colecao_idx on public.dre_registros (colecao);
alter table public.dre_registros enable row level security;

create table if not exists public.dre_config_global (
  id            boolean primary key default true check (id),
  config        jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.dre_config_global enable row level security;

create table if not exists public.dre_meta (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.dre_meta enable row level security;

insert into storage.buckets (id, name, public)
values ('dre-arquivos', 'dre-arquivos', false)
on conflict (id) do nothing;
