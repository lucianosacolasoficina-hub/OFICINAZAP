import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/origin";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(publicUrl(req, "/login"), { status: 303 });
}
