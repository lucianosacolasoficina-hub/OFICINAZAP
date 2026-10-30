import { NextResponse } from "next/server";
import { currentUser } from "./supabase/server";
import { can, getAgent, permFor, podeVerConversa } from "./perms";
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
      // Atendente sem acesso total só abre as conversas que pode ver.
      const conv = new URL(req.url).pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})/);
      if (conv && agent && !can(agent, "ver_todas")) {
        const db = supabaseAdmin();
        const [{ data: c }, { data: deps }] = await Promise.all([
          db.from("conversations").select("assigned_to, status, department_id").eq("id", conv[1]).maybeSingle(),
          db.from("department_agents").select("department_id").eq("agent_id", user.id),
        ]);
        if (c && !podeVerConversa(user.id, c, (deps ?? []).map((d) => d.department_id))) {
          throw new HttpError(403, "esta conversa está com outro atendente ou já foi encerrada");
        }
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
