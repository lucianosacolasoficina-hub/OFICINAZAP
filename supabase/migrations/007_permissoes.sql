-- Permissões por atendente: o administrador escolhe o que cada um pode fazer.
alter table agents add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table agents add column if not exists active boolean not null default true;
-- O primeiro usuário cadastrado vira administrador (dono do sistema).
update agents set role = 'admin' where id = (select id from agents order by created_at limit 1) and not exists (select 1 from agents where role = 'admin');
