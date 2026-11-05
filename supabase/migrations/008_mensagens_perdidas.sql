-- Mensagens que não chegavam no OficinaZap.
-- 1) Contatos com número oculto (@lid): o WhatsApp às vezes manda só o id anônimo, sem o número.
--    Guardamos aqui o número de cada @lid sempre que ele aparece, para usar quando vier sem.
-- 2) Rede de segurança: a cada 2 minutos o OficinaZap confere na Evolution as mensagens
--    que não entraram (webhook perdido num reinício, @lid sem número etc.) e as recupera.

create table if not exists wa_lid_map (
  lid text primary key,          -- só os dígitos do @lid
  phone text not null,           -- só os dígitos do número real
  updated_at timestamptz not null default now()
);
alter table wa_lid_map enable row level security;

-- Buscas rápidas na tabela de mensagens da Evolution (por horário e por conversa).
create index if not exists "Message_messageTimestamp_idx" on evolution_api."Message" ("messageTimestamp");
create index if not exists "Message_remoteJid_idx" on evolution_api."Message" ((key->>'remoteJid'));

-- Aprende o número dos @lid com o que já está guardado na Evolution.
insert into wa_lid_map (lid, phone)
select distinct on (split_part(key->>'remoteJid', '@', 1))
  split_part(key->>'remoteJid', '@', 1),
  split_part(coalesce(key->>'remoteJidAlt', key->>'senderPn'), '@', 1)
from evolution_api."Message"
where key->>'remoteJid' like '%@lid'
  and coalesce(key->>'remoteJidAlt', key->>'senderPn') like '%@s.whatsapp.net'
order by split_part(key->>'remoteJid', '@', 1), "messageTimestamp" desc
on conflict (lid) do update set phone = excluded.phone, updated_at = now();

-- Cada mensagem nova na Evolution que traz o número junto do @lid ensina o mapa.
-- Protegido: um erro aqui nunca impede a Evolution de gravar a mensagem.
create or replace function zap_aprender_lid() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  alt text := coalesce(new.key->>'remoteJidAlt', new.key->>'senderPn');
begin
  if new.key->>'remoteJid' like '%@lid' and alt like '%@s.whatsapp.net' then
    insert into public.wa_lid_map (lid, phone)
    values (split_part(new.key->>'remoteJid', '@', 1), split_part(alt, '@', 1))
    on conflict (lid) do update set phone = excluded.phone, updated_at = now()
    where wa_lid_map.phone is distinct from excluded.phone;
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists zap_aprender_lid on evolution_api."Message";
create trigger zap_aprender_lid after insert on evolution_api."Message"
for each row execute function zap_aprender_lid();

-- Número real de um @lid (null se ainda não for conhecido).
create or replace function zap_numero_do_lid(p_lid text) returns text
language sql stable security definer set search_path = public as $$
  select phone from public.wa_lid_map where lid = split_part(p_lid, '@', 1)
$$;

-- Mensagens guardadas na Evolution entre p_de e p_ate segundos atrás que não estão no OficinaZap.
-- Já devolve o número real no lugar do @lid quando ele é conhecido.
create or replace function zap_mensagens_perdidas(p_de int default 3600, p_ate int default 60)
returns table (instance text, rec jsonb)
language sql stable security definer set search_path = public as $$
  select i.name::text,
    jsonb_build_object(
      'key', case
        when m.key->>'remoteJid' like '%@lid' and coalesce(m.key->>'remoteJidAlt', m.key->>'senderPn') is null and l.phone is not null
          then m.key || jsonb_build_object('remoteJidAlt', l.phone || '@s.whatsapp.net')
        else m.key end,
      'pushName', m."pushName",
      'message', m.message,
      'messageTimestamp', m."messageTimestamp"
    )
  from evolution_api."Message" m
  join evolution_api."Instance" i on i.id = m."instanceId"
  left join public.wa_lid_map l on l.lid = split_part(m.key->>'remoteJid', '@', 1)
  where m."messageTimestamp" between extract(epoch from now())::int - p_de and extract(epoch from now())::int - p_ate
    and m.key->>'remoteJid' not like 'status@%'
    and m.key->>'id' is not null
    and m."messageType" in ('conversation', 'extendedTextMessage', 'imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage')
    -- @lid sem número conhecido fica para a próxima rodada (o número costuma aparecer logo).
    and (m.key->>'remoteJid' not like '%@lid' or coalesce(m.key->>'remoteJidAlt', m.key->>'senderPn') is not null or l.phone is not null)
    and not exists (select 1 from public.messages p where p.wa_message_id = m.key->>'id')
  order by m."messageTimestamp"
  limit 300
$$;

revoke all on function zap_mensagens_perdidas(int, int) from public, anon, authenticated;
revoke all on function zap_numero_do_lid(text) from public, anon, authenticated;
grant execute on function zap_mensagens_perdidas(int, int) to service_role;
grant execute on function zap_numero_do_lid(text) to service_role;
