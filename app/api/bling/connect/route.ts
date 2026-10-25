import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, blingConfigured } from "@/lib/bling";

// Leva o atendente para a tela de login do Bling. O "state" confere a volta no callback.
export async function GET() {
  if (!blingConfigured()) {
    return NextResponse.json({ error: "BLING_CLIENT_ID e BLING_CLIENT_SECRET não configurados" }, { status: 500 });
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("bling_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
