import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { emailUrl, getEmailConfig, urlAutorizacaoEmail } from "@/lib/email";

/** Sem segredo: o app funciona como "cliente público" e a troca do código é protegida por PKCE. */
function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
import { publicUrl } from "@/lib/origin";

// Botão "Conectar Outlook": manda o administrador para entrar na conta Microsoft e autorizar.
export async function GET(req: Request) {
  if (publicUrl(req, "/").host !== new URL(emailUrl("/")).host) return NextResponse.redirect(emailUrl("/api/email/connect"));
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || agent.role !== "admin") return NextResponse.redirect(publicUrl(req, "/whatsapp?mail=sem-permissao"));
  const cfg = await getEmailConfig();
  if (!cfg.client_id) return NextResponse.redirect(publicUrl(req, "/whatsapp?mail=sem-app"));
  const state = randomBytes(16).toString("hex");
  // Sem segredo salvo: usa PKCE (app como cliente público na Microsoft).
  const p = cfg.client_secret ? null : pkce();
  const res = NextResponse.redirect(urlAutorizacaoEmail(cfg, state, p?.challenge));
  res.cookies.set("mail_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  if (p) res.cookies.set("mail_pkce", p.verifier, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  return res;
}
