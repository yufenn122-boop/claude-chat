"use client";
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: newMessages }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      assistantText += decoder.decode(value);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: assistantText };
        return updated;
      });
    }
    setLoading(false);
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>Claude Chat</div>
      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>发送消息开始对话</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={m.role === "user" ? styles.userBubble : styles.aiBubble}>
            <span style={styles.role}>{m.role === "user" ? "你" : "Claude"}</span>
            <div style={styles.text}>{m.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={styles.inputRow}>
        <textarea
          style={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          rows={2}
        />
        <button style={styles.button} onClick={send} disabled={loading}>
          {loading ? "..." : "发送"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: { display: "flex", flexDirection: "column", height: "100vh", maxWidth: 700, margin: "0 auto", fontFamily: "sans-serif" },
  header: { padding: "16px", fontSize: 20, fontWeight: "bold", borderBottom: "1px solid #eee", background: "#fff" },
  messages: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  empty: { color: "#aaa", textAlign: "center", marginTop: 40 },
  userBubble: { alignSelf: "flex-end", background: "#0070f3", color: "#fff", borderRadius: 12, padding: "10px 14px", maxWidth: "80%" },
  aiBubble: { alignSelf: "flex-start", background: "#f1f1f1", color: "#000", borderRadius: 12, padding: "10px 14px", maxWidth: "80%" },
  role: { fontSize: 11, opacity: 0.7, display: "block", marginBottom: 4 },
  text: { whiteSpace: "pre-wrap", lineHeight: 1.6 },
  inputRow: { display: "flex", gap: 8, padding: 12, borderTop: "1px solid #eee", background: "#fff" },
  textarea: { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", resize: "none", fontSize: 15, fontFamily: "sans-serif" },
  button: { padding: "0 20px", background: "#0070f3", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 15 },
};
