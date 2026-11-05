-- Puxar histórico sem pesar na Evolution: lê as mensagens direto da tabela que a Evolution grava
-- (mesmo banco), em lotes, a partir de um marcador (horário + id). Já troca o @lid pelo número real
-- quando ele é conhecido e pula as que já estão no OficinaZap.
create or replace function zap_historico_do_banco(
  p_instance text, p_desde int, p_apos_ts int default 0, p_apos_id text default '', p_limite int default 200)
returns table (ts int, id text, rec jsonb)
language sql stable security definer set search_path = public as $$
  select m."messageTimestamp"::int, m.key->>'id',
    jsonb_build_object(
      'key', case
        when m.key->>'remoteJid' like '%@lid' and coalesce(m.key->>'remoteJidAlt', m.key->>'senderPn') is null and l.phone is not null
          then m.key || jsonb_build_object('remoteJidAlt', l.phone || '@s.whatsapp.net')
        else m.key end,
      'pushName', m."pushName",
      'message', m.message,
      'messageTimestamp', m."messageTimestamp")
  from evolution_api."Message" m
  join evolution_api."Instance" i on i.id = m."instanceId"
  left join public.wa_lid_map l on l.lid = split_part(m.key->>'remoteJid', '@', 1)
  where i.name = p_instance
    and m.key->>'id' is not null
    and m."messageTimestamp" >= greatest(p_desde, p_apos_ts)
    and (m."messageTimestamp" > p_apos_ts or m.key->>'id' > p_apos_id)
    and m.key->>'remoteJid' not like 'status@%'
    and m."messageType" in ('conversation', 'extendedTextMessage', 'imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage')
    and not exists (select 1 from public.messages p where p.wa_message_id = m.key->>'id')
  order by m."messageTimestamp", m.key->>'id'
  limit p_limite
$$;

revoke all on function zap_historico_do_banco(text, int, int, text, int) from public, anon, authenticated;
grant execute on function zap_historico_do_banco(text, int, int, text, int) to service_role;
