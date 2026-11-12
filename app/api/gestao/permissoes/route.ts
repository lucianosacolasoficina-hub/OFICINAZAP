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
  const b = (await req.json().catch(() => ({}))) as { acao?: string; id?: string; active?: boolean; role?: string; permissions?: Record<string, unknown>; name?: string; email?: string; password?: string };
  const db = supabaseAdmin();
  try {
    if (b.acao === "listar" || !b.acao) {
      const [{ data: agents, error }, users, { data: canais }] = await Promise.all([
        db.from("agents").select("id, name, role, permissions, active, created_at, archived_at").order("created_at"),
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
    if (b.acao === "excluir" || b.acao === "voltar") {
      // Botão ✕ da central: sem histórico exclui; com histórico tira da lista e bloqueia (o histórico fica).
      if (!UUID.test(String(b.id))) return resp(req, { error: "atendente inválido" }, 400);
      if (b.id === eu.id) return resp(req, { error: "você não pode excluir a sua própria conta" }, 400);
      const { data: ag } = await db.from("agents").select("id, name, role").eq("id", b.id!).maybeSingle();
      if (!ag) return resp(req, { error: "atendente não encontrado" }, 404);
      if (b.acao === "voltar") {
        const { error } = await db.from("agents").update({ archived_at: null }).eq("id", b.id!);
        if (error) throw new Error(error.message);
        limparCacheAgent();
        return resp(req, { ok: true, acao: "voltou", nome: ag.name });
      }
      const conta = async (t: string, col: string) => {
        const { count, error } = await db.from(t).select("id", { count: "exact", head: true }).eq(col, b.id!);
        if (error) throw new Error(error.message);
        return count ?? 0;
      };
      const n = (await Promise.all([
        conta("conversations", "assigned_to"), conta("messages", "agent_id"),
        conta("task_cards", "assignee"), conta("task_cards", "created_by"), conta("task_comments", "agent_id"),
      ])).reduce((a, x) => a + x, 0);
      if (n === 0) {
        const { error } = await db.auth.admin.deleteUser(b.id!); // apaga também a linha de agents (cascade)
        if (error) throw new Error(error.message);
        limparCacheAgent();
        return resp(req, { ok: true, acao: "excluido", nome: ag.name });
      }
      const { error } = await db.from("agents").update({ active: false, archived_at: new Date().toISOString() }).eq("id", b.id!);
      if (error) throw new Error(error.message);
      limparCacheAgent();
      return resp(req, { ok: true, acao: "arquivado", nome: ag.name, registros: n });
    }
    if (b.acao === "criar") {
      // Cadastra um atendente novo pela central do sistema (mesma regra da tela Equipe).
      const name = String(b.name ?? "").trim(), email = String(b.email ?? "").trim().toLowerCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp(req, { error: "informe nome e um e-mail válido" }, 400);
      if (!b.password || String(b.password).length < 8) return resp(req, { error: "a senha inicial precisa ter pelo menos 8 caracteres" }, 400);
      const p: Record<string, unknown> = {};
      if (b.permissions && typeof b.permissions === "object") {
        for (const k of Object.keys(PERMS)) if (typeof b.permissions[k] === "boolean") p[k] = b.permissions[k];
        const c = b.permissions.canais;
        if (Array.isArray(c)) p.canais = c.filter((x) => typeof x === "string" && UUID.test(x));
      }
      const { data, error } = await db.auth.admin.createUser({ email, password: String(b.password), email_confirm: true, user_metadata: { name } });
      if (error) return resp(req, { error: /already|registered|exists/i.test(error.message) ? "já existe um usuário com esse e-mail no OficinaZap" : error.message }, 400);
      const id = data.user.id;
      const { error: e2 } = await db.from("agents").upsert({ id, name, role: b.role === "admin" ? "admin" : "agent", permissions: p, active: true });
      if (e2) throw new Error(e2.message);
      limparCacheAgent();
      return resp(req, { ok: true, id });
    }
    return resp(req, { error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return resp(req, { error: e instanceof Error ? e.message : "erro" }, 500);
  }
}
