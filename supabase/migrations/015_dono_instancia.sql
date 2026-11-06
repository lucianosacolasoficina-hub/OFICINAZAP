-- Número do celular de uma instância, lido direto do banco da Evolution
-- (o /instance/fetchInstances da Evolution conta todas as mensagens e segurava conexões do banco por minutos).
create or replace function zap_dono_instancia(p_instance text) returns text
language sql stable security definer set search_path = public as $$
  select split_part(split_part("ownerJid", '@', 1), ':', 1) from evolution_api."Instance" where name = p_instance
$$;
revoke all on function zap_dono_instancia(text) from public, anon, authenticated;
grant execute on function zap_dono_instancia(text) to service_role;
