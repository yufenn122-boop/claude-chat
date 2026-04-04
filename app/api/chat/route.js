export async function POST(req) {
  const { messages } = await req.json();

  const body = {
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "你是一个有温度、有个性的AI助手。说话自然随意，像朋友聊天一样，偶尔可以开个小玩笑。不要太正式，不要用生硬的列表格式，多用口语表达。" },
      ...messages,
    ],
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}`,
  };

  // 同时发流式请求和非流式请求
  const [streamRes, usageRes] = await Promise.all([
    fetch("https://code.ppchat.vip/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
    }),
    fetch("https://code.ppchat.vip/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: false, max_tokens: 1 }),
    }),
  ]);

  if (!streamRes.ok) {
    const err = await streamRes.json().catch(() => ({}));
    const msg = (err?.error?.message || "").toLowerCase();
    if (streamRes.status === 429 || msg.includes("quota") || msg.includes("insufficient") || msg.includes("balance")) {
      return new Response("__QUOTA_EXCEEDED__", { status: 200 });
    }
    return new Response("__REQUEST_FAILED__", { status: 200 });
  }

  // 从非流式响应里拿 token 用量
  let promptTokens = 0;
  if (usageRes.ok) {
    const usageJson = await usageRes.json().catch(() => ({}));
    promptTokens = usageJson?.usage?.prompt_tokens || 0;
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completionTokens = 0;

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
            if (text) {
              completionTokens++;
              controller.enqueue(encoder.encode(text));
            }
            // 如果流式响应里有 usage 就用它
            if (json.usage?.prompt_tokens) {
              promptTokens = json.usage.prompt_tokens;
              completionTokens = json.usage.completion_tokens || completionTokens;
            }
          } catch {}
        }
      }

      const info = `__USAGE__${promptTokens}|${completionTokens}`;
      controller.enqueue(encoder.encode(info));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
