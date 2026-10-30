// Confere um token de sessão do sistema de gestão (Supabase do sistema) e devolve o e-mail do usuário.
export async function emailDaGestao(token: string): Promise<string | null> {
  const url = process.env.GESTAO_SUPABASE_URL, anon = process.env.GESTAO_SUPABASE_ANON_KEY;
  if (!url || !anon || !token) return null;
  const r = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) return null;
  const u = (await r.json().catch(() => null)) as { email?: string } | null;
  return u?.email?.trim().toLowerCase() || null;
}
