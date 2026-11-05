import { randomUUID } from "crypto";
import { supabaseAdmin } from "./supabase/admin";

// Rascunho: mensagem (texto e, se houver, um arquivo como PDF ou Excel) que o sistema de gestão
// deixa pronta aqui para o atendente só conferir e enviar na conversa do cliente.
// Fica no Storage (pasta rascunhos/<id>/) e some depois de enviado ou após 2 dias.

const BUCKET = "media";
const PASTA = "rascunhos";
export const RASCUNHO_MAX_BYTES = 15 * 1024 * 1024;
const VALIDADE_MS = 2 * 24 * 60 * 60 * 1000;

export type RascunhoArquivo = { nome: string; mimeType: string; tamanho: number; path: string };
export type Rascunho = {
  id: string;
  texto: string;
  tel: string;
  nome: string;
  arquivo: RascunhoArquivo | null;
  criadoEm: string;
};

const limpaNome = (n: string) =>
  (n || "arquivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "arquivo";

export async function salvarRascunho(d: { texto: string; tel: string; nome: string; arquivo?: { nome: string; mimeType: string; data: Buffer } | null }): Promise<Rascunho> {
  const id = randomUUID();
  const st = supabaseAdmin().storage.from(BUCKET);
  let arquivo: RascunhoArquivo | null = null;
  if (d.arquivo) {
    const nome = limpaNome(d.arquivo.nome);
    const path = `${PASTA}/${id}/${nome}`;
    const { error } = await st.upload(path, d.arquivo.data, { contentType: d.arquivo.mimeType, upsert: true });
    if (error) throw new Error(error.message);
    arquivo = { nome, mimeType: d.arquivo.mimeType, tamanho: d.arquivo.data.length, path };
  }
  const r: Rascunho = { id, texto: d.texto, tel: d.tel, nome: d.nome, arquivo, criadoEm: new Date().toISOString() };
  const { error } = await st.upload(`${PASTA}/${id}/meta.json`, Buffer.from(JSON.stringify(r)), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
  return r;
}

export async function lerRascunho(id: string): Promise<Rascunho | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(`${PASTA}/${id}/meta.json`);
  if (error || !data) return null;
  const r = JSON.parse(await data.text()) as Rascunho;
  if (Date.now() - new Date(r.criadoEm).getTime() > VALIDADE_MS) {
    await apagarRascunho(id).catch(() => {});
    return null;
  }
  return r;
}

export async function arquivoDoRascunho(r: Rascunho): Promise<{ data: Buffer; mimeType: string; nome: string } | null> {
  if (!r.arquivo) return null;
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(r.arquivo.path);
  if (error || !data) return null;
  return { data: Buffer.from(await data.arrayBuffer()), mimeType: r.arquivo.mimeType, nome: r.arquivo.nome };
}

export async function apagarRascunho(id: string) {
  const st = supabaseAdmin().storage.from(BUCKET);
  const { data } = await st.list(`${PASTA}/${id}`);
  const paths = (data ?? []).map((f) => `${PASTA}/${id}/${f.name}`);
  if (paths.length) await st.remove(paths);
}
