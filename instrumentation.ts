// Roda uma vez quando o servidor sobe: busca e-mails novos (Outlook e Gmail) a cada minuto.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { sincronizarTodos } = await import("./lib/email");
  const { sincronizarTodosImap } = await import("./lib/emailImap");
  setInterval(() => {
    sincronizarTodos().catch((e) => console.error("sync e-mail", e));
    sincronizarTodosImap().catch((e) => console.error("sync gmail", e));
  }, 60_000);
}
