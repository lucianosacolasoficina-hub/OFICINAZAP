import { after, NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { getEmailConfig, sincronizarEmail, trocarCodigoEmail } from "@/lib/email";
import { publicUrl } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Volta da autorização da Microsoft: guarda o acesso e cria a conexão "E-mail" no OficinaZap.
export async function GET(req: NextRequest) {
  const volta = (q: string) => {
    const r = NextResponse.redirect(publicUrl(req, `/whatsapp?mail=${q}`));
    r.cookies.delete("mail_state");
    r.cookies.delete("mail_pkce");
    return r;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return volta(`erro&msg=${encodeURIComponent((p.get("error_description") ?? p.get("error") ?? "").slice(0, 200))}`);
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || agent.role !== "admin") return volta("sem-permissao");
  if (!p.get("state") || p.get("state") !== req.cookies.get("mail_state")?.value) return volta("expirou");
  const code = p.get("code");
  if (!code) return volta("cancelado");
  try {
    const r = await trocarCodigoEmail(await getEmailConfig(), code, req.cookies.get("mail_pkce")?.value);
    const db = supabaseAdmin();
    const instance = `mail:${r.address}`;
    let { data: conn } = await db.from("whatsapp_connections").select("id").eq("instance", instance).maybeSingle();
    if (conn) await db.from("whatsapp_connections").update({ connected_at: new Date().toISOString() }).eq("id", conn.id);
    else {
      const ins = await db
        .from("whatsapp_connections")
        .insert({ name: `E-mail ${r.address}`, instance, channel: "email", connected_at: new Date().toISOString() })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      conn = ins.data;
    }
    const up = await db.from("email_tokens").upsert({
      connection_id: conn!.id,
      address: r.address,
      access_token: r.access,
      refresh_token: r.refresh,
      expires_at: r.expiresAt,
      updated_at: new Date().toISOString(),
    });
    if (up.error) throw new Error(up.error.message);
    // Traz os e-mails dos últimos 30 dias em segundo plano.
    after(() => sincronizarEmail(conn!.id).catch((e) => console.error("primeira sincronização do e-mail", e)));
    return volta("ok");
  } catch (err) {
    console.error("Erro ao conectar Outlook", err);
    return volta(`erro&msg=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
  }
}
