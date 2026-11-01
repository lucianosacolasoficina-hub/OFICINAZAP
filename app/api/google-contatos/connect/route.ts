import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { emailUrl } from "@/lib/email";
import { getGmailConfig } from "@/lib/emailImap";
import { CONTATOS_SCOPES } from "@/lib/googleSync";
import { publicUrl } from "@/lib/origin";

// "Ligar ao Google Contatos": usa o mesmo app do Google do Gmail e a mesma volta (/api/gmail/callback),
// marcada no "state" com "ct_" para guardar o acesso aos contatos.
export async function GET(req: Request) {
  if (publicUrl(req, "/").host !== new URL(emailUrl("/")).host) return NextResponse.redirect(emailUrl("/api/google-contatos/connect"));
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || !agent.active || agent.role !== "admin") return NextResponse.redirect(publicUrl(req, "/contatos?google=sem-permissao"));
  const cfg = await getGmailConfig();
  if (!cfg.client_id || !cfg.client_secret) return NextResponse.redirect(publicUrl(req, "/contatos?google=sem-app"));
  const state = "ct_" + randomBytes(16).toString("hex");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", cfg.client_id);
  u.searchParams.set("redirect_uri", emailUrl("/api/gmail/callback"));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", CONTATOS_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("login_hint", "lucianosacolasoficina@gmail.com");
  u.searchParams.set("state", state);
  const res = NextResponse.redirect(u.toString());
  res.cookies.set("gmail_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  return res;
}
