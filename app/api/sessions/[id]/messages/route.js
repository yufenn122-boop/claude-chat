import { getSupabase } from "@/lib/supabase";

export async function GET(_, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, display_content, time, created_at")
    .eq("session_id", id)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const { role, content, display_content, time } = await req.json();
  const { data, error } = await supabase
    .from("messages")
    .insert({ session_id: id, role, content, display_content, time })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
