import { PRODUCTS } from "./products.js";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "change-this-secret";
const ADMIN_ID = String(Deno.env.get("ADMIN_ID") || "");
const STORE_NAME = Deno.env.get("STORE_NAME") || "SUP Plus | Malath";
const STORE_SUBTITLE = Deno.env.get("STORE_SUBTITLE") || "Digital Store · Instant Delivery";
const SUPPORT_HANDLE = Deno.env.get("SUPPORT_HANDLE") || "@splus0";
const STORE_IMAGE_URL = Deno.env.get("STORE_IMAGE_URL") || "";
const BINANCE_API_KEY = Deno.env.get("BINANCE_API_KEY") || "";
const BINANCE_SECRET_KEY = Deno.env.get("BINANCE_SECRET_KEY") || "";
const BINANCE_UID = Deno.env.get("BINANCE_UID") || "1207301024";
const BINANCE_ADDRESS = Deno.env.get("BINANCE_ADDRESS") || "0x02146fef412e246b88add1123e24755986900113";
const BINANCE_NETWORK = Deno.env.get("BINANCE_NETWORK") || "BSC";
const LOOKBACK_HOURS = Number(Deno.env.get("DEPOSIT_LOOKBACK_HOURS") || "24");
const MAX_BROADCAST_USERS = Number(Deno.env.get("MAX_BROADCAST_USERS") || "2500");

let kv = null;
const memoryStore = new Map();
try {
  kv = await Deno.openKv();
} catch (_error) {
  console.log("Deno KV unavailable; using temporary memory store.");
}

