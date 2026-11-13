import { getSetting } from "./db";

// Cobrança por Pix na conversa: monta o "Pix copia e cola" (BR Code do Banco Central) com a chave da loja e o valor.
// O cliente copia o código e cola no app do banco; o valor e o favorecido já vêm preenchidos.

export type Pix = {
  tipo: "cpf" | "cnpj" | "telefone" | "email" | "aleatoria";
  chave: string;
  /** Nome de quem recebe (aparece no banco do cliente). */
  nome: string;
  cidade: string;
};

export const PIX_VAZIO: Pix = { tipo: "cnpj", chave: "", nome: "", cidade: "" };

const TIPOS = ["cpf", "cnpj", "telefone", "email", "aleatoria"] as const;

/** Tira acentos e símbolos (o BR Code só aceita letras simples) e corta no tamanho máximo. */
function simples(s: string, max: number) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max);
}

export function normalizaChave(tipo: Pix["tipo"], chave: string) {
  const c = chave.trim();
  if (tipo === "cpf" || tipo === "cnpj") return c.replace(/\D/g, "");
  if (tipo === "telefone") {
    const d = c.replace(/\D/g, "");
    return d ? `+${d.length <= 11 ? "55" + d : d}` : "";
  }
  if (tipo === "email") return c.toLowerCase();
  return c.toLowerCase();
}

export function normalizaPix(v: Partial<Pix> | null | undefined): Pix {
  const tipo = TIPOS.includes(v?.tipo as Pix["tipo"]) ? (v!.tipo as Pix["tipo"]) : PIX_VAZIO.tipo;
  return {
    tipo,
    chave: normalizaChave(tipo, String(v?.chave ?? "")).slice(0, 77),
    nome: String(v?.nome ?? "").slice(0, 60),
    cidade: String(v?.cidade ?? "").slice(0, 40),
  };
}

export async function getPix(): Promise<Pix> {
  return normalizaPix(await getSetting<Partial<Pix> | null>("pix", null).catch(() => null));
}

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como pede o padrão do Pix. */
function crc16(s: string) {
  let crc = 0xffff;
  for (const b of Buffer.from(s, "utf8")) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Código "Pix copia e cola" com valor (em reais) e uma descrição curta opcional. */
export function pixCopiaECola(cfg: Pix, valor?: number, descricao?: string) {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", cfg.chave) + (descricao ? campo("02", simples(descricao, 40)) : "");
  const corpo =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    (valor && valor > 0 ? campo("54", valor.toFixed(2)) : "") +
    campo("58", "BR") +
    campo("59", simples(cfg.nome, 25) || "LOJA") +
    campo("60", simples(cfg.cidade, 15) || "BRASIL") +
    campo("62", campo("05", "***")) +
    "6304";
  return corpo + crc16(corpo);
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NOME_TIPO: Record<Pix["tipo"], string> = { cpf: "CPF", cnpj: "CNPJ", telefone: "Telefone", email: "E-mail", aleatoria: "Chave aleatória" };

/** Chave como o cliente lê: CNPJ e CPF com pontos e traço. */
function chaveLegivel(cfg: Pix) {
  const d = cfg.chave;
  if (cfg.tipo === "cnpj" && d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (cfg.tipo === "cpf" && d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}

/**
 * Mensagem da cobrança (no mesmo jeito das mensagens que a loja já manda) e, à parte, o código copia e cola
 * sozinho, para o cliente copiar fácil no celular. Sem valor: só a chave (codigo vazio).
 */
export function textoCobranca(cfg: Pix, valor?: number, descricao?: string) {
  const linhas: string[] = [];
  if (descricao) linhas.push(`*${descricao}*`);
  if (valor && valor > 0) linhas.push(`*Valor a pagar: ${brl(valor)}*`, "");
  linhas.push(`🏦 ${cfg.nome || "Pix"}`, `🔑 Chave PIX (${NOME_TIPO[cfg.tipo]}): ${chaveLegivel(cfg)}`);
  if (valor && valor > 0) linhas.push("", "O código *PIX copia e cola* vem na próxima mensagem 👇 (já com o valor).");
  linhas.push("", "Após o pagamento, se possível, encaminhe o comprovante para conferência.", "", "Agradecemos!");
  return { texto: linhas.join("\n"), codigo: valor && valor > 0 ? pixCopiaECola(cfg, valor, descricao) : "" };
}
