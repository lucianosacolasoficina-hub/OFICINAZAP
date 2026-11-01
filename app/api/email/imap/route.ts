import { after } from "next/server";
import { HttpError, route } from "@/lib/api";
import { getAgent } from "@/lib/perms";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limparSenhaApp, sincronizarImap, testarLogin } from "@/lib/emailImap";

export const maxDuration = 60;

// Liga um Gmail (ou outro e-mail IMAP/SMTP) por senha de app. Cada colaborador pode ter a sua caixa.
export const POST = route(async (req, _ctx, userId) => {
  const agent = await getAgent(userId);
  if (!agent || agent.role !== "admin") throw new HttpError(403, "só o administrador liga contas de e-mail");
  const b = (await req.json()) as { address?: string; password?: string; nome?: string; department_id?: string | null };
  const address = b.address?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new HttpError(400, "e-mail inválido");
  const password = limparSenhaApp(b.password ?? "");
  const gmail = /@(gmail|googlemail)\.com$/.test(address);
  if (gmail && !/^[a-z]{16}$/i.test(password)) throw new HttpError(400, "a senha de app do Google tem 16 letras (ex.: abcd efgh ijkl mnop). Não use a senha normal do Gmail");
  if (!password) throw new HttpError(400, "cole a senha de app");
  const hosts = gmail ? { imap_host: "imap.gmail.com", smtp_host: "smtp.gmail.com" } : { imap_host: `imap.${address.split("@")[1]}`, smtp_host: `smtp.${address.split("@")[1]}` };
  await testarLogin({ address, password, imap_host: hosts.imap_host });

  const db = supabaseAdmin();
  const instance = `imap:${address}`;
  const nome = b.nome?.trim() ? `E-mail ${b.nome.trim()}` : `E-mail ${address}`;
  let { data: conn } = await db.from("whatsapp_connections").select("id").eq("instance", instance).maybeSingle();
  if (conn) {
    await db.from("whatsapp_connections").update({ name: nome, connected_at: new Date().toISOString(), ...(b.department_id !== undefined ? { department_id: b.department_id || null } : {}) }).eq("id", conn.id);
  } else {
    const ins = await db
      .from("whatsapp_connections")
      .insert({ name: nome, instance, channel: "email", connected_at: new Date().toISOString(), department_id: b.department_id || null })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    conn = ins.data;
  }
  const up = await db.from("email_imap").upsert({ connection_id: conn!.id, address, password, ...hosts, last_error: null, updated_at: new Date().toISOString() });
  if (up.error) throw new Error(up.error.message);
  const id = conn!.id as string;
  after(async () => {
    await sincronizarImap(id).catch((e) => console.error("primeira leitura do e-mail", e));
  });
  return { ok: true, connection_id: id };
});
