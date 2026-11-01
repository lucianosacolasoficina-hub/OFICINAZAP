import { supabaseAdmin } from "./supabase/admin";
import { getGmailConfig } from "./emailImap";

// Contatos do OficinaZap ligados ao Google Contatos de uma conta da empresa, nos dois sentidos:
// - do Google para o OficinaZap: o nome salvo no Google atualiza o contato com o mesmo telefone;
// - do OficinaZap para o Google: contato com nome que ainda não está no Google é criado lá,
//   e quando o nome muda aqui, muda lá também.
// Grupos, Instagram, Facebook e e-mail ficam de fora (só números de WhatsApp).

export const CONTATOS_SCOPES = ["https://www.googleapis.com/auth/contacts", "openid", "email"];
const API = "https://people.googleapis.com/v1";

type Cfg = { address: string | null; refresh_token: string | null; access_token: string | null; expires_at: string | null; sync_token: string | null };
type Person = { resourceName: string; etag?: string; names?: { displayName?: string; unstructuredName?: string }[]; phoneNumbers?: { value?: string; canonicalForm?: string }[]; metadata?: { deleted?: boolean } };

async function token(form: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google: ${j.error_description ?? j.error ?? r.status}`);
  return j;
}

export async function trocarCodigoContatos(code: string, redirectUri: string) {
  const cfg = await getGmailConfig();
  const j = await token({ client_id: cfg.client_id ?? "", client_secret: cfg.client_secret ?? "", code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const info = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${j.access_token}` } })).json()) as { email?: string };
  const db = supabaseAdmin();
  const { data: antes } = await db.from("google_contatos").select("refresh_token, address").eq("id", 1).maybeSingle();
  const mesmaConta = antes?.address && info.email && antes.address === info.email.toLowerCase();
  const refresh = j.refresh_token ?? (mesmaConta ? (antes?.refresh_token as string | null) : null);
  if (!refresh) throw new Error("o Google não liberou o acesso contínuo: tente de novo e marque a permissão de contatos");
  const up = await db.from("google_contatos").upsert({
    id: 1,
    address: info.email?.toLowerCase() ?? null,
    refresh_token: refresh,
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000 - 60000).toISOString(),
    sync_token: mesmaConta ? undefined : null,
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  if (up.error) throw new Error(up.error.message);
  return info.email ?? "";
}

async function acesso(c: Cfg): Promise<string> {
  if (c.access_token && c.expires_at && new Date(c.expires_at).getTime() > Date.now()) return c.access_token;
  const cfg = await getGmailConfig();
  const j = await token({ client_id: cfg.client_id ?? "", client_secret: cfg.client_secret ?? "", refresh_token: c.refresh_token ?? "", grant_type: "refresh_token" });
  const exp = new Date(Date.now() + (j.expires_in ?? 3600) * 1000 - 60000).toISOString();
  await supabaseAdmin().from("google_contatos").update({ access_token: j.access_token, expires_at: exp }).eq("id", 1);
  return j.access_token!;
}

/** Telefone do Google no mesmo formato do OficinaZap: só dígitos, com 55 quando é número brasileiro. */
export function normalizarTelefone(v?: string | null) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d.replace(/^0/, "");
  else if (d.length === 12 && d.startsWith("0")) d = "55" + d.slice(1);
  return d.length >= 12 && d.length <= 15 ? d : null;
}
/** Variações do mesmo celular (com e sem o 9 depois do DDD). */
function variacoes(d: string) {
  const out = new Set([d]);
  if (d.startsWith("55") && d.length === 13 && d[4] === "9") out.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith("55") && d.length === 12) out.add(d.slice(0, 4) + "9" + d.slice(4));
  return [...out];
}
const pareceTelefone = (s?: string | null) => !s || /^[+\d\s().-]+$/.test(s.trim());

