import { route } from "@/lib/api";
import { getAlertas, limpaCacheAlertas, normalizaAlertas, type Alertas } from "@/lib/alertas";
import { getSetting, setSetting } from "@/lib/db";

export const GET = route(async () => ({
  bot_enabled: await getSetting("bot_enabled", true),
  knowledge_base: await getSetting("knowledge_base", ""),
  alertas: await getAlertas(),
}));

export const PUT = route(async (req) => {
  const body = (await req.json()) as { bot_enabled?: boolean; knowledge_base?: string; alertas?: Partial<Alertas> };
  if (typeof body.bot_enabled === "boolean") await setSetting("bot_enabled", body.bot_enabled);
  if (typeof body.knowledge_base === "string") await setSetting("knowledge_base", body.knowledge_base);
  if (body.alertas && typeof body.alertas === "object") {
    await setSetting("alertas", normalizaAlertas(body.alertas));
    limpaCacheAlertas();
  }
});
