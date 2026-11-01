// Só no servidor Node: busca e-mails novos (Outlook e Gmail) a cada minuto.
import { sincronizarTodos } from "./lib/email";
import { sincronizarTodosImap } from "./lib/emailImap";

setInterval(() => {
  sincronizarTodos().catch((e) => console.error("sync e-mail", e));
  sincronizarTodosImap().catch((e) => console.error("sync gmail", e));
}, 60_000);
