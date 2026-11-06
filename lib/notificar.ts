// Mostra um aviso do sistema. No celular (Android) o aviso precisa sair pelo service worker do app;
// no computador também funciona assim, e se não houver service worker cai no aviso comum do navegador.
export async function notificar(titulo: string, opcoes: NotificationOptions & { url?: string } = {}) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  const { url, ...resto } = opcoes;
  const op: NotificationOptions = { icon: "/icon-192.png", badge: "/icon-96.png", ...resto, data: { url: url || location.pathname + location.search } };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(titulo, op);
      return;
    }
  } catch {}
  try {
    const n = new Notification(titulo, op);
    n.onclick = () => window.focus();
  } catch {}
}