function skey(key) {
  return JSON.stringify(key);
}
async function storeGet(key) {
  if (kv) return (await kv.get(key)).value;
  return memoryStore.get(skey(key));
}
async function storeSet(key, value) {
  if (kv) return await kv.set(key, value);
  memoryStore.set(skey(key), value);
  return { ok: true };
}
async function storeDelete(key) {
  if (kv) return await kv.delete(key);
  memoryStore.delete(skey(key));
  return { ok: true };
}
async function storeList(prefix) {
  if (kv) {
    const out = [];
    for await (const item of kv.list({ prefix })) out.push({ key: item.key, value: item.value });
    return out;
  }
  const p = JSON.stringify(prefix).slice(0, -1);
  return [...memoryStore.entries()]
    .filter(([k]) => k.startsWith(p))
    .map(([k, value]) => ({ key: JSON.parse(k), value }));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function trim(text, max = 3900) {
  const s = String(text || "");
  return s.length > max ? `${s.slice(0, max - 20)}\n...` : s;
}
function money(n) {
  const x = Number(n || 0);
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
function nowIso() {
  return new Date().toISOString();
}
function isAdmin(chatId) {
  return ADMIN_ID && String(chatId) === ADMIN_ID;
}

async function tg(method, payload) {
  if (!BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.log("Telegram API error", method, data);
  return data;
}
async function sendMessage(chatId, text, reply_markup = undefined) {
  return await tg("sendMessage", {
    chat_id: chatId,
    text: trim(text),
    reply_markup,
    disable_web_page_preview: true,
  });
}
async function editMessage(chatId, messageId, text, reply_markup = undefined) {
  return await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: trim(text),
    reply_markup,
    disable_web_page_preview: true,
  });
}
async function sendPhoto(chatId, photo, caption, reply_markup = undefined) {
  return await tg("sendPhoto", {
    chat_id: chatId,
    photo,
    caption: trim(caption, 1000),
    reply_markup,
  });
}
async function answerCallback(id, text = "") {
  return await tg("answerCallbackQuery", { callback_query_id: id, text, show_alert: false });
}
async function safeSend(chatId, text, reply_markup = undefined, photo = "") {
  if (photo) {
    const sent = await sendPhoto(chatId, photo, text, reply_markup);
    if (sent.ok) return sent;
  }
  return await sendMessage(chatId, text, reply_markup);
}
async function safeDelete(chatId, messageId) {
  if (!chatId || !messageId) return;
  try {
    await tg("deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch (_error) {
    // Message may be too old, already deleted, or not deletable. Ignore.
  }
}
async function rememberUiMessage(chatId, sent) {
  const messageId = sent?.result?.message_id;
  if (messageId) await storeSet(["last_ui", String(chatId)], { message_id: messageId, updated_at: nowIso() });
  return sent;
}
async function clearLastUi(chatId, exceptMessageId = null) {
  const last = await storeGet(["last_ui", String(chatId)]);
  if (last?.message_id && String(last.message_id) !== String(exceptMessageId || "")) {
    await safeDelete(chatId, last.message_id);
  }
}
async function sendCard(chatId, text, reply_markup = undefined, photo = "", previousMessageId = null) {
  // Keeps the store flow clean: old screen is deleted, new screen appears in the same chat.
  await clearLastUi(chatId, previousMessageId);
  if (previousMessageId) await safeDelete(chatId, previousMessageId);
  const sent = await safeSend(chatId, text, reply_markup, photo);
  return await rememberUiMessage(chatId, sent);
}

async function registerUser(chat, from) {
  if (!chat?.id) return;
  const user = {
    chat_id: String(chat.id),
    type: chat.type || "private",
    username: from?.username || chat.username || "",
    first_name: from?.first_name || chat.first_name || "",
    last_name: from?.last_name || chat.last_name || "",
    blocked: false,
    updated_at: nowIso(),
    created_at: (await storeGet(["users", String(chat.id)]))?.created_at || nowIso(),
  };
  await storeSet(["users", String(chat.id)], user);
}
async function usersList() {
  return (await storeList(["users"])).map((x) => x.value).filter((u) => !u.blocked);
}

function baseProducts() {
  return PRODUCTS.map((p) => ({ ...p, source: "base" }));
}
async function customProducts() {
  return (await storeList(["custom_products"])).map((x) => x.value);
}
async function getProductState(productId) {
  return (await storeGet(["product_state", productId])) || {};
}
async function setProductState(productId, patch) {
  const old = await getProductState(productId);
  const next = { ...old, ...patch, updated_at: nowIso() };
  await storeSet(["product_state", productId], next);
  return next;
}
async function inventoryEntries(productId) {
  return await storeList(["inventory", productId]);
}
async function inventoryCount(productId) {
  return (await inventoryEntries(productId)).length;
}
async function resolveProduct(product) {
  const s = await getProductState(product.product_id);
  const itemCount = await inventoryCount(product.product_id);
  const mode = s.delivery_mode || (s.inventory_mode ? "auto" : "manual");
  const manualStock = Number(s.stock ?? product.stock ?? 0);
  const stock = mode === "auto" ? itemCount : manualStock;
  const price = Number(s.price ?? product.price ?? 0);
  return {
    ...product,
    active: s.active ?? product.active ?? true,
    product_id: product.product_id,
    button_name: s.button_name ?? product.button_name ?? product.name_en ?? product.name_ar,
    name_ar: s.name_ar ?? product.name_ar ?? product.button_name,
    name_en: s.name_en ?? product.name_en ?? product.button_name,
    category: s.category ?? product.category ?? "Digital",
    page: Number(s.page ?? product.page ?? 1),
    button_order: Number(s.button_order ?? product.button_order ?? 999),
    duration: s.duration ?? product.duration ?? "1 Month",
    price,
    currency: s.currency ?? product.currency ?? "USDT",
    stock,
    manual_stock: manualStock,
    inventory_count: itemCount,
    delivery_mode: mode,
    sold: Number(s.sold ?? product.sold ?? 0),
    warranty: s.warranty ?? product.warranty ?? "YES",
    warranty_days: Number(s.warranty_days ?? product.warranty_days ?? 30),
    delivery: s.delivery ?? product.delivery ?? (mode === "auto" ? "Instant" : "Manual processing"),
    description_ar: s.description_ar ?? product.description_ar ?? "",
    description_en: s.description_en ?? product.description_en ?? "",
    image_url: s.image_url ?? product.image_url ?? product.logo_preview ?? "",
    discount: s.discount ?? product.discount ?? "",
  };
}
async function getAllProducts() {
  const map = new Map();
  for (const p of baseProducts()) map.set(p.product_id, p);
  for (const p of await customProducts()) map.set(p.product_id, { ...p, source: "custom" });
  const out = [];
  for (const p of map.values()) out.push(await resolveProduct(p));
  return out.sort((a, b) => a.page - b.page || a.button_order - b.button_order || String(a.button_name).localeCompare(String(b.button_name)));
}
async function getActiveProducts() {
  return (await getAllProducts()).filter((p) => p.active);
}
async function findProduct(productId, includeHidden = false) {
  const list = includeHidden ? await getAllProducts() : await getActiveProducts();
  return list.find((p) => p.product_id === productId);
}

function homeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🛍 Available Products", callback_data: "products_p1" }],
      [
        { text: "🔄 Refresh", callback_data: "products_p1" },
        { text: "🎧 Support", callback_data: "support" },
      ],
    ],
  };
}
async function showHome(chatId) {
  const products = await getActiveProducts();
  const available = products.reduce((sum, p) => sum + Number(p.stock || 0), 0);
  const text = `✨ ${STORE_NAME}\n${STORE_SUBTITLE}\n\n🛒 Available Products: ${products.length}\n📦 Total stock: ${available}\n💵 Currency: USDT\n\nPlease select a product below.`;
  return await sendCard(chatId, text, homeKeyboard(), STORE_IMAGE_URL);
}
function productLabel(p) {
  const stock = Number(p.stock || 0);
  const dot = stock > 0 ? "🟢" : "🔴";
  const status = stock > 0 ? `📦 ${stock}` : "OUT";
  const name = String(p.button_name || p.name_en || p.product_id).slice(0, 34);
  const discount = p.discount ? ` 🔥${p.discount}` : "";
  return `${dot} ${name} | $${money(p.price)}${discount} | ${status}`;
}
async function showProductsPage(chatId, page = 1, messageId = null) {
  const products = await getActiveProducts();
  const totalPages = Math.max(1, ...products.map((p) => Number(p.page || 1)));
  page = Math.max(1, Math.min(Number(page) || 1, totalPages));
  const list = products.filter((p) => Number(p.page || 1) === page);
  const rows = [];
  rows.push([{ text: "🛍 Available Products", callback_data: `products_p${page}` }]);
  for (const p of list) rows.push([{ text: productLabel(p), callback_data: `product_${p.product_id}` }]);
  rows.push([
    { text: "🔄 Refresh", callback_data: `products_p${page}` },
    { text: "Sort: All", callback_data: `products_p${page}` },
  ]);
  rows.push([
    { text: "⬅️ Prev", callback_data: `products_p${Math.max(1, page - 1)}` },
    { text: `${page}/${totalPages}`, callback_data: "noop" },
    { text: "➡️ Next", callback_data: `products_p${Math.min(totalPages, page + 1)}` },
  ]);
  rows.push([{ text: "🏠 Home", callback_data: "menu" }]);
  const text = `✨ ${STORE_NAME}\n🛒 Welcome to our digital store\n\n🟢 Available  |  🔴 Out of stock\nPlease select a product below:`;
  const markup = { inline_keyboard: rows };
  if (messageId) return await editMessage(chatId, messageId, text, markup);
  return await sendMessage(chatId, text, markup);
}
function productDetailsText(p) {
  const inStock = Number(p.stock || 0) > 0;
  const warranty = p.warranty === "YES" ? `${p.warranty_days || 30} days warranty` : "No warranty";
  const desc = p.description_en || p.description_ar || "Premium digital product with secure delivery.";
  const shortDesc = String(desc).length > 420 ? `${String(desc).slice(0, 420)}...` : desc;
  return `✨ ${STORE_NAME}
${STORE_SUBTITLE}

🔮 ${p.name_en || p.button_name}

💵 Price: $${money(p.price)} / code
📦 Stock: ${p.stock}
${inStock ? "🟢 Available now" : "🔴 Out of stock"}
🚚 Delivery: ${p.delivery_mode === "auto" ? "Automatic after payment" : "Manual after payment"}
🛡 Warranty: ${warranty}
⏳ Duration: ${p.duration}

━━━━━━━━━━━━━━
${shortDesc}

🧾 Product ID: ${p.product_id}
${p.delivery_mode === "auto" ? "🎁 Instant auto delivery after payment verification." : "👩‍💻 Admin will deliver after payment verification."}`;
}
function productKeyboard(p) {
  const rows = [];
  if (Number(p.stock || 0) > 0) rows.push([{ text: "🛒 Buy Now", callback_data: `buy_${p.product_id}` }]);
  else rows.push([{ text: "🔴 Out of stock", callback_data: "noop" }]);
  rows.push([{ text: "↩️ Back to Store", callback_data: `products_p${p.page || 1}` }]);
  return { inline_keyboard: rows };
}
async function showProduct(chatId, productId, previousMessageId = null) {
  const p = await findProduct(productId);
  if (!p) return await sendMessage(chatId, "⚠️ Product not found or hidden.");
  return await sendCard(chatId, productDetailsText(p), productKeyboard(p), p.image_url, previousMessageId);
}
function quantityKeyboard(p) {
  const stock = Number(p.stock || 0);
  const choices = [1, 2, 3, 5, 10, 15, 20, 25].filter((q) => q <= stock);
  const rows = [];
  for (let i = 0; i < choices.length; i += 4) {
    rows.push(choices.slice(i, i + 4).map((q) => ({ text: `📦 ${q}`, callback_data: `qty_${p.product_id}_${q}` })));
  }
  if (!choices.length) rows.push([{ text: "🔴 Out of stock", callback_data: "noop" }]);
  rows.push([{ text: "↩️ Back to Product", callback_data: `product_${p.product_id}` }, { text: "🏠 Home", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}
async function showQuantity(chatId, productId, previousMessageId = null) {
  const p = await findProduct(productId);
  if (!p) return await sendMessage(chatId, "⚠️ Product not found.");
  const text = `🛒 Select Quantity\n\n📦 ${p.name_en || p.button_name}\n💵 $${money(p.price)} / code\n📦 Stock: ${p.stock}\n\n${p.description_en || p.description_ar || ""}\n\nHow many codes do you want?`;
  return await sendCard(chatId, text, quantityKeyboard(p), p.image_url, previousMessageId);
}
function parseQty(data) {
  const rest = data.replace(/^qty_/, "");
  const last = rest.lastIndexOf("_");
  return { productId: rest.slice(0, last), qty: Number(rest.slice(last + 1)) };
}
async function showSummary(chatId, data, previousMessageId = null) {
  const { productId, qty } = parseQty(data);
  const p = await findProduct(productId);
  if (!p) return await sendMessage(chatId, "⚠️ Product not found.");
  if (qty < 1 || qty > Number(p.stock || 0)) return await sendMessage(chatId, `🔴 Quantity not available. Stock: ${p.stock}`);
  const total = Number(p.price) * qty;
  const text = `🧾 Order Summary\n\n📦 ${p.name_en || p.button_name}\n📦 Quantity: ${qty}\n💵 Total: $${money(total)} USDT\n\n${p.description_en || p.description_ar || ""}`;
  const markup = { inline_keyboard: [
    [{ text: "✅ Confirm & Pay", callback_data: `confirm_${productId}_${qty}` }],
    [{ text: "↩️ Change Qty", callback_data: `buy_${productId}` }, { text: "🏠 Home", callback_data: "menu" }],
  ] };
  return await sendCard(chatId, text, markup, p.image_url, previousMessageId);
}
function parsePay(data, prefix) {
  const rest = data.replace(new RegExp(`^${prefix}_`), "");
  const last = rest.lastIndexOf("_");
  return { productId: rest.slice(0, last), qty: Number(rest.slice(last + 1)) };
}
function makeOrderId() {
  const s = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `ORD-${s}`;
}
async function createOrder(chatId, from, productId, qty) {
  const p = await findProduct(productId);
  if (!p) throw new Error("Product not found");
  if (Number(p.stock || 0) < qty) throw new Error(`Out of stock. Available: ${p.stock}`);
  const order = {
    order_id: makeOrderId(),
    chat_id: String(chatId),
    user_id: String(from?.id || chatId),
    username: from?.username || "",
    first_name: from?.first_name || "",
    product_id: productId,
    product_name: p.name_en || p.button_name,
    qty: Number(qty),
    amount: Number(p.price) * Number(qty),
    currency: p.currency || "USDT",
    status: "WAITING_TXID",
    delivery_status: "WAITING_PAYMENT",
    txid: "",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await storeSet(["active_order", String(chatId)], order);
  await storeSet(["orders", order.order_id], order);
  return order;
}
async function showPayment(chatId, from, data, previousMessageId = null) {
  const { productId, qty } = parsePay(data, "confirm");
  let order;
  try {
    order = await createOrder(chatId, from, productId, qty);
  } catch (e) {
    return await sendMessage(chatId, `❌ ${e.message}`);
  }
  const p = await findProduct(productId, true);
  const text = `🟡 Binance Deposit\n\n🎯 Product: ${order.product_name} x ${order.qty}\n💵 Amount: ${money(order.amount)} USDT\n🧾 Order ID: ${order.order_id}\n\n1️⃣ Open Binance\n2️⃣ Send USDT to this address:\n${BINANCE_ADDRESS}\n\nNetwork: ${BINANCE_NETWORK}\nUID: ${BINANCE_UID}\nAmount: ${money(order.amount)} USDT\n\nAfter transfer, press I paid then send TXID / Transaction Hash.\n\n⚠️ Send exact amount only.`;
  const markup = { inline_keyboard: [
    [{ text: "✅ I paid", callback_data: `paid_${order.order_id}` }],
    [{ text: "❌ Cancel order", callback_data: "cancel_order" }, { text: "🏠 Home", callback_data: "menu" }],
  ] };
  return await sendCard(chatId, text, markup, p?.image_url || "", previousMessageId);
}
async function markPaidPrompt(chatId, orderId, previousMessageId = null) {
  const order = await storeGet(["orders", orderId]);
  if (!order || String(order.chat_id) !== String(chatId)) return await sendMessage(chatId, "⚠️ Order not found.");
  await storeSet(["active_order", String(chatId)], { ...order, status: "WAITING_TXID", updated_at: nowIso() });
  return await sendCard(chatId, `✅ Order received\n\nNow send your TXID / Transaction Hash in this chat.\n\nOrder: ${order.order_id}`, undefined, "", previousMessageId);
}
async function cancelOrder(chatId) {
  await storeDelete(["active_order", String(chatId)]);
  return await sendCard(chatId, "❌ Order cancelled.", homeKeyboard());
}

async function hmacSha256(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function normTx(x) {
  return String(x || "").trim().toLowerCase();
}
function amountClose(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.000001;
}
async function checkBinanceDeposit({ coin = "USDT", expectedAmount, txId }) {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) return { paid: false, status: "CONFIG_ERROR", message: "Missing Binance API keys" };
  const now = Date.now();
  const startTime = now - LOOKBACK_HOURS * 60 * 60 * 1000;
  const params = new URLSearchParams({ coin, status: "1", startTime: String(startTime), recvWindow: "60000", timestamp: String(now) });
  const query = params.toString();
  const signature = await hmacSha256(query, BINANCE_SECRET_KEY);
  const url = `https://api.binance.com/sapi/v1/capital/deposit/hisrec?${query}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": BINANCE_API_KEY } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_e) { return { paid: false, status: "BINANCE_ERROR", raw: text, httpStatus: res.status }; }
  if (!Array.isArray(data)) return { paid: false, status: "BINANCE_ERROR", raw: data, httpStatus: res.status };
  const wanted = normTx(txId);
  const txMatch = data.find((d) => normTx(d.txId) === wanted);
  if (txMatch) {
    if (amountClose(txMatch.amount, expectedAmount)) return { paid: true, status: "PAID", amount: txMatch.amount, coin: txMatch.coin, network: txMatch.network || "", txId: txMatch.txId || "" };
    return { paid: false, status: "AMOUNT_MISMATCH", amount: txMatch.amount, expectedAmount, txId: txMatch.txId || "" };
  }
  return { paid: false, status: "NOT_FOUND" };
}
async function takeInventory(productId, qty) {
  const entries = await inventoryEntries(productId);
  if (entries.length < qty) return [];
  const chosen = entries.slice(0, qty);
  const out = [];
  for (const e of chosen) {
    out.push(e.value);
    await storeDelete(e.key);
  }
  return out;
}
async function fulfillOrder(order, txid, binance) {
  const p = await findProduct(order.product_id, true);
  if (!p) throw new Error("Product disappeared");
  if (Number(p.stock || 0) < Number(order.qty)) {
    order.status = "PAID";
    order.delivery_status = "OUT_OF_STOCK_AFTER_PAYMENT";
    order.txid = txid;
    order.binance = binance;
    order.updated_at = nowIso();
    await storeSet(["orders", order.order_id], order);
    return { delivered: false, text: "✅ Payment verified\n\n⚠️ Stock became unavailable after payment. Admin will process your order manually.", adminText: "Paid but stock unavailable." };
  }
  const mode = p.delivery_mode;
  let items = [];
  if (mode === "auto") items = await takeInventory(order.product_id, Number(order.qty));
  if (mode === "auto" && items.length === Number(order.qty)) {
    const deliveryText = items.map((it, i) => `#${i + 1}\n${it.content}`).join("\n\n━━━━━━━━━━━━━━\n");
    order.status = "PAID";
    order.delivery_status = "DELIVERED_AUTO";
    order.delivery_items = items.map((x) => x.id);
    order.txid = txid;
    order.binance = binance;
    order.updated_at = nowIso();
    await setProductState(order.product_id, { sold: Number(p.sold || 0) + Number(order.qty), delivery_mode: "auto" });
    await storeSet(["orders", order.order_id], order);
    return { delivered: true, text: `✅ Payment verified\n\n🎁 Your product is ready:\n\n${deliveryText}\n\nOrder: ${order.order_id}`, adminText: `Auto delivered ${items.length} item(s).` };
  }
  const newStock = Math.max(0, Number(p.manual_stock || p.stock || 0) - Number(order.qty));
  await setProductState(order.product_id, { stock: newStock, sold: Number(p.sold || 0) + Number(order.qty), delivery_mode: "manual" });
  order.status = "PAID";
  order.delivery_status = "PROCESSING_MANUAL";
  order.txid = txid;
  order.binance = binance;
  order.updated_at = nowIso();
  await storeSet(["orders", order.order_id], order);
  return { delivered: false, text: `✅ Payment verified\n\n📦 Your order is now being processed.\nAdmin will deliver it soon.\n\nOrder: ${order.order_id}`, adminText: `Manual delivery needed. New stock: ${newStock}` };
}
async function handleTxid(chatId, text, from) {
  const order = await storeGet(["active_order", String(chatId)]);
  if (!order || order.status !== "WAITING_TXID") return false;
  const txid = text.trim();
  if (!/^0x[a-fA-F0-9]{8,}$/.test(txid)) return await sendMessage(chatId, "⚠️ Send a valid TXID / Transaction Hash starting with 0x.");
  await sendMessage(chatId, "🔎 Checking payment on Binance...");
  const result = await checkBinanceDeposit({ coin: "USDT", expectedAmount: Number(order.amount), txId: txid });
  if (result.paid) {
    const delivery = await fulfillOrder(order, txid, result);
    await storeDelete(["active_order", String(chatId)]);
    await sendMessage(chatId, delivery.text);
    if (ADMIN_ID) await sendMessage(ADMIN_ID, `✅ Paid order\n\nOrder: ${order.order_id}\nUser: ${from?.first_name || ""} @${from?.username || ""}\nProduct: ${order.product_name}\nQty: ${order.qty}\nAmount: ${money(order.amount)} USDT\nTXID: ${txid}\nDelivery: ${order.delivery_status}\n${delivery.adminText}`);
    return true;
  }
  if (result.status === "AMOUNT_MISMATCH") return await sendMessage(chatId, `⚠️ Payment found but amount is wrong.\nExpected: ${money(result.expectedAmount)} USDT\nReceived: ${money(result.amount)} USDT`);
  if (result.status === "CONFIG_ERROR") return await sendMessage(chatId, "⚠️ Payment checker is not configured. Admin was notified.");
  return await sendMessage(chatId, "⚠️ Payment not found.\n\nCheck TXID, amount, network, and wait 2-5 minutes if the transfer is new.");
}

function adminKeyboard() {
  return { inline_keyboard: [
    [{ text: "📦 Stock", callback_data: "admin_stock" }, { text: "🧾 Orders", callback_data: "admin_orders" }],
    [{ text: "📮 Pending", callback_data: "admin_pending" }, { text: "📊 Stats", callback_data: "admin_stats" }],
    [{ text: "📚 Help", callback_data: "admin_help" }],
  ] };
}
async function showAdmin(chatId) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  return await sendMessage(chatId, `🛠 Admin Panel\n\n/stock — عرض الستوك\n/orders — آخر الطلبات\n/stats — إحصائيات\n\n/setstock product_id 10\n/addstock product_id 5\n/price product_id 20\n/hide product_id\n/show product_id\n/image product_id https://image-url\n/mode product_id auto\n/mode product_id manual\n/additem product_id delivery text\n/items product_id\n/addproduct id|Name|Price|Stock|Page|Duration|ImageURL|Description\n/broadcast message
/users`, adminKeyboard());
}
async function showStock(chatId, messageId = null) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const products = await getAllProducts();
  const lines = products.map((p) => `${p.active ? "🟢" : "🙈"} ${p.stock > 0 ? "✅" : "🔴"} ${p.product_id}\n${p.button_name} | $${money(p.price)} | Stock: ${p.stock} | Items: ${p.inventory_count} | Mode: ${p.delivery_mode} | Sold: ${p.sold}`);
  const text = `📦 Stock List\n\n${lines.join("\n\n")}`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}
async function showOrders(chatId, messageId = null) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const orders = (await storeList(["orders"])).map((x) => x.value).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  if (!orders.length) return await sendMessage(chatId, "No orders yet.", adminKeyboard());
  const text = `🧾 Last orders\n\n${orders.map((o) => `• ${o.status} | ${o.delivery_status}\n${o.product_name} x${o.qty} | ${money(o.amount)} ${o.currency}\n${o.order_id}\n${o.txid || "No TXID"}`).join("\n\n")}`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}
