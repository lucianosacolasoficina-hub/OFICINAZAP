import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PERMS, agentePorEmail, isDono, limparCacheAgent } from "@/lib/perms";

// Central de permissões do sistema de gestão: o dono do OficinaZap vê e altera a equipe daqui
// sem abrir o OficinaZap. Mesma regra da tela Equipe: só o dono mexe nos acessos.
const ORIGENS = (process.env.GESTAO_ORIGENS || "https://sistema.sacolasoficina.com.br").split(",").map((s) => s.trim());
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
}
const resp = (req: Request, body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors(req) });
export function OPTIONS(req: Request) { return new NextResponse(null, { status: 204, headers: cors(req) }); }

const UUID = /^[0-9a-f-]{36}$/;

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const email = await emailDaGestao(token);
  if (!email) return resp(req, { error: "sessão do sistema inválida", code: "session_expired" }, 401);
  const eu = await agentePorEmail(email);
  if (!eu || !eu.active || !(await isDono(eu.id))) {
    return resp(req, { error: "só o dono do OficinaZap mexe na equipe e nos acessos", code: "nao_dono" }, 403);
  }
  const b = (await req.json().catch(() => ({}))) as { acao?: string; id?: string; active?: boolean; role?: string; permissions?: Record<string, unknown> };
  const db = supabaseAdmin();
  try {
    if (b.acao === "listar" || !b.acao) {
      const [{ data: agents, error }, users, { data: canais }] = await Promise.all([
        db.from("agents").select("id, name, role, permissions, active, created_at").order("created_at"),
        db.auth.admin.listUsers({ perPage: 200 }),
        db.from("whatsapp_connections").select("id, name, channel, phone").order("created_at"),
      ]);
      if (error) throw new Error(error.message);
      const emails = new Map((users.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));
      return resp(req, {
        eu: eu.id,
        perms: Object.entries(PERMS).map(([key, p]) => ({ key, ...p })),
        agents: (agents ?? []).map((a) => ({ ...a, email: emails.get(a.id) ?? "" })),
        canais: canais ?? [],
      });
    }
    if (b.acao === "salvar") {
      if (!UUID.test(String(b.id))) return resp(req, { error: "atendente inválido" }, 400);
      if (b.id === eu.id && (b.active === false || b.role === "agent")) {
        return resp(req, { error: "você não pode tirar o seu próprio acesso de administrador" }, 400);
      }
      const patch: Record<string, unknown> = {};
      if (b.role === "admin" || b.role === "agent") patch.role = b.role;
      if (typeof b.active === "boolean") patch.active = b.active;
      if (b.permissions && typeof b.permissions === "object") {
        const p: Record<string, unknown> = {};
        for (const k of Object.keys(PERMS)) if (typeof b.permissions[k] === "boolean") p[k] = b.permissions[k];
        const c = b.permissions.canais;
        if (Array.isArray(c)) p.canais = c.filter((x) => typeof x === "string" && UUID.test(x));
        patch.permissions = p;
      }
      if (!Object.keys(patch).length) return resp(req, { ok: true });
      const { error } = await db.from("agents").update(patch).eq("id", b.id!);
      if (error) throw new Error(error.message);
      limparCacheAgent();
      return resp(req, { ok: true });
    }
    return resp(req, { error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return resp(req, { error: e instanceof Error ? e.message : "erro" }, 500);
  }
}
