// Só no servidor Node: busca e-mails novos (Outlook e Gmail) a cada minuto.
import { sincronizarTodos } from "./lib/email";
import { sincronizarTodosImap } from "./lib/emailImap";
import { sincronizarGoogle } from "./lib/googleSync";
import { preencherFotos } from "./lib/fotos";
import { retomarHistoricos } from "./lib/historico";
import { baixarMidiasPendentes } from "./lib/midias";
import { recuperarPerdidas } from "./lib/recuperar";
import { vigiarNumeros } from "./lib/vigia";

// Nenhuma chamada externa (Supabase, Google, Microsoft, Instagram, Bling, sistema de gestão) pode ficar
// pendurada para sempre: sem prazo, uma resposta que nunca vem prende a tarefa automática que a fez
// (e-mail, fotos, conferência de mensagens param de rodar) e acumula memória. Prazo padrão de 90 s;
// quem já define o próprio prazo continua com o seu.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (init?.signal || (typeof Request !== "undefined" && input instanceof Request && input.signal && !init)) return fetchOriginal(input, init);
  return fetchOriginal(input, { ...init, signal: AbortSignal.timeout(90_000) });
}) as typeof fetch;

setInterval(() => {
  sincronizarTodos().catch((e) => console.error("sync e-mail", e));
  sincronizarTodosImap().catch((e) => console.error("sync gmail", e));
}, 60_000);

// Contatos com o Google Contatos (nos dois sentidos) a cada 5 minutos, e 1 minuto depois de subir.
setTimeout(() => {
  sincronizarGoogle().catch((e) => console.error("sync Google Contatos", e));
}, 60_000);
setInterval(() => {
  sincronizarGoogle().catch((e) => console.error("sync Google Contatos", e));
}, 5 * 60_000);

// Fotos de perfil do WhatsApp: busca aos poucos (25 por minuto) para a lista abrir já com as fotos.
setInterval(() => {
  preencherFotos(25).catch((e) => console.error("fotos dos contatos", e));
}, 60_000);

// Mensagens do WhatsApp que não chegaram pelo webhook (reinício, queda, número oculto): confere a cada 2 minutos.
// Ao subir, olha as últimas 12 horas para trazer o que se perdeu enquanto estava fora.
setTimeout(() => {
  recuperarPerdidas(12 * 3600).catch((e) => console.error("recuperar mensagens", e));
}, 30_000);
setInterval(() => {
  recuperarPerdidas().catch((e) => console.error("recuperar mensagens", e));
}, 2 * 60_000);

// "Puxar conversas antigas" pedido ou interrompido por um reinício: continua sozinho ao subir.
setTimeout(() => {
  retomarHistoricos().catch((e) => console.error("retomar histórico", e));
}, 90_000);

// Anexos que entraram sem o arquivo (histórico importado, enviados pelo celular): 20 por minuto,
// para não disputar o banco com a Evolution.
setInterval(() => {
  baixarMidiasPendentes(20).catch((e) => console.error("anexos pendentes", e));
}, 60_000);

// Vigia dos números: a cada 5 minutos confere se algum número "conectado" travou por dentro.
setInterval(() => {
  vigiarNumeros().catch((e) => console.error("vigia dos números", e));
}, 5 * 60_000);

// Diário de saúde: a cada 30 minutos anota no log quanta memória o servidor está usando,
// para enxergar cedo se algo voltar a acumular.
setInterval(() => {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  console.log(`memória: total ${mb(m.rss)} MB, heap ${mb(m.heapUsed)}/${mb(m.heapTotal)} MB, externa ${mb(m.external)} MB`);
}, 30 * 60_000);
