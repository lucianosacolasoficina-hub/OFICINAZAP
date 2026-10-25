import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, blingConfigured } from "@/lib/bling";

// Leva o atendente para a tela de login do Bling. O "state" confere a volta no callback.
export async function GET() {
  if (!(await blingConfigured())) {
    return NextResponse.json({ error: "cadastre o Client Id e o Client Secret em Configurações" }, { status: 400 });
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(await authorizeUrl(state));
  res.cookies.set("bling_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
