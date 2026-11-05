-- Histórico em lotes que não passam do tempo limite do banco: lê os próximos N registros por horário
-- (índice "Message_instance_ts_idx") e só monta os que ainda não estão no OficinaZap; os outros vêm
-- com rec nulo para o marcador andar sem varrer a tabela inteira (conexões com 100 mil mensagens).
create or replace function zap_historico_lote(
  p_instance text, p_desde int, p_apos_ts int default 0, p_apos_id text default '', p_limite int default 300)
returns table (ts int, id text, rec jsonb)
language sql stable security definer set search_path = public as $$
  select m.ts, m.id,
    case when exists (select 1 from public.messages p where p.wa_message_id = m.id) then null else jsonb_build_object(
      'key', case
        when m.key->>'remoteJid' like '%@lid' and coalesce(m.key->>'remoteJidAlt', m.key->>'senderPn') is null and l.phone is not null
          then m.key || jsonb_build_object('remoteJidAlt', l.phone || '@s.whatsapp.net')
        else m.key end,
      'pushName', m."pushName",
      'message', m.message,
      'messageTimestamp', m.ts) end
  from (
    select x."messageTimestamp"::int ts, x.key->>'id' id, x.key, x."pushName", x.message
    from evolution_api."Message" x
    where x."instanceId" = (select i.id from evolution_api."Instance" i where i.name = p_instance)
      and x."messageTimestamp" >= greatest(p_desde, p_apos_ts)
      and (x."messageTimestamp" > p_apos_ts or x.key->>'id' > p_apos_id)
      and x.key->>'id' is not null
      and x.key->>'remoteJid' not like 'status@%'
      and x."messageType" in ('conversation', 'extendedTextMessage', 'imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage')
    order by x."messageTimestamp", x.key->>'id'
    limit p_limite) m
  left join public.wa_lid_map l on l.lid = split_part(m.key->>'remoteJid', '@', 1)
  order by m.ts, m.id
$$;
revoke all on function zap_historico_lote(text, int, int, text, int) from public, anon, authenticated;
grant execute on function zap_historico_lote(text, int, int, text, int) to service_role;