async function showStats(chatId, messageId = null) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const products = await getAllProducts();
  const orders = (await storeList(["orders"])).map((x) => x.value);
  const users = await usersList();
  const paid = orders.filter((o) => o.status === "PAID");
  const revenue = paid.reduce((s, o) => s + Number(o.amount || 0), 0);
  const text = `📊 Stats\n\nUsers: ${users.length}\nProducts: ${products.length}\nVisible products: ${products.filter((p) => p.active).length}\nTotal stock: ${products.reduce((s, p) => s + Number(p.stock || 0), 0)}\nOrders: ${orders.length}\nPaid orders: ${paid.length}\nRevenue: ${money(revenue)} USDT`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}
async function showAdminHelp(chatId, messageId = null) {
  const text = `📚 Admin Help\n\nتغيير الستوك:\n/setstock chatgpt_plus 10\n/addstock chatgpt_plus 5\n\nصورة المنتج:\n/image chatgpt_plus https://example.com/photo.jpg\n\nالتسليم التلقائي:\n/mode chatgpt_plus auto\n/additem chatgpt_plus email: test@test.com password: 123\n\nالتسليم اليدوي:\n/mode chatgpt_plus manual\n\nإضافة منتج + إشعار للمستخدمين:\n/addproduct figma_pro|Figma Pro Education 2 Years|6|2|1|2 Years|https://image-url|Full Figma access\n\nإرسال إعلان:\n/broadcast New product is available now!`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}
