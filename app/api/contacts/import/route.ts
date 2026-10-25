import { HttpError, route } from "@/lib/api";
import { normalizePhone, phoneVariants } from "@/lib/phone";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Incoming = { name?: string; phones?: string[]; tags?: string[] };

/**
 * Importa contatos (ex.: CSV exportado do Google Contatos, lido na tela).
 * Não duplica: quem já existe pelo telefone só ganha o nome (se não tinha) e as etiquetas.
 */
export const POST = route(async (req) => {
  const body = (await req.json()) as { contacts?: Incoming[] };
  if (!Array.isArray(body.contacts)) throw new HttpError(400, "lista de contatos inválida");
  if (body.contacts.length > 2000) throw new HttpError(400, "envie no máximo 2000 contatos por vez");

  // Um registro por telefone; se o mesmo número aparece duas vezes, fica o primeiro nome.
  const byPhone = new Map<string, { name: string | null; tags: string[] }>();
  let invalid = 0;
  for (const c of body.contacts) {
    const phones = (c.phones ?? []).map(normalizePhone).filter((p): p is string => !!p);
    if (phones.length === 0) invalid++;
    const name = c.name?.trim().slice(0, 200) || null;
    const tags = (c.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
    for (const phone of phones) {
      const prev = byPhone.get(phone);
      if (prev) prev.tags = [...new Set([...prev.tags, ...tags])];
      else byPhone.set(phone, { name, tags });
    }
  }

  const db = supabaseAdmin();
  const allVariants = [...new Set([...byPhone.keys()].flatMap(phoneVariants))];
  const existing = new Map<string, { id: string; phone: string; name: string | null; tags: string[] }>();
  for (let i = 0; i < allVariants.length; i += 300) {
    const { data, error } = await db
      .from("contacts")
      .select("id, phone, name, tags")
      .in("phone", allVariants.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) existing.set(row.phone, row);
  }

  const toInsert: { phone: string; name: string | null; tags: string[] }[] = [];
  let updated = 0;
  let unchanged = 0;
  const seen = new Set<string>();
  for (const [phone, c] of byPhone) {
    const match = phoneVariants(phone).map((v) => existing.get(v)).find(Boolean);
    if (!match) {
      toInsert.push({ phone, ...c });
      continue;
    }
    if (seen.has(match.id)) continue; // mesmo contato com e sem o 9
    seen.add(match.id);
    const tags = [...new Set([...match.tags, ...c.tags])];
    const patch: Record<string, unknown> = {};
    if (!match.name && c.name) patch.name = c.name;
    if (tags.length !== match.tags.length) patch.tags = tags;
    if (Object.keys(patch).length === 0) {
      unchanged++;
      continue;
    }
    const { error } = await db.from("contacts").update(patch).eq("id", match.id);
    if (error) throw new Error(error.message);
    updated++;
  }

  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await db.from("contacts").insert(toInsert.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  return { created: toInsert.length, updated, unchanged, invalid };
});
