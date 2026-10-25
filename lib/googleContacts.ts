// Lê o CSV que o Google Contatos exporta (contacts.google.com > Exportar > Google CSV).
// Também aceita o formato "Outlook CSV" e planilhas simples com colunas Nome/Telefone.

export type ParsedContact = { name: string; phones: string[]; tags: string[] };

/** CSV com aspas, vírgulas e quebras de linha dentro dos campos. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const sep = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

// Planilhas do Excel em português costumam usar ";".
function detectSeparator(text: string) {
  const first = text.split(/\r?\n/, 1)[0];
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
}

// Rótulos automáticos do Google que não fazem sentido como etiqueta.
const SYSTEM_LABELS = /^\*?\s*(mycontacts|starred|meus contatos|com estrela)$/i;

export function parseGoogleContacts(text: string): ParsedContact[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const h = header.map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((c) => names.includes(c));

  const nameCol = col("name", "nome", "nome completo", "display name");
  const firstCol = col("first name", "given name", "primeiro nome", "nome próprio");
  const middleCol = col("middle name", "additional name", "nome do meio");
  const lastCol = col("last name", "family name", "sobrenome");
  const nickCol = col("nickname", "apelido");
  const orgCol = col("organization name", "organization 1 - name", "company", "empresa");
  const labelCol = col("labels", "group membership", "marcadores", "categories");
  const phoneCols = h
    .map((c, i) => ((/phone|telefone|celular|whatsapp|fone/.test(c) && !/label|type|tipo|rótulo/.test(c)) ? i : -1))
    .filter((i) => i >= 0);

  return rows.map((r) => {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const name =
      get(nameCol) ||
      [get(firstCol), get(middleCol), get(lastCol)].filter(Boolean).join(" ") ||
      get(nickCol) ||
      get(orgCol);
    // O Google junta vários números numa célula com " ::: ".
    const phones = phoneCols.flatMap((i) => get(i).split(":::")).map((p) => p.trim()).filter(Boolean);
    const tags = get(labelCol)
      .split(":::")
      .map((t) => t.trim())
      .filter((t) => t && !SYSTEM_LABELS.test(t));
    return { name, phones, tags };
  });
}
