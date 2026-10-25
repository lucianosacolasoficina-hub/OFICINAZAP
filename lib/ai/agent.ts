import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolUnion, BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Message, QuoteData } from "../db";

const MODEL = process.env.AI_MODEL || "claude-opus-5-5";

export const QUOTE_FIELDS = {
  produto: "Tipo de sacola (ex.: kraft, plástica alça vazada, ecobag, TNT)",
  quantidade: "Quantidade de unidades",
  tamanho: "Tamanho ou medidas (largura x altura x fundo)",
  material: "Material ou gramatura",
  cores_impressao: "Cores da impressão / quantas cores tem a arte",
  tem_arte: "Se o cliente já tem a logo/arte pronta (sim/não)",
  prazo_desejado: "Para quando o cliente precisa",
  cep: "CEP de entrega",
  nome_cliente: "Nome do cliente ou da empresa",
  observacoes: "Qualquer outro detalhe relevante",
} as const;

const tools: BetaToolUnion[] = [
  {
    name: "salvar_orcamento",
    description:
      "Salva os dados do pedido de orçamento que o cliente informou até agora. Chame sempre que o cliente " +
      "passar um dado novo. Envie null nos campos que ainda não sabe; os dados já salvos são mantidos.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(QUOTE_FIELDS),
      properties: Object.fromEntries(
        Object.entries(QUOTE_FIELDS).map(([k, description]) => [k, { type: ["string", "null"], description }]),
      ),
    },
  },
  {
    name: "transferir_para_humano",
    description:
      "Passa a conversa para um atendente humano. Use quando o cliente pedir para falar com uma pessoa, " +
      "quando você não souber responder com base nas informações da empresa, quando houver reclamação, " +
      "ou quando todos os dados do orçamento já estiverem coletados.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["motivo"],
      properties: { motivo: { type: "string", description: "Resumo curto do motivo para o atendente" } },
    },
  },
];

function systemPrompt(knowledgeBase: string, quote: QuoteData | null) {
  return `Você é o assistente virtual de atendimento no WhatsApp da empresa descrita abaixo. Responda clientes em português do Brasil, de forma simpática, objetiva e curta (como numa conversa de WhatsApp: no máximo 3 frases curtas por mensagem, sem markdown, sem listas longas).

Seu objetivo é tirar dúvidas e coletar os dados para o orçamento: ${Object.keys(QUOTE_FIELDS).join(", ")}. Pergunte uma ou duas coisas por vez, não faça um interrogatório. Sempre que o cliente informar algum dado, salve com a ferramenta salvar_orcamento.

Regras:
- Use somente as informações da empresa abaixo. Nunca invente preços, prazos ou condições. Se não souber, diga que vai confirmar com a equipe e transfira para um humano.
- Não feche preço nem prometa desconto: o valor final é sempre passado pela equipe.
- Quando os dados principais do orçamento (produto, quantidade, tamanho e prazo) estiverem coletados, agradeça, diga que a equipe vai preparar o orçamento e transfira para um humano.
- Mensagens marcadas como [Atendente] foram escritas por uma pessoa da equipe; mantenha coerência com elas.

<informacoes_da_empresa>
${knowledgeBase}
</informacoes_da_empresa>

<orcamento_coletado_ate_agora>
${quote ? JSON.stringify(quote) : "nada ainda"}
</orcamento_coletado_ate_agora>`;
}

/** Converte o histórico do banco no formato de mensagens da API (alternando cliente e assistente). */
function toApiMessages(history: Message[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of history) {
    if (m.sender === "system") continue;
    const role = m.direction === "in" ? "user" : "assistant";
    let text = m.body;
    if (m.media_type && m.direction === "in") {
      text = `[cliente enviou ${m.media_type}${m.media_type === "audio" ? " (ainda não consigo ouvir áudios)" : ""}] ${text}`;
    }
    if (m.sender === "agent") text = `[Atendente] ${text}`;
    if (!text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content as string}\n${text}`;
    } else {
      out.push({ role, content: text });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export type AgentResult = {
  reply: string | null;
  handoff: string | null;
  quoteFields: QuoteData[];
};

export async function runAgent(opts: {
  history: Message[];
  knowledgeBase: string;
  quote: QuoteData | null;
}): Promise<AgentResult> {
  const client = new Anthropic();
  const messages = toApiMessages(opts.history);
  const result: AgentResult = { reply: null, handoff: null, quoteFields: [] };
  if (!messages.length) return result;

  const replyParts: string[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: systemPrompt(opts.knowledgeBase, opts.quote),
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") break;

    const toolResults: BetaContentBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) replyParts.push(block.text.trim());
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, string | null>;
      if (block.name === "salvar_orcamento") {
        result.quoteFields.push(input);
      } else if (block.name === "transferir_para_humano") {
        result.handoff = input.motivo ?? "sem motivo informado";
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "ok" });
    }

    if (response.stop_reason !== "tool_use" || !toolResults.length) break;
    messages.push({ role: "assistant", content: response.content as BetaContentBlockParam[] });
    messages.push({ role: "user", content: toolResults });
  }

  result.reply = replyParts.join("\n\n") || null;
  return result;
}
