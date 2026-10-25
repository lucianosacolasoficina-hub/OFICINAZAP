"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Conversas", icon: "💬" },
  { href: "/contatos", label: "Contatos", icon: "👥" },
  { href: "/orcamentos", label: "Orçamentos", icon: "📋" },
  { href: "/configuracoes", label: "Configurações", icon: "⚙️" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="logo">
        🛍️ <span className="label">OficinaZap</span>
      </div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
          {l.icon} <span className="label">{l.label}</span>
        </Link>
      ))}
      <div className="spacer" />
      <form action="/api/auth/logout" method="post">
        <button>
          🚪 <span className="label">Sair</span>
        </button>
      </form>
    </nav>
  );
}
