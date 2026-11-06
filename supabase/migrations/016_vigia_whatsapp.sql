-- Vigia dos números: hora da última mensagem (recebida ou enviada) que a Evolution guardou para a instância.
create or replace function zap_ultima_mensagem(p_instance text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select to_timestamp(max(m."messageTimestamp"))
  from evolution_api."Message" m
  where m."instanceId" = (select i.id from evolution_api."Instance" i where i.name = p_instance)
    and m."messageTimestamp" > extract(epoch from now() - interval '2 days')
$$;
revoke all on function zap_ultima_mensagem(text) from public, anon, authenticated;
grant execute on function zap_ultima_mensagem(text) to service_role;
