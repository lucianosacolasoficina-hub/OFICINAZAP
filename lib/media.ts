import { supabaseAdmin } from "./supabase/admin";
import type { MediaFile } from "./whatsapp";

const BUCKET = "media";
const MAX_BYTES = 15 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/** Guarda o arquivo no Supabase Storage e devolve o caminho. */
export async function saveMedia(conversationId: string, messageId: string, file: MediaFile): Promise<string | null> {
  if (file.data.length > MAX_BYTES) return null;
  const path = `${conversationId}/${messageId}.${EXT[file.mimeType] ?? "bin"}`;
  const { error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .upload(path, file.data, { contentType: file.mimeType, upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

export async function loadMedia(path: string): Promise<MediaFile | null> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return { data: Buffer.from(await data.arrayBuffer()), mimeType: data.type };
}

export async function signedMediaUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}
