// Telefones são guardados só com dígitos e DDI (ex.: 5511999998888).

/** Converte um telefone digitado de qualquer jeito para o formato do banco, ou null se não der. */
export function normalizePhone(raw: string): string | null {
  const international = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) return valid(digits.replace(/^0+/, ""));
  if (international) return valid(digits);
  // "0 15 11 99999-8888" ou "011 99999-8888": tira o zero e o código da operadora.
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
    if (digits.length === 12 || digits.length === 13) digits = digits.slice(2);
  }
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null; // sem DDD ou formato desconhecido
}

function valid(digits: string) {
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/**
 * Formas do mesmo celular brasileiro: o WhatsApp às vezes manda o número sem o 9
 * (5511 9999-8888), então procuramos as duas para não duplicar o contato.
 */
export function phoneVariants(phone: string): string[] {
  const m13 = phone.match(/^55(\d{2})9(\d{8})$/);
  if (m13) return [phone, `55${m13[1]}${m13[2]}`];
  const m12 = phone.match(/^55(\d{2})([6-9]\d{7})$/);
  if (m12) return [phone, `55${m12[1]}9${m12[2]}`];
  return [phone];
}
