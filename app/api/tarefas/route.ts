import { route, HttpError } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Kanban de tarefas da equipe: quadros, colunas e cartões.
export const GET = route(async (req) => {
  const db = supabaseAdmin();
  const quadro = new URL(req.url).searchParams.get("quadro");
  const { data: boards, error } = await db.from("task_boards").select("id, name").order("position");
  if (error) throw new Error(error.message);
  const atual = (boards ?? []).find((b) => b.id === quadro) ?? boards?.[0];
  if (!atual) return { boards: [], board: null, columns: [], cards: [], agents: [] };
  const [cols, cards, agents] = await Promise.all([
    db.from("task_columns").select("*").eq("board_id", atual.id).order("position"),
    db
      .from("task_cards")
      .select("*, contact:contacts(name, phone), comentarios:task_comments(count)")
      .eq("board_id", atual.id)
      .order("position"),
    db.from("agents").select("id, name").eq("active", true).order("name"),
  ]);
  return { boards, board: atual, columns: cols.data ?? [], cards: cards.data ?? [], agents: agents.data ?? [] };
});

// Novo quadro (já com as colunas A fazer / Fazendo / Feito).
export const POST = route(async (req) => {
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) throw new HttpError(400, "dê um nome ao quadro");
  const db = supabaseAdmin();
  const { data: b, error } = await db.from("task_boards").insert({ name: name.trim().slice(0, 60) }).select("id, name").single();
  if (error) throw new Error(error.message);
  await db.from("task_columns").insert([
    { board_id: b.id, name: "A fazer", color: "#6b7280", position: 1 },
    { board_id: b.id, name: "Fazendo", color: "#2b6cb0", position: 2 },
    { board_id: b.id, name: "Feito", color: "#128c4a", position: 3, done: true },
  ]);
  return b;
});
