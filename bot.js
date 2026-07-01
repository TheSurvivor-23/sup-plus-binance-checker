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

async function storeDelete(key) {
  if (kv) return await kv.delete(key);
  memoryStore.delete(storageKey(key));
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

function isAdmin(chatId) {
  return ADMIN_ID && String(chatId) === String(ADMIN_ID);
}

function baseProducts() {
  return PRODUCTS.map((p) => ({ ...p, source: "base" }));
}

async function customProducts() {
  return await storeList(["custom_products"]);
}

async function getProductState(productId) {
  return (await storeGet(["product_state", productId])) || {};
}

async function setProductState(productId, patch) {
  const old = await getProductState(productId);
  const next = { ...old, ...patch, updated_at: new Date().toISOString() };
  await storeSet(["product_state", productId], next);
  return next;
}

async function inventoryEntries(productId) {
  if (kv) {
    const entries = [];
    for await (const item of kv.list({ prefix: ["inventory", productId] })) entries.push(item);
    return entries;
  }
  const p = JSON.stringify(["inventory", productId]).slice(0, -1);
  return [...memoryStore.entries()]
    .filter(([k]) => k.startsWith(p))
    .map(([k, v]) => ({ key: JSON.parse(k), value: v, versionstamp: "memory" }));
}

async function inventoryCount(productId) {
  return (await inventoryEntries(productId)).length;
}

async function resolveProduct(product) {
  const state = await getProductState(product.product_id);
  const invCount = await inventoryCount(product.product_id);
  const manualStock = Number(state.stock ?? product.stock ?? 0);
  const inventoryMode = state.inventory_mode === true;
  const price = Number(state.price ?? product.price ?? 0);
  const stock = inventoryMode ? invCount : manualStock;
  return {
    ...product,
    active: state.active ?? product.active ?? true,
    price,
    stock,
    manual_stock: manualStock,
    inventory_count: invCount,
    inventory_mode: inventoryMode,
    sold: Number(state.sold ?? product.sold ?? 0),
    button_name: state.button_name ?? product.button_name,
    name_ar: state.name_ar ?? product.name_ar,
    name_en: state.name_en ?? product.name_en,
    duration: state.duration ?? product.duration,
    description_ar: state.description_ar ?? product.description_ar,
    description_en: state.description_en ?? product.description_en,
    delivery: state.delivery ?? product.delivery,
    currency: state.currency ?? product.currency ?? "USDT",
    page: Number(state.page ?? product.page ?? 1),
  };
}

async function getAllProducts() {
  const map = new Map();
  for (const p of baseProducts()) map.set(p.product_id, p);
  for (const p of await customProducts()) map.set(p.product_id, { ...p, source: "custom" });
  const resolved = [];
  for (const p of map.values()) resolved.push(await resolveProduct(p));
  return resolved.sort((a, b) => Number(a.page || 1) - Number(b.page || 1) || Number(a.button_order || 999) - Number(b.button_order || 999) || String(a.button_name).localeCompare(String(b.button_name)));
}

async function getActiveProducts() {
  return (await getAllProducts()).filter((p) => p.active);
}

async function findProduct(productId, includeHidden = false) {
  const list = includeHidden ? await getAllProducts() : await getActiveProducts();
  return list.find((p) => p.product_id === productId);
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
  const stock = Number(p.stock || 0);
  const status = stock > 0 ? "✅" : "❌";
  return `${status} ${p.button_name || p.name_en} | ${p.duration} | ${p.price} ${p.currency} | Stock: ${stock}`;
}

async function showProductsPage(chatId, page = 1, messageId = null) {
  const active = await getActiveProducts();
  const totalPages = Math.max(1, ...active.map((p) => Number(p.page || 1)));
  page = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const list = active.filter((p) => Number(p.page) === page);
  const rows = list.map((p) => [{ text: productButtonText(p), callback_data: `product_${p.product_id}` }]);
  const nav = [];
  if (page > 1) nav.push({ text: "⬅️ Back", callback_data: `products_p${page - 1}` });
  nav.push({ text: "📋 Menu", callback_data: "menu" });
  if (page < totalPages) nav.push({ text: "Next ➡️", callback_data: `products_p${page + 1}` });
  rows.push(nav);

  const text = `🛍 Products | المنتجات 🛍\nPage ${page} / ${totalPages}\n\n👇 اختاري المنتج المطلوب من الأسفل\nChoose a product below 👇\n\n✅ Available = متوفر\n❌ Out of stock = غير متوفر`;
  const markup = { inline_keyboard: rows };
  if (messageId) return await editMessage(chatId, messageId, text, markup);
  return await sendMessage(chatId, text, markup);
}

function qtyKeyboard(product) {
  const rows = [];
  const stock = Number(product.stock || 0);
  const maxQty = Math.min(5, stock);
  for (let qty = 1; qty <= maxQty; qty++) {
    rows.push([{ text: `${qty}️⃣ Qty ${qty} | ${product.price * qty} ${product.currency}`, callback_data: `qty_${product.product_id}_${qty}` }]);
  }
  if (stock <= 0) rows.push([{ text: "❌ Out of stock | غير متوفر", callback_data: "noop" }]);
  rows.push([
    { text: "🔙 Products", callback_data: `products_p${product.page || 1}` },
    { text: "📋 Main Menu", callback_data: "menu" },
  ]);
  return { inline_keyboard: rows };
}

async function showProduct(chatId, productId, messageId = null) {
  const p = await findProduct(productId, true);
  if (!p || !p.active) return await sendMessage(chatId, "⚠️ Product not found or hidden");
  const text = buildProductDetails(p);
  if (messageId) return await editMessage(chatId, messageId, text, qtyKeyboard(p));
  return await sendMessage(chatId, text, qtyKeyboard(p));
}

function buildProductDetails(p) {
  const status = Number(p.stock || 0) > 0 ? "✅ المنتج متوفر | Available" : "❌ غير متوفر حالياً | Out of stock";
  return `📦 ${p.name_ar || p.button_name} | ${p.name_en || p.button_name}\n${status}\n\n━━━━━━━━━━━━━━\n🇦🇪 تفاصيل المنتج\n🕒 المدة: ${p.duration}\n💰 السعر للوحدة: ${p.price} ${p.currency}\n📦 المخزون الحالي: ${p.stock}\n🔥 عدد المبيعات: ${p.sold || 0}\n🛡 الضمان: ${p.warranty === "YES" ? "يوجد ضمان ✅" : "حسب الحالة"}\n🚚 التسليم: ${p.delivery}\n\nالوصف:\n${p.description_ar || ""}\n\n━━━━━━━━━━━━━━\n🇬🇧 Product details\nDuration: ${p.duration}\nUnit price: ${p.price} ${p.currency}\nStock: ${p.stock}\nSold: ${p.sold || 0}\nDelivery: ${p.delivery}\n\n${p.description_en || ""}\n\nاختاري الكمية من الأسفل 👇`;
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
  const p = await findProduct(productId);
  if (!p) return await sendMessage(chatId, "⚠️ Product not found");
  if (Number(p.stock || 0) < qty) return await sendMessage(chatId, `❌ الكمية غير متوفرة حالياً.\nالمتوفر: ${p.stock}`);
  const amount = Number(p.price) * qty;
  const text = `🧾 تأكيد الطلب\n\n📦 المنتج: ${p.button_name}\n🔢 الكمية: ${qty}\n📦 المخزون المتوفر: ${p.stock}\n💰 المجموع: ${amount} ${p.currency}\n\nاختاري طريقة الدفع 👇`;
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
  const p = await findProduct(productId);
  if (!p) throw new Error("Product not found");
  if (Number(p.stock || 0) < Number(qty)) throw new Error(`Out of stock. Available: ${p.stock}`);
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
    delivery_status: "WAITING_PAYMENT",
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
  let order;
  try {
    order = await createOrUpdateOrder(chatId, from, productId, qty);
  } catch (error) {
    return await sendMessage(chatId, `❌ ${error.message}`);
  }
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
  let order;
  try {
    order = await createOrUpdateOrder(chatId, from, productId, qty);
  } catch (error) {
    return await sendMessage(chatId, `❌ ${error.message}`);
  }
  order.status = "WAITING_TXID";
  order.updated_at = new Date().toISOString();
  await storeSet(["active_order", String(chatId)], order);
  await storeSet(["orders", order.order_id], order);
  return await sendMessage(chatId, `✅ تم استلام طلب الفحص\n\nالآن أرسلي TXID / Transaction Hash في الشات.\n\nPlease send your TXID / Transaction Hash now.\n\nOrder: ${order.order_id}`);
}

async function takeInventory(productId, qty) {
  const entries = await inventoryEntries(productId);
  if (entries.length < qty) return [];
  const chosen = entries.slice(0, qty);

  if (kv) {
    const tx = kv.atomic();
    for (const item of chosen) tx.check(item).delete(item.key);
    const res = await tx.commit();
    if (!res.ok) return await takeInventory(productId, qty);
    return chosen.map((entry) => entry.value);
  }

  for (const item of chosen) memoryStore.delete(storageKey(item.key));
  return chosen.map((entry) => entry.value);
}

async function updateSoldAndManualStock(productId, qty, usedInventory) {
  const product = await findProduct(productId, true);
  const state = await getProductState(productId);
  const sold = Number(state.sold ?? product?.sold ?? 0) + Number(qty);
  const patch = { sold };
  if (!usedInventory) {
    const current = Number(state.stock ?? product?.manual_stock ?? product?.stock ?? 0);
    patch.stock = Math.max(0, current - Number(qty));
    patch.inventory_mode = false;
  }
  await setProductState(productId, patch);
}

async function fulfillPaidOrder(order) {
  const product = await findProduct(order.product_id, true);
  const items = await takeInventory(order.product_id, Number(order.qty));
  if (items.length === Number(order.qty)) {
    await updateSoldAndManualStock(order.product_id, order.qty, true);
    order.delivery_status = "DELIVERED_AUTO";
    order.delivered_items = items;
    const delivered = items.map((item, i) => `#${i + 1}\n${item.content}`).join("\n\n━━━━━━━━━━━━━━\n\n");
    return {
      auto: true,
      customerText: `🎁 تم تسليم المنتج تلقائياً\n\n📦 ${order.product_name}\n🔢 Qty: ${order.qty}\n\n━━━━━━━━━━━━━━\n\n${delivered}\n\nاحفظي البيانات عندك ولا تشاركيها مع أحد.`,
      adminText: `Auto delivered ${items.length} item(s).`,
    };
  }

  await updateSoldAndManualStock(order.product_id, order.qty, false);
  order.delivery_status = "WAITING_MANUAL_DELIVERY";
  return {
    auto: false,
    customerText: `📦 طلبك قيد التجهيز\n\nتم تأكيد الدفع، وسيتم التسليم قريباً من الدعم.`,
    adminText: `Manual delivery needed. Inventory items available: ${product?.inventory_count || 0}.`,
  };
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
    const delivery = await fulfillPaidOrder(order);
    await storeSet(["active_order", String(chatId)], order);
    await storeSet(["orders", order.order_id], order);
    await sendMessage(chatId, `✅ Payment verified\n\nتم تأكيد الدفع بنجاح.\nوصل المبلغ الصحيح على Binance.\n\nOrder: ${order.order_id}`);
    await sendMessage(chatId, delivery.customerText);
    if (ADMIN_ID) {
      await sendMessage(ADMIN_ID, `✅ New paid order\n\nOrder: ${order.order_id}\nUser: ${order.first_name} @${order.username}\nProduct: ${order.product_name}\nQty: ${order.qty}\nAmount: ${order.amount} ${order.currency}\nTXID: ${order.txid}\nDelivery: ${order.delivery_status}\n${delivery.adminText}`);
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
  if (wantedTx) txMatch = deposits.find((item) => normTx(item.txId) === wantedTx);

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

function adminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📦 Stock", callback_data: "admin_stock" }, { text: "🧾 Orders", callback_data: "admin_orders" }],
      [{ text: "📚 Help", callback_data: "admin_help" }],
    ],
  };
}

