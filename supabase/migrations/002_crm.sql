-- OficinaZap: funil de vendas (Fase 2)
-- Rode este arquivo no SQL Editor do Supabase depois do 001_init.sql.

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  title text not null,
  stage text not null default 'novo'
    check (stage in ('novo', 'orcamento', 'arte', 'fechado', 'producao', 'entregue', 'perdido')),
  value numeric(12, 2),
  notes text,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_stage_idx on deals (stage, position);
create index if not exists deals_contact_idx on deals (contact_id);

alter table deals enable row level security;

-- Arquivos recebidos no WhatsApp (imagens etc.), em bucket privado
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;