async function adminSetStock(chatId, text, add = false) {
  const [, productId, nText] = text.split(/\s+/);
  const p = await findProduct(productId, true);
  const n = Number(nText);
  if (!p || !Number.isFinite(n)) return await sendMessage(chatId, add ? "❌ /addstock chatgpt_plus 5" : "❌ /setstock chatgpt_plus 10");
  const stock = add ? Math.max(0, Number(p.manual_stock || p.stock || 0) + n) : Math.max(0, n);
  await setProductState(productId, { stock, delivery_mode: "manual", inventory_mode: false });
  return await sendMessage(chatId, `✅ Stock updated\n${productId}: ${stock}`);
}
async function adminPrice(chatId, text) {
  const [, productId, priceText] = text.split(/\s+/);
  const p = await findProduct(productId, true);
  const price = Number(priceText);
  if (!p || !Number.isFinite(price) || price <= 0) return await sendMessage(chatId, "❌ /price chatgpt_plus 20");
  await setProductState(productId, { price });
  return await sendMessage(chatId, `✅ Price updated\n${productId}: $${money(price)}`);
}
async function adminHideShow(chatId, text, active) {
  const [, productId] = text.split(/\s+/);
  const p = await findProduct(productId, true);
  if (!p) return await sendMessage(chatId, `❌ Product not found: ${productId}`);
  await setProductState(productId, { active });
  return await sendMessage(chatId, `${active ? "🟢 Shown" : "🙈 Hidden"}: ${productId}`);
}
async function adminImage(chatId, text) {
  const match = text.match(/^\/image\s+(\S+)\s+(https?:\/\/\S+)/);
  if (!match) return await sendMessage(chatId, "❌ /image chatgpt_plus https://example.com/photo.jpg");
  const [, productId, image_url] = match;
  const p = await findProduct(productId, true);
  if (!p) return await sendMessage(chatId, `❌ Product not found: ${productId}`);
  await setProductState(productId, { image_url });
  return await sendMessage(chatId, `✅ Image updated\n${productId}`);
}
async function adminMode(chatId, text) {
  const [, productId, mode] = text.split(/\s+/);
  const p = await findProduct(productId, true);
  if (!p || !["auto", "manual"].includes(mode)) return await sendMessage(chatId, "❌ /mode chatgpt_plus auto\nأو\n/mode chatgpt_plus manual");
  await setProductState(productId, { delivery_mode: mode, inventory_mode: mode === "auto" });
  return await sendMessage(chatId, `✅ Delivery mode updated\n${productId}: ${mode}`);
}
async function adminAddItem(chatId, text) {
  const match = text.match(/^\/additem\s+(\S+)\s+([\s\S]+)$/);
  if (!match) return await sendMessage(chatId, "❌ /additem chatgpt_plus email: test@test.com password: 123");
  const productId = match[1];
  const content = match[2].trim();
  const p = await findProduct(productId, true);
  if (!p) return await sendMessage(chatId, `❌ Product not found: ${productId}`);
  const item = { id: `${Date.now()}-${crypto.randomUUID()}`, product_id: productId, content, created_at: nowIso() };
  await storeSet(["inventory", productId, item.id], item);
  await setProductState(productId, { delivery_mode: "auto", inventory_mode: true, active: true });
  return await sendMessage(chatId, `✅ Item added for auto delivery\n${productId}\nReady items: ${await inventoryCount(productId)}`);
}
async function adminItems(chatId, text) {
  const [, productId] = text.split(/\s+/);
  const p = await findProduct(productId, true);
  if (!p) return await sendMessage(chatId, "❌ /items chatgpt_plus");
  return await sendMessage(chatId, `📦 ${productId}\nVisible stock: ${p.stock}\nReady auto items: ${p.inventory_count}\nManual stock: ${p.manual_stock}\nMode: ${p.delivery_mode}`);
}
async function broadcast(chatId, text, photo = "") {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const users = (await usersList()).slice(0, MAX_BROADCAST_USERS);
  let ok = 0;
  let fail = 0;
  for (const u of users) {
    const res = await safeSend(u.chat_id, text, undefined, photo);
    if (res.ok) ok++; else fail++;
  }
  return await sendMessage(chatId, `📣 Broadcast done\nSent: ${ok}\nFailed: ${fail}`);
}
async function adminBroadcast(chatId, text) {
  const msg = text.replace(/^\/broadcast\s+/, "").trim();
  if (!msg) return await sendMessage(chatId, "❌ /broadcast your message");
  return await broadcast(chatId, msg);
}
async function adminAddProduct(chatId, text) {
  const raw = text.replace(/^\/addproduct\s+/, "").trim();
  const parts = raw.split("|").map((x) => x.trim());
  if (parts.length < 8) return await sendMessage(chatId, "❌ /addproduct id|Name|Price|Stock|Page|Duration|ImageURL|Description");
  const [product_id, name, priceText, stockText, pageText, duration, image_url, description] = parts;
  const exists = await findProduct(product_id, true);
  if (exists) return await sendMessage(chatId, `❌ Product already exists: ${product_id}`);
  const product = {
    active: true,
    product_id,
    category: "Custom",
    page: Number(pageText) || 1,
    button_order: 999,
    button_name: name,
    name_ar: name,
    name_en: name,
    duration: duration || "1 Month",
    price: Number(priceText) || 0,
    currency: "USDT",
    stock: Number(stockText) || 0,
    sold: 0,
    warranty: "YES",
    warranty_days: 30,
    delivery: "Manual/Auto",
    description_ar: description,
    description_en: description,
    image_url,
  };
  await storeSet(["custom_products", product_id], product);
  await setProductState(product_id, { active: true, stock: product.stock, price: product.price, image_url, delivery_mode: "manual" });
  await sendMessage(chatId, `✅ Product added\n${product_id}\n${name}\nStock: ${product.stock}\nPrice: $${money(product.price)}\n\n📣 Sending notification to users...`);
  await broadcast(chatId, `🆕 New product available!\n\n${name}\n💵 $${money(product.price)} USDT\n📦 Stock: ${product.stock}\n\nOpen /products to order.`, image_url);
}
async function showPending(chatId, messageId = null) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const orders = (await storeList(["orders"]))
    .map((x) => x.value)
    .filter((o) => o.status === "PAID" && ["PROCESSING_MANUAL", "OUT_OF_STOCK_AFTER_PAYMENT"].includes(o.delivery_status))
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))
    .slice(0, 20);
  if (!orders.length) return await sendMessage(chatId, "✅ No pending deliveries.", adminKeyboard());
  const text = `📮 Pending deliveries

${orders.map((o) => `• ${o.order_id}
👤 ${o.first_name || "Customer"} @${o.username || "-"}
🆔 User: ${o.user_id} | Chat: ${o.chat_id}
📦 ${o.product_name} x${o.qty}
💵 ${money(o.amount)} ${o.currency}
🚚 ${o.delivery_status}

