-- OficinaZap: tela de conversas nova (filtros, grupos e tempo de espera).
-- Rode este arquivo no SQL Editor do Supabase depois do 005_whatsapp_numeros.sql.

-- Grupos do WhatsApp viram um "contato" marcado como grupo (o telefone guarda o id do grupo).
alter table contacts add column if not exists is_group boolean not null default false;

-- Desde quando o cliente está esperando resposta (vazio = já foi respondido).
alter table conversations add column if not exists waiting_since timestamptz;
create index if not exists conversations_status_idx on conversations (status, last_message_at desc);
create index if not exists conversations_assigned_idx on conversations (assigned_to);

-- Conversas que já existiam: está esperando quem mandou a última mensagem e ainda não teve resposta.
update conversations c
set waiting_since = (
  select min(m.created_at) from messages m
  where m.conversation_id = c.id and m.direction = 'in'
    and m.created_at > coalesce(
      (select max(o.created_at) from messages o
       where o.conversation_id = c.id and o.direction = 'out' and o.sender in ('agent', 'bot')),
      '-infinity'::timestamptz)
)
where c.status <> 'closed' and c.waiting_since is null;
