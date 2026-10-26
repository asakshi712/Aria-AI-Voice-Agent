# Aria — Aura Skincare AI Voice Customer Support Agent

A browser-based voice support demo built for the Datastraw AI Voice Agent assessment. It includes voice input/output, a policy-aware conversational backend, a mock order database, tool/function calling, call transcript, structured post-call summary, and an evaluator-friendly test order panel.

## Features mapped to the assignment

- **Voice conversation:** browser Speech Recognition for microphone input and Speech Synthesis for spoken responses. The app prefers an available `en-IN` voice; actual voices depend on the visitor's OS/browser.
- **Natural AI responses:** optional OpenAI Chat Completions integration, with a server-side `get_order_details(order_id)` function tool.
- **Safe fallback:** when no API key is configured or the AI provider fails, deterministic responses still support the sample scenarios. The UI labels whether AI mode is enabled in the health endpoint; the transcript footer reports the mode used for the latest reply.
- **Brand guardrails:** server prompt and deterministic fallback both use the supplied shipping, return, damaged-item, cancellation, and COD policies.
- **Order database:** `ORD-101`, `ORD-102`, `ORD-103` are held server-side and available through `/api/orders` and `/api/orders/:id`.
- **Post-call summary:** `/api/summary` returns `customer_intent`, `order_id`, `resolution_status`, `call_summary`, `message_count`, and timestamp.
- **Testing UI:** Start Call, End Call, state indicator, text test mode, visible order helper, transcript, and JSON outcome.
- **Deployment:** a single Express service serves the built Vite app and API.

## Architecture

```text
Browser microphone
  -> Web Speech API (SpeechRecognition)
  -> React conversation state / transcript
  -> POST /api/chat
       -> OpenAI Chat Completions + get_order_details function tool (if API key set)
       -> policy-aware deterministic fallback if not configured or provider fails
  -> response text
  -> Browser SpeechSynthesis (available local voice)
  -> transcript + /api/summary JSON after End Call
```

### Technology choices

- **React + Vite:** quick, responsive browser interface and simple local development.
- **Node.js + Express:** server-side policy handling, mock order database, summary endpoint, and secure API-key boundary.
- **OpenAI Chat Completions tool calling (optional):** lets the model decide when order data is needed. The API key stays on the server and is never sent to the browser.
- **Browser Web Speech APIs:** avoids separate STT/TTS vendor setup for this assessment. Voice availability and quality are browser/OS-dependent; Chrome or Edge on desktop is recommended.
- **CSS:** responsive, low-distraction support interface.

This is a browser voice agent, not telephony. It does not purchase or connect a phone number.

## Run locally

Requires Node.js 18+ and npm.

