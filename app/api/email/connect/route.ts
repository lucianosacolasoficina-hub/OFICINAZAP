import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { emailUrl, getEmailConfig, urlAutorizacaoEmail } from "@/lib/email";
import { publicUrl } from "@/lib/origin";

// Botão "Conectar Outlook": manda o administrador para entrar na conta Microsoft e autorizar.
export async function GET(req: Request) {
  if (publicUrl(req, "/").host !== new URL(emailUrl("/")).host) return NextResponse.redirect(emailUrl("/api/email/connect"));
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || agent.role !== "admin") return NextResponse.redirect(publicUrl(req, "/whatsapp?mail=sem-permissao"));
  const cfg = await getEmailConfig();
  if (!cfg.client_id || !cfg.client_secret) return NextResponse.redirect(publicUrl(req, "/whatsapp?mail=sem-app"));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(urlAutorizacaoEmail(cfg, state));
  res.cookies.set("mail_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  return res;
}
