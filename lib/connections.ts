import { randomBytes } from "node:crypto";
import { HttpError } from "./api";
import { supabaseAdmin } from "./supabase/admin";
import { EvolutionProvider } from "./whatsapp/evolution";

// Números de WhatsApp conectados por QR Code (uma instância da Evolution API para cada).
export type Connection = {
  id: string;
  name: string;
  instance: string;
  phone: string | null;
  department_id: string | null;
  connected_at: string | null;
  created_at: string;
  channel?: string;
};

/** Quantos números podem ser conectados ao mesmo tempo. */
export const MAX_CONNECTIONS = Number(process.env.WHATSAPP_MAX_NUMBERS ?? 5);

export function requireEvolution() {
  if (process.env.WHATSAPP_PROVIDER === "meta") throw new HttpError(400, "o sistema está usando a API oficial da Meta");
}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function listConnections(): Promise<Connection[]> {
  return check(await supabaseAdmin().from("whatsapp_connections").select("*").order("created_at"));
}

export async function getConnection(id: string): Promise<Connection | null> {
  return check(await supabaseAdmin().from("whatsapp_connections").select("*").eq("id", id).maybeSingle());
}

export async function connectionByInstance(instance: string): Promise<Connection | null> {
  return check(
    await supabaseAdmin().from("whatsapp_connections").select("*").eq("instance", instance).maybeSingle(),
  );
}

export async function createConnection(name: string, departmentId: string | null): Promise<Connection> {
  const instance = `oficina-${randomBytes(4).toString("hex")}`;
  return check(
    await supabaseAdmin()
      .from("whatsapp_connections")
      .insert({ name, instance, department_id: departmentId })
      .select()
      .single(),
  );
}

export async function updateConnection(
  id: string,
  patch: Partial<Pick<Connection, "name" | "phone" | "department_id" | "connected_at">>,
): Promise<Connection> {
  return check(
    await supabaseAdmin().from("whatsapp_connections").update(patch).eq("id", id).select().single(),
  );
}

export async function deleteConnection(id: string) {
  check(await supabaseAdmin().from("whatsapp_connections").delete().eq("id", id));
}

/**
 * Consulta na Evolution API se o número está conectado e guarda o celular e a data da conexão.
 * Estados: "open" (conectado), "connecting", "close" ou "missing" (instância ainda não criada).
 */
export async function syncState(conn: Connection): Promise<Connection & { state: string }> {
  // Instagram não passa pela Evolution: está conectado enquanto tiver o token guardado.
  if (conn.channel === "instagram" || conn.channel === "email") return { ...conn, state: conn.connected_at ? "open" : "close" };
  const evolution = new EvolutionProvider(conn.instance);
  let state: string;
  try {
    state = await evolution.connectionState();
  } catch {
    return { ...conn, state: "error" };
  }
  let next = conn;
  if (state === "open" && (!conn.connected_at || !conn.phone)) {
    const phone = (await evolution.ownerPhone().catch(() => null)) ?? conn.phone;
    next = await updateConnection(conn.id, { phone, connected_at: conn.connected_at ?? new Date().toISOString() });
  } else if ((state === "close" || state === "missing") && conn.connected_at) {
    next = await updateConnection(conn.id, { connected_at: null });
  }
  return { ...next, state };
}