Deliver with:
/deliver ${o.order_id} delivery text here`).join("\n\n━━━━━━━━━━━━━━\n\n")}`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}
async function showOrderDetails(chatId, text) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const [, orderId] = text.split(/\s+/);
  const o = await storeGet(["orders", orderId]);
  if (!o) return await sendMessage(chatId, "❌ /order ORD-XXXXXXXXXX");
  return await sendMessage(chatId, `🧾 Order details

Order: ${o.order_id}
Status: ${o.status}
Delivery: ${o.delivery_status}

👤 Customer: ${o.first_name || ""} @${o.username || "-"}
🆔 User ID: ${o.user_id}
💬 Chat ID: ${o.chat_id}

📦 Product: ${o.product_name}
Qty: ${o.qty}
Amount: ${money(o.amount)} ${o.currency}
TXID: ${o.txid || "-"}

Created: ${o.created_at}
Updated: ${o.updated_at || "-"}

Manual delivery:
/deliver ${o.order_id} delivery text here`);
}
async function adminDeliver(chatId, text) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const match = text.match(/^\/deliver\s+(ORD-[A-Z0-9]+)\s+([\s\S]+)$/i);
  if (!match) return await sendMessage(chatId, "❌ /deliver ORD-XXXXXXXXXX account/code/details");
  const orderId = match[1].toUpperCase();
  const delivery = match[2].trim();
  const order = await storeGet(["orders", orderId]);
  if (!order) return await sendMessage(chatId, `❌ Order not found: ${orderId}`);
  const customerText = `🎁 Your order is ready

📦 ${order.product_name} x${order.qty}
🧾 Order: ${order.order_id}

━━━━━━━━━━━━━━
${delivery}
━━━━━━━━━━━━━━

Need help? Contact ${SUPPORT_HANDLE}`;
  const res = await sendMessage(order.chat_id, customerText);
  if (!res.ok) return await sendMessage(chatId, `❌ Could not send to customer.
Chat ID: ${order.chat_id}`);
  order.delivery_status = "DELIVERED_MANUAL";
  order.delivered_at = nowIso();
  order.manual_delivery_by = String(chatId);
  order.updated_at = nowIso();
  await storeSet(["orders", order.order_id], order);
  return await sendMessage(chatId, `✅ Delivered to customer only

Order: ${order.order_id}
User: ${order.first_name || ""} @${order.username || "-"}
Chat ID: ${order.chat_id}`);
}
async function adminListUsers(chatId) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const users = (await usersList()).slice(-30).reverse();
  const text = users.length ? users.map((u) => `• ${u.first_name || "User"} @${u.username || "-"}
Chat: ${u.chat_id}`).join("\n\n") : "No users yet.";
  return await sendMessage(chatId, `👥 Users

${text}`);
}
async function handleAdminCommand(chatId, text) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  if (text === "/admin") return await showAdmin(chatId);
  if (text === "/stock") return await showStock(chatId);
  if (text === "/orders") return await showOrders(chatId);
  if (text === "/pending") return await showPending(chatId);
  if (text === "/users") return await adminListUsers(chatId);
  if (text === "/stats") return await showStats(chatId);
  if (text === "/adminhelp") return await showAdminHelp(chatId);
  if (text.startsWith("/setstock ")) return await adminSetStock(chatId, text, false);
  if (text.startsWith("/addstock ")) return await adminSetStock(chatId, text, true);
  if (text.startsWith("/price ")) return await adminPrice(chatId, text);
  if (text.startsWith("/hide ")) return await adminHideShow(chatId, text, false);
  if (text.startsWith("/show ")) return await adminHideShow(chatId, text, true);
  if (text.startsWith("/image ")) return await adminImage(chatId, text);
  if (text.startsWith("/mode ")) return await adminMode(chatId, text);
  if (text.startsWith("/additem ")) return await adminAddItem(chatId, text);
  if (text.startsWith("/items ")) return await adminItems(chatId, text);
  if (text.startsWith("/order ")) return await showOrderDetails(chatId, text);
  if (text.startsWith("/deliver ")) return await adminDeliver(chatId, text);
  if (text.startsWith("/addproduct ")) return await adminAddProduct(chatId, text);
  if (text.startsWith("/broadcast ")) return await adminBroadcast(chatId, text);
  return false;
}
function isAdminCommand(text) {
  return text === "/admin" || text === "/stock" || text === "/orders" || text === "/pending" || text === "/users" || text === "/stats" || text === "/adminhelp" || /^\/(setstock|addstock|price|hide|show|image|mode|additem|items|order|deliver|addproduct|broadcast)\s/.test(text);
}

