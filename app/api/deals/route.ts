import { HttpError, route } from "@/lib/api";
import { isStage } from "@/lib/deals";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const GET = route(async () => {
  const db = supabaseAdmin();
  const { data: deals, error } = await db
    .from("deals")
    .select("*, contact:contacts(name, phone)")
    .order("position", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  // Junta os dados do orçamento coletados pela IA em cada negócio.
  const ids = deals.map((d) => d.conversation_id).filter(Boolean);
  const { data: quotes, error: qError } = ids.length
    ? await db.from("quotes").select("conversation_id, data").in("conversation_id", ids)
    : { data: [], error: null };
  if (qError) throw new Error(qError.message);
  const byConv = new Map((quotes ?? []).map((q) => [q.conversation_id, q.data]));
  return deals.map((d) => ({ ...d, quote: byConv.get(d.conversation_id) ?? null }));
});

export const POST = route(async (req) => {
  const body = (await req.json()) as { contact_id?: string; conversation_id?: string; title?: string; stage?: string };
  if (!body.contact_id || !body.title?.trim()) throw new HttpError(400, "contato e título são obrigatórios");
  const stage = isStage(body.stage) ? body.stage : "novo";
  const { data, error } = await supabaseAdmin()
    .from("deals")
    .insert({
      contact_id: body.contact_id,
      conversation_id: body.conversation_id ?? null,
      title: body.title.trim(),
      stage,
      position: Date.now(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
});
