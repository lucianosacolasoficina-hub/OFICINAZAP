// Só no servidor Node: busca e-mails novos (Outlook e Gmail) a cada minuto.
import { sincronizarTodos } from "./lib/email";
import { sincronizarTodosImap } from "./lib/emailImap";
import { sincronizarGoogle } from "./lib/googleSync";

setInterval(() => {
  sincronizarTodos().catch((e) => console.error("sync e-mail", e));
  sincronizarTodosImap().catch((e) => console.error("sync gmail", e));
}, 60_000);

// Contatos com o Google Contatos (nos dois sentidos) a cada 15 minutos.
setInterval(() => {
  sincronizarGoogle().catch((e) => console.error("sync Google Contatos", e));
}, 15 * 60_000);
