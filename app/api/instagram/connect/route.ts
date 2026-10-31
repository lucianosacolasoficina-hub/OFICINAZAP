import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { getIgConfig, urlAutorizacao, igUrl } from "@/lib/instagram";
import { publicUrl } from "@/lib/origin";

// Botão "Conectar Instagram": manda o administrador para a tela de autorização do Instagram.
export async function GET(req: Request) {
  // A autorização precisa começar e terminar no mesmo endereço cadastrado na Meta.
  if (publicUrl(req, "/").host !== new URL(igUrl("/")).host) return NextResponse.redirect(igUrl("/api/instagram/connect"));
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || agent.role !== "admin") return NextResponse.redirect(publicUrl(req, "/whatsapp?ig=sem-permissao"));
  const cfg = await getIgConfig();
  if (!cfg.app_id || !cfg.app_secret) return NextResponse.redirect(publicUrl(req, "/whatsapp?ig=sem-app"));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(urlAutorizacao(cfg, igUrl("/api/instagram/callback"), state));
  res.cookies.set("ig_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  return res;
}
