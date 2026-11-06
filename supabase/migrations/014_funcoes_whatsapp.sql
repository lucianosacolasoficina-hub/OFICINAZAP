-- Caixa de conversa com as funções do WhatsApp Business: reações, favoritar (estrela) e editar mensagem.
-- reacoes: {"nos": "👍", "cliente": "❤️"} (a reação de cada lado na mensagem).
alter table public.messages add column if not exists reacoes jsonb not null default '{}'::jsonb;
alter table public.messages add column if not exists favorita boolean not null default false;
alter table public.messages add column if not exists editada boolean not null default false;
create index if not exists messages_favorita_idx on public.messages (conversation_id) where favorita;
