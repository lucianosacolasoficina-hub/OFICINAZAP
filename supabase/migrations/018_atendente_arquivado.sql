-- Central de permissões do sistema de gestão: botão ✕ do atendente.
-- Sem histórico: exclui. Com histórico (conversas, mensagens, tarefas): sai da lista e fica desativado.
alter table public.agents add column if not exists archived_at timestamptz;
