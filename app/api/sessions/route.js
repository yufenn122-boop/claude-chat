import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, title, model, created_at, total_prompt, total_completion")
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req) {
  const supabase = getSupabase();
  const { title, model } = await req.json();
  const { data, error } = await supabase
    .from("sessions")
    .insert({ title, model })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
