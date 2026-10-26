import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Small, deterministic mock database from the Datastraw assessment.
const ORDERS = {
  "ORD-101": {
    order_id: "ORD-101", customer: "Priya Sharma", product: "Vitamin C Serum (30ml)",
    value: 699, status: "Out for Delivery", courier: "BlueDart", tracking_number: "BD-982103",
    note: "Expected by 6 PM today", delivered_days_ago: null
  },
  "ORD-102": {
    order_id: "ORD-102", customer: "Rahul Verma", product: "Hydrating Sunscreen SPF 50",
    value: 499, status: "Delivered", courier: "Delhivery", tracking_number: "DL-441029",
    note: "Delivered 14 days ago", delivered_days_ago: 14
  },
  "ORD-103": {
    order_id: "ORD-103", customer: "Ananya Patel", product: "Green Tea Face Wash + Toner",
    value: 850, status: "Processing", courier: null, tracking_number: null,
    note: "Ordered 3 hours ago. Eligible for cancellation", delivered_days_ago: null
  }
};

const BRAND_CONTEXT = `
You are Aria, a friendly, professional, concise Indian customer support specialist for Aura Skincare.
Aura Skincare is a premium organic Indian skincare brand focused on simple, effective skincare products
made with thoughtfully selected ingredients.
POLICIES (follow exactly):
- Shipping: Free delivery on orders above ₹499. Orders below ₹499 have a ₹50 shipping fee.
  Standard delivery takes 3–5 business days.
- Returns: Accepted within 7 days of delivery for unopened, unused products in original packaging.
- Damaged/defective products: Must be reported within 48 hours of delivery with photos for replacement.
- Cancellation: Only while status is Processing. Shipped or Out for Delivery orders cannot be cancelled.
  Customers may refuse delivery at the doorstep.
- COD: Available for orders up to ₹2,500. Payment by cash or UPI at the doorstep.
- Only answer Aura Skincare-related questions. Politely decline unrelated requests.
- Never invent order details, refunds, guarantees, product ingredients, medical claims, or actions.
- If information is missing, ask a concise clarifying question or say that a human support teammate must confirm.
- Never claim an action succeeded unless the backend action confirms it. For cancellation requests, the application executes the cancellation when the order is still Processing.
- Use order lookup for order-specific questions. Ask for an order ID if it is missing.
- Be concise and conversational; avoid repeating information.
`;

function get_order_details(order_id) {
  const normalized = String(order_id || "").trim().toUpperCase().replace(/[\s_]+/g, "-");
  return ORDERS[normalized] || null;
}

