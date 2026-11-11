import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";
import { listConnections } from "@/lib/connections";
import { getSetting, setSetting } from "@/lib/db";
import { whatsapp } from "@/lib/whatsapp";

// Aviso ao dono (Luciano) no WhatsApp quando uma vendedora pede liberação de preço abaixo da tabela.
// O texto é montado aqui a partir do pedido/proposta lido no banco do sistema com a sessão de quem pediu
// (ninguém consegue mandar texto livre por aqui), e só vai para o número configurado do dono.
// Configuração em settings, chave `aviso_dono`: { "para": "5577988413065", "de": "557734246208" }.
const ORIGENS = (process.env.GESTAO_ORIGENS || "https://sistema.sacolasoficina.com.br").split(",").map((s) => s.trim());
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" };
}
const resp = (req: Request, body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors(req) });
export function OPTIONS(req: Request) { return new NextResponse(null, { status: 204, headers: cors(req) }); }

const PADRAO = { para: "5577988413065", de: "557734246208" };
const SITE = process.env.GESTAO_SITE || "https://sistema.sacolasoficina.com.br";
const brl = (n: unknown) => "R$ " + (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const corta = (s: unknown, n: number) => String(s ?? "").replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const enviados = new Map<string, number>();

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const email = await emailDaGestao(token);
  if (!email) return resp(req, { error: "sessão do sistema inválida" }, 401);
  const b = (await req.json().catch(() => ({}))) as { col?: string; id?: string; tipo?: string };
  const col = b.col === "orcamentos" ? "orcamentos" : b.col === "pedidos" ? "pedidos" : "";
  const id = String(b.id ?? "");
  if (!col || !/^[A-Za-z0-9_-]{3,60}$/.test(id)) return resp(req, { error: "documento inválido" }, 400);

  // lê o documento no sistema com a sessão de quem pediu (respeita as regras de acesso do sistema)
  const url = (process.env.GESTAO_SUPABASE_URL || "").replace(/\/+$/, ""), anon = process.env.GESTAO_SUPABASE_ANON_KEY || "";
  const r = await fetch(`${url}/rest/v1/docs?col=eq.${col}&id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  const rows = r?.ok ? ((await r.json().catch(() => [])) as { data?: any }[]) : [];
  const d = rows[0]?.data;
  if (b.tipo === "excecao") return avisarExcecao(req, email, col, id, d);
  const lp = d?.libPreco;
  if (!d || !lp || lp.status !== "pendente") return resp(req, { enviado: false, motivo: "não há liberação de preço pendente neste documento" });

  const chave = `${col}:${id}:${lp.em || ""}`;
  if ((enviados.get(chave) ?? 0) > Date.now() - 10 * 60_000) return resp(req, { enviado: false, motivo: "aviso já enviado" });
  enviados.set(chave, Date.now());

  const cfg = await getSetting<{ para?: string; de?: string }>("aviso_dono", PADRAO).catch(() => PADRAO);
  const para = String(cfg?.para || PADRAO.para).replace(/\D/g, ""), de = String(cfg?.de || PADRAO.de).replace(/\D/g, "");
  const itens = (Array.isArray(lp.itens) ? lp.itens : []).slice(0, 6);
  const linhas = itens.map((x: any) => `• ${corta(x.desc, 60)}${x.vn ? " (" + corta(x.vn, 30) + ")" : ""}${x.qtd ? " · " + Number(x.qtd).toLocaleString("pt-BR") + " un" : ""} · pediu *${brl(x.valor)}* (tabela ${brl(x.tabela)})`);
  const texto = [
    `🔔 *Liberação de preço* · ${corta(lp.porNome || lp.por || "vendedora", 30)}`,
    `${col === "pedidos" ? "Pedido" : "Proposta"} nº ${corta(d.numero, 12)} · ${corta(d.clienteNome, 50)}`,
    ...linhas,
    lp.motivo ? `Motivo: ${corta(lp.motivo, 200)}` : "",
    "",
    `Liberar ou recusar: ${SITE}/#libpreco-${col === "pedidos" ? "p" : "o"}-${id}`,
  ].filter((x) => x !== "").join("\n");

  return enviar(req, email, para, de, texto, chave);
}

// Pedido travado (pagamento/layout) liberado como exceção por alguém que não é o dono: avisa o dono.
async function avisarExcecao(req: Request, email: string, col: string, id: string, d: any) {
  const ex = d?.libExcecao;
  if (col !== "pedidos" || !d || !ex || !ex.em) return resp(req, { enviado: false, motivo: "este pedido não foi liberado como exceção" });
  const quando = Date.parse(ex.emIso || "") || 0;
  if (!quando || Date.now() - quando > 30 * 60_000) return resp(req, { enviado: false, motivo: "liberação antiga" });
  const chave = `exc:${id}:${ex.emIso}`;
  if ((enviados.get(chave) ?? 0) > Date.now() - 10 * 60_000) return resp(req, { enviado: false, motivo: "aviso já enviado" });
  enviados.set(chave, Date.now());
  const cfg = await getSetting<{ para?: string; de?: string }>("aviso_dono", PADRAO).catch(() => PADRAO);
  const para = String(cfg?.para || PADRAO.para).replace(/\D/g, ""), de = String(cfg?.de || PADRAO.de).replace(/\D/g, "");
  const itens = (Array.isArray(d.itens) ? d.itens : []).filter((i: any) => i && i.desc);
  const total = itens.reduce((s: number, i: any) => s + Number(i.qtd || 0) * Number(i.valor || 0), 0) + Number(d.frete || 0) + Number(d.outros || 0) - Number(d.desconto || 0);
  const dt = new Date(quando).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const texto = [
    `👑 *Pedido liberado como exceção* · ${corta(ex.porNome || "equipe", 30)}`,
    `Pedido nº ${corta(d.numero, 12)} · ${corta(d.clienteNome, 50)}`,
    total > 0 ? `Valor: ${brl(total)}` : "",
    ex.pend ? `Estava pendente: ${corta(ex.pend, 160)}` : "",
    `Observação: ${corta(ex.motivo, 300)}`,
    `Liberado em ${dt}${ex.senha ? " · confirmado com senha" : ""}`,
    "",
    `Ver o pedido: ${SITE}/#ped=${id}`,
  ].filter((x) => x !== "").join("\n");
  return enviar(req, email, para, de, texto, chave);
}

async function enviar(req: Request, email: string, para: string, de: string, texto: string, chave: string) {
  // sai pelo número da empresa; se ele estiver fora do ar, tenta os outros números conectados
  const conns = (await listConnections()).filter((c) => c.channel !== "instagram" && c.channel !== "messenger" && c.channel !== "email" && c.instance && !/^(ig|fb|mail|imap):/.test(c.instance) && (c.phone || "") !== para);
  conns.sort((a, c) => Number((c.phone || "") === de) - Number((a.phone || "") === de));
  let erro = "";
  for (const c of conns) {
    try { await whatsapp(c.instance).sendText(para, texto); await setSetting(`aviso_dono_ultimo`, { em: new Date().toISOString(), doc: chave, por: email, de: c.phone }).catch(() => {}); return resp(req, { enviado: true, de: c.phone }); }
    catch (e) { erro = (e as Error)?.message || String(e); }
  }
  enviados.delete(chave);
  return resp(req, { enviado: false, motivo: "não consegui mandar pelo WhatsApp: " + erro.slice(0, 200) }, 502);
}
