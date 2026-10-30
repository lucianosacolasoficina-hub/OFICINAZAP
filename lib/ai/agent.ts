import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolUnion, BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Department, Message, QuoteData } from "../db";

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

/** Departamentos que a IA pode escolher: só os que têm descrição de quando encaminhar. */
const routable = (departments: Department[]) => departments.filter((d) => d.description.trim());

function buildTools(departments: Department[], comGestao: boolean): BetaToolUnion[] {
  const names = routable(departments).map((d) => d.name);
  const handoffProps: Record<string, unknown> = {
    motivo: { type: "string", description: "Resumo curto do motivo para o atendente" },
  };
  if (names.length) {
    handoffProps.departamento = {
      type: ["string", "null"],
      enum: [...names, null],
      description: "Departamento que deve atender, conforme a lista de departamentos. null se nenhum se encaixar.",
    };
  }
  const gestaoTools: BetaToolUnion[] = comGestao
    ? [
        {
          name: "consultar_pedido",
          description:
            "Consulta no sistema de gestão da empresa a situação de um pedido (etapa da produção e previsão de entrega). " +
            "Use quando o cliente perguntar por um pedido específico pelo número. Os pedidos do telefone do cliente já estão no contexto.",
          strict: true,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["numero_pedido"],
            properties: { numero_pedido: { type: "string", description: "Número do pedido ou da OS informado pelo cliente" } },
          },
        },
      ]
    : [];
  return [
    ...gestaoTools,
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
        required: Object.keys(handoffProps),
        properties: handoffProps,
      },
    },
  ];
}

function departmentsBlock(departments: Department[]) {
  const list = routable(departments);
  if (!list.length) return "";
  return `
Ao transferir para um humano, escolha o departamento certo pelo assunto da conversa:
<departamentos>
${list.map((d) => `- ${d.name}: ${d.description}`).join("\n")}
</departamentos>
`;
}

function systemPrompt(knowledgeBase: string, quote: QuoteData | null, departments: Department[], gestao?: string) {
  return `Você é o assistente virtual de atendimento no WhatsApp da empresa descrita abaixo. Responda clientes em português do Brasil, de forma simpática, objetiva e curta (como numa conversa de WhatsApp: no máximo 3 frases curtas por mensagem, sem markdown, sem listas longas).

Seu objetivo é tirar dúvidas e coletar os dados para o orçamento: ${Object.keys(QUOTE_FIELDS).join(", ")}. Pergunte uma ou duas coisas por vez, não faça um interrogatório. Sempre que o cliente informar algum dado, salve com a ferramenta salvar_orcamento.

Regras:
- Use somente as informações da empresa abaixo. Nunca invente preços, prazos ou condições. Se não souber, diga que vai confirmar com a equipe e transfira para um humano.
- Não feche preço nem prometa desconto: o valor final é sempre passado pela equipe.
- Quando os dados principais do orçamento (produto, quantidade, tamanho e prazo) estiverem coletados, agradeça, diga que a equipe vai preparar o orçamento e transfira para um humano.
- Se o cliente mandar uma imagem (logo, arte, foto de sacola de referência), descreva brevemente o que entendeu e use isso no orçamento (ex.: quantas cores a arte parece ter).
- Mensagens marcadas como [Atendente] foram escritas por uma pessoa da equipe; mantenha coerência com elas.
${gestao ? `- Para perguntas sobre pedidos (andamento, prazo, entrega), use os dados do sistema de gestão abaixo e a ferramenta consultar_pedido. Explique a etapa em palavras simples (ex.: "está em produção", "pronto para retirada/envio"). Se estiver atrasado, peça desculpas e transfira para um atendente confirmar a nova data. Não informe valores, a não ser o saldo quando o cliente perguntar sobre pagamento. Nunca passe dados de pedidos de outro cliente.
` : `- Se o cliente perguntar sobre um pedido já feito (andamento, prazo, entrega, rastreio), não informe a situação: diga com simpatia que um atendente vai verificar e já retorna, e transfira para um humano.
`}${departmentsBlock(departments)}
${gestao ? `<sistema_de_gestao>
${gestao}
</sistema_de_gestao>
` : ""}
<informacoes_da_empresa>
${knowledgeBase}
</informacoes_da_empresa>

<orcamento_coletado_ate_agora>
${quote ? JSON.stringify(quote) : "nada ainda"}
</orcamento_coletado_ate_agora>`;
}

export type AgentImage = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const isAgentImageType = (t: string): t is AgentImage["mediaType"] => IMAGE_TYPES.has(t);

/** Converte o histórico do banco no formato de mensagens da API (alternando cliente e assistente). */
function toApiMessages(history: Message[], images: Map<string, AgentImage>): BetaMessageParam[] {
  const out: { role: "user" | "assistant"; content: BetaContentBlockParam[] }[] = [];
  for (const m of history) {
    if (m.sender === "system") continue;
    const role = m.direction === "in" ? "user" : "assistant";
    const blocks: BetaContentBlockParam[] = [];
    const image = role === "user" ? images.get(m.id) : undefined;
    if (image) {
      blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
    }
    let text = m.body;
    if (m.media_type && m.direction === "in" && !image) {
      text = `[cliente enviou ${m.media_type}${m.media_type === "audio" ? " (ainda não consigo ouvir áudios)" : ""}] ${text}`;
    }
    if (m.sender === "agent") text = `[Atendente] ${text}`;
    if (text.trim()) blocks.push({ type: "text", text });
    if (!blocks.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export type AgentResult = {
  reply: string | null;
  handoff: string | null;
  /** Nome do departamento escolhido pela IA ao transferir. */
  department: string | null;
  quoteFields: QuoteData[];
};

export async function runAgent(opts: {
  history: Message[];
  knowledgeBase: string;
  quote: QuoteData | null;
  /** Imagens recentes enviadas pelo cliente, por id da mensagem. */
  images?: Map<string, AgentImage>;
  departments?: Department[];
  /** Resumo do cliente no sistema de gestão (pedidos e etapas). */
  gestao?: string;
  /** Consulta um pedido pelo número no sistema de gestão (já restrito ao telefone do cliente). */
  consultarPedido?: (numero: string) => Promise<string>;
}): Promise<AgentResult> {
  const client = new Anthropic();
  const messages = toApiMessages(opts.history, opts.images ?? new Map());
  const result: AgentResult = { reply: null, handoff: null, department: null, quoteFields: [] };
  const departments = opts.departments ?? [];
  const tools = buildTools(departments, !!opts.consultarPedido);
  if (!messages.length) return result;

  const replyParts: string[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: systemPrompt(opts.knowledgeBase, opts.quote, departments, opts.gestao),
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") break;

    const toolResults: BetaContentBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) replyParts.push(block.text.trim());
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, string | null>;
      if (block.name === "consultar_pedido") {
        let out = "Não foi possível consultar agora.";
        try {
          if (opts.consultarPedido && input.numero_pedido) out = await opts.consultarPedido(String(input.numero_pedido));
        } catch (err) {
          console.error("Falha ao consultar pedido", err);
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: out });
        continue;
      }
      if (block.name === "salvar_orcamento") {
        result.quoteFields.push(input);
      } else if (block.name === "transferir_para_humano") {
        result.handoff = input.motivo ?? "sem motivo informado";
        result.department = input.departamento ?? null;
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
