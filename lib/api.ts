import { NextResponse } from "next/server";
import { currentUser } from "./supabase/server";
import { can, getAgent, permFor } from "./perms";

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
