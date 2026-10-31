import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Protege o painel: quem não está logado vai para /login.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  // Confere o login localmente pelo token (rápido); se não der, consulta o Supabase.
  let logado = false;
  try {
    const { data: c, error } = await supabase.auth.getClaims();
    logado = !error && !!c?.claims?.sub;
  } catch {}
  if (!logado) logado = !!(await supabase.auth.getUser()).data.user;
  const data = { user: logado ? {} : null };

  const path = request.nextUrl.pathname;
  if (!data.user && path !== "/login" && path !== "/api/auth/sso" && path !== "/api/lula" && path !== "/privacidade" && path !== "/exclusao-de-dados") {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "não autenticado" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = {
  // O webhook do WhatsApp fica de fora: ele é chamado pelo provedor, não por um atendente.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