```bash
npm install
cp .env.example .env
# Optional: add OPENAI_API_KEY to .env to enable model-based responses and tool calling
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The client proxies `/api` requests to Express on port 3001.

Without an API key, the demo runs in policy-safe deterministic fallback mode. For a stronger evaluation experience, configure a valid API key. Never commit `.env`.

## Production build

```bash
npm install
npm run build
npm start
```

Express serves the built frontend and API on the same port (`PORT`, default `3001`).

## Deployment (Render example)

1. Push the project to a public GitHub repository.
2. Create a **Web Service** on Render and connect the repository.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add environment variables `OPENAI_API_KEY` and optionally `OPENAI_MODEL=gpt-4o-mini`.
6. Deploy, then open the public HTTPS URL and allow microphone access.
7. Test the public URL in Chrome/Edge. Browser microphone permissions require HTTPS (localhost is also allowed).

Vercel can work too, but this project is intentionally configured as one Node/Express service; Render or Railway is the simplest deployment path without splitting the API into serverless functions.

## Test plan

1. Start a voice call and ask: “Where is order ORD-101?” Expected: Out for Delivery, BlueDart, tracking `BD-982103`, expected by 6 PM today.
2. Ask: “Can I cancel ORD-103?” Expected: eligible because status is Processing; the demo must not claim it actually cancelled the order.
3. Ask: “Can I cancel ORD-101?” Expected: cannot cancel while Out for Delivery; customer may refuse delivery at doorstep.
4. Ask: “I received ORD-102 14 days ago. Can I return it?” Expected: outside the 7-day return window.
5. Ask: “Can you book me a flight to Goa?” Expected: polite out-of-scope refusal.
6. Ask about `ORD-999`. Expected: not found; ask the customer to verify the ID.
7. End the call. Expected: chronological transcript remains visible and structured JSON appears.
8. Use text test mode if microphone permission or browser support is unavailable.

## Known limitations / honest trade-offs

- Web Speech API support and voice availability vary by browser, OS, locale, and network. This is not a guaranteed identical voice experience on every device.
- Voice recognition is turn-based rather than a full-duplex streaming audio model. The app listens for a user turn, thinks, speaks, then resumes listening. This keeps the demo simple and stable.
- Barge-in is basic: recognition is stopped while Aria speaks. For production-grade interruption, low latency, and more consistent Indian speech recognition, replace browser speech APIs with a realtime voice provider.
- The summary endpoint uses transparent heuristics, not a second LLM call. For production, use validated structured output and test the resolution classification.
- The demo does not perform real cancellation, refunds, or replacement creation. It reports eligibility and next steps only.
- The sample database is intentionally small and in-memory, as provided by the assignment. Production would use persistent storage and access controls.

## README: Tell Us How You Think

### 1. Why did you choose this architecture and technology stack?
I chose React and Vite for a responsive browser interface and Node.js/Express for the API, policy boundary, and order lookup. Browser speech APIs make the demo easy to try without telephony setup or a separate speech vendor, while optional server-side model tool calling enables more flexible conversation and keeps the API key out of the browser. A deterministic fallback means core test scenarios remain demonstrable if model access is not configured or temporarily unavailable.

### 2. What was the most difficult part, and how did you solve it?
The key challenge is balancing conversational flexibility with accurate policy enforcement and order-specific facts. I separated the order database and policy rules from the user interface, exposed order lookup as a named function, and added a deterministic fallback for common cases. The agent is instructed not to claim that it completed real-world actions such as cancellations or refunds.

### 3. If you had one more week, what would you improve first and why?
I would move voice handling to a realtime speech pipeline with streaming transcription, interruption/barge-in, and latency measurements. I would also add automated policy regression tests and structured-output validation for summaries, because reliability matters more than adding cosmetic features to customer support.

### 4. What would need to change at 1,000 conversations a day?
I would move orders and call records to a persistent database, add authentication and role-based access, rate limiting, observability, error tracking, and queue-based analytics. I would evaluate a managed realtime voice service, monitor latency and resolution rates, add privacy/retention controls for transcripts, and test policy behavior across a larger set of real-world utterances. I would also add load tests and a human escalation workflow.

## Short approach note

I built Aria as a browser-based voice customer support agent using React, Node.js, and Express. The agent uses a server-side order lookup tool and explicit Aura Skincare policy guardrails, with browser speech APIs for microphone input and spoken responses. After each call, it displays the transcript and a structured JSON outcome, while handling missing orders and out-of-scope requests safely.

## Demo video outline (3–5 minutes)

1. **0:00–0:25** — Introduce Aria and explain the browser-based architecture.
2. **0:25–1:15** — Start a voice call; ask about `ORD-101`; show status and tracking details.
3. **1:15–2:00** — Ask whether `ORD-102` can be returned after 14 days; show the 7-day policy guardrail.
4. **2:00–2:30** — Ask about an invalid ID or an out-of-scope request.
5. **2:30–3:15** — End the call and show transcript plus JSON outcome.
6. **3:15–4:00** — Show the order lookup endpoint, server-side function tool, environment variable boundary, and README.

## Submission checklist

- [ ] Public HTTPS application URL tested in Chrome/Edge
- [ ] Public GitHub repository contains source, README, and `.env.example` (never commit `.env`)
- [ ] 3–5 minute demo video link
- [ ] LinkedIn profile URL
- [ ] Short approach note
- [ ] Email subject: `AI Voice Agent Assignment - [Your Full Name]`
- [ ] Send to `ozair.shaikh@datastraw.in` and `aryan.jaiswal@datastraw.in`, CC `talent@datastraw.in`
