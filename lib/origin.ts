// Endereço público do site (no Render, req.url aponta para o servidor interno, ex.: localhost:10000).
export function publicUrl(req: Request, path: string) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const base = host ? `${req.headers.get("x-forwarded-proto")?.split(",")[0] ?? "https"}://${host}` : new URL(req.url).origin;
  return new URL(path, base);
}
