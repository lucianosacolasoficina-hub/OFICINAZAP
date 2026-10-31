"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/useMe";
import { Icon } from "./Icon";

// "perm": permissão necessária para ver o menu ("admin" = só administrador).
const LINKS: { href: string; label: string; icon: string; perm?: string }[] = [
  { href: "/", label: "Conversas", icon: "chat" },
  { href: "/central", label: "Central (colunas)", icon: "columns" },
  { href: "/painel", label: "Painel", icon: "chart", perm: "ver_todas" },
  { href: "/funil", label: "Funil de vendas", icon: "funnel", perm: "funil" },
  { href: "/contatos", label: "Contatos", icon: "users" },
  { href: "/orcamentos", label: "Orçamentos", icon: "doc" },
  { href: "/departamentos", label: "Departamentos", icon: "building", perm: "departamentos" },
  { href: "/whatsapp", label: "WhatsApp", icon: "phone", perm: "whatsapp" },
  { href: "/configuracoes", label: "Configurações", icon: "gear", perm: "configuracoes" },
  { href: "/atendimentos", label: "Atendimentos", icon: "trend", perm: "admin" },
  { href: "/equipe", label: "Equipe", icon: "lock", perm: "admin" },
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
        <span className="logo-m">OZ</span> <span className="label">OficinaZap</span>
      </div>
      {LINKS.filter((l) => show(l.perm)).map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""} title={l.label} aria-label={l.label}>
          <Icon name={l.icon} size={22} /> <span className="label">{l.label}</span>
        </Link>
      ))}
      <div className="spacer" />
      <form action="/api/auth/logout" method="post">
        <button title="Sair" aria-label="Sair">
          <Icon name="logout" size={22} /> <span className="label">Sair</span>
        </button>
      </form>
    </nav>
  );
}
