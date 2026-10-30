import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { emailDaGestao } from "@/lib/gestaoAuth";

// Lula, o assistente de IA do sistema de gestão (sistema.sacolasoficina.com.br).
// O sistema manda as regras, a conversa e as ferramentas; as ferramentas rodam lá no navegador,
// com as permissões de quem está logado. Aqui só conferimos a sessão e chamamos a IA.
const MODEL = process.env.AI_MODEL || "claude-opus-5-5";
const ORIGENS = (process.env.GESTAO_ORIGENS || "https://sistema.sacolasoficina.com.br").split(",").map((s) => s.trim());

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}
const resp = (req: Request, body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors(req) });

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

type Tool = { name: string; description?: string; input_schema: Record<string, unknown> };

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const email = await emailDaGestao(token);
  if (!email) return resp(req, { error: "sessão do sistema inválida", code: "session_expired" }, 401);

  const body = (await req.json().catch(() => null)) as { system?: string; messages?: Anthropic.Beta.BetaMessageParam[]; tools?: Tool[] } | null;
  const system = String(body?.system ?? "").slice(0, 80000);
  const messages = Array.isArray(body?.messages) ? body!.messages.slice(-30) : [];
  const tools = (Array.isArray(body?.tools) ? body!.tools : []).slice(0, 20).map((t) => ({
    name: String(t.name).slice(0, 64),
    description: String(t.description ?? "").slice(0, 2000),
    input_schema: (t.input_schema ?? { type: "object", properties: {} }) as Anthropic.Beta.BetaTool.InputSchema,
  }));
  if (!messages.length || JSON.stringify(messages).length > 400000) return resp(req, { error: "conversa inválida" }, 400);

  try {
    const r = await new Anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 3000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: `${system}\n\nSeu nome é Lula. Você é o assistente de IA da Sacolas Oficina. Quem está falando com você: ${email}.`,
      ...(tools.length ? { tools } : {}),
      messages,
    });
    return resp(req, { content: r.content, stop_reason: r.stop_reason });
  } catch (err) {
    console.error("Lula (gestão) falhou", err);
    const status = (err as { status?: number }).status;
    return resp(req, { error: "a IA não respondeu agora", code: status === 429 ? "rate_limited" : "erro" }, 502);
  }
}
