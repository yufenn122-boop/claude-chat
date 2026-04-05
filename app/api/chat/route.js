export async function POST(req) {
  const { messages, model } = await req.json();

  const body = {
    model: model || "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "你是一个贴心的日常助手，像朋友一样陪伴用户。说话自然随意，有温度，偶尔幽默。不要主动引导话题到代码或技术，跟着用户的话题走。不要用列表格式，多用口语，简短自然地回应。" },
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
