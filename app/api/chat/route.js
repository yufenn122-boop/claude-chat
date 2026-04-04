export async function POST(req) {
  const { messages } = await req.json();

  const body = {
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "你是一个有温度、有个性的AI助手。说话自然随意，像朋友聊天一样，偶尔可以开个小玩笑。不要太正式，不要用生硬的列表格式，多用口语表达。" },
      ...messages,
    ],
    stream: false,
  };

  const res = await fetch("https://code.ppchat.vip/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err?.error?.message || "").toLowerCase();
    if (res.status === 429 || msg.includes("quota") || msg.includes("insufficient") || msg.includes("balance")) {
      return Response.json({ error: "quota" });
    }
    return Response.json({ error: "failed" });
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || "";
  const usage = json.usage || {};

  return Response.json({
    text,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
  });
}
