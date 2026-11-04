import { NextResponse } from "next/server";
import { currentUser } from "./supabase/server";
import { can, getAgent, isDono, permFor, podeVerConversa } from "./perms";
import { supabaseAdmin } from "./supabase/admin";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Envolve uma rota da API: exige atendente logado e transforma erros em JSON. */
export function route<C>(handler: (req: Request, ctx: C, userId: string) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "não autenticado");
      const agent = await getAgent(user.id);
      if (agent && !agent.active) throw new HttpError(403, "seu acesso ao OficinaZap foi desativado");
      const need = permFor(req.method, new URL(req.url).pathname);
      if (need === "admin" ? agent && agent.role !== "admin" : need && !can(agent, need)) {
        throw new HttpError(403, "sem permissão para esta ação: fale com o administrador");
      }
      const path = new URL(req.url).pathname;
      // Equipe e acessos: só o dono do sistema.
      if (path.startsWith("/api/team") && agent && !(await isDono(user.id))) {
        throw new HttpError(403, "só o dono do sistema mexe na equipe e nos acessos");
      }
      if (agent?.canais) {
        // Atendente só abre as conversas dos números liberados para ele (ou que estão com ele).
        const conv = path.match(/^\/api\/conversations\/([0-9a-f-]{36})/);
        if (conv) {
          const { data: c } = await supabaseAdmin()
            .from("conversations")
            .select("assigned_to, status, connection_id")
            .eq("id", conv[1])
            .maybeSingle();
          if (c && !podeVerConversa(user.id, c, agent.canais, can(agent, "ver_todas"))) {
            throw new HttpError(403, "esta conversa é de um número de WhatsApp que não foi liberado para você");
          }
        }
        // Tela de conexões: só mexe nos números liberados para ele.
        const num = path.match(/^\/api\/(?:whatsapp|instagram|email)\/([0-9a-f-]{36})/);
        if (num && !agent.canais.includes(num[1])) throw new HttpError(403, "este número não foi liberado para você");
      }
      const data = await handler(req, ctx, user.id);
      return NextResponse.json(data ?? { ok: true });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "erro" }, { status });
    }
  };
}

export type IdCtx = { params: Promise<{ id: string }> };
