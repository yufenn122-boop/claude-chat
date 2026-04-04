export async function POST(req) {
  const { password } = await req.json();
  if (password === process.env.CHAT_PASSWORD) {
    return new Response("ok", { status: 200 });
  }
  return new Response("unauthorized", { status: 401 });
}
