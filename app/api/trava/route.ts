import { route } from "@/lib/api";
import { listConnections } from "@/lib/connections";
import { contagem, contagemFrios, getLimites, lerAvisos, marcarAvisosLidos, salvarLimites, type Limites } from "@/lib/whatsapp/trava";

// Trava contra envio em massa no WhatsApp: ajustes, contagem de cada número e avisos para o master.
export const GET = route(async (req) => {
  // Só a contagem de primeiros contatos de um número (painel "Nova conversa" da Central).
  const conn = new URL(req.url).searchParams.get("frios");
  if (conn) return contagemFrios(conn);
  const conns = (await listConnections()).filter((c) => !c.channel || c.channel === "whatsapp");
  const numeros = await Promise.all(conns.map(async (c) => ({ id: c.id, nome: c.name, instance: c.instance, phone: c.phone, ...contagem(c.instance), frios: await contagemFrios(c.id) })));
  const nomes = new Map(conns.map((c) => [c.instance, c.name]));
  const avisos = (await lerAvisos()).slice(0, 15).map((a) => ({ ...a, nome: nomes.get(a.instance) ?? a.instance }));
  return { limites: await getLimites(), numeros, avisos };
});

export const PUT = route(async (req) => {
  const body = (await req.json()) as { limites?: Partial<Limites>; lidos?: boolean };
  if (body.limites && typeof body.limites === "object") await salvarLimites(body.limites);
  if (body.lidos) await marcarAvisosLidos();
});
