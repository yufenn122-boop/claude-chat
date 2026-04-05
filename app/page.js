"use client";
import { useState, useRef, useEffect, useCallback } from "react";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", short: "Sonnet", limit: 200000 },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", short: "Opus", limit: 200000 },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", short: "Haiku", limit: 200000 },
];

function sgTime() {
  return new Date().toLocaleString("zh-SG", { timeZone: "Asia/Singapore", hour12: false });
}

function renderWithLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>{part}</a>
      : part
  );
}

function highlight(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "#ffe066", borderRadius: 2 }}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = not searching, [] = no results
  const [highlightMsgId, setHighlightMsgId] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [copied, setCopied] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const msgRefs = useRef({});

  const activeSession = sessions.find((s) => s.id === activeId);
  const totalPrompt = activeSession?.total_prompt || 0;
  const modelLimit = MODELS.find((m) => m.id === model)?.limit || 200000;
  const contextPct = Math.min(100, Math.round((totalPrompt / modelLimit) * 100));
  const contextWarn = contextPct >= 80;

  // 加载 sessions
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setSessions(data);
          setActiveId(data[0].id);
        } else if (Array.isArray(data) && data.length === 0) {
          createSession(true);
        }
      });
  }, []);

  // 切换对话时加载消息
  useEffect(() => {
    if (!activeId) return;
    setMessages([]);
    fetch(`/api/sessions/${activeId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMessages(data);
      });
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // 高亮定位：messages 加载完后再触发
  useEffect(() => {
    if (!highlightMsgId || messages.length === 0) return;
    const el = msgRefs.current[highlightMsgId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightMsgId(null), 2000);
    }
  }, [highlightMsgId, messages]);

  async function checkPassword() {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwInput }),
    });
    if (res.ok) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

  async function saveTitle(id, title) {
    if (!title.trim()) return;
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: title.trim() } : s));
    setEditingId(null);
  }

  async function createSession(silent = false) {
    const num = sessions.length + 1;
    const title = `新对话 ${num}`;
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, model }),
    });
    const s = await res.json();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setMessages([]);
    if (!silent) setShowSidebar(false);
  }

  async function deleteSession(id) {
    if (!window.confirm("确定删除这个对话吗？")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id || null);
        setMessages([]);
      }
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

  async function handleSearch(q) {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults(null); return; }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setSearchResults(Array.isArray(data) ? data : []);
  }

  async function jumpToMessage(sessionId, msgId) {
    setSearchResults(null);
    setSearchQuery("");
    if (activeId !== sessionId) {
      setActiveId(sessionId);
      // 等消息加载完再高亮
      setTimeout(() => setHighlightMsgId(msgId), 400);
    } else {
      setHighlightMsgId(msgId);
    }
    setShowSidebar(false);
  }

  async function send() {
    if ((!input.trim() && attachments.length === 0) || loading || !activeId) return;

    let content = input;
    if (attachments.length > 0) {
      const textFiles = attachments.filter((a) => a.type === "text");
      const imgFiles = attachments.filter((a) => a.type === "image");
      if (textFiles.length > 0) {
        content += "\n\n" + textFiles.map((a) => `[文件: ${a.name}]\n${a.data}`).join("\n\n");
      }
      if (imgFiles.length > 0) {
        const contentArr = [];
        if (content) contentArr.push({ type: "text", text: content });
        imgFiles.forEach((a) => contentArr.push({ type: "image_url", image_url: { url: a.data } }));
        content = contentArr;
      }
    }

    const displayContent = input + (attachments.length > 0 ? ` [附件: ${attachments.map(a => a.name).join(", ")}]` : "");
    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const time = sgTime();

    // 先写 user 消息到 Supabase
    const userRes = await fetch(`/api/sessions/${activeId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: contentStr, display_content: displayContent, time }),
    });
    const userMsg = await userRes.json();

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setAttachments([]);
    setLoading(true);
    setStreamText("");

    // 更新标题（第一条消息时）
    const userCount = newMessages.filter(m => m.role === "user").length;
    if (userCount === 1 && input.trim()) {
      const newTitle = input.slice(0, 20);
      await fetch(`/api/sessions/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, title: newTitle } : s));
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // API 消息用原始 content（可能是数组）
    const apiMessages = newMessages.map((m) => {
      let c = m.content;
      try { const parsed = JSON.parse(c); if (Array.isArray(parsed)) c = parsed; } catch {}
      return { role: m.role, content: c };
    });

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
            fullText += line.slice(2).replace(/\\n/g, "\n");
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

      // 写 assistant 消息到 Supabase
      const asstRes = await fetch(`/api/sessions/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: fullText, time: replyTime }),
      });
      const asstMsg = await asstRes.json();
      setMessages((prev) => [...prev, asstMsg]);

      // 更新 token 统计
      if (promptTokens > 0 || completionTokens > 0) {
        setSessions((prev) => {
          const cur = prev.find((s) => s.id === activeId);
          const newPrompt = (cur?.total_prompt || 0) + promptTokens;
          const newCompletion = (cur?.total_completion || 0) + completionTokens;
          fetch(`/api/sessions/${activeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ total_prompt: newPrompt, total_completion: newCompletion }),
          });
          return prev.map((s) => s.id === activeId ? { ...s, total_prompt: newPrompt, total_completion: newCompletion } : s);
        });
      }

    } catch (e) {
      setStreamText("");
      if (e.name !== "AbortError") {
        const errRes = await fetch(`/api/sessions/${activeId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "assistant", content: "请求失败，请稍后再试。", time: sgTime() }),
        });
        const errMsg = await errRes.json();
        setMessages((prev) => [...prev, errMsg]);
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
    navigator.clipboard.writeText(content);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  }

  function exportTxt() {
    if (!activeSession) return;
    const text = messages.map((m) => {
      const c = m.display_content || m.content;
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

  function exportPdf() { window.print(); }

  const filteredSessions = sessions.filter((s) =>
    !searchQuery || s.title.includes(searchQuery)
  );

  const msgCount = messages.filter((m) => m.role === "user").length;
  const totalTokens = (activeSession?.total_prompt || 0) + (activeSession?.total_completion || 0);

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
      <style>{`@media print { .no-print { display: none !important; } }`}</style>

      {showSidebar && <div style={styles.overlay} onClick={() => setShowSidebar(false)} />}
      <div style={{ ...styles.sidebar, transform: showSidebar ? "translateX(0)" : "translateX(-100%)" }} className="no-print">
        <div style={styles.sidebarHeader}>
          <span style={{ fontWeight: "bold" }}>历史对话</span>
          <button style={styles.iconBtn} onClick={() => createSession()}>＋ 新对话</button>
        </div>
        <div style={{ position: "relative", margin: "8px 12px" }}>
          <input style={{ ...styles.searchInput, margin: 0, width: "100%", boxSizing: "border-box", paddingRight: 28 }}
            placeholder="搜索消息..." value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)} />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); setSearchResults(null); }}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 14, padding: 0 }}>✕</button>
          )}
        </div>

        {/* 搜索结果 */}
        {searchResults !== null ? (
          <div style={styles.sessionList}>
            {searchResults.length === 0 && <div style={{ padding: "12px", color: "#aaa", fontSize: 13 }}>无结果</div>}
            {searchResults.map((m) => (
              <div key={m.id} style={styles.searchResultItem} onClick={() => jumpToMessage(m.session_id, m.id)}>
                <div style={styles.searchResultSession}>{m.sessions?.title || "对话"}</div>
                <div style={styles.searchResultSnippet}>
                  {highlight(m.display_content || m.content, searchQuery)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.sessionList}>
            {filteredSessions.map((s) => (
              <div key={s.id} style={{ ...styles.sessionItem, background: s.id === activeId ? "#e8f0fe" : "transparent" }}
                onClick={() => { setActiveId(s.id); setShowSidebar(false); }}>
                {editingId === s.id ? (
                  <input
                    autoFocus
                    style={{ fontSize: 14, width: "100%", border: "1px solid #0070f3", borderRadius: 4, padding: "2px 6px", boxSizing: "border-box" }}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => saveTitle(s.id, editingTitle)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTitle(s.id, editingTitle); if (e.key === "Escape") setEditingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div style={styles.sessionTitle}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingId(s.id); setEditingTitle(s.title); }}>
                    {s.title}
                  </div>
                )}
                <div style={styles.sessionMeta}>{((s.total_prompt || 0) + (s.total_completion || 0)).toLocaleString()} tokens</div>
                <button style={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.container}>
        <div style={styles.header} className="no-print">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button style={styles.iconBtn} onClick={() => setShowSidebar(true)}>☰</button>
            <span style={{ fontWeight: "bold", fontSize: 17 }}>{activeSession?.title || "Claude Chat"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={styles.statsText}>{msgCount}条 · {totalTokens.toLocaleString()} tokens</span>
            <button style={styles.exportBtn} onClick={exportTxt}>TXT</button>
            <button style={styles.exportBtn} onClick={exportPdf}>PDF</button>
          </div>
        </div>

        {contextWarn && (
          <div style={styles.contextWarn} className="no-print">
            ⚠️ 上下文已用 {contextPct}%，接近上限，建议新开对话
          </div>
        )}

        <div style={styles.toolbar} className="no-print">
          <select style={styles.modelSelect} value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.short}</option>)}
          </select>
          <div style={styles.contextBar}>
            <div style={{ ...styles.contextFill, width: `${contextPct}%`, background: contextWarn ? "#e53e3e" : "#0070f3" }} />
          </div>
          <span style={{ fontSize: 11, color: contextWarn ? "#e53e3e" : "#aaa" }}>{contextPct}%</span>
        </div>

        <div style={styles.messages}>
          {messages.length === 0 && !loading && <div style={styles.empty}>发送消息开始对话</div>}
          {messages.map((m, i) => {
            const displayText = m.display_content || m.content;
            const isHighlighted = m.id === highlightMsgId;
            return (
              <div key={m.id || i} style={{ display: "flex", alignItems: "flex-start", justifyContent: m.role === "user" ? "flex-end" : "flex-start", gap: 6 }}>
                {isHighlighted && m.role !== "user" && <span style={{ fontSize: 20, lineHeight: 1, marginTop: 8, animation: "none" }}>👉</span>}
                <div
                  ref={(el) => { if (m.id) msgRefs.current[m.id] = el; }}
                  style={{
                    ...(m.role === "user" ? styles.userBubble : styles.aiBubble),
                    ...(isHighlighted ? { borderLeft: "4px solid #f6c90e", background: m.role === "user" ? "#1a5fd4" : "rgba(246,201,14,0.18)", transition: "all 0.3s" } : {}),
                  }}>
                  <span style={styles.role}>{m.role === "user" ? "你" : "Claude"}</span>
                  <div style={styles.text}>{renderWithLinks(displayText)}</div>
                  <div style={styles.bubbleFooter}>
                    {m.time && <span style={styles.time}>{m.time}</span>}
                    <button style={styles.copyBtn} onClick={() => copyMsg(displayText, i)}>
                      {copied === i ? "✓" : "复制"}
                    </button>
                  </div>
                </div>
                {isHighlighted && m.role === "user" && <span style={{ fontSize: 20, lineHeight: 1, marginTop: 8 }}>👈</span>}
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
              placeholder="输入消息..."
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
  searchResultItem: { padding: "10px 8px", borderRadius: 8, cursor: "pointer", marginBottom: 4, borderBottom: "1px solid #f0f0f0" },
  searchResultSession: { fontSize: 11, color: "#0070f3", marginBottom: 3, fontWeight: "500" },
  searchResultSnippet: { fontSize: 13, color: "#333", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
  container: { flex: 1, display: "flex", flexDirection: "column", maxWidth: 700, margin: "0 auto", width: "100%" },
  header: { padding: "12px 16px", borderBottom: "1px solid #eee", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
  statsText: { fontSize: 12, color: "#888" },
  contextWarn: { background: "#fff5f5", color: "#e53e3e", fontSize: 13, padding: "6px 16px", borderBottom: "1px solid #fed7d7" },
  toolbar: { padding: "6px 12px", borderBottom: "1px solid #f0f0f0", background: "#fafafa", display: "flex", alignItems: "center", gap: 8 },
  modelSelect: { fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", maxWidth: 90 },
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
