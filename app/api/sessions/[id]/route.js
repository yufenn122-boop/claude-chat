import { getSupabase } from "@/lib/supabase";

export async function PATCH(req, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const body = await req.json();
  const { error } = await supabase.from("sessions").update(body).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(_, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
