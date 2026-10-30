"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/useMe";

// "perm": permissão necessária para ver o menu ("admin" = só administrador).
const LINKS: { href: string; label: string; icon: string; perm?: string }[] = [
  { href: "/painel", label: "Painel", icon: "📊", perm: "ver_todas" },
  { href: "/central", label: "Central de atendimento (colunas)", icon: "🗂" },
  { href: "/", label: "Conversas", icon: "💬" },
  { href: "/funil", label: "Funil de vendas", icon: "🗂️", perm: "funil" },
  { href: "/contatos", label: "Contatos", icon: "👥" },
  { href: "/orcamentos", label: "Orçamentos", icon: "📋" },
  { href: "/departamentos", label: "Departamentos", icon: "🏢", perm: "departamentos" },
  { href: "/whatsapp", label: "WhatsApp", icon: "📱", perm: "whatsapp" },
  { href: "/configuracoes", label: "Configurações", icon: "⚙️", perm: "configuracoes" },
  { href: "/atendimentos", label: "Atendimentos por atendente", icon: "📈", perm: "admin" },
  { href: "/equipe", label: "Equipe e permissões", icon: "🔐", perm: "admin" },
];

export function Nav() {
  const path = usePathname();
  const me = useMe();
  const show = (perm?: string) =>
    !perm || (me ? (perm === "admin" ? me.role === "admin" : me.perms[perm as keyof typeof me.perms]) : perm !== "admin");
  // Dentro da Central de atendimento a conversa abre numa janela sem o menu.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1") return null;
  return (
    <nav className="nav">
      <div className="logo">
        🛍️ <span className="label">OficinaZap</span>
      </div>
      {LINKS.filter((l) => show(l.perm)).map((l) => (
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
