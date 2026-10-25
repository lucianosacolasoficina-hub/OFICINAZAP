-- OficinaZap: vários números de WhatsApp (QR Code), cada um ligado a um departamento.
-- Rode este arquivo no SQL Editor do Supabase depois do 004_departments.sql.

create table if not exists whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- nome que aparece no card (ex.: Sacolas Oficina, Bia)
  instance text not null unique,         -- nome da instância na Evolution API
  phone text,                            -- número conectado, somente dígitos com DDI
  department_id uuid references departments (id) on delete set null,
  connected_at timestamptz,              -- quando o celular foi conectado (vazio = desconectado)
  created_at timestamptz not null default now()
);

alter table whatsapp_connections enable row level security;

-- De qual número veio a conversa (a resposta sai pelo mesmo número).
alter table conversations add column if not exists connection_id uuid references whatsapp_connections (id) on delete set null;
create index if not exists conversations_connection_idx on conversations (connection_id);

-- O número que já estava conectado (instância "oficina") vira o primeiro da lista.
insert into whatsapp_connections (name, instance)
values ('Sacolas Oficina', 'oficina')
on conflict (instance) do nothing;

update conversations
set connection_id = (select id from whatsapp_connections where instance = 'oficina')
where connection_id is null;
