-- OficinaZap: estrutura inicial do banco (Fase 1)
-- Rode este arquivo no SQL Editor do Supabase.

-- Atendentes (ligados aos usuários do Supabase Auth)
create table if not exists agents (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role text not null default 'agent' check (role in ('admin', 'agent')),
  created_at timestamptz not null default now()
);

-- Cria o atendente automaticamente quando um usuário é cadastrado no Auth
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into agents (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,          -- somente dígitos, com DDI (ex.: 5511999998888)
  name text,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

-- status: bot = IA atendendo | waiting = aguardando humano | open = humano atendendo | closed = resolvida
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id) on delete cascade,
  status text not null default 'bot' check (status in ('bot', 'waiting', 'open', 'closed')),
  assigned_to uuid references agents (id) on delete set null,
  unread_count int not null default 0,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  created_at timestamptz not null default now()
);
create index if not exists conversations_last_message_idx on conversations (last_message_at desc);
create index if not exists conversations_contact_idx on conversations (contact_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  sender text not null check (sender in ('contact', 'bot', 'agent', 'system')),
  agent_id uuid references agents (id) on delete set null,
  body text not null default '',
  media_type text,                      -- image | audio | video | document
  media_url text,
  wa_message_id text unique,            -- id da mensagem no WhatsApp (evita duplicadas)
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);

-- Dados de orçamento coletados pela IA
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  data jsonb not null default '{}',
  status text not null default 'novo' check (status in ('novo', 'enviado', 'fechado', 'perdido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quick_replies (
  id uuid primary key default gen_random_uuid(),
  shortcut text not null unique,        -- usado com "/" no chat, ex.: /pix
  body text not null,
  created_at timestamptz not null default now()
);

-- Configurações gerais (chave/valor)
create table if not exists settings (
  key text primary key,
  value jsonb not null
);

insert into settings (key, value) values
  ('bot_enabled', 'true'),
  ('knowledge_base', to_jsonb(
'Empresa: Sacolas Oficina, fabricante de sacolas personalizadas.

Produtos: (descreva aqui os tipos de sacola, ex.: sacola de papel kraft, sacola plástica alça vazada, ecobag de algodão, TNT)
Tamanhos disponíveis: (liste)
Pedido mínimo: (ex.: 500 unidades)
Prazo de produção: (ex.: 15 dias úteis após aprovação da arte)
Formas de pagamento: (ex.: Pix, boleto, cartão)
Frete: (como é calculado)
Horário de atendimento humano: (ex.: seg a sex, 8h às 18h)'::text)),
  ('greeting', to_jsonb('Olá! Aqui é da Sacolas Oficina 👋 Como posso te ajudar?'::text))
on conflict (key) do nothing;

-- Segurança: o app acessa o banco somente pelo servidor (service role).
-- Ativamos RLS sem políticas para bloquear acesso direto pelo navegador.
alter table agents enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table quotes enable row level security;
alter table quick_replies enable row level security;
alter table settings enable row level security;
