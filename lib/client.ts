// Utilitários usados nas telas (navegador).
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `erro ${res.status}`);
  return data as T;
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatPhone(phone: string) {
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${phone}`;
}

export const STATUS_LABEL = { bot: "IA", waiting: "Aguardando", open: "Em atendimento", closed: "Encerrada" } as const;

/** Horário na lista de conversas: hora (hoje), "Ontem", dia da semana ou data. */
export function formatListTime(iso: string) {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Ontem";
  if (days < 7) return d.toLocaleDateString("pt-BR", { weekday: "long" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Tempo desde uma data, curto: 5min, 3h, 2d. */
export function formatSince(iso: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min}min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / (24 * 60))}d`;
}

const MEDIA_LABEL: Record<string, string> = {
  image: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  document: "📄 Documento",
  sticker: "🏷️ Figurinha",
};

/** Troca "[audio]" e afins da prévia por um texto com ícone. */
export function formatPreview(preview: string | null) {
  return (preview ?? "").replace(/\[(image|audio|video|document|sticker)\]/g, (_, t: string) => MEDIA_LABEL[t]);
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? "")).toUpperCase();
}

const AVATAR_COLORS = ["#128c4a", "#2b6cb0", "#b83280", "#6b46c1", "#c05621", "#2c7a7b", "#4a5568", "#9b2c2c"];

/** Cor fixa para cada contato/atendente, a partir do id. */
export function avatarColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
