// Só no servidor Node: busca e-mails novos (Outlook e Gmail) a cada minuto.
import { sincronizarTodos } from "./lib/email";
import { sincronizarTodosImap } from "./lib/emailImap";
import { sincronizarGoogle } from "./lib/googleSync";
import { preencherFotos } from "./lib/fotos";

setInterval(() => {
  sincronizarTodos().catch((e) => console.error("sync e-mail", e));
  sincronizarTodosImap().catch((e) => console.error("sync gmail", e));
}, 60_000);

// Contatos com o Google Contatos (nos dois sentidos) a cada 15 minutos.
setInterval(() => {
  sincronizarGoogle().catch((e) => console.error("sync Google Contatos", e));
}, 15 * 60_000);

// Fotos de perfil do WhatsApp: busca aos poucos (25 por minuto) para a lista abrir já com as fotos.
setInterval(() => {
  preencherFotos(25).catch((e) => console.error("fotos dos contatos", e));
}, 60_000);
