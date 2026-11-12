import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { agentePorEmail, isDono } from "@/lib/perms";
import { getSetting, setSetting } from "@/lib/db";
import { createConnection, getConnection, listConnections, MAX_CONNECTIONS, requireEvolution, syncState, updateConnection } from "@/lib/connections";
import { EvolutionProvider } from "@/lib/whatsapp/evolution";

// Tela "Oficina Zap" do sistema de gestão: o dono configura o Zap de lá, no visual do sistema
// (números de WhatsApp, IA e respostas rápidas). Equipe e permissões ficam em /api/gestao/permissoes.
const ORIGENS = (process.env.GESTAO_ORIGENS || "https://sistema.sacolasoficina.com.br").split(",").map((s) => s.trim());
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
}
const resp = (req: Request, body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors(req) });
export function OPTIONS(req: Request) { return new NextResponse(null, { status: 204, headers: cors(req) }); }

const UUID = /^[0-9a-f-]{36}$/;
class Erro extends Error { constructor(public status: number, msg: string) { super(msg); } }

function webhookUrl(req: Request, instance: string) {
  const host = req.headers.get("x-forwarded-host");
  const origin = process.env.RENDER_EXTERNAL_URL ?? (host ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}` : new URL(req.url).origin);
  return `${origin}/api/webhooks/whatsapp?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}&instance=${instance}`;
}
async function numero(id: unknown) {
  requireEvolution();
  if (!UUID.test(String(id))) throw new Erro(400, "número inválido");
  const c = await getConnection(String(id));
  if (!c) throw new Erro(404, "número não encontrado");
  return c;
}

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const email = await emailDaGestao(token);
  if (!email) return resp(req, { error: "sessão do sistema inválida", code: "session_expired" }, 401);
  const eu = await agentePorEmail(email);
  if (!eu || !eu.active || !(await isDono(eu.id))) {
    return resp(req, { error: "só o dono do OficinaZap configura o Zap por aqui", code: "nao_dono" }, 403);
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = supabaseAdmin();
  try {
    switch (b.acao) {
      case "resumo": {
        const [bot, kb, rr, deps] = await Promise.all([
          getSetting("bot_enabled", true), getSetting("knowledge_base", ""),
          db.from("quick_replies").select("id, shortcut, body").order("shortcut"),
          db.from("departments").select("id, name").order("name"),
        ]);
        let numeros: unknown[] = [], erroNumeros = "";
        try {
          requireEvolution();
          const l = (await listConnections()).filter((c) => !c.channel || c.channel === "whatsapp");
          numeros = await Promise.all(l.map(syncState));
        } catch (e) { erroNumeros = e instanceof Error ? e.message : "indisponível"; }
        return resp(req, { bot_enabled: bot, knowledge_base: kb, respostas: rr.data ?? [], departamentos: deps.data ?? [], numeros, erroNumeros, max: MAX_CONNECTIONS });
      }
      case "ia_salvar": {
        if (typeof b.bot_enabled === "boolean") await setSetting("bot_enabled", b.bot_enabled);
        if (typeof b.knowledge_base === "string") await setSetting("knowledge_base", b.knowledge_base.slice(0, 50000));
        return resp(req, { ok: true });
      }
      case "resposta_salvar": {
        const atalho = String(b.shortcut ?? "").trim().replace(/^\//, "").toLowerCase(), texto = String(b.body ?? "").trim();
        if (!atalho || !texto) throw new Erro(400, "atalho e texto são obrigatórios");
        const { error } = await db.from("quick_replies").upsert({ shortcut: atalho, body: texto }, { onConflict: "shortcut" });
        if (error) throw new Error(error.message);
        return resp(req, { ok: true });
      }
      case "resposta_excluir": {
        if (!UUID.test(String(b.id))) throw new Erro(400, "resposta inválida");
        const { error } = await db.from("quick_replies").delete().eq("id", String(b.id));
        if (error) throw new Error(error.message);
        return resp(req, { ok: true });
      }
      case "numero_novo": {
        requireEvolution();
        const nome = String(b.name ?? "").trim();
        if (!nome) throw new Erro(400, "informe um nome para o número");
        if ((await listConnections()).filter((c) => !c.channel || c.channel === "whatsapp").length >= MAX_CONNECTIONS) throw new Erro(400, `limite de ${MAX_CONNECTIONS} números atingido`);
        return resp(req, await createConnection(nome, UUID.test(String(b.department_id)) ? String(b.department_id) : null));
      }
      case "numero_editar": {
        const c = await numero(b.id);
        const nome = b.name === undefined ? undefined : String(b.name).trim();
        if (nome !== undefined && !nome) throw new Erro(400, "informe um nome para o número");
        return resp(req, await updateConnection(c.id, { ...(nome !== undefined && { name: nome }), ...(b.department_id !== undefined && { department_id: UUID.test(String(b.department_id)) ? String(b.department_id) : null }) }));
      }
      case "numero_estado": return resp(req, await syncState(await numero(b.id)));
      case "numero_qr": {
        const c = await numero(b.id);
        if (!process.env.WEBHOOK_SECRET) throw new Erro(500, "WEBHOOK_SECRET não configurado");
        const ev = new EvolutionProvider(c.instance);
        const dig = String(b.phone ?? "").replace(/\D/g, "");
        const r = await ev.connect(webhookUrl(req, c.instance), dig ? (dig.length <= 11 ? "55" + dig : dig) : undefined);
        if (r.state !== "open" && c.connected_at) await updateConnection(c.id, { connected_at: null });
        return resp(req, r);
      }
      case "numero_renovar": {
        const c = await numero(b.id);
        if (c.connected_at) return resp(req, { state: "open" });
        return resp(req, await new EvolutionProvider(c.instance).currentQr());
      }
      case "numero_reiniciar": {
        const c = await numero(b.id);
        if (!process.env.WEBHOOK_SECRET) throw new Erro(500, "WEBHOOK_SECRET não configurado");
        const ev = new EvolutionProvider(c.instance);
        await ev.restart();
        await new Promise((r) => setTimeout(r, 4000));
        return resp(req, { reiniciado: true, ...(await ev.connect(webhookUrl(req, c.instance))) });
      }
      case "numero_desconectar": {
        const c = await numero(b.id);
        await new EvolutionProvider(c.instance).logout();
        return resp(req, await updateConnection(c.id, { connected_at: null }));
      }
    }
    return resp(req, { error: "ação desconhecida" }, 400);
  } catch (e) {
    const st = e instanceof Erro ? e.status : (e as { status?: number })?.status ?? 500;
    if (st >= 500) console.error(e);
    return resp(req, { error: e instanceof Error ? e.message : "erro" }, st);
  }
}
