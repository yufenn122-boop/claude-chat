"use client";
import { useState, useRef, useEffect } from "react";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", limit: 200000 },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", limit: 200000 },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", limit: 200000 },
];

function sgTime() {
  return new Date().toLocaleString("zh-SG", { timeZone: "Asia/Singapore", hour12: false });
}

function newSession(id) {
  return {
    id, messages: [], createdAt: Date.now(), totalPrompt: 0, totalCompletion: 0,
    title: "新对话 " + new Date().toLocaleString("zh-SG", { timeZone: "Asia/Singapore", hour12: false, month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }),
  };
}

// 把文本里的 URL 渲染成可点击链接
function renderWithLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>{part}</a>
      : part
  );
}

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);
  const [copied, setCopied] = useState(null);
  const [attachments, setAttachments] = useState([]); // [{name, type, data}]
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);

  const activeSession = sessions.find((s) => s.id === activeId);
  const messages = activeSession?.messages || [];
  const totalPrompt = activeSession?.totalPrompt || 0;
  const modelLimit = MODELS.find((m) => m.id === model)?.limit || 200000;
  const contextPct = Math.min(100, Math.round((totalPrompt / modelLimit) * 100));
  const contextWarn = contextPct >= 80;

  useEffect(() => {
    const saved = localStorage.getItem("claude-sessions");
    if (saved) {
      const parsed = JSON.parse(saved);
      setSessions(parsed);
      if (parsed.length > 0) setActiveId(parsed[0].id);
    } else {
      const s = newSession(Date.now());
      setSessions([s]);
      setActiveId(s.id);
    }
  }, []);

  useEffect(() => {
    if (sessions.length > 0) localStorage.setItem("claude-sessions", JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  function updateSession(id, updater) {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }

  async function checkPassword() {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwInput }),
    });
    if (res.ok) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

  function createSession() {
    const s = newSession(Date.now());
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setShowSidebar(false);
  }

  function deleteSession(id) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeId === id) setActiveId(next[0]?.id || null);
      return next;
    });
  }

  async function handleFile(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (file.type.startsWith("image/")) {
          setAttachments((prev) => [...prev, { name: file.name, type: "image", data: ev.target.result }]);
        } else {
          setAttachments((prev) => [...prev, { name: file.name, type: "text", data: ev.target.result }]);
        }
      };
      if (file.type.startsWith("image/")) reader.readAsDataURL(file);
      else reader.readAsText(file);
    }
    e.target.value = "";
  }

  async function send() {
    if ((!input.trim() && attachments.length === 0) || loading || !activeId) return;

    // 构建消息内容
    let content = input;
    if (attachments.length > 0) {
      const textFiles = attachments.filter((a) => a.type === "text");
      const imgFiles = attachments.filter((a) => a.type === "image");
      if (textFiles.length > 0) {
        content += "\n\n" + textFiles.map((a) => `[文件: ${a.name}]\n${a.data}`).join("\n\n");
      }
      // 图片用 OpenAI 格式的 content array
      if (imgFiles.length > 0) {
        const contentArr = [];
        if (content) contentArr.push({ type: "text", text: content });
        imgFiles.forEach((a) => contentArr.push({ type: "image_url", image_url: { url: a.data } }));
        content = contentArr;
      }
    }

    const userMsg = {
      role: "user",
      content,
      displayContent: input + (attachments.length > 0 ? ` [附件: ${attachments.map(a => a.name).join(", ")}]` : ""),
      time: sgTime(),
    };
    const newMessages = [...messages, userMsg];
    updateSession(activeId, (s) => ({ ...s, messages: newMessages }));
    setInput("");
    setAttachments([]);
    setLoading(true);
    setStreamText("");

    const controller = new AbortController();
    abortRef.current = controller;

    // 发给 API 的消息用 content 字段（可能是数组）
    const apiMessages = newMessages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, model }),
        signal: controller.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let promptTokens = 0;
      let completionTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("t:")) {
            fullText += line.slice(2);
            setStreamText(fullText);
          } else if (line.startsWith("u:")) {
            const [p, c] = line.slice(2).split("|");
            promptTokens = parseInt(p) || 0;
            completionTokens = parseInt(c) || 0;
          } else if (line.startsWith('{"error"')) {
            const err = JSON.parse(line);
            fullText = err.error === "quota" ? "⚠️ API 额度已耗尽，请去中转站充值后再使用。" : "请求失败，请稍后再试。";
          }
        }
      }

      const replyTime = sgTime();
      setStreamText("");
      updateSession(activeId, (s) => ({
        ...s,
        title: s.messages.filter(m => m.role === "user").length === 1 ? (input.slice(0, 20) || s.title) : s.title,
        messages: [...newMessages, { role: "assistant", content: fullText, time: replyTime }],
        totalPrompt: (s.totalPrompt || 0) + promptTokens,
        totalCompletion: (s.totalCompletion || 0) + completionTokens,
      }));
    } catch (e) {
      setStreamText("");
      if (e.name !== "AbortError") {
        updateSession(activeId, (s) => ({ ...s, messages: [...newMessages, { role: "assistant", content: "请求失败，请稍后再试。", time: sgTime() }] }));
      }
    }
    setLoading(false);
  }

  function stop() {
    abortRef.current?.abort();
    setStreamText("");
    setLoading(false);
  }

  function copyMsg(content, idx) {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  }

  function exportTxt() {
    if (!activeSession) return;
    const text = activeSession.messages.map((m) => {
      const c = typeof m.content === "string" ? m.content : (m.displayContent || "");
      return `[${m.time || ""}] ${m.role === "user" ? "你" : "Claude"}:\n${c}`;
    }).join("\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeSession.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    window.print();
  }

  const filteredSessions = sessions.filter((s) =>
    !searchQuery || s.title.includes(searchQuery) || s.messages.some((m) => {
      const c = typeof m.content === "string" ? m.content : (m.displayContent || "");
      return c.includes(searchQuery);
    })
  );

  const msgCount = messages.filter((m) => m.role === "user").length;
  const totalTokens = (activeSession?.totalPrompt || 0) + (activeSession?.totalCompletion || 0);

  if (!authed) {
    return (
      <div style={styles.lockScreen}>
        <div style={styles.lockBox}>
          <div style={styles.lockTitle}>Claude Chat</div>
          <input style={styles.pwInput} type="password" placeholder="输入密码" value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && checkPassword()} />
          {pwError && <div style={styles.pwError}>密码错误</div>}
          <button style={styles.button} onClick={checkPassword}>进入</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <style>{`@media print { .no-print { display: none !important; } .print-only { display: block !important; } }`}</style>

      {showSidebar && <div style={styles.overlay} onClick={() => setShowSidebar(false)} />}
      <div style={{ ...styles.sidebar, transform: showSidebar ? "translateX(0)" : "translateX(-100%)" }} className="no-print">
        <div style={styles.sidebarHeader}>
          <span style={{ fontWeight: "bold" }}>历史对话</span>
          <button style={styles.iconBtn} onClick={createSession}>＋ 新对话</button>
        </div>
        <input style={styles.searchInput} placeholder="搜索对话..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)} />
        <div style={styles.sessionList}>
          {filteredSessions.map((s) => (
            <div key={s.id} style={{ ...styles.sessionItem, background: s.id === activeId ? "#e8f0fe" : "transparent" }}
              onClick={() => { setActiveId(s.id); setShowSidebar(false); }}>
              <div style={styles.sessionTitle}>{s.title}</div>
              <div style={styles.sessionMeta}>{s.messages.filter(m => m.role === "user").length} 条消息</div>
              <button style={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.container}>
        <div style={{ ...styles.header }} className="no-print">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button style={styles.iconBtn} onClick={() => setShowSidebar(true)}>☰</button>
            <span style={{ fontWeight: "bold", fontSize: 17 }}>{activeSession?.title || "Claude Chat"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={styles.statsText}>{msgCount}条 · {totalTokens} tokens</span>
            <button style={styles.exportBtn} onClick={exportTxt}>TXT</button>
            <button style={styles.exportBtn} onClick={exportPdf}>PDF</button>
          </div>
        </div>

        {contextWarn && (
          <div style={styles.contextWarn} className="no-print">
            ⚠️ 上下文已用 {contextPct}%，接近上限，建议新开对话
          </div>
        )}

        <div style={{ ...styles.toolbar }} className="no-print">
          <select style={styles.modelSelect} value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <div style={styles.contextBar}>
            <div style={{ ...styles.contextFill, width: `${contextPct}%`, background: contextWarn ? "#e53e3e" : "#0070f3" }} />
          </div>
          <span style={{ fontSize: 11, color: contextWarn ? "#e53e3e" : "#aaa" }}>{contextPct}%</span>
        </div>

        <div style={styles.messages}>
          {messages.length === 0 && <div style={styles.empty}>发送消息开始对话</div>}
          {messages.map((m, i) => {
            const displayText = typeof m.content === "string" ? m.content : (m.displayContent || "");
            return (
              <div key={i} style={m.role === "user" ? styles.userBubble : styles.aiBubble}>
                <span style={styles.role}>{m.role === "user" ? "你" : "Claude"}</span>
                <div style={styles.text}>{renderWithLinks(displayText)}</div>
                <div style={styles.bubbleFooter}>
                  {m.time && <span style={styles.time}>{m.time}</span>}
                  <button style={styles.copyBtn} onClick={() => copyMsg(displayText, i)}>
                    {copied === i ? "✓" : "复制"}
                  </button>
                </div>
              </div>
            );
          })}
          {loading && (
            <div style={styles.aiBubble}>
              <span style={styles.role}>Claude</span>
              <div style={styles.text}>{streamText || <span style={styles.typing}>●●●</span>}</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={styles.inputArea} className="no-print">
          {attachments.length > 0 && (
            <div style={styles.attachList}>
              {attachments.map((a, i) => (
                <div key={i} style={styles.attachItem}>
                  {a.type === "image" ? "🖼 " : "📄 "}{a.name}
                  <button style={styles.removeAttach} onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={styles.inputRow}>
            <button style={styles.attachBtn} onClick={() => fileRef.current.click()} title="上传文件/图片">📎</button>
            <input ref={fileRef} type="file" multiple accept="image/*,.txt,.md,.csv,.json,.pdf" style={{ display: "none" }} onChange={handleFile} />
            <textarea style={styles.textarea} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !/iPhone|iPad|Android/i.test(navigator.userAgent)) {
                  e.preventDefault(); send();
                }
              }}
              placeholder="输入消息... (电脑 Enter 发送，手机点发送按钮)"
              rows={2} />
            {loading
              ? <button style={{ ...styles.button, background: "#e53e3e" }} onClick={stop}>停止</button>
              : <button style={styles.button} onClick={send}>发送</button>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  app: { display: "flex", height: "100vh", overflow: "hidden", fontFamily: "sans-serif" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 10 },
  sidebar: { position: "fixed", left: 0, top: 0, bottom: 0, width: 280, background: "#fff", borderRight: "1px solid #eee", zIndex: 20, display: "flex", flexDirection: "column", transition: "transform 0.25s", boxShadow: "2px 0 8px rgba(0,0,0,0.1)" },
  sidebarHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 12px", borderBottom: "1px solid #eee" },
  searchInput: { margin: "8px 12px", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 },
  sessionList: { flex: 1, overflowY: "auto", padding: "4px 8px" },
  sessionItem: { padding: "10px 8px", borderRadius: 8, cursor: "pointer", marginBottom: 4, position: "relative" },
  sessionTitle: { fontSize: 14, fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 20 },
  sessionMeta: { fontSize: 11, color: "#aaa", marginTop: 2 },
  deleteBtn: { position: "absolute", right: 6, top: 10, background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 12 },
  container: { flex: 1, display: "flex", flexDirection: "column", maxWidth: 700, margin: "0 auto", width: "100%" },
  header: { padding: "12px 16px", borderBottom: "1px solid #eee", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
  statsText: { fontSize: 12, color: "#888" },
  contextWarn: { background: "#fff5f5", color: "#e53e3e", fontSize: 13, padding: "6px 16px", borderBottom: "1px solid #fed7d7" },
  toolbar: { padding: "6px 12px", borderBottom: "1px solid #f0f0f0", background: "#fafafa", display: "flex", alignItems: "center", gap: 8 },
  modelSelect: { fontSize: 13, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" },
  contextBar: { flex: 1, height: 4, background: "#eee", borderRadius: 2, overflow: "hidden" },
  contextFill: { height: "100%", borderRadius: 2, transition: "width 0.3s" },
  messages: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  empty: { color: "#aaa", textAlign: "center", marginTop: 40 },
  userBubble: { alignSelf: "flex-end", background: "#0070f3", color: "#fff", borderRadius: 12, padding: "10px 14px", maxWidth: "80%" },
  aiBubble: { alignSelf: "flex-start", background: "#f1f1f1", color: "#000", borderRadius: 12, padding: "10px 14px", maxWidth: "80%" },
  role: { fontSize: 11, opacity: 0.7, display: "block", marginBottom: 4 },
  text: { whiteSpace: "pre-wrap", lineHeight: 1.6 },
  bubbleFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 },
  time: { fontSize: 10, opacity: 0.6 },
  copyBtn: { fontSize: 11, background: "rgba(0,0,0,0.08)", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "inherit", opacity: 0.7 },
  typing: { letterSpacing: 4, opacity: 0.5 },
  inputArea: { borderTop: "1px solid #eee", background: "#fff" },
  attachList: { display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px 0" },
  attachItem: { fontSize: 12, background: "#f0f0f0", borderRadius: 6, padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 },
  removeAttach: { background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 12, padding: 0 },
  inputRow: { display: "flex", gap: 8, padding: 12 },
  attachBtn: { background: "none", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", fontSize: 18, padding: "0 10px" },
  textarea: { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", resize: "none", fontSize: 15, fontFamily: "sans-serif" },
  button: { padding: "0 20px", background: "#0070f3", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 15 },
  exportBtn: { background: "#0070f3", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 13, cursor: "pointer" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 15, padding: "4px 8px", borderRadius: 6, color: "#555" },
  lockScreen: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f5f5f5" },
  lockBox: { background: "#fff", padding: 32, borderRadius: 16, display: "flex", flexDirection: "column", gap: 12, width: 280, boxShadow: "0 2px 16px rgba(0,0,0,0.1)" },
  lockTitle: { fontSize: 22, fontWeight: "bold", textAlign: "center", marginBottom: 8 },
  pwInput: { padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 15 },
  pwError: { color: "red", fontSize: 13, textAlign: "center" },
};