async function showAdmin(chatId) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only");
  return await sendMessage(chatId, `🛠 Admin Panel\n\nالأوامر المهمة:\n/stock\n/orders\n/setstock product_id 10\n/price product_id 20\n/hide product_id\n/show product_id\n/additem product_id delivery_text\n/items product_id\n/addproduct id|name|price|stock|page|duration|description`, adminKeyboard());
}

async function showAdminHelp(chatId, messageId = null) {
  const text = `🛠 Admin Help\n\nتعديل الستوك اليدوي:\n/setstock chatgpt_plus 10\n\nتغيير السعر:\n/price chatgpt_plus 20\n\nإخفاء/إظهار منتج:\n/hide chatgpt_plus\n/show chatgpt_plus\n\nإضافة تسليم تلقائي:\n/additem chatgpt_plus email: test@test.com\npassword: 123456\n\nعدد المنتجات الجاهزة للتسليم:\n/items chatgpt_plus\n\nإضافة منتج جديد:\n/addproduct product_id|Product Name|20|10|1|1 Month|Description here`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}

async function showStock(chatId, messageId = null) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only");
  const products = await getAllProducts();
  const lines = products.map((p) => `${p.active ? "✅" : "🙈"} ${p.product_id}\n${p.button_name} | ${p.price} ${p.currency} | Stock: ${p.stock} | Items: ${p.inventory_count} | Sold: ${p.sold}`);
  const text = `📦 Stock List\n\n${lines.join("\n\n")}`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}