async function showMyOrders(chatId) {
  const orders = (await storeList(["orders"]))
    .map((x) => x.value)
    .filter((o) => String(o.chat_id) === String(chatId))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 5);
  if (!orders.length) return await sendMessage(chatId, "ما عندك طلبات حالياً.\nUse /products to order.");
  const text = `🧾 My Orders

${orders.map((o) => `• ${o.order_id}
${o.product_name} x${o.qty}
${money(o.amount)} ${o.currency}
Status: ${o.status}
Delivery: ${o.delivery_status}`).join("\n\n")}`;
  return await sendMessage(chatId, text);
}
async function handlePhotoMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId || !isAdmin(chatId)) return false;
  const caption = String(message.caption || "").trim();
  const match = caption.match(/^\/image\s+(\S+)$/);
  if (!match) return false;
  const productId = match[1];
  const p = await findProduct(productId, true);
  if (!p) {
    await sendMessage(chatId, `❌ Product not found: ${productId}`);
    return true;
  }
  const photos = message.photo || [];
  const fileId = photos[photos.length - 1]?.file_id;
  if (!fileId) return false;
  await setProductState(productId, { image_url: fileId });
  await sendMessage(chatId, `✅ Product photo saved
${productId}

Now open /products and test it.`);
  return true;
}
async function handleMessage(message) {
  const chatId = message.chat?.id;
  await registerUser(message.chat, message.from);
  if (message.photo && await handlePhotoMessage(message)) return;
  const text = String(message.text || "").trim();
  if (!chatId || !text) return;
  if (isAdminCommand(text)) {
    const handled = await handleAdminCommand(chatId, text);
    if (handled !== false) return;
  }
  if (text === "/start" || text.toLowerCase() === "start" || text === "/menu") return await showHome(chatId);
  if (text === "/products") return await showProductsPage(chatId, 1);
  if (text === "/myorders") return await showMyOrders(chatId);
  if (text === "/support") return await sendCard(chatId, `🎧 Support\n${SUPPORT_HANDLE}`, homeKeyboard());
  if (await handleTxid(chatId, text, message.from)) return;
  return await sendMessage(chatId, "استخدمي /products لعرض المنتجات أو /start للبدء.");
}
async function handleCallback(q) {
  const chatId = q.message?.chat?.id;
  const messageId = q.message?.message_id;
  const data = String(q.data || "");
  if (!chatId) return;
  await registerUser(q.message.chat, q.from);
  await answerCallback(q.id);
  if (data === "noop") return;
  if (data === "menu") return await sendCard(chatId, `✨ ${STORE_NAME}
${STORE_SUBTITLE}

🛒 Available Products: ${(await getActiveProducts()).length}
💵 Currency: USDT

Please select a product below.`, homeKeyboard(), STORE_IMAGE_URL, messageId);
  if (data === "support") return await sendCard(chatId, `🎧 Support\n${SUPPORT_HANDLE}`, homeKeyboard(), "", messageId);
  if (data.startsWith("products_p")) return await showProductsPage(chatId, Number(data.replace("products_p", "")), messageId);
  if (data.startsWith("product_")) return await showProduct(chatId, data.replace("product_", ""), messageId);
  if (data.startsWith("buy_")) return await showQuantity(chatId, data.replace("buy_", ""), messageId);
  if (data.startsWith("qty_")) return await showSummary(chatId, data, messageId);
  if (data.startsWith("confirm_")) return await showPayment(chatId, q.from, data, messageId);
  if (data.startsWith("paid_")) return await markPaidPrompt(chatId, data.replace("paid_", ""), messageId);
  if (data === "cancel_order") { await safeDelete(chatId, messageId); return await cancelOrder(chatId); }
  if (data === "admin_stock") return await showStock(chatId, messageId);
  if (data === "admin_orders") return await showOrders(chatId, messageId);
  if (data === "admin_pending") return await showPending(chatId, messageId);
  if (data === "admin_stats") return await showStats(chatId, messageId);
  if (data === "admin_help") return await showAdminHelp(chatId, messageId);
}
async function setWebhook(requestUrl) {
  const base = new URL(requestUrl);
  const webhookUrl = `${base.origin}/webhook/${WEBHOOK_SECRET}`;
  const result = await tg("setWebhook", { url: webhookUrl, allowed_updates: ["message", "callback_query"] });
  return { ok: true, webhookResult: result, webhookPath: `/webhook/${WEBHOOK_SECRET}` };
}

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/") return json({ ok: true, app: STORE_NAME, message: "Pro store bot is running. Use /setup?key=WEBHOOK_SECRET once." });
    if (url.pathname === "/setup") {
      if (url.searchParams.get("key") !== WEBHOOK_SECRET) return json({ ok: false, error: "Invalid key" }, 403);
      return json(await setWebhook(request.url));
    }
    if (url.pathname === `/webhook/${WEBHOOK_SECRET}` && request.method === "POST") {
      const update = await request.json();
      if (update.message) await handleMessage(update.message);
      if (update.callback_query) await handleCallback(update.callback_query);
      return json({ ok: true });
    }
    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    console.log(error);
    return json({ ok: false, error: error.message }, 500);
  }
});