// Speech recognition often turns “ORD one zero three” into words, or drops the hyphen.
// Accept typed, spoken, and customer-name references without guessing outside the sample DB.
const DIGIT_WORDS = { zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
function resolveOrderId(text = "") {
  const value = String(text);
  let match = value.match(/\b(?:ord|o\s*r\s*d)\s*[-:#]?\s*(\d{3})\b/i)
    || value.match(/\border(?:\s+(?:id|number|no\.?))?\s*[-:#]?\s*(\d{3})\b/i);
  if (match) return `ORD-${match[1]}`;

  // Example: “order one zero three”, “O R D one zero three”.
  const spoken = value.match(/\b(?:ord|o\s*r\s*d|order(?:\s+(?:id|number|no\.?))?)\s+((?:(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\s*){3})\b/i);
  if (spoken) {
    const digits = spoken[1].trim().toLowerCase().split(/\s+/).map(word => DIGIT_WORDS[word]).join("");
    if (/^\d{3}$/.test(digits) && ORDERS[`ORD-${digits}`]) return `ORD-${digits}`;
  }

  // If the caller says a customer's name alongside an order/support request, resolve only
  // against known sample records (e.g. “track Ananya's order”).
  if (/order|track|tracking|deliver|shipment|status|cancel|return|refund/i.test(value)) {
    const lower = value.toLowerCase();
    const found = Object.values(ORDERS).find(order => {
      const full = order.customer.toLowerCase();
      const first = full.split(/\s+/)[0];
      return lower.includes(full) || new RegExp(`\\b${first}\\b`, "i").test(value);
    });
    if (found) return found.order_id;
  }
  return null;
}

function normalizeOrderReference(text = "", contextText = "") {
  let orderId = resolveOrderId(text);
  // If Aria just asked for the ID, customers often reply only “103” or “one zero three”.
  // Resolve that short answer using the recent customer context, but only when it contains
  // a clear order/support request; never guess from an unrelated number.
  if (!orderId && /(?:^|\s)(\d{3})(?:$|\s|[.!?,])/i.test(String(text).trim()) && /order|track|tracking|delivery|shipment|cancel|return|refund/i.test(contextText)) {
    const bare = String(text).trim().match(/(?:^|\s)(\d{3})(?:$|\s|[.!?,])/i)?.[1];
    if (bare && ORDERS[`ORD-${bare}`]) orderId = `ORD-${bare}`;
  }
  if (!orderId && /^(?:one|two|three|four|five|six|seven|eight|nine|zero|oh|o)(?:[\s-]+(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)){2}$/i.test(String(text).trim()) && /order|track|tracking|delivery|shipment|cancel|return|refund/i.test(contextText)) {
    const spokenDigits = String(text).trim().toLowerCase().split(/[\s-]+/).map(word => DIGIT_WORDS[word]).join("");
    if (ORDERS[`ORD-${spokenDigits}`]) orderId = `ORD-${spokenDigits}`;
  }
  if (!orderId) return String(text);
  // Keep the customer's words for context, but add the canonical ID for model/fallback lookup.
  return /\bORD-\d{3}\b/i.test(text) ? String(text).replace(/\bord-\d{3}\b/i, orderId) : `${String(text)} (${orderId})`;
}

function classifyIntent(text = "") {
  const s = text.toLowerCase();
  // More specific intents must take priority over the word “order” in the same sentence.
  if (/cancel/.test(s)) return "CANCELLATION";
  if (/return|refund|exchange/.test(s)) return "RETURN_REFUND";
  if (/damaged|defect|broken|leak/.test(s)) return "DAMAGED_PRODUCT";
  if (/order|deliver|tracking|track\b|where.*package|shipment|status/.test(s)) return "ORDER_TRACKING";
  if (/cod|cash on delivery|upi/.test(s)) return "COD";
  if (/shipping|delivery fee|ship fee/.test(s)) return "SHIPPING_POLICY";
  if (/ingredient|product|serum|sunscreen|face wash|toner|skin/.test(s)) return "PRODUCT_INFORMATION";
  return "GENERAL_SUPPORT";
}
function fallbackReply(text, history = []) {
  const s = text.toLowerCase();
  const orderId = resolveOrderId(text);
  const orderMatch = orderId ? [orderId, orderId] : null;
  const intent = classifyIntent(text);
  if (/flight|goa|weather|cricket|politics|write.*code/.test(s) && !/order/.test(s)) {
    return "I’m here to help with Aura Skincare orders, products, and support policies. Is there something about your Aura order I can help with?";
  }
  if (intent === "ORDER_TRACKING" || orderMatch) {
    if (!orderMatch) return "I can check that for you. Could you please share your order ID, such as ORD-101?";
    const order = get_order_details(orderMatch[0]);
    if (!order) return "I couldn’t locate an order with that ID. Could you please repeat it or verify the order number?";
    const tracking = order.tracking_number
      ? `The courier is ${order.courier} and the tracking number is ${order.tracking_number}.`
      : "It has not been dispatched yet, so a courier and tracking number are not available at the moment.";
    return `I found ${order.order_id} for ${order.customer}. The ${order.product} order is currently ${order.status.toLowerCase()}. ${order.note}. ${tracking}`.trim();
  }
  if (intent === "CANCELLATION") {
    if (!orderMatch) return "I can help check cancellation eligibility. Could you share your order ID?";
    const order = get_order_details(orderMatch[0]);
    if (!order) return "I couldn’t locate that order ID. Please verify it and try again.";
    if (order.status === "Cancelled") return `${order.order_id} has already been cancelled successfully.`;
    if (order.status === "Processing") {
      order.status = "Cancelled";
      order.note = "Cancellation confirmed. The order has not been dispatched.";
      return `Done. I’ve successfully cancelled ${order.order_id} for ${order.customer}. The ${order.product} order will not be dispatched. If a payment was already captured, any refund timing would need to be confirmed by the support team.`;
    }
    return `${order.order_id} is ${order.status.toLowerCase()}, so it can’t be cancelled under our policy. If it is out for delivery, you may refuse the delivery at the doorstep.`;
  }
  if (intent === "RETURN_REFUND") {
    if (!orderMatch) return "Our return policy allows returns within 7 days of delivery for unopened, unused products in original packaging. If you share your order ID, I can check the sample order details.";
    const order = get_order_details(orderMatch[0]);
    if (!order) return "I couldn’t locate that order ID. Could you please verify it?";
    if (order.delivered_days_ago === null) return "This order hasn’t been marked as delivered in the sample database, so I can’t confirm return eligibility. Our policy allows eligible returns within 7 days of delivery for unopened, unused products in original packaging.";
    return order.delivered_days_ago <= 7
      ? "This order is within the 7-day return window based on the sample record, provided the product is unopened, unused, and in its original packaging."
      : `This order was delivered ${order.delivered_days_ago} days ago, which is outside our 7-day return window. I’m sorry, but it doesn’t meet the standard return timing policy.`;
  }
  if (intent === "DAMAGED_PRODUCT") return "I’m sorry to hear that. Damaged or defective products must be reported within 48 hours of delivery, with photos, so the team can review a replacement. If you share your order ID and when it arrived, I can help explain the next step.";
  if (intent === "COD") return "Cash on Delivery is available for orders up to ₹2,500. You can pay by cash or UPI at the doorstep.";
  if (intent === "SHIPPING_POLICY") return "Standard delivery usually takes 3–5 business days. Delivery is free for orders above ₹499; orders below ₹499 have a ₹50 shipping fee.";
  if (/hello|hi\b|hey|good morning/.test(s)) return "Hello! You’re speaking with Aria from Aura Skincare. How can I help you today?";
  if (/thank/.test(s)) return "You’re welcome. Is there anything else about Aura Skincare I can help with?";
  return "I can help with Aura Skincare order tracking, cancellation and return policies, shipping, Cash on Delivery, and product support. What would you like to know?";
}

async function askModel(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const tools = [{
    type: "function",
    function: {
      name: "get_order_details",
      description: "Retrieve an order from Aura Skincare's mock order database. Use this for order-specific status, cancellation, or return eligibility questions.",
      parameters: {
        type: "object",
        properties: { order_id: { type: "string", description: "Order ID, for example ORD-101" } },
        required: ["order_id"],
        additionalProperties: false
      }
    }
  }];
  const apiMessages = [
    { role: "system", content: BRAND_CONTEXT },
    ...messages.slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 3000) }))
  ];
  const call = async (msgs) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", messages: msgs, tools, tool_choice: "auto", temperature: 0.3 })
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`AI provider returned ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response.json();
  };
  let result = await call(apiMessages);
  let msg = result.choices?.[0]?.message;
  if (!msg) throw new Error("AI provider returned an empty response.");
  if (msg.tool_calls?.length) {
    const followup = [...apiMessages, msg];
    for (const toolCall of msg.tool_calls) {
      if (toolCall.function?.name === "get_order_details") {
        let args = {};
        try { args = JSON.parse(toolCall.function.arguments || "{}"); } catch {}
        const order = get_order_details(args.order_id);
        followup.push({
          role: "tool", tool_call_id: toolCall.id,
          content: JSON.stringify(order ? { found: true, order } : { found: false, message: "No order found for that ID. Do not invent order details." })
        });
      }
    }
    result = await call(followup);
    msg = result.choices?.[0]?.message;
  }
  return msg?.content || null;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, aiEnabled: Boolean(process.env.OPENAI_API_KEY), voiceInput: "browser Web Speech API", voiceOutput: "browser SpeechSynthesis" }));
app.get("/api/orders", (_req, res) => res.json(Object.values(ORDERS)));
app.get("/api/orders/:id", (req, res) => {
  const order = get_order_details(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found", order_id: req.params.id });
  res.json(order);
});
app.post("/api/chat", async (req, res) => {
  const { messages = [], text = "" } = req.body || {};
  const safeMessages = Array.isArray(messages) ? messages.slice(-12) : [];
  const rawUserText = String(text || safeMessages.filter(m => m.role === "user").at(-1)?.content || "").trim();
  if (!rawUserText) return res.status(400).json({ error: "A customer message is required." });
  const recentCustomerContext = safeMessages.filter(message => message?.role === "user").slice(-4).map(message => String(message.content || "")).join(" ");
  const userText = normalizeOrderReference(rawUserText, recentCustomerContext);
  const modelMessages = safeMessages.map((message, index) => {
    if (message?.role !== "user") return message;
    const isLastUserMessage = index === safeMessages.map(m => m?.role).lastIndexOf("user");
    return isLastUserMessage ? { ...message, content: userText } : message;
  });
  try {
    // Handle cancellation deterministically so the AI cannot merely describe eligibility,
    // route the request to tracking, or repeat a stale order-status answer.
    // Handle return/refund questions deterministically so the model cannot mistake
    // a follow-up return request for another order-tracking question.
    if (classifyIntent(userText) === "RETURN_REFUND") {
      const orderId = resolveOrderId(userText) || resolveOrderId(recentCustomerContext);
      if (!orderId) {
        return res.json({
          reply: "I can check that for you. Which order would you like to return? You can say the last three digits, such as 102.",
          mode: "policy", intent: "RETURN_REFUND"
        });
      }
      const order = get_order_details(orderId);
      if (!order) {
        return res.json({ reply: "I couldn’t find that order. Please check the order number and try again.", mode: "policy", intent: "RETURN_REFUND" });
      }
      if (order.delivered_days_ago === null || order.delivered_days_ago === undefined) {
        return res.json({
          reply: `I found ${order.order_id} for ${order.customer}. The ${order.product} order is currently ${order.status.toLowerCase()}, and the sample record does not show a delivery date yet. Our policy accepts returns within 7 days after delivery for unopened, unused products in their original packaging, so I can’t confirm eligibility until delivery is recorded.`,
          mode: "policy", intent: "RETURN_REFUND", order
        });
      }
      if (order.delivered_days_ago > 7) {
        return res.json({
          reply: `I found ${order.order_id} for ${order.customer}. The ${order.product} was delivered ${order.delivered_days_ago} days ago, which is outside our 7-day return window. I’m sorry, but I can’t process a standard return under the current policy.`,
          mode: "policy", intent: "RETURN_REFUND", order
        });
      }
      return res.json({
        reply: `I found ${order.order_id} for ${order.customer}. It was delivered ${order.delivered_days_ago} days ago, so it is within our 7-day return window, provided the product is unopened, unused, and in its original packaging. The support team would need to confirm the item's condition before approving the return.`,
        mode: "policy", intent: "RETURN_REFUND", order
      });
    }

    if (classifyIntent(userText) === "CANCELLATION") {
      const orderId = resolveOrderId(userText) || resolveOrderId(recentCustomerContext);
      if (!orderId) {
        return res.json({ reply: "I can check that for you. Which order would you like me to cancel? You can say just the last three digits, such as 103.", mode: "policy", intent: "CANCELLATION" });
      }
      const order = get_order_details(orderId);
      if (!order) return res.json({ reply: "I couldn’t find that order. Please check the order number and try again.", mode: "policy", intent: "CANCELLATION" });
      if (order.status === "Cancelled") {
        return res.json({ reply: `${order.order_id} has already been cancelled successfully.`, mode: "policy", intent: "CANCELLATION", order });
      }
      if (order.status !== "Processing") {
        return res.json({ reply: `${order.order_id} is ${order.status.toLowerCase()}, so it can’t be cancelled under our policy. If it is out for delivery, you may refuse the delivery at the doorstep.`, mode: "policy", intent: "CANCELLATION", order });
      }
      order.status = "Cancelled";
      order.note = "Cancellation confirmed. The order has not been dispatched.";
      return res.json({ reply: `Done. I’ve successfully cancelled ${order.order_id} for ${order.customer}. The ${order.product} order will not be dispatched.`, mode: "policy", intent: "CANCELLATION", order });
    }
    const modelReply = await askModel(modelMessages.length ? modelMessages : [{ role: "user", content: userText }]);
    return res.json({ reply: modelReply || fallbackReply(userText, modelMessages), mode: modelReply ? "ai" : "fallback", intent: classifyIntent(userText) });
  } catch (error) {
    console.error("Chat error:", error.message);
    // Fail closed to a policy-aware deterministic reply if the provider is unavailable.
    return res.json({ reply: fallbackReply(userText, modelMessages), mode: "fallback", intent: classifyIntent(userText), warning: "AI provider unavailable; deterministic policy fallback used." });
  }
});

