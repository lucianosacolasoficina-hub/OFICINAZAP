import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/bling";

// O Bling volta para cá depois do login (este endereço é o "Link de redirecionamento" do app no Bling).
export async function GET(req: NextRequest) {
  const back = (status: string) => {
    const host = req.headers.get("x-forwarded-host");
    const origin =
      process.env.RENDER_EXTERNAL_URL ??
      (host ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}` : req.nextUrl.origin);
    const res = NextResponse.redirect(`${origin}/configuracoes?bling=${status}`);
    res.cookies.delete("bling_state");
    return res;
  };

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("bling_state")?.value) return back("erro");
  try {
    await exchangeCode(code);
    return back("ok");
  } catch (err) {
    console.error(err);
    return back("erro");
  }
}