let rodando = false;
export async function sincronizarGoogle(opts: { completo?: boolean } = {}) {
  if (rodando) return { ocupado: true };
  rodando = true;
  const db = supabaseAdmin();
  const stats = { lidosGoogle: 0, nomesAtualizados: 0, ligados: 0, criadosNoGoogle: 0, nomesEnviados: 0 };
  try {
    const { data } = await db.from("google_contatos").select("*").eq("id", 1).maybeSingle();
    const c = data as Cfg | null;
    if (!c?.refresh_token) return { conectado: false };
    const tk = await acesso(c);
    const h = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };

    // 1) Do Google para o OficinaZap (com syncToken, só o que mudou desde a última vez).
    let pageToken: string | undefined;
    let syncToken = opts.completo ? null : c.sync_token;
    let novoSync: string | undefined;
    do {
      const u = new URL(`${API}/people/me/connections`);
      u.searchParams.set("personFields", "names,phoneNumbers,metadata");
      u.searchParams.set("pageSize", "1000");
      u.searchParams.set("requestSyncToken", "true");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      if (syncToken) u.searchParams.set("syncToken", syncToken);
      const r = await fetch(u, { headers: h });
      if (r.status === 410 && syncToken) { syncToken = null; pageToken = undefined; continue; } // token vencido: lê tudo de novo
      const j = (await r.json()) as { connections?: Person[]; nextPageToken?: string; nextSyncToken?: string; error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? `Google Contatos ${r.status}`);
      for (const p of j.connections ?? []) {
        stats.lidosGoogle++;
        if (p.metadata?.deleted) { await db.from("contacts").update({ google_resource: null, google_etag: null, google_nome: null }).eq("google_resource", p.resourceName); continue; }
        const nome = (p.names?.[0]?.displayName ?? p.names?.[0]?.unstructuredName ?? "").trim();
        const tels = (p.phoneNumbers ?? []).map((t) => normalizarTelefone(t.canonicalForm ?? t.value)).filter(Boolean) as string[];
        if (!tels.length) continue;
        const { data: achados } = await db.from("contacts").select("id, name, google_resource").eq("is_group", false).in("phone", tels.flatMap(variacoes));
        for (const ct of achados ?? []) {
          const upd: Record<string, unknown> = { google_resource: p.resourceName, google_etag: p.etag ?? null };
          if (!ct.google_resource) stats.ligados++;
          if (nome && !pareceTelefone(nome) && nome !== ct.name) { upd.name = nome; stats.nomesAtualizados++; }
          if (nome) upd.google_nome = nome;
          await db.from("contacts").update(upd).eq("id", ct.id);
        }
      }
      pageToken = j.nextPageToken;
      if (j.nextSyncToken) novoSync = j.nextSyncToken;
    } while (pageToken);

    // 2) Do OficinaZap para o Google: contatos com nome que ainda não estão lá (em lotes de 200).
    for (let volta = 0; volta < 20; volta++) {
      const { data: novos } = await db
        .from("contacts")
        .select("id, name, phone")
        .eq("is_group", false)
        .is("google_resource", null)
        .not("name", "is", null)
        .neq("name", "")
        .order("created_at", { ascending: false })
        .limit(400);
      const lote = (novos ?? []).filter((x) => /^\d{10,15}$/.test(String(x.phone)) && !pareceTelefone(x.name)).slice(0, 200);
      if (!lote.length) break;
      const r = await fetch(`${API}/people:batchCreateContacts?readMask=names,phoneNumbers`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ contacts: lote.map((x) => ({ contactPerson: { names: [{ unstructuredName: x.name }], phoneNumbers: [{ value: `+${x.phone}` }] } })) }),
      });
      const j = (await r.json()) as { createdPeople?: { person?: Person }[]; error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? `Google Contatos ${r.status}`);
      const criados = j.createdPeople ?? [];
      for (let i = 0; i < lote.length; i++) {
        const p = criados[i]?.person;
        await db.from("contacts").update(p ? { google_resource: p.resourceName, google_etag: p.etag ?? null, google_nome: lote[i].name } : { google_resource: "erro" }).eq("id", lote[i].id);
        if (p) stats.criadosNoGoogle++;
      }
      if (lote.length < 200) break;
    }

    // 3) Nome mudado no OficinaZap: atualiza no Google.
    const { data: mudados } = await db.from("contacts").select("id, name, google_resource, google_etag, google_nome").like("google_resource", "people/%").not("name", "is", null).limit(3000);
    for (const x of (mudados ?? []).filter((m) => m.name && m.name !== m.google_nome && !pareceTelefone(m.name)).slice(0, 100)) {
      const r = await fetch(`${API}/${x.google_resource}:updateContact?updatePersonFields=names`, {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ etag: x.google_etag, names: [{ unstructuredName: x.name }] }),
      });
      const p = (await r.json().catch(() => ({}))) as Person;
      if (r.ok) { await db.from("contacts").update({ google_etag: p.etag ?? null, google_nome: x.name }).eq("id", x.id); stats.nomesEnviados++; }
      else if (r.status === 404) await db.from("contacts").update({ google_resource: null, google_etag: null, google_nome: null }).eq("id", x.id);
    }

    await db.from("google_contatos").update({ sync_token: novoSync ?? c.sync_token, last_sync: new Date().toISOString(), last_error: null, stats }).eq("id", 1);
    return { conectado: true, ...stats };
  } catch (e) {
    await db.from("google_contatos").update({ last_sync: new Date().toISOString(), last_error: (e as Error).message.slice(0, 300) }).eq("id", 1);
    throw e;
  } finally {
    rodando = false;
  }
}
