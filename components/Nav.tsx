"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/lib/useMe";
import { Icon } from "./Icon";

// "perm": permissão necessária para ver o menu ("admin" = só administrador).
const LINKS: { href: string; label: string; short: string; icon: string; perm?: string }[] = [
  { href: "/", label: "Conversas", short: "Conversas", icon: "chat" },
  { href: "/central", label: "Central (colunas)", short: "Central", icon: "columns" },
  { href: "/painel", label: "Painel", short: "Painel", icon: "chart", perm: "ver_todas" },
  { href: "/funil", label: "Funil de vendas", short: "Funil", icon: "funnel", perm: "funil" },
  { href: "/tarefas", label: "Tarefas da equipe", short: "Tarefas", icon: "check", perm: "tarefas" },
  { href: "/contatos", label: "Contatos", short: "Contatos", icon: "users" },
  { href: "/orcamentos", label: "Orçamentos", short: "Orçamentos", icon: "doc" },
  { href: "/departamentos", label: "Departamentos", short: "Deptos.", icon: "building", perm: "departamentos" },
  { href: "/whatsapp", label: "Conexões: WhatsApp, Instagram e e-mail", short: "Conexões", icon: "phone", perm: "whatsapp" },
  { href: "/configuracoes", label: "Configurações", short: "Ajustes", icon: "gear", perm: "configuracoes" },
  { href: "/atendimentos", label: "Atendimentos", short: "Relatório", icon: "trend", perm: "admin" },
  { href: "/equipe", label: "Equipe", short: "Equipe", icon: "lock", perm: "admin" },
];

export function Nav() {
  const path = usePathname();
  const me = useMe();
  // O menu pode ser escondido no computador para sobrar mais espaço para as conversas.
  const [oculto, setOculto] = useState(false);
  useEffect(() => {
    try { setOculto(localStorage.getItem("oz.navOculto") === "1"); } catch {}
  }, []);
  const mudar = (v: boolean) => {
    setOculto(v);
    try { localStorage.setItem("oz.navOculto", v ? "1" : "0"); } catch {}
  };
  const show = (perm?: string) =>
    !perm || (me ? (perm === "admin" ? me.role === "admin" : me.perms[perm as keyof typeof me.perms]) : perm !== "admin");
  // Dentro da Central de atendimento a conversa abre numa janela sem o menu.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1") return null;
  if (oculto)
    return (
      <nav className="nav nav-oculto">
        <button className="nav-mostrar" onClick={() => mudar(false)} title="Mostrar o menu" aria-label="Mostrar o menu">
          <span aria-hidden="true">»</span>
          <span className="nav-mostrar-t">Menu</span>
        </button>
      </nav>
    );
  return (
    <nav className="nav">
      <div className="logo">
        <span className="logo-m">OZ</span> <span className="label">OficinaZap</span>
      </div>
      {LINKS.filter((l) => show(l.perm)).map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""} title={l.label} aria-label={l.label}>
          <Icon name={l.icon} size={22} /> <span className="label">{l.label}</span><span className="nav-s">{l.short}</span>
        </Link>
      ))}
      <div className="spacer" />
      <button className="nav-esconder" onClick={() => mudar(true)} title="Esconder o menu para ver melhor as conversas" aria-label="Esconder o menu">
        <span className="nav-esc-ic" aria-hidden="true">«</span> <span className="label">Esconder menu</span><span className="nav-s">Esconder</span>
      </button>
      <form action="/api/auth/logout" method="post">
        <button title="Sair" aria-label="Sair">
          <Icon name="logout" size={22} /> <span className="label">Sair</span><span className="nav-s">Sair</span>
        </button>
      </form>
    </nav>
  );
}
