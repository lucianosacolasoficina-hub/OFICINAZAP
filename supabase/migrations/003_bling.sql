-- Integração com o Bling: guarda o código do cliente e do pedido criados lá.
alter table contacts add column if not exists bling_id bigint;
alter table deals add column if not exists bling_order_id bigint;
alter table deals add column if not exists bling_order_number text;
alter table deals add column if not exists bling_error text;
