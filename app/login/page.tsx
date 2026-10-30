"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Mensagem quando a entrada direta pelo sistema de gestão não deu certo.
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("sso");
    const msgs: Record<string, string> = {
      "sem-acesso": "Seu e-mail do sistema de gestão ainda não tem acesso ao OficinaZap. Peça ao administrador para cadastrar você em Equipe e permissões (com o mesmo e-mail).",
      desativado: "Seu acesso ao OficinaZap foi desativado. Fale com o administrador.",
      sessao: "Não foi possível confirmar sua sessão do sistema de gestão. Entre de novo no sistema ou use e-mail e senha abaixo.",
      indisponivel: "A entrada direta pelo sistema está indisponível agora. Use e-mail e senha abaixo.",
    };
    if (m && msgs[m]) setError(msgs[m]);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("E-mail ou senha incorretos.");
    else window.location.href = "/";
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>OficinaZap</h1>
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
        <button className="primary" disabled={loading}>{loading ? "Entrando..." : "Entrar"}</button>
      </form>
    </div>
  );
}
