import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signedMediaUrl } from "@/lib/media";

// Candace (assistente de vendas do sistema de gestão) lê as conversas do WhatsApp para lançar pedidos.
// Só leitura: busca conversas, lê as mensagens e devolve links temporários dos arquivos. Nunca envia nada.
const ORIGENS = (process.env.GESTAO_ORIGENS || "https://sistema.sacolasoficina.com.br").split(",").map((s) => s.trim());
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
}
const resp = (req: Request, body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors(req) });
export function OPTIONS(req: Request) { return new NextResponse(null, { status: 204, headers: cors(req) }); }

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", ogg: "audio/ogg", mp3: "audio/mpeg", mp4: "video/mp4" };
const UUID = /^[0-9a-f-]{36}$/;
const limpa = (s: unknown) => String(s ?? "").replace(/[%_,()]/g, " ").trim().slice(0, 60);

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const email = await emailDaGestao(token);
  if (!email) return resp(req, { error: "sessão do sistema inválida", code: "session_expired" }, 401);
  const b = (await req.json().catch(() => ({}))) as { acao?: string; texto?: string; conversa_id?: string; limite?: number; ids?: string[] };
  const db = supabaseAdmin();
  try {
    if (b.acao === "buscar") {
      const t = limpa(b.texto), dig = t.replace(/\D/g, "");
      let q = db.from("contacts").select("id, name, phone, gestao_cliente_id, gestao_cliente_nome").eq("is_group", false).limit(12);
      q = dig.length >= 6 ? q.ilike("phone", `%${dig}%`) : t ? q.or(`name.ilike.%${t}%,gestao_cliente_nome.ilike.%${t}%,google_nome.ilike.%${t}%`) : q;
      const { data: cts, error } = await q;
      if (error) throw new Error(error.message);
      const ids = (cts ?? []).map((c) => c.id);
      const { data: cvs } = ids.length ? await db.from("conversations").select("id, contact_id, last_message_at, last_message_preview, status, connection:whatsapp_connections(name)").in("contact_id", ids).order("last_message_at", { ascending: false }) : { data: [] as any[] };
      const out = (cvs ?? []).slice(0, 10).map((v: any) => { const c = (cts ?? []).find((x) => x.id === v.contact_id)!; return { conversa_id: v.id, contato: c?.name || c?.phone, telefone: c?.phone, cliente_no_sistema: c?.gestao_cliente_nome || null, cliente_id_no_sistema: c?.gestao_cliente_id || null, canal: v.connection?.name || "", ultima_mensagem: String(v.last_message_preview || "").slice(0, 120), quando: v.last_message_at }; });
      return resp(req, { conversas: out });
    }
    if (b.acao === "ler") {
      if (!UUID.test(String(b.conversa_id))) return resp(req, { error: "conversa inválida" }, 400);
      const { data: cv } = await db.from("conversations").select("id, contact:contacts(name, phone, gestao_cliente_id, gestao_cliente_nome), connection:whatsapp_connections(name)").eq("id", b.conversa_id!).maybeSingle();
      if (!cv) return resp(req, { error: "conversa não encontrada" }, 404);
      const lim = Math.min(80, Math.max(5, Number(b.limite) || 40));
      const { data: ms, error } = await db.from("messages").select("id, direction, body, media_type, media_url, created_at").eq("conversation_id", b.conversa_id!).order("created_at", { ascending: false }).limit(lim);
      if (error) throw new Error(error.message);
      const c: any = (cv as any).contact || {};
      return resp(req, {
        conversa_id: cv.id, contato: c.name || c.phone, telefone: c.phone, cliente_no_sistema: c.gestao_cliente_nome || null, cliente_id_no_sistema: c.gestao_cliente_id || null, canal: (cv as any).connection?.name || "",
        mensagens: (ms ?? []).reverse().map((m) => ({ id: m.id, quem: m.direction === "in" ? "cliente" : "atendente", quando: m.created_at, texto: m.media_type && m.media_type !== "text" && m.media_type !== "document" ? m.body || "" : m.media_type === "document" ? "" : m.body || "",
          arquivo: m.media_type && m.media_type !== "text" ? { tipo: m.media_type, nome: m.media_type === "document" ? m.body || "documento" : m.media_type, disponivel: !!m.media_url } : undefined })),
      });
    }
    if (b.acao === "arquivos") {
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x) => UUID.test(String(x))).slice(0, 10);
      if (!ids.length) return resp(req, { arquivos: [] });
      const { data: ms } = await db.from("messages").select("id, body, media_type, media_url, created_at").in("id", ids);
      const out = [];
      for (const m of ms ?? []) {
        if (!m.media_url) { out.push({ id: m.id, erro: "arquivo não guardado" }); continue; }
        const ext = String(m.media_url).split(".").pop()!.toLowerCase();
        const url = await signedMediaUrl(m.media_url);
        const d = String(m.created_at).slice(0, 10);
        const nome = m.media_type === "document" && m.body ? String(m.body).slice(0, 120) : `whatsapp-${m.media_type}-${d}-${String(m.id).slice(0, 6)}.${ext}`;
        out.push({ id: m.id, url, nome, tipo: MIME[ext] || "application/octet-stream", midia: m.media_type });
      }
      return resp(req, { arquivos: out });
    }
    return resp(req, { error: "ação inválida" }, 400);
  } catch (e) {
    console.error("candace (gestão) falhou", e);
    return resp(req, { error: "não consegui ler o WhatsApp agora" }, 500);
  }
}
