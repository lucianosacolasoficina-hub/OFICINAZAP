import { route } from "@/lib/api";
import { sincronizarTodos } from "@/lib/email";

// Busca e-mails novos agora (a tela chama de tempos em tempos; o servidor também busca a cada minuto).
export const POST = route(async () => {
  await sincronizarTodos();
  return { ok: true };
});
