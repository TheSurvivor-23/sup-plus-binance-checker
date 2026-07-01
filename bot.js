import { PRODUCTS } from "./products.js";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "change-this-secret";
const ADMIN_ID = Deno.env.get("ADMIN_ID") || "";
const STORE_NAME = Deno.env.get("STORE_NAME") || "SUP Plus | Malath";
const SUPPORT_HANDLE = Deno.env.get("SUPPORT_HANDLE") || "@splus0";
const BINANCE_API_KEY = Deno.env.get("BINANCE_API_KEY") || "";
const BINANCE_SECRET_KEY = Deno.env.get("BINANCE_SECRET_KEY") || "";
const BINANCE_UID = Deno.env.get("BINANCE_UID") || "1207301024";
const BINANCE_ADDRESS = Deno.env.get("BINANCE_ADDRESS") || "0x02146fef412e246b88add1123e24755986900113";
const BINANCE_NETWORK = Deno.env.get("BINANCE_NETWORK") || "CONFIRM_NETWORK_BEFORE_SENDING";
const LOOKBACK_HOURS = Number(Deno.env.get("DEPOSIT_LOOKBACK_HOURS") || "24");

const ACTIVE_PRODUCTS = PRODUCTS.filter((p) => p.active);
const TOTAL_PAGES = Math.max(...ACTIVE_PRODUCTS.map((p) => Number(p.page || 1)));

let kv = null;
const memoryStore = new Map();
try {
  kv = await Deno.openKv();
} catch (_error) {
  console.log("Deno KV is not available. Using temporary memory storage.");
}

function storageKey(key) {
  return JSON.stringify(key);
}

async function storeGet(key) {
  if (kv) return (await kv.get(key)).value;
  return memoryStore.get(storageKey(key));
}

async function storeSet(key, value) {
  if (kv) return await kv.set(key, value);
  memoryStore.set(storageKey(key), value);
  return { ok: true };
}

