import { after, NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { emailUrl } from "@/lib/email";
import { sincronizarImap, trocarCodigoGoogle } from "@/lib/emailImap";
import { publicUrl } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sincronizarGoogle, trocarCodigoContatos } from "@/lib/googleSync";

export const maxDuration = 60;

// Volta do Google: guarda o acesso e cria a conexão de e-mail (Gmail) no nome de quem conectou.
export async function GET(req: NextRequest) {
  const volta = (q: string) => {
    const r = NextResponse.redirect(publicUrl(req, `/whatsapp?gmail=${q}`));
    r.cookies.delete("gmail_state");
    return r;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return volta(p.get("error") === "access_denied" ? "cancelado" : `erro&msg=${encodeURIComponent(p.get("error") ?? "")}`);
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || !agent.active) return volta("sem-permissao");
  if (!p.get("state") || p.get("state") !== req.cookies.get("gmail_state")?.value) return volta("expirou");
  const code = p.get("code");
  if (!code) return volta("cancelado");
  // Volta da ligação com o Google Contatos (state começa com "ct_").
  if (p.get("state")!.startsWith("ct_")) {
    const voltaCt = (q: string) => {
      const r = NextResponse.redirect(publicUrl(req, `/contatos?google=${q}`));
      r.cookies.delete("gmail_state");
      return r;
    };
    if (agent.role !== "admin") return voltaCt("sem-permissao");
    try {
      await trocarCodigoContatos(code, emailUrl("/api/gmail/callback"));
      after(async () => {
        await sincronizarGoogle({ completo: true }).catch((e) => console.error("primeira sincronização Google Contatos", e));
      });
      return voltaCt("ok");
    } catch (err) {
      console.error("Erro ao ligar Google Contatos", err);
      return voltaCt(`erro&msg=${encodeURIComponent((err as Error).message.slice(0, 300))}`);
    }
  }
  try {
    const r = await trocarCodigoGoogle(code, emailUrl("/api/gmail/callback"));
    const db = supabaseAdmin();
    const { data: antes } = await db.from("email_imap").select("refresh_token").eq("address", r.address).maybeSingle();
    const refresh = r.refresh_token ?? (antes?.refresh_token as string | null) ?? null;
    if (!refresh) throw new Error("o Google não liberou o acesso contínuo: tente de novo e marque todas as permissões");
    const instance = `imap:${r.address}`;
    const nome = `E-mail ${agent.name ?? r.name ?? r.address}`;
    let { data: conn } = await db.from("whatsapp_connections").select("id").eq("instance", instance).maybeSingle();
    if (conn) await db.from("whatsapp_connections").update({ connected_at: new Date().toISOString() }).eq("id", conn.id);
    else {
      const ins = await db.from("whatsapp_connections").insert({ name: nome, instance, channel: "email", connected_at: new Date().toISOString() }).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      conn = ins.data;
    }
    const up = await db.from("email_imap").upsert({
      connection_id: conn!.id,
      address: r.address,
      password: null,
      refresh_token: refresh,
      access_token: r.access_token,
      expires_at: r.expires_at,
      owner_agent_id: agent.id,
      imap_host: "imap.gmail.com",
      smtp_host: "smtp.gmail.com",
      last_error: null,
      updated_at: new Date().toISOString(),
    });
    if (up.error) throw new Error(up.error.message);
    const id = conn!.id as string;
    after(async () => {
      await sincronizarImap(id).catch((e) => console.error("primeira leitura do Gmail", e));
    });
    return volta("ok");
  } catch (err) {
    console.error("Erro ao conectar Gmail", err);
    return volta(`erro&msg=${encodeURIComponent((err as Error).message.slice(0, 300))}`);
  }
}
