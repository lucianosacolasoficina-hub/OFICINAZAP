import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente com a sessão do atendente logado (cookies), usado para autenticação.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Chamado de um Server Component: o middleware renova a sessão.
          }
        },
      },
    },
  );
}

/** Usuário logado. Confere o token localmente (rápido); se não der, pergunta ao Supabase. */
export async function currentUser(): Promise<{ id: string; email?: string } | null> {
  const supabase = await supabaseServer();
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (!error && typeof sub === "string") return { id: sub, email: data?.claims?.email as string | undefined };
  } catch {}
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null;
}
