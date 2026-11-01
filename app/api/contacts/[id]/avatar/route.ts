import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EvolutionProvider } from "@/lib/whatsapp/evolution";

// Foto de perfil do WhatsApp do contato (como no celular). A Evolution devolve um link do WhatsApp
// que vence depois de alguns dias: guardamos e renovamos a cada 3 dias. Sem foto, responde 404
// e a tela mostra as iniciais.
const RENOVAR_MS = 3 * 864e5;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new NextResponse(null, { status: 401 });
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  const { data: ct } = await db.from("contacts").select("id, phone, is_group, avatar_url, avatar_checked_at").eq("id", id).maybeSingle();
  if (!ct) return new NextResponse(null, { status: 404 });
  let url = ct.avatar_url as string | null;
  const fresco = ct.avatar_checked_at && Date.now() - new Date(ct.avatar_checked_at).getTime() < RENOVAR_MS;
  const phone = String(ct.phone);
  if (!fresco && !/^(ig|fb|mail):/.test(phone)) {
    url = null;
    try {
      const { data: conv } = await db
        .from("conversations")
        .select("connection:whatsapp_connections(instance, channel)")
        .eq("contact_id", id)
        .not("connection_id", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const conn = (conv?.connection ?? null) as { instance?: string | null; channel?: string | null } | null;
      if (conn?.instance && (!conn.channel || conn.channel === "whatsapp")) {
        url = await new EvolutionProvider(conn.instance).profilePicture(ct.is_group ? `${phone.replace(/@.*/, "")}@g.us` : phone.replace(/\D/g, ""));
      }
    } catch (e) {
      console.error("foto do contato", e);
    }
    await db.from("contacts").update({ avatar_url: url, avatar_checked_at: new Date().toISOString() }).eq("id", id);
  }
  if (!url) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=21600" } });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=86400" } });
}
