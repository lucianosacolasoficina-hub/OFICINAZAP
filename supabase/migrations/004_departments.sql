-- OficinaZap: departamentos (setores) para organizar o atendimento.
-- Rode este arquivo no SQL Editor do Supabase depois do 003_bling.sql.

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Quando a IA deve mandar o cliente para este departamento (ela lê este texto).
  description text not null default '',
  color text not null default '#128c4a',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Quais atendentes trabalham em cada departamento
create table if not exists department_agents (
  department_id uuid not null references departments (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  primary key (department_id, agent_id)
);

alter table conversations add column if not exists department_id uuid references departments (id) on delete set null;
create index if not exists conversations_department_idx on conversations (department_id);

-- Mesmos departamentos usados hoje no ZapResponder (dá para editar na tela Departamentos).
insert into departments (name, description, color) values
  ('Vendas', 'Orçamentos, preços, pedidos novos e dúvidas sobre produtos.', '#128c4a'),
  ('Instagram', '', '#c13584'),
  ('Bia', '', '#2b6cb0'),
  ('Lorena', '', '#b83280'),
  ('Carlos design', 'Criação e aprovação de arte, ajustes na logo e no layout da sacola.', '#6b46c1'),
  ('Luciano pessoal', '', '#4a5568'),
  ('Mkt sacolasoficina', '', '#c05621')
on conflict (name) do nothing;

alter table departments enable row level security;
alter table department_agents enable row level security;
