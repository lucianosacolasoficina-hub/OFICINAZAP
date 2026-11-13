-- 019: recursos do WhatsApp Business no OficinaZap.

-- Tracinhos das mensagens enviadas: enviada (✓), entregue (✓✓) e lida (✓✓ azul).
alter table public.messages add column if not exists entrega text check (entrega in ('enviada', 'entregue', 'lida'));
alter table public.messages add column if not exists entrega_em timestamptz;
create index if not exists messages_entrega_em_idx on public.messages (conversation_id, entrega_em) where entrega_em is not null;

-- Conversas fixadas no topo da lista.
alter table public.conversations add column if not exists fixada_em timestamptz;

-- Mensagens agendadas para sair num dia e hora.
create table if not exists public.agendadas (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete set null,
  body text not null,
  enviar_em timestamptz not null,
  status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviada', 'erro', 'cancelada')),
  erro text,
  message_id uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists agendadas_fila_idx on public.agendadas (status, enviar_em);
create index if not exists agendadas_conversa_idx on public.agendadas (conversation_id, status);
alter table public.agendadas enable row level security;