async function showOrders(chatId, messageId = null) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only");
  const orders = (await storeList(["orders"])).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  if (!orders.length) return await sendMessage(chatId, "No orders yet.", adminKeyboard());
  const lines = orders.map((o) => `• ${o.status} | ${o.delivery_status || ""}\n${o.product_name} x${o.qty} | ${o.amount} ${o.currency}\n${o.order_id}\n${o.txid || "No TXID"}`);
  const text = `🧾 Last orders\n\n${lines.join("\n\n")}`;
  if (messageId) return await editMessage(chatId, messageId, text, adminKeyboard());
  return await sendMessage(chatId, text, adminKeyboard());
}

async function adminSetStock(chatId, text) {
  const [, productId, stockText] = text.split(/\s+/);
  const product = await findProduct(productId, true);
  const stock = Number(stockText);
  if (!product || !Number.isFinite(stock) || stock < 0) return await sendMessage(chatId, "❌ الصيغة: /setstock chatgpt_plus 10");
  await setProductState(productId, { stock, inventory_mode: false });
  return await sendMessage(chatId, `✅ تم تعديل الستوك\n${productId}: ${stock}`);
}

async function adminSetPrice(chatId, text) {
  const [, productId, priceText] = text.split(/\s+/);
  const product = await findProduct(productId, true);
  const price = Number(priceText);
  if (!product || !Number.isFinite(price) || price <= 0) return await sendMessage(chatId, "❌ الصيغة: /price chatgpt_plus 20");
  await setProductState(productId, { price });
  return await sendMessage(chatId, `✅ تم تعديل السعر\n${productId}: ${price}`);
}

