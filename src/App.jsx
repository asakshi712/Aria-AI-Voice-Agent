import React, { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, AudioLines, Check, ChevronDown, CircleHelp, Headphones, Mic, MicOff, Phone, PhoneOff, ShieldCheck, Sparkles, Truck, UserRound, Volume2, WandSparkles } from "lucide-react";

const money = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const greeting = { role: "assistant", content: "Namaste! I’m Aria from Aura Skincare. How can I help you today?", time: new Date().toISOString() };

function App() {
  const [orders, setOrders] = useState([]);
  const [health, setHealth] = useState({ aiEnabled: false });
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState("Idle");
  const [callActive, setCallActive] = useState(false);
  const [summary, setSummary] = useState(null);
  const [mode, setMode] = useState("voice");
  const [voiceStatus, setVoiceStatus] = useState("Checking microphone support…");
  const [error, setError] = useState("");
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [voiceName, setVoiceName] = useState("");
  const [lastMode, setLastMode] = useState("fallback");
  const recognitionRef = useRef(null);
  const messagesRef = useRef([]);
  const callActiveRef = useRef(false);
  const busyRef = useRef(false);
  const transcriptEndRef = useRef(null);
  const currentAssistantRef = useRef("");
  const voicesRef = useRef([]);

  useEffect(() => {
    fetch("/api/orders").then(r => r.json()).then(setOrders).catch(() => setError("Could not load the sample order database."));
    fetch("/api/health").then(r => r.json()).then(setHealth).catch(() => {});
    const supported = ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
    setVoiceStatus(supported ? "Microphone voice input available in supported browsers" : "Speech recognition is not supported in this browser. Try Microsoft Edge or Chrome.");
    const loadVoices = () => { voicesRef.current = window.speechSynthesis?.getVoices?.() || []; };
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => {
      recognitionRef.current?.stop?.();
      window.speechSynthesis?.cancel?.();
      window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
    };
  }, []);

  useEffect(() => { messagesRef.current = messages; transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { callActiveRef.current = callActive; }, [callActive]);

  const appendMessage = useCallback((role, content) => {
    const msg = { role, content, time: new Date().toISOString() };
    setMessages(prev => [...prev, msg]);
    messagesRef.current = [...messagesRef.current, msg];
    return msg;
  }, []);

  const chooseVoice = useCallback(() => {
    const voices = voicesRef.current.length ? voicesRef.current : (window.speechSynthesis?.getVoices?.() || []);
    const preferred = voices.find(v => /en-IN/i.test(v.lang) && /female|heera|priya|neerja|india/i.test(v.name))
      || voices.find(v => /en-IN/i.test(v.lang))
      || voices.find(v => /en-GB/i.test(v.lang) && /female/i.test(v.name))
      || voices.find(v => /^en/i.test(v.lang));
    if (preferred) setVoiceName(`${preferred.name} (${preferred.lang})`);
    return preferred;
  }, []);

  const speak = useCallback((text, onEnd) => {
    if (!("speechSynthesis" in window)) { setState("Listening"); onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = chooseVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || "en-IN";
    utterance.rate = 1.02;
    utterance.pitch = 1.03;
    utterance.onstart = () => setState("Speaking");
    utterance.onend = () => { if (callActiveRef.current) { setState("Listening"); onEnd?.(); } };
    utterance.onerror = () => { if (callActiveRef.current) { setState("Listening"); onEnd?.(); } };
    window.speechSynthesis.speak(utterance);
  }, [chooseVoice]);

  const startRecognition = useCallback(() => {
    if (!callActiveRef.current || busyRef.current) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setVoiceStatus("Voice input unavailable. Use the text test box below."); return; }
    try {
      const recognition = new Recognition();
      recognition.lang = "en-IN";
      // Keep the microphone session open across natural pauses and wait for a short
      // silence window before submitting, so a brief pause doesn't cut the customer off.
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 5;
      recognitionRef.current = recognition;
      let finalText = "";
      let submitTimer = null;
      let submitted = false;
      recognition.onstart = () => { setState("Listening"); setError(""); };
      recognition.onresult = event => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const alternatives = Array.from(result).map(item => item.transcript || "");
          const part = alternatives.sort((a, b) => b.length - a.length)[0] || "";
          if (result.isFinal) finalText = `${finalText} ${part}`.trim();
          else interim += ` ${part}`;
        }
        setDraft(`${finalText} ${interim}`.trim());
        if (finalText.trim()) {
          if (submitTimer) window.clearTimeout(submitTimer);
          // Wait 1.4 seconds after the latest final speech segment before taking the turn.
          submitTimer = window.setTimeout(() => {
            if (!submitted && callActiveRef.current && finalText.trim()) {
              submitted = true;
              try { recognition.stop(); } catch {}
              setDraft("");
              handleCustomerMessage(finalText.trim(), "voice");
            }
          }, 1400);
        }
      };
      recognition.onerror = event => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("Microphone access was blocked. Allow microphone access in your browser settings, then start the call again.");
          setVoiceStatus("Microphone permission needed");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError(`Voice input issue: ${event.error}. You can continue using the text test box.`);
        }
      };
      recognition.onend = () => {
        // Some browsers end a continuous recognition session on their own. Preserve the
        // same silence buffer rather than responding instantly to the first pause.
        if (!submitted && finalText.trim() && callActiveRef.current && !submitTimer) {
          submitTimer = window.setTimeout(() => {
            if (!submitted && callActiveRef.current && finalText.trim()) {
              submitted = true;
              setDraft("");
              handleCustomerMessage(finalText.trim(), "voice");
            }
          }, 1400);
        } else if (callActiveRef.current && !busyRef.current && !finalText.trim()) {
          setState("Listening");
          // No speech was captured; don't send an empty turn.
        }
      };
      recognition.start();
    } catch (e) {
      setError("Could not start voice recognition. Check microphone permissions and try again.");
      setState("Idle");
    }
  }, []);

  const sendToAgent = useCallback(async (text) => {
    const history = messagesRef.current.map(m => ({ role: m.role, content: m.content }));
    setState("Thinking");
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, messages: history })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The agent could not respond.");
      setLastMode(data.mode || "fallback");
      // Keep the visible sample-order cards in sync with mutations confirmed by the backend.
      // The cancellation endpoint returns the authoritative updated order record.
      if (data.order?.order_id) {
        setOrders(prev => prev.map(order =>
          order.order_id === data.order.order_id ? { ...order, ...data.order } : order
        ));
      }
      const msg = appendMessage("assistant", data.reply || "I’m sorry, I couldn’t process that. Could you please rephrase?");
      if (callActiveRef.current && mode === "voice") speak(msg.content, () => startRecognition());
      else setState(callActiveRef.current ? "Listening" : "Idle");
    } catch (e) {
      const fallback = "I’m sorry, I’m having trouble connecting right now. Please try again in a moment.";
      appendMessage("assistant", fallback);
      setError(e.message || "Unable to contact the support service.");
      if (callActiveRef.current && mode === "voice") speak(fallback, () => startRecognition());
      else setState("Idle");
    } finally { busyRef.current = false; }
  }, [appendMessage, mode, speak, startRecognition]);

  const handleCustomerMessage = useCallback(async (text, source = "text") => {
    const clean = String(text || "").trim();
    if (!clean || busyRef.current) return;
    busyRef.current = true;
    window.speechSynthesis?.cancel?.();
    recognitionRef.current?.stop?.();
    appendMessage("user", clean);
    setDraft("");
    await sendToAgent(clean);
  }, [appendMessage, sendToAgent]);

  const startCall = () => {
    setError("");
    setSummary(null);
    setMessages([greeting]);
    messagesRef.current = [greeting];
    setCallActive(true);
    callActiveRef.current = true;
    setMode("voice");
    setState("Speaking");
    // User gesture allows browser speech playback. Ask permission through recognition after greeting.
    speak(greeting.content, () => startRecognition());
  };

  const endCall = async () => {
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel?.();
    setCallActive(false);
    callActiveRef.current = false;
    setState("Idle");
    busyRef.current = false;
    try {
      const response = await fetch("/api/summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesRef.current })
      });
      setSummary(await response.json());
    } catch {
      setSummary({ customer_intent: "GENERAL_SUPPORT", order_id: null, resolution_status: "NEEDS_FOLLOW_UP", call_summary: "Summary service unavailable. Review the transcript above." });
    }
  };

  const startTextTest = () => {
    setError(""); setSummary(null);
    const initial = { ...greeting, time: new Date().toISOString() };
    setMessages([initial]); messagesRef.current = [initial];
    setCallActive(true); callActiveRef.current = true; setMode("text"); setState("Listening");
  };

  const reset = () => {
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel?.();
    setMessages([]); messagesRef.current = []; setSummary(null); setCallActive(false);
    callActiveRef.current = false; setState("Idle"); setError(""); setDraft("");
  };

  const submitDraft = async e => {
    e?.preventDefault?.();
    const value = draft.trim();
    if (!value || busyRef.current || !callActive) return;
    await handleCustomerMessage(value, mode === "voice" ? "typed" : "text");
  };

  const formatTime = iso => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const stateColor = state === "Listening" ? "listening" : state === "Thinking" ? "thinking" : state === "Speaking" ? "speaking" : "idle";

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark"><Sparkles size={19}/></div>
        <div><div className="brand-name">aura <span>skincare</span></div><div className="brand-sub">CUSTOMER EXPERIENCE</div></div>
      </div>
      <div className="topbar-right"><span className="secure-pill"><ShieldCheck size={14}/> Demo environment</span><div className="avatar">A</div></div>
    </header>

    <main className="main-layout">
      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-dot"/> AI CUSTOMER SUPPORT <span className="eyebrow-line"/></div>
        <h1>A little care.<br/><em>A lot of clarity.</em></h1>
        <p className="hero-copy">Meet Aria, your Aura Skincare support specialist. Ask about an order, delivery, or our customer care policies.</p>
        <div className="hero-proof"><div className="proof-icon"><ShieldCheck size={17}/></div><span>Thoughtful answers, grounded in our policies.</span></div>
      </section>

      <div className="workspace">
        <section className="call-card panel">
          <div className="card-heading">
            <div><div className="section-kicker">YOUR SUPPORT ASSISTANT</div><h2>Talk to Aria</h2></div>
            <div className={`status-pill ${stateColor}`}><span className="status-dot"/>{state}</div>
          </div>
          <div className={`voice-orb ${stateColor}`}>
            <div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><div className="orb-core"><AudioLines size={31}/></div>
            {state === "Listening" && <div className="listening-bars"><i/><i/><i/><i/><i/></div>}
          </div>
          <div className="agent-name">Aria <span className="agent-online"><i/> {callActive ? "Here with you" : "Ready to help"}</span></div>
          <p className="call-hint">{state === "Listening" ? "I’m listening. Go ahead." : state === "Thinking" ? "Let me check that for you…" : state === "Speaking" ? "Aria is responding…" : "Start a call to begin your conversation."}</p>
          <div className="call-actions">
            {!callActive ? <button className="primary-button" onClick={startCall}><Phone size={17} fill="currentColor"/> Start voice call</button> :
              <button className="end-button" onClick={endCall}><PhoneOff size={17}/> End call</button>}
            {!callActive && <button className="secondary-button" onClick={startTextTest}><WandSparkles size={16}/> Test with text</button>}
          </div>
          {callActive && <form className="text-fallback" onSubmit={submitDraft}>
            <label htmlFor="message-input">{mode === "voice" ? "Or type if your microphone isn't available" : "Send a test message"}</label>
            <div className="composer"><input id="message-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. Where is order ORD-101?" disabled={state === "Thinking"}/><button type="submit" aria-label="Send message" disabled={!draft.trim() || state === "Thinking"}><ArrowUpRight size={18}/></button></div>
          </form>}
          <div className="voice-footnote"><Mic size={14}/><span>{voiceStatus}</span></div>
          {voiceName && <div className="voice-name"><Volume2 size={13}/> Voice selected: {voiceName}</div>}
          {error && <div className="error-box"><CircleHelp size={16}/><span>{error}</span></div>}
        </section>

        <section className="transcript-card panel">
          <div className="card-heading transcript-heading"><div><div className="section-kicker">LIVE CONVERSATION</div><h2>Call transcript</h2></div><span className="message-count">{messages.length} messages</span></div>
          <div className="transcript-body">
            {!messages.length ? <div className="empty-state"><div className="empty-icon"><Headphones size={23}/></div><strong>Your conversation will appear here</strong><p>Start a voice call or use the text test to see the transcript and call outcome.</p></div> :
              messages.map((m, i) => <div className={`message ${m.role}`} key={`${m.time}-${i}`}>
                <div className={`message-avatar ${m.role}`}>{m.role === "assistant" ? <Sparkles size={15}/> : <UserRound size={15}/>}</div>
                <div className="message-content"><div className="message-meta"><strong>{m.role === "assistant" ? "Aria" : "Customer"}</strong><time>{formatTime(m.time)}</time></div><p>{m.content}</p></div>
              </div>)}
            <div ref={transcriptEndRef}/>
          </div>
          <div className="transcript-footer"><span className="live-dot"/>{callActive ? "Conversation in progress" : messages.length ? "Call log saved in this session" : "Waiting for your first call"}<span className="footer-spacer"/><span>{lastMode === "ai" ? "AI powered" : "Policy-safe mode"}</span></div>
        </section>
      </div>

      <div className="lower-grid">
        <section className="orders-card panel">
          <div className="card-heading"><div><div className="section-kicker">QUICK TEST DATA</div><h2>Sample orders</h2></div><span className="count-badge">{orders.length} records</span></div>
          <p className="panel-description">Try asking Aria about one of these order IDs.</p>
          <div className="orders-list">
            {orders.map(order => <div className={`order-row ${expandedOrder === order.order_id ? "expanded" : ""}`} key={order.order_id}>
              <button className="order-main" onClick={() => setExpandedOrder(expandedOrder === order.order_id ? null : order.order_id)}>
                <div className="order-icon"><Truck size={17}/></div><div className="order-identity"><strong>{order.order_id}</strong><span>{order.product}</span></div>
                <div className="order-right"><span className={`order-status ${order.status.toLowerCase().replaceAll(" ", "-")}`}>{order.status}</span><ChevronDown size={15}/></div>
              </button>
              {expandedOrder === order.order_id && <div className="order-details">
                <div><span>Customer</span><strong>{order.customer}</strong></div><div><span>Order value</span><strong>{money(order.value)}</strong></div>
                <div><span>Courier</span><strong>{order.courier || "Not shipped yet"}</strong></div><div><span>Tracking</span><strong>{order.tracking_number || "Not available"}</strong></div><p>{order.note}</p>
                {callActive && <button className="ask-order" onClick={() => handleCustomerMessage(`Can you check order ${order.order_id} for me?`)}>Ask Aria about this order <ArrowUpRight size={14}/></button>}
              </div>}
            </div>)}
          </div>
          <div className="data-note"><ShieldCheck size={15}/><span>Sample data only. No real customer information is used.</span></div>
        </section>

        <section className="policy-card panel">
          <div className="card-heading"><div><div className="section-kicker">AURA CARE PROMISE</div><h2>Support policies</h2></div><div className="policy-symbol"><ShieldCheck size={20}/></div></div>
          <div className="policy-list">
            <div className="policy-item"><div className="policy-number">01</div><div><strong>Shipping & delivery</strong><p>Free above ₹499 · ₹50 fee below ₹499 · 3–5 business days</p></div></div>
            <div className="policy-item"><div className="policy-number">02</div><div><strong>Returns & refunds</strong><p>Within 7 days of delivery for unopened, unused items in original packaging.</p></div></div>
            <div className="policy-item"><div className="policy-number">03</div><div><strong>Damaged products</strong><p>Report within 48 hours of delivery and provide photos for replacement review.</p></div></div>
            <div className="policy-item"><div className="policy-number">04</div><div><strong>Order cancellation</strong><p>Only while Processing. Shipped or out-for-delivery orders cannot be cancelled.</p></div></div>
            <div className="policy-item"><div className="policy-number">05</div><div><strong>Cash on Delivery</strong><p>Available up to ₹2,500. Pay by cash or UPI at the doorstep.</p></div></div>
          </div>
        </section>
      </div>

      {summary && <section className="summary-card panel">
        <div className="card-heading"><div><div className="section-kicker">AFTER THE CALL</div><h2>Call outcome</h2></div><span className={`resolution ${summary.resolution_status === "RESOLVED" ? "resolved" : "followup"}`}>{summary.resolution_status === "RESOLVED" ? <Check size={14}/> : <CircleHelp size={14}/>} {summary.resolution_status.replaceAll("_", " ")}</span></div>
        <div className="summary-grid"><div className="summary-field"><span>Customer intent</span><strong>{summary.customer_intent}</strong></div><div className="summary-field"><span>Order ID</span><strong>{summary.order_id || "Not identified"}</strong></div><div className="summary-field"><span>Messages</span><strong>{summary.message_count ?? messages.length}</strong></div></div>
        <div className="summary-description"><span>Call summary</span><p>{summary.call_summary}</p></div>
        <div className="json-heading"><strong>Structured JSON</strong><button className="copy-button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(summary, null, 2))}>Copy JSON <ArrowUpRight size={13}/></button></div>
        <pre className="json-block">{JSON.stringify(summary, null, 2)}</pre>
      </section>}

      <section className="demo-strip">
        <div className="demo-strip-icon"><Activity size={18}/></div><div><strong>Built for helpful, honest support.</strong><p>Aria checks the available order data, follows the published policy, and asks when more information is needed.</p></div>
        <button onClick={() => { if (callActive) endCall(); else startTextTest(); }} className="demo-strip-button">{callActive ? "Finish test" : "Try a text test"} <ArrowUpRight size={15}/></button>
      </section>
    </main>
    <footer className="footer"><span>© Aura Skincare · Assessment demo</span><span>Customer care, with clarity.</span></footer>
  </div>;
}

export default App;
