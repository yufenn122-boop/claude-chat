import { supabase } from "@/lib/supabase";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return Response.json([]);

  const { data, error } = await supabase
    .from("messages")
    .select("id, session_id, role, content, display_content, time, sessions(id, title)")
    .ilike("content", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
