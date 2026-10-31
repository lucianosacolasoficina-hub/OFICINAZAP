import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { getIgConfig, urlAutorizacao } from "@/lib/instagram";
import { publicUrl } from "@/lib/origin";

// Botão "Conectar Instagram": manda o administrador para a tela de autorização do Instagram.
export async function GET(req: Request) {
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || agent.role !== "admin") return NextResponse.redirect(publicUrl(req, "/whatsapp?ig=sem-permissao"));
  const cfg = await getIgConfig();
  if (!cfg.app_id || !cfg.app_secret) return NextResponse.redirect(publicUrl(req, "/whatsapp?ig=sem-app"));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(urlAutorizacao(cfg, publicUrl(req, "/api/instagram/callback").toString(), state));
  res.cookies.set("ig_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  return res;
}