app.post("/api/summary", (req, res) => {
  const { messages = [] } = req.body || {};
  const transcript = Array.isArray(messages) ? messages : [];

  const customerMessages = transcript.filter(
    (message) => message?.role === "user"
  );

  const assistantMessages = transcript.filter(
    (message) => message?.role === "assistant"
  );

  const customerTexts = customerMessages
    .map((message) => String(message.content || "").trim())
    .filter(Boolean);

  const allText = transcript
    .map((message) => String(message.content || ""))
    .join(" ");

  const orderId =
    resolveOrderId(customerTexts.join(" ")) ||
    resolveOrderId(allText);

  // Identify the customer's distinct requests.
  const intentLabels = [];

  const intentNames = {
    ORDER_TRACKING: "order tracking",
    CANCELLATION: "order cancellation",
    RETURN_REFUND: "return/refund information",
    DAMAGED_PRODUCT: "a damaged or defective product",
    COD: "Cash on Delivery information",
    SHIPPING_POLICY: "shipping and delivery information",
    PRODUCT_INFORMATION: "product information",
    GENERAL_SUPPORT: "general support"
  };

  for (const text of customerTexts) {
    const intent = classifyIntent(text);
    const label = intentNames[intent] || "general support";

    if (!intentLabels.includes(label)) {
      intentLabels.push(label);
    }
  }

  // Collect unique, meaningful responses from Aria.
  const greetingsPattern =
    /^(namaste|hello|hi)[!,. ]+.*how can i help you today\??$/i;

  const assistantReplies = assistantMessages
    .map((message) => String(message.content || "").trim())
    .filter((text) => text && !greetingsPattern.test(text));

  const uniqueReplies = [...new Set(assistantReplies)];

  const responseText = uniqueReplies.join(" ");
  const lowerResponse = responseText.toLowerCase();

  // Determine whether the conversation needs follow-up.
  const needsFollowUpPattern =
    /could you (?:please )?(?:share|provide|confirm)|which order|couldn.t (?:find|locate)|could not (?:find|locate)|can.t confirm eligibility|cannot confirm eligibility|not been recorded|human support teammate|support team must confirm|please verify/i;

  let resolutionStatus = "NEEDS_FOLLOW_UP";

  if (
    uniqueReplies.length > 0 &&
    !needsFollowUpPattern.test(lowerResponse)
  ) {
    resolutionStatus = "RESOLVED";
  }

  // Build a meaningful summary rather than echoing the transcript.
  const requestDescription = intentLabels.length
    ? intentLabels.join(" and ")
    : "general support";

  let callSummary =
    `Customer contacted Aura Skincare regarding ${requestDescription}`;

  if (orderId) {
    callSummary += ` for ${orderId}`;
  }

  callSummary += ".";

  if (uniqueReplies.length > 0) {
    callSummary +=
      " Assistance provided: " + uniqueReplies.join(" ");
  } else if (customerMessages.length > 0) {
    callSummary +=
      " No substantive response from Aria was recorded.";
  }

  // Explicitly record unresolved outcomes where appropriate.
  if (resolutionStatus === "NEEDS_FOLLOW_UP") {
    callSummary +=
      " Follow-up may be required to resolve the customer's request.";
  }

  // Keep the response concise enough for the dashboard.
  if (callSummary.length > 1500) {
    callSummary = callSummary.slice(0, 1497).trimEnd() + "...";
  }

  res.json({
    customer_intent: intentLabels.length
      ? intentLabels
          .map((label) =>
            label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
          )
          .join("_AND_")
      : "GENERAL_SUPPORT",
    order_id: orderId,
    resolution_status: resolutionStatus,
    call_summary: callSummary,
    message_count: transcript.length,
    generated_at: new Date().toISOString()
  });
});

// Serve the production build when deployed as one service.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res, next) => {
  if (_req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distPath, "index.html"), err => { if (err) next(); });
});
app.listen(PORT, () => console.log(`Aria server listening on http://localhost:${PORT}`));
