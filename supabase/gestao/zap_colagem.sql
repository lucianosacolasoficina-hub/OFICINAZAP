-- Rodar no banco do SISTEMA DE GESTÃO (Supabase "gestao-sacolas"), não no do OficinaZap.
-- OficinaZap: situação da colagem (app Coladeira, tabelas col_*) dos pedidos do cliente.
-- Recebe ids de pedidos do sistema (docs col='pedidos') e devolve { "<id do pedido>": { resumo + OS de colagem } }.
-- A OS de colagem pode apontar direto para o pedido ou para uma OS de produção cuja origem é o pedido.
-- Só leitura; protegida pela mesma chave de integração das outras funções zap_*.
create or replace function public.zap_colagem(p_chave text, p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions'
as $function$
declare r jsonb;
begin
  if p_chave is null or not exists(select 1 from app.integracao_chaves where nome='oficinazap' and hash=encode(digest(p_chave,'sha256'),'hex')) then
    raise exception 'chave inválida';
  end if;
  with alvo as (
    select unnest(coalesce(p_ids,'{}'))::text as pid
  ), liga as (
    select a.pid, o.*
      from alvo a
      join col_os o on o.pedido_id = a.pid
                   or o.pedido_id in (select d.id from docs d where d.col='pedidos' and d.data->'origem'->>'id' = a.pid)
     where o.status <> 'cancelada'
  ), linhas as (
    select l.pid, l.numero, l.status, l.descricao, l.tamanho,
           coalesce(l.qtd_recebida, l.qtd_os, 0) as total,
           case when l.status='finalizada' and coalesce(l.qtd_produzida,0)=0 then coalesce(l.qtd_recebida, l.qtd_os, 0) else coalesce(l.qtd_produzida,0) end as feitas,
           coalesce(l.qtd_perda,0) as perda,
           l.previsao_fim, l.iniciado_em, l.finalizado_em, l.retirado_em, l.falta_material, l.atualizado_em,
           c.nome as coladeira,
           (select max(ap.em) from col_apontamentos ap where ap.os_id = l.id) as ultimo_apont
      from liga l left join col_coladeiras c on c.id = l.coladeira_id
  )
  select coalesce(jsonb_object_agg(pid, j), '{}'::jsonb) into r from (
    select pid, jsonb_build_object(
      'total', sum(total), 'feitas', sum(feitas), 'perda', sum(perda),
      'abertas', count(*) filter (where status in ('aguardando','em_servico')),
      'previsao', max(previsao_fim) filter (where status in ('aguardando','em_servico')),
      'semPrevisao', count(*) filter (where status in ('aguardando','em_servico') and previsao_fim is null),
      'concluida', bool_and(status='finalizada'),
      'faltaMaterial', coalesce(bool_or(coalesce(falta_material,'')<>'' and status<>'finalizada'),false),
      'atualizadoEm', max(greatest(atualizado_em, ultimo_apont)),
      'os', jsonb_agg(jsonb_build_object(
        'numero', numero, 'status', status, 'coladeira', coladeira, 'descricao', nullif(concat_ws(' ', descricao, tamanho),''),
        'total', total, 'feitas', feitas, 'perda', perda, 'previsao', previsao_fim,
        'iniciadoEm', iniciado_em, 'finalizadoEm', finalizado_em, 'retiradoEm', retirado_em,
        'faltaMaterial', nullif(falta_material,''), 'ultimoApontamento', ultimo_apont
      ) order by numero)
    ) j
    from linhas group by pid
  ) x;
  return r;
end $function$;

revoke all on function public.zap_colagem(text, text[]) from public;
grant execute on function public.zap_colagem(text, text[]) to anon, authenticated, service_role;