async function adminHideShow(chatId, text, active) {
  const [, productId] = text.split(/\s+/);
  const product = await findProduct(productId, true);
  if (!product) return await sendMessage(chatId, `❌ المنتج مش موجود: ${productId}`);
  await setProductState(productId, { active });
  return await sendMessage(chatId, `${active ? "✅ تم إظهار" : "🙈 تم إخفاء"} ${productId}`);
}

async function adminAddItem(chatId, text) {
  const match = text.match(/^\/additem\s+(\S+)\s+([\s\S]+)$/);
  if (!match) return await sendMessage(chatId, "❌ الصيغة:\n/additem chatgpt_plus email: test@test.com\npassword: 123456");
  const productId = match[1];
  const content = match[2].trim();
  const product = await findProduct(productId, true);
  if (!product) return await sendMessage(chatId, `❌ المنتج مش موجود: ${productId}`);
  const item = { id: `${Date.now()}-${crypto.randomUUID()}`, product_id: productId, content, created_at: new Date().toISOString() };
  await storeSet(["inventory", productId, item.id], item);
  await setProductState(productId, { inventory_mode: true, active: true });
  const count = await inventoryCount(productId);
  return await sendMessage(chatId, `✅ تمت إضافة منتج للتسليم التلقائي\n${productId}\nالمتوفر الآن: ${count}`);
}

