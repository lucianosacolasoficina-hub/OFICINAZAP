-- Responder (citar) mensagens na tela de Conversas: guarda qual mensagem foi citada,
-- para a citação aparecer em cima do balão no OficinaZap, como no WhatsApp.
-- Sem esta coluna a resposta citada sai normalmente no WhatsApp; só não aparece a citação aqui.
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
