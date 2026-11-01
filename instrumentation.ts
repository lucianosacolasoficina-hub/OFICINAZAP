// Roda uma vez quando o servidor sobe: busca e-mails novos do Outlook a cada minuto.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { sincronizarTodos } = await import("./lib/email");
  setInterval(() => {
    sincronizarTodos().catch((e) => console.error("sync e-mail", e));
  }, 60_000);
}
