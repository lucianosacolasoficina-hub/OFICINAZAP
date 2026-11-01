import { route, HttpError } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Novo cartão. Sem coluna: vai para a primeira coluna do primeiro quadro (ex.: criado a partir de uma conversa).
export const POST = route(async (req, _ctx, userId) => {
  const b = (await req.json()) as {
    column_id?: string;
    title?: string;
    description?: string;
    assignee?: string | null;
    due_date?: string | null;
    conversation_id?: string | null;
  };
  if (!b.title?.trim()) throw new HttpError(400, "escreva o título da tarefa");
  const db = supabaseAdmin();
  let col: { id: string; board_id: string } | null = null;
  if (b.column_id) col = (await db.from("task_columns").select("id, board_id").eq("id", b.column_id).maybeSingle()).data;
  else {
    const { data: board } = await db.from("task_boards").select("id").order("position").limit(1).maybeSingle();
    if (board) col = (await db.from("task_columns").select("id, board_id").eq("board_id", board.id).order("position").limit(1).maybeSingle()).data;
  }
  if (!col) throw new HttpError(400, "crie um quadro com pelo menos uma coluna");
  let contact_id: string | null = null;
  if (b.conversation_id) contact_id = (await db.from("conversations").select("contact_id").eq("id", b.conversation_id).maybeSingle()).data?.contact_id ?? null;
  const { data: ult } = await db.from("task_cards").select("position").eq("column_id", col.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db
    .from("task_cards")
    .insert({
      board_id: col.board_id,
      column_id: col.id,
      title: b.title.trim().slice(0, 200),
      description: b.description?.slice(0, 5000) ?? null,
      assignee: b.assignee ?? null,
      due_date: b.due_date || null,
      conversation_id: b.conversation_id ?? null,
      contact_id,
      created_by: userId,
      position: (ult?.position ?? 0) + 1000,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
});
