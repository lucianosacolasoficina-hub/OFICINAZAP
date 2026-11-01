"use client";

import { useEffect, useRef, useState } from "react";
import { avatarColor, initials } from "@/lib/client";

/** Bolinha do contato: foto de perfil do WhatsApp quando houver, senão as iniciais. Só busca a foto quando aparece na tela. */
export function FotoContato({ id, name, phone, size = 36 }: { id: string; name: string; phone?: string | null; size?: number }) {
  const foto = !/^(ig|fb|mail):/.test(String(phone ?? ""));
  const [ok, setOk] = useState(true);
  const [visto, setVisto] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!foto || visto || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") return setVisto(true);
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setVisto(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [foto, visto]);
  return (
    <span ref={ref} className="ib-avatar" style={{ background: avatarColor(id), width: size, height: size, fontSize: size * 0.36 }}>
      {initials(name)}
      {foto && ok && visto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ib-foto" src={`/api/contacts/${id}/avatar`} alt="" onError={() => setOk(false)} />
      )}
    </span>
  );
}