async function storeList(prefix) {
  if (kv) {
    const out = [];
    for await (const item of kv.list({ prefix })) out.push(item.value);
    return out;
  }
  const p = JSON.stringify(prefix).slice(0, -1);
  return [...memoryStore.entries()]
    .filter(([k]) => k.startsWith(p))
    .map(([, v]) => v);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function telegram(method, payload) {
  if (!BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN env var");
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.log("Telegram API error", method, data);
  return data;
}

async function sendMessage(chatId, text, replyMarkup = undefined) {
  return await telegram("sendMessage", {
    chat_id: chatId,
    text: trimTelegram(text),
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}

async function editMessage(chatId, messageId, text, replyMarkup = undefined) {
  return await telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: trimTelegram(text),
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}

async function answerCallback(callbackQueryId, text = "") {
  return await telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

function trimTelegram(text) {
  const str = String(text || "");
  return str.length > 3900 ? str.slice(0, 3890) + "\n..." : str;
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🛍 المنتجات | Products", callback_data: "products_p1" }],
      [
        { text: "🌐 اللغة | Language", callback_data: "language" },
        { text: "🎧 الدعم | Support", callback_data: "support" },
      ],
    ],
  };
}

async function showMainMenu(chatId, messageId = null) {
  const text = `👋 Welcome to ${STORE_NAME}\n\nReliable digital services:\n⚡ Fast delivery\n🔒 Secure service\n🎧 Continuous support\n\n━━━━━━━━━━━━━━\n\n👋 أهلاً بك في ${STORE_NAME}\n\nخدمات رقمية موثوقة:\n⚡ سرعة في التسليم\n🔒 أمان في التعامل\n🎧 دعم مستمر\n\nاختاري من القائمة 👇`;
  if (messageId) return await editMessage(chatId, messageId, text, mainMenuKeyboard());
  return await sendMessage(chatId, text, mainMenuKeyboard());
}

function productButtonText(p) {
  const status = Number(p.stock || 0) > 0 ? "✅" : "❌";
  return `${status} ${p.button_name || p.name_en} | ${p.duration} | ${p.price} ${p.currency}`;
}

async function showProductsPage(chatId, page = 1, messageId = null) {
  page = Math.min(Math.max(Number(page) || 1, 1), TOTAL_PAGES);
  const list = ACTIVE_PRODUCTS.filter((p) => Number(p.page) === page);
  const rows = list.map((p) => [{ text: productButtonText(p), callback_data: `product_${p.product_id}` }]);
  const nav = [];
  if (page > 1) nav.push({ text: "⬅️ Back", callback_data: `products_p${page - 1}` });
  nav.push({ text: "📋 Menu", callback_data: "menu" });
  if (page < TOTAL_PAGES) nav.push({ text: "Next ➡️", callback_data: `products_p${page + 1}` });
  rows.push(nav);

  const text = `🛍 Products | المنتجات 🛍\nPage ${page} / ${TOTAL_PAGES}\n\n👇 اختاري المنتج المطلوب من الأسفل\nChoose a product below 👇\n\n✅ Available = متوفر\n❌ Out of stock = غير متوفر`;
  const markup = { inline_keyboard: rows };
  if (messageId) return await editMessage(chatId, messageId, text, markup);
  return await sendMessage(chatId, text, markup);
}

function findProduct(productId) {
  return ACTIVE_PRODUCTS.find((p) => p.product_id === productId);
}

function qtyKeyboard(product) {
  const rows = [];
  const maxQty = Math.min(5, Math.max(1, Number(product.stock || 1)));
  for (let qty = 1; qty <= maxQty; qty++) {
    rows.push([{ text: `${qty}️⃣ Qty ${qty} | ${product.price * qty} ${product.currency}`, callback_data: `qty_${product.product_id}_${qty}` }]);
  }
  rows.push([
    { text: "🔙 Products", callback_data: `products_p${product.page || 1}` },
    { text: "📋 Main Menu", callback_data: "menu" },
  ]);
  return { inline_keyboard: rows };
}

async function showProduct(chatId, productId, messageId = null) {
  const p = findProduct(productId);
  if (!p) return await sendMessage(chatId, "⚠️ Product not found");
  const text = p.details_text || buildProductDetails(p);
  if (messageId) return await editMessage(chatId, messageId, text, qtyKeyboard(p));
  return await sendMessage(chatId, text, qtyKeyboard(p));
}

function buildProductDetails(p) {
  return `📦 ${p.name_ar || p.button_name} | ${p.name_en || p.button_name}\n✅ المنتج متوفر | Available\n\n━━━━━━━━━━━━━━\n🇦🇪 تفاصيل المنتج\n🕒 المدة: ${p.duration}\n💰 السعر للوحدة: ${p.price} ${p.currency}\n📦 المخزون الحالي: ${p.stock}\n🛡 الضمان: ${p.warranty === "YES" ? "يوجد ضمان ✅" : "حسب الحالة"}\n🚚 التسليم: ${p.delivery}\n\nالوصف:\n${p.description_ar}\n\n━━━━━━━━━━━━━━\n🇬🇧 Product details\nDuration: ${p.duration}\nUnit price: ${p.price} ${p.currency}\nStock: ${p.stock}\nDelivery: ${p.delivery}\n\n${p.description_en}\n\nاختاري الكمية من الأسفل 👇`;
}

function parseQtyCallback(data) {
  const rest = data.replace(/^qty_/, "");
  const last = rest.lastIndexOf("_");
  return { productId: rest.slice(0, last), qty: Number(rest.slice(last + 1)) };
}

function parsePayCallback(data, prefix) {
  const rest = data.replace(new RegExp(`^${prefix}_`), "");
  const last = rest.lastIndexOf("_");
  return { productId: rest.slice(0, last), qty: Number(rest.slice(last + 1)) };
}

async function showQtyConfirm(chatId, data, messageId = null) {
  const { productId, qty } = parseQtyCallback(data);
  const p = findProduct(productId);
  if (!p) return await sendMessage(chatId, "⚠️ Product not found");
  const amount = Number(p.price) * qty;
  const text = `🧾 تأكيد الطلب\n\n📦 المنتج: ${p.button_name}\n🔢 الكمية: ${qty}\n💰 المجموع: ${amount} ${p.currency}\n\nاختاري طريقة الدفع 👇`;
  const markup = {
    inline_keyboard: [
      [{ text: "🟡 Binance Deposit", callback_data: `pay_binance_${productId}_${qty}` }],
      [{ text: "🔙 Back", callback_data: `product_${productId}` }, { text: "📋 Menu", callback_data: "menu" }],
    ],
  };
  if (messageId) return await editMessage(chatId, messageId, text, markup);
  return await sendMessage(chatId, text, markup);
}

function makeOrderId(chatId) {
  return `SUP-${chatId}-${Date.now()}`;
}

async function createOrUpdateOrder(chatId, from, productId, qty) {
  const p = findProduct(productId);
  if (!p) throw new Error("Product not found");
  const amount = Number(p.price) * Number(qty);
  const existing = await storeGet(["active_order", String(chatId)]);
  const order = {
    order_id: existing?.order_id || makeOrderId(chatId),
    chat_id: String(chatId),
    user_id: String(from?.id || chatId),
    username: from?.username || "",
    first_name: from?.first_name || "",
    product_id: productId,
    product_name: p.button_name,
    qty: Number(qty),
    amount,
    currency: p.currency || "USDT",
    status: "WAITING_TXID",
    txid: "",
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await storeSet(["active_order", String(chatId)], order);
  await storeSet(["orders", order.order_id], order);
  return order;
}

async function showPayment(chatId, from, data, messageId = null) {
  const { productId, qty } = parsePayCallback(data, "pay_binance");
  const order = await createOrUpdateOrder(chatId, from, productId, qty);
  const text = `🟡 Binance Deposit\n\n🧾 Order: ${order.order_id}\n📦 Product: ${order.product_name}\n🔢 Qty: ${order.qty}\n💰 Amount: ${order.amount} ${order.currency}\n\n━━━━━━━━━━━━━━\n\nادفعي نفس المبلغ بالضبط.\nBinance UID: ${BINANCE_UID}\nWallet: ${BINANCE_ADDRESS}\nNetwork: ${BINANCE_NETWORK}\n\nبعد التحويل اضغطي I paid ثم أرسلي TXID / Transaction Hash في الشات.\n\n⚠️ مهم: أي مبلغ مختلف لن يتم تأكيده تلقائياً.`;
  const markup = {
    inline_keyboard: [
      [{ text: "✅ I paid | دفعت", callback_data: `paid_binance_${productId}_${qty}` }],
      [{ text: "🔙 Back", callback_data: `qty_${productId}_${qty}` }, { text: "📋 Menu", callback_data: "menu" }],
    ],
  };
  if (messageId) return await editMessage(chatId, messageId, text, markup);
  return await sendMessage(chatId, text, markup);
}

async function askForTxid(chatId, from, data) {
  const { productId, qty } = parsePayCallback(data, "paid_binance");
  const order = await createOrUpdateOrder(chatId, from, productId, qty);
  order.status = "WAITING_TXID";
  order.updated_at = new Date().toISOString();
  await storeSet(["active_order", String(chatId)], order);
  await storeSet(["orders", order.order_id], order);
  return await sendMessage(chatId, `✅ تم استلام طلب الفحص\n\nالآن أرسلي TXID / Transaction Hash في الشات.\n\nPlease send your TXID / Transaction Hash now.\n\nOrder: ${order.order_id}`);
}

async function handleTxid(chatId, text) {
  const order = await storeGet(["active_order", String(chatId)]);
  if (!order || order.status !== "WAITING_TXID") {
    if (looksLikeTxid(text)) {
      return await sendMessage(chatId, "⚠️ ما في طلب بانتظار TXID حالياً.\nافتحي /products واعملي الطلب أولاً.");
    }
    return;
  }

  if (!looksLikeTxid(text)) {
    return await sendMessage(chatId, "⚠️ أرسلي TXID / Transaction Hash الصحيح.\nغالباً يبدأ بـ 0x إذا التحويل على شبكة EVM.");
  }

  await sendMessage(chatId, "🔍 جاري فحص الدفع على Binance...");
  const result = await checkBinanceDeposit({ coin: order.currency || "USDT", amount: Number(order.amount), txId: text.trim() });

  order.txid = text.trim();
  order.updated_at = new Date().toISOString();
  order.check_result = result;

  if (result.paid) {
    order.status = "PAID";
    await storeSet(["active_order", String(chatId)], order);
    await storeSet(["orders", order.order_id], order);
    await sendMessage(chatId, `✅ Payment verified\n\nتم تأكيد الدفع بنجاح.\nوصل المبلغ الصحيح على Binance.\n\n📦 طلبك الآن قيد التجهيز.\nOrder: ${order.order_id}`);
    if (ADMIN_ID) {
      await sendMessage(ADMIN_ID, `✅ New paid order\n\nOrder: ${order.order_id}\nUser: ${order.first_name} @${order.username}\nProduct: ${order.product_name}\nQty: ${order.qty}\nAmount: ${order.amount} ${order.currency}\nTXID: ${order.txid}`);
    }
    return;
  }

  if (result.status === "AMOUNT_MISMATCH") {
    order.status = "AMOUNT_MISMATCH";
    await storeSet(["active_order", String(chatId)], order);
    await storeSet(["orders", order.order_id], order);
    return await sendMessage(chatId, `⚠️ Amount mismatch\n\nتم العثور على TXID لكن المبلغ غير مطابق.\nالمطلوب: ${order.amount} ${order.currency}\nالمستلم: ${result.amount || "غير معروف"} ${order.currency}\n\nراجعي التحويل أو تواصلي مع الدعم.`);
  }

  order.status = "WAITING_TXID";
  await storeSet(["active_order", String(chatId)], order);
  await storeSet(["orders", order.order_id], order);
  return await sendMessage(chatId, `⚠️ Payment not found\n\nلم يتم العثور على دفع مطابق لهذا TXID.\n\nتأكدي من:\n• إرسال TXID الصحيح\n• إرسال نفس المبلغ المطلوب\n• الانتظار 2-5 دقائق إذا التحويل جديد\n\nOrder: ${order.order_id}`);
}

function looksLikeTxid(text) {
  const t = String(text || "").trim();
  return t.length >= 10 && /^[a-zA-Z0-9_:\-]+$/.test(t);
}

async function hmacSha256(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normTx(value) {
  return String(value || "").trim().toLowerCase();
}

function amountClose(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.000001;
}

async function checkBinanceDeposit({ coin = "USDT", amount = 0, txId = "" }) {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    return { paid: false, status: "ERROR", error: "Missing Binance API keys" };
  }
  const expectedAmount = Number(amount || 0);
  if (!expectedAmount || expectedAmount <= 0) {
    return { paid: false, status: "ERROR", error: "Missing or invalid amount" };
  }

  const now = Date.now();
  const startTime = now - LOOKBACK_HOURS * 60 * 60 * 1000;
  const params = new URLSearchParams({
    coin,
    status: "1",
    startTime: String(startTime),
    recvWindow: "60000",
    timestamp: String(now),
  });
  const query = params.toString();
  const signature = await hmacSha256(query, BINANCE_SECRET_KEY);
  const binanceUrl = `https://api.binance.com/sapi/v1/capital/deposit/hisrec?${query}&signature=${signature}`;

  const res = await fetch(binanceUrl, { headers: { "X-MBX-APIKEY": BINANCE_API_KEY } });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_error) {
    return { paid: false, status: "ERROR", error: "Invalid Binance response", httpStatus: res.status, raw };
  }
  if (!Array.isArray(data)) {
    return { paid: false, status: "ERROR", error: "Binance API error", httpStatus: res.status, raw: data };
  }

  const deposits = data.filter((item) => item.coin === coin && Number(item.status) === 1);
  const wantedTx = normTx(txId);
  let txMatch = null;
  if (wantedTx) {
    txMatch = deposits.find((item) => normTx(item.txId) === wantedTx);
  }

  if (txMatch) {
    if (amountClose(txMatch.amount, expectedAmount)) {
      return {
        paid: true,
        status: "PAID",
        amount: txMatch.amount,
        coin: txMatch.coin,
        network: txMatch.network || "",
        txId: txMatch.txId || "",
        insertTime: txMatch.insertTime || "",
      };
    }
    return {
      paid: false,
      status: "AMOUNT_MISMATCH",
      amount: txMatch.amount,
      expectedAmount,
      coin: txMatch.coin,
      network: txMatch.network || "",
      txId: txMatch.txId || "",
    };
  }

  return { paid: false, status: "NOT_FOUND", message: "No successful deposit found with this TXID" };
}

async function showSupport(chatId, messageId = null) {
  const text = `🎧 Support | الدعم\n\nللدعم والتسليم اليدوي تواصلي معنا:\n${SUPPORT_HANDLE}\n\nFor support and manual delivery, contact:\n${SUPPORT_HANDLE}`;
  if (messageId) return await editMessage(chatId, messageId, text, mainMenuKeyboard());
  return await sendMessage(chatId, text, mainMenuKeyboard());
}

async function showLanguage(chatId, messageId = null) {
  const text = "🌐 Language | اللغة\n\nالبوت حالياً يعرض عربي + English معاً.\nThe bot currently shows Arabic + English together.";
  if (messageId) return await editMessage(chatId, messageId, text, mainMenuKeyboard());
  return await sendMessage(chatId, text, mainMenuKeyboard());
}

async function showAdmin(chatId) {
  if (!ADMIN_ID || String(chatId) !== String(ADMIN_ID)) return await sendMessage(chatId, "⚠️ Admin only");
  const orders = (await storeList(["orders"])).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  if (!orders.length) return await sendMessage(chatId, "No orders yet.");
  const lines = orders.map((o) => `• ${o.status} | ${o.product_name} x${o.qty} | ${o.amount} ${o.currency}\n  ${o.order_id}\n  ${o.txid || "No TXID"}`);
  return await sendMessage(chatId, `📦 Last orders\n\n${lines.join("\n\n")}`);
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  if (!chatId || !text) return;

  if (text === "/start" || text.toLowerCase() === "start") return await showMainMenu(chatId);
  if (text === "/menu") return await showMainMenu(chatId);
  if (text === "/products") return await showProductsPage(chatId, 1);
  if (text === "/support") return await showSupport(chatId);
  if (text === "/language") return await showLanguage(chatId);
  if (text === "/admin" || text === "/orders") return await showAdmin(chatId);
  if (text.startsWith("/")) return await showMainMenu(chatId);

  return await handleTxid(chatId, text);
}

async function handleCallback(callback) {
  const data = callback.data || "";
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  await answerCallback(callback.id);
  if (!chatId) return;

  if (data === "start" || data === "menu" || data === "main_menu") return await showMainMenu(chatId, messageId);
  if (data === "support") return await showSupport(chatId, messageId);
  if (data === "language") return await showLanguage(chatId, messageId);
  if (data === "products") return await showProductsPage(chatId, 1, messageId);
  if (data.startsWith("products_p")) return await showProductsPage(chatId, Number(data.replace("products_p", "")), messageId);
  if (data.startsWith("product_")) return await showProduct(chatId, data.replace("product_", ""), messageId);
  if (data.startsWith("qty_")) return await showQtyConfirm(chatId, data, messageId);
  if (data.startsWith("pay_binance_")) return await showPayment(chatId, callback.from, data, messageId);
  if (data.startsWith("paid_binance_")) return await askForTxid(chatId, callback.from, data);
}

async function setWebhook(origin) {
  if (!BOT_TOKEN) return { ok: false, error: "Missing TELEGRAM_BOT_TOKEN" };
  const webhookUrl = `${origin}/webhook/${WEBHOOK_SECRET}`;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] }),
  });
  return await res.json();
}

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, app: STORE_NAME, message: "Bot is running. Use /setup?key=WEBHOOK_SECRET once." });
    }

    if (request.method === "GET" && url.pathname === "/setup") {
      if (url.searchParams.get("key") !== WEBHOOK_SECRET) return json({ ok: false, error: "Wrong setup key" }, 403);
      const result = await setWebhook(url.origin);
      return json({ ok: true, webhookResult: result, webhookPath: `/webhook/${WEBHOOK_SECRET}` });
    }

    if (request.method === "GET" && url.pathname === "/check") {
      const coin = url.searchParams.get("coin") || "USDT";
      const amount = Number(url.searchParams.get("amount") || "0");
      const txId = url.searchParams.get("txId") || "";
      return json(await checkBinanceDeposit({ coin, amount, txId }));
    }

    if (request.method === "POST" && url.pathname === `/webhook/${WEBHOOK_SECRET}`) {
      const update = await request.json();
      if (update.message) await handleMessage(update.message);
      if (update.callback_query) await handleCallback(update.callback_query);
      return json({ ok: true });
    }

    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error.message }, 500);
  }
});
