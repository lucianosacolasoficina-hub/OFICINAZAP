-- Contatos sem nome: busca o nome de perfil do WhatsApp (pushName) que a própria pessoa mandou
-- numa mensagem recebida, pelo número (@s.whatsapp.net) ou pelo número oculto (@lid) já conhecido.
-- Só mensagens recebidas (fromMe = false) e fora de grupo, para não pegar o nome do atendente.
create or replace function zap_nomes_do_whatsapp(p_limite int default 500)
returns table (contact_id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select s.id, n.nome
  from (
    select c.id, c.phone from contacts c
    where not c.is_group and c.phone ~ '^\d{10,15}$'
      and (c.name is null or btrim(c.name) = '' or c.name ~ '^[+\d\s().-]+$')
    order by c.created_at desc
    limit p_limite
  ) s
  cross join lateral (
    select btrim(m."pushName") as nome
    from evolution_api."Message" m
    where m."key"->>'remoteJid' in (
        select s.phone || '@s.whatsapp.net'
        union all
        select l.lid || '@lid' from wa_lid_map l where l.phone = s.phone
      )
      and coalesce(m."key"->>'fromMe', 'false') = 'false'
      and btrim(coalesce(m."pushName", '')) <> ''
      and m."pushName" !~ '^[+\d\s().~-]+$'
    order by m."messageTimestamp" desc
    limit 1
  ) n
$$;
revoke all on function zap_nomes_do_whatsapp(int) from public, anon, authenticated;
grant execute on function zap_nomes_do_whatsapp(int) to service_role;
