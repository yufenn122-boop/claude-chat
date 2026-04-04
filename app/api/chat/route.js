export async function POST(req) {
  const { messages } = await req.json();

  const res = await fetch("https://code.ppchat.vip/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}`,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      messages: [
        { role: "system", content: "你是一个有温度、有个性的AI助手。说话自然随意，像朋友聊天一样，偶尔可以开个小玩笑。不要太正式，不要用生硬的列表格式，多用口语表达。" },
        ...messages,
      ],
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err?.error?.message || "").toLowerCase();
    if (res.status === 429 || msg.includes("quota") || msg.includes("insufficient") || msg.includes("balance")) {
      return new Response("__QUOTA_EXCEEDED__", { status: 200 });
    }
    return new Response("__REQUEST_FAILED__", { status: 200 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.delta?.content;
            if (text) controller.enqueue(encoder.encode(text));
          } catch {}
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
