export async function POST(req) {
  const { messages, model } = await req.json();

  const res = await fetch("https://new.aicode.us.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "你是一个贴心的日常助手，像朋友一样陪伴用户。说话自然随意，有温度，偶尔幽默。不要主动引导话题到代码或技术，跟着用户的话题走。不要用列表格式，多用口语，简短自然地回应。" },
        ...messages,
      ],
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err?.error?.message || "").toLowerCase();
    if (res.status === 429 || msg.includes("quota") || msg.includes("insufficient") || msg.includes("balance")) {
      return new Response(JSON.stringify({ error: "quota" }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "failed" }), { headers: { "Content-Type": "application/json" } });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let promptTokens = 0;
      let completionTokens = 0;

      try {
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
              if (text) controller.enqueue(encoder.encode("t:" + text.replace(/\n/g, "\\n") + "\n"));
              if (json.usage) {
                promptTokens = json.usage.prompt_tokens || 0;
                completionTokens = json.usage.completion_tokens || 0;
              }
            } catch {}
          }
        }
      } catch {}

      controller.enqueue(encoder.encode(`u:${promptTokens}|${completionTokens}`));
      controller.close();
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