async function adminItems(chatId, text) {
  const [, productId] = text.split(/\s+/);
  const product = await findProduct(productId, true);
  if (!product) return await sendMessage(chatId, "❌ الصيغة: /items chatgpt_plus");
  const count = await inventoryCount(productId);
  return await sendMessage(chatId, `📦 ${productId}\nItems ready for auto delivery: ${count}\nManual stock: ${product.manual_stock}\nVisible stock: ${product.stock}`);
}

async function adminAddProduct(chatId, text) {
  const raw = text.replace(/^\/addproduct\s+/, "").trim();
  const parts = raw.split("|").map((x) => x.trim());
  if (parts.length < 7) {
    return await sendMessage(chatId, "❌ الصيغة:\n/addproduct product_id|Product Name|20|10|1|1 Month|Description here");
  }
  const [product_id, name, priceText, stockText, pageText, duration, description] = parts;
  if (!product_id || !name) return await sendMessage(chatId, "❌ product_id و name مطلوبين");
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
    delivery: "Auto/Manual",
    requires_email: "NO",
    supplier_type: "Custom",
    description_ar: description,
    description_en: description,
  };
  await storeSet(["custom_products", product_id], product);
  await setProductState(product_id, { active: true, stock: product.stock, price: product.price, inventory_mode: false });
  return await sendMessage(chatId, `✅ تم إضافة المنتج\n${product_id}\n${name}\nالسعر: ${product.price} USDT\nالستوك: ${product.stock}`);
}

async function handleAdminCommand(chatId, text) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only");
  if (text === "/admin") return await showAdmin(chatId);
  if (text === "/adminhelp") return await showAdminHelp(chatId);
  if (text === "/stock") return await showStock(chatId);
  if (text === "/orders") return await showOrders(chatId);
  if (text.startsWith("/setstock ")) return await adminSetStock(chatId, text);
  if (text.startsWith("/price ")) return await adminSetPrice(chatId, text);
  if (text.startsWith("/hide ")) return await adminHideShow(chatId, text, false);
  if (text.startsWith("/show ")) return await adminHideShow(chatId, text, true);
  if (text.startsWith("/additem ")) return await adminAddItem(chatId, text);
  if (text.startsWith("/items ")) return await adminItems(chatId, text);
  if (text.startsWith("/addproduct ")) return await adminAddProduct(chatId, text);
  return false;
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  if (!chatId || !text) return;

  if (text.startsWith("/admin") || text === "/stock" || text === "/orders" || text.startsWith("/setstock ") || text.startsWith("/price ") || text.startsWith("/hide ") || text.startsWith("/show ") || text.startsWith("/additem ") || text.startsWith("/items ") || text.startsWith("/addproduct ")) {
    const handled = await handleAdminCommand(chatId, text);
    if (handled !== false) return;
  }

  if (text === "/start" || text.toLowerCase() === "start") return await showMainMenu(chatId);
  if (text === "/menu") return await showMainMenu(chatId);
  if (text === "/products") return await showProductsPage(chatId, 1);
  if (text === "/support") return await showSupport(chatId);
  if (text === "/language") return await showLanguage(chatId);
  if (text.startsWith("/")) return await showMainMenu(chatId);

  return await handleTxid(chatId, text);
}

async function handleCallback(callback) {
  const data = callback.data || "";
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  await answerCallback(callback.id);
  if (!chatId) return;

  if (data === "noop") return;
  if (data === "start" || data === "menu" || data === "main_menu") return await showMainMenu(chatId, messageId);
  if (data === "support") return await showSupport(chatId, messageId);
  if (data === "language") return await showLanguage(chatId, messageId);
  if (data === "products") return await showProductsPage(chatId, 1, messageId);
  if (data.startsWith("products_p")) return await showProductsPage(chatId, Number(data.replace("products_p", "")), messageId);
  if (data === "admin_stock") return await showStock(chatId, messageId);
  if (data === "admin_orders") return await showOrders(chatId, messageId);
  if (data === "admin_help") return await showAdminHelp(chatId, messageId);
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
