import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { assinarWebhook, getIgConfig, trocarCodigo, igUrl } from "@/lib/instagram";
import { publicUrl } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Volta da autorização do Instagram: guarda o token e cria a "conexão" Instagram no OficinaZap.
export async function GET(req: NextRequest) {
  const volta = (q: string) => {
    const r = NextResponse.redirect(publicUrl(req, `/whatsapp?ig=${q}`));
    r.cookies.delete("ig_state");
    return r;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return volta("cancelado");
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || agent.role !== "admin") return volta("sem-permissao");
  if (!p.get("state") || p.get("state") !== req.cookies.get("ig_state")?.value) return volta("expirou");
  const code = p.get("code");
  if (!code) return volta("cancelado");
  try {
    const cfg = await getIgConfig();
    const r = await trocarCodigo(cfg, code, igUrl("/api/instagram/callback"));
    const db = supabaseAdmin();
    const instance = `ig:${r.igUserId}`;
    const nome = `Instagram${r.username ? ` @${r.username}` : ""}`;
    let { data: conn } = await db.from("whatsapp_connections").select("id").eq("instance", instance).maybeSingle();
    if (conn) {
      await db.from("whatsapp_connections").update({ name: nome, connected_at: new Date().toISOString() }).eq("id", conn.id);
    } else {
      const ins = await db
        .from("whatsapp_connections")
        .insert({ name: nome, instance, channel: "instagram", phone: null, connected_at: new Date().toISOString() })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      conn = ins.data;
    }
    const up = await db.from("instagram_tokens").upsert({
      connection_id: conn!.id,
      ig_user_id: r.igUserId,
      username: r.username,
      access_token: r.token,
      expires_at: r.expiresAt,
      updated_at: new Date().toISOString(),
    });
    if (up.error) throw new Error(up.error.message);
    await assinarWebhook(r.token);
    return volta("ok");
  } catch (err) {
    console.error("Erro ao conectar Instagram", err);
    return volta(`erro&msg=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
  }
}
