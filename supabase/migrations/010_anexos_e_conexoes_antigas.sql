-- Anexos das mensagens que entraram sem o arquivo (histórico importado, enviadas pelo celular):
-- o OficinaZap baixa aos poucos. media_tentativas evita insistir para sempre (9 = desistiu).
alter table public.messages add column if not exists media_tentativas smallint not null default 0;
create index if not exists messages_midia_pendente_idx on public.messages (created_at desc) where media_url is null and media_type is not null;
create index if not exists "Message_keyid_idx" on evolution_api."Message" ((key->>'id'));

-- Conexões da Evolution do mesmo celular (inclusive antigas, de cards excluídos), a aberta primeiro.
create or replace function zap_instancias_do_numero(p_phone text) returns setof text
language sql stable security definer set search_path = public as $$
  select name::text from evolution_api."Instance"
  where split_part("ownerJid", '@', 1) = p_phone
  order by ("connectionStatus" = 'open') desc, "createdAt" desc
$$;

-- Próximos anexos a baixar (mais novos primeiro), com a mensagem original guardada na Evolution.
create or replace function zap_midias_pendentes(p_limite int default 20)
returns table (id uuid, conversation_id uuid, media_type text, wa_message_id text, instance text, aberta boolean, message jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.conversation_id, p.media_type, p.wa_message_id, e.name, e.aberta, e.message
  from (select * from public.messages
        where media_url is null and media_type is not null and media_tentativas < 3 and wa_message_id is not null
        order by created_at desc limit p_limite) p
  left join lateral (
    select i.name::text name, i."connectionStatus" = 'open' aberta, m.message
    from evolution_api."Message" m join evolution_api."Instance" i on i.id = m."instanceId"
    where m.key->>'id' = p.wa_message_id
    order by (i."connectionStatus" = 'open') desc limit 1) e on true
$$;

revoke all on function zap_instancias_do_numero(text) from public, anon, authenticated;
revoke all on function zap_midias_pendentes(int) from public, anon, authenticated;
grant execute on function zap_instancias_do_numero(text) to service_role;
grant execute on function zap_midias_pendentes(int) to service_role;
