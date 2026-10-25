import type { Contact, QuoteData } from "./db";
import { getQuote, getSetting, setSetting } from "./db";
import type { Deal } from "./stages";
import { supabaseAdmin } from "./supabase/admin";

// Integração com o Bling (API v3, login por OAuth). Os tokens ficam na tabela settings,
// que só o servidor consegue ler.
const AUTHORIZE_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
const API_URL = "https://api.bling.com.br/Api/v3";

type Tokens = { access_token: string; refresh_token: string; expires_at: number };

export function blingConfigured() {
  return Boolean(process.env.BLING_CLIENT_ID && process.env.BLING_CLIENT_SECRET);
}

export async function blingConnected() {
  return Boolean(await getSetting<Tokens | null>("bling_tokens", null));
}

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({ response_type: "code", client_id: process.env.BLING_CLIENT_ID!, state });
  return `${AUTHORIZE_URL}?${params}`;
}

async function requestToken(body: Record<string, string>): Promise<Tokens> {
  const basic = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${API_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Bling recusou o login: ${data.error?.description ?? data.error ?? res.status}`);
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // Renova um minuto antes de vencer (o token do Bling dura cerca de 6 horas).
    expires_at: Date.now() + (Number(data.expires_in) - 60) * 1000,
  };
  await setSetting("bling_tokens", tokens);
  return tokens;
}

export function exchangeCode(code: string) {
  return requestToken({ grant_type: "authorization_code", code });
}

export async function disconnectBling() {
  await supabaseAdmin().from("settings").delete().eq("key", "bling_tokens");
}

async function accessToken() {
  const tokens = await getSetting<Tokens | null>("bling_tokens", null);
  if (!tokens) throw new Error("Bling não conectado (Configurações > Conectar ao Bling)");
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  return (await requestToken({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })).access_token;
}

async function bling<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields = (data.error?.fields ?? []) as { msg?: string }[];
    const detail = [data.error?.description ?? data.error?.message, ...fields.map((f) => f.msg)].filter(Boolean).join("; ");
    throw new Error(`Bling: ${detail || `erro ${res.status}`}`);
  }
  return data as T;
}

/** Devolve o código do cliente no Bling, cadastrando-o na primeira vez. */
async function ensureBlingContact(contact: Contact & { bling_id: number | null }, quote: QuoteData | null) {
  if (contact.bling_id) return contact.bling_id;
  const local = contact.phone.replace(/^55/, "");
  const { data } = await bling<{ data: { id: number } }>("/contatos", {
    method: "POST",
    body: JSON.stringify({
      nome: String(quote?.nome_cliente || contact.name || `WhatsApp ${local}`),
      tipo: "F",
      situacao: "A",
      celular: local,
      endereco: quote?.cep ? { geral: { cep: String(quote.cep) } } : undefined,
      observacao: "Cadastrado pelo OficinaZap (WhatsApp)",
    }),
  });
  await supabaseAdmin().from("contacts").update({ bling_id: data.id }).eq("id", contact.id);
  return data.id;
}

const QUOTE_LABELS: Record<string, string> = {
  produto: "Produto",
  quantidade: "Quantidade",
  tamanho: "Tamanho",
  material: "Material",
  cores: "Cores",
  arte: "Arte",
  prazo_desejado: "Prazo",
  cep: "CEP",
};

/** Cria no Bling o cliente e um pedido de venda com os dados do negócio. Grava o resultado no negócio. */
export async function sendDealToBling(dealId: string) {
  const db = supabaseAdmin();
  const { data: deal, error } = await db.from("deals").select("*, contact:contacts(*)").eq("id", dealId).single();
  if (error) throw new Error(error.message);
  const d = deal as Deal & { contact: Contact & { bling_id: number | null } };
  if (d.bling_order_id) return { id: d.bling_order_id, numero: d.bling_order_number };

  try {
    const quote = d.conversation_id ? await getQuote(d.conversation_id) : null;
    const contactId = await ensureBlingContact(d.contact, quote);

    const qty = Number(String(quote?.quantidade ?? "").replace(/\D/g, "")) || 1;
    const total = Number(d.value) || 0;
    const details = Object.entries(QUOTE_LABELS)
      .filter(([k]) => quote?.[k])
      .map(([k, label]) => `${label}: ${quote![k]}`);
    const { data } = await bling<{ data: { id: number; numero?: number } }>("/pedidos/vendas", {
      method: "POST",
      body: JSON.stringify({
        contato: { id: contactId },
        data: new Date().toISOString().slice(0, 10),
        itens: [
          {
            descricao: String(quote?.produto || d.title).slice(0, 120),
            unidade: "UN",
            quantidade: qty,
            valor: Math.round((total / qty) * 100) / 100,
          },
        ],
        observacoes: [d.title, ...details, d.notes].filter(Boolean).join("\n"),
        observacoesInternas: "Criado pelo OficinaZap a partir do funil de vendas",
      }),
    });
    const numero = data.numero != null ? String(data.numero) : null;
    await db
      .from("deals")
      .update({ bling_order_id: data.id, bling_order_number: numero, bling_error: null })
      .eq("id", dealId);
    return { id: data.id, numero };
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro ao enviar ao Bling";
    await db.from("deals").update({ bling_error: message }).eq("id", dealId);
    throw err;
  }
}
