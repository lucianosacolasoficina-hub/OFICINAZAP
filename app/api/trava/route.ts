import { route } from "@/lib/api";
import { listConnections } from "@/lib/connections";
import { contagem, getLimites, lerAvisos, liberarNumero, marcarAvisosLidos, pausaDe, salvarLimites, type Limites } from "@/lib/whatsapp/trava";

// Trava de envio do WhatsApp: limites, contagem de cada número, pausas e avisos para o master.
export const GET = route(async () => {
  const conns = (await listConnections()).filter((c) => !c.channel || c.channel === "whatsapp");
  const numeros = await Promise.all(
    conns.map(async (c) => ({ id: c.id, nome: c.name, instance: c.instance, phone: c.phone, ...contagem(c.instance), pausa: await pausaDe(c.instance) })),
  );
  const nomes = new Map(conns.map((c) => [c.instance, c.name]));
  const avisos = (await lerAvisos()).slice(0, 15).map((a) => ({ ...a, nome: nomes.get(a.instance) ?? a.instance }));
  return { limites: await getLimites(), numeros, avisos };
});

export const PUT = route(async (req) => {
  const body = (await req.json()) as { limites?: Partial<Limites>; liberar?: string; lidos?: boolean };
  if (body.limites && typeof body.limites === "object") await salvarLimites(body.limites);
  if (typeof body.liberar === "string") await liberarNumero(body.liberar);
  if (body.lidos) await marcarAvisosLidos();
});
