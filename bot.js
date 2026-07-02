import { PRODUCTS } from "./products.js";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "change-this-secret";
const ADMIN_ID = String(Deno.env.get("ADMIN_ID") || "");
const STORE_NAME = Deno.env.get("STORE_NAME") || "SUP Plus | Malath";
const STORE_SUBTITLE = Deno.env.get("STORE_SUBTITLE") || "Digital Store · Instant Delivery";
const SUPPORT_HANDLE_RAW = Deno.env.get("SUPPORT_HANDLE") || Deno.env.get("SUPPORT_USERNAME") || "@SPlusX_Help";
const SUPPORT_HANDLE = String(SUPPORT_HANDLE_RAW).startsWith("@") ? String(SUPPORT_HANDLE_RAW) : `@${SUPPORT_HANDLE_RAW}`;
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

// Performance cache: keeps KV persistent but avoids reading the whole database on every button click.
// You can override from Deno Environment Variables if needed.
const PRODUCT_CACHE_TTL_MS = Number(Deno.env.get("PRODUCT_CACHE_TTL_MS") || "60000");
const USER_WRITE_TTL_MS = Number(Deno.env.get("USER_WRITE_TTL_MS") || "600000");
let allProductsCache = { at: 0, value: null };
let customProductsCache = { at: 0, value: null };
const productStateCache = new Map();
const inventoryEntriesCache = new Map();
const userWriteCache = new Map();

function cacheFresh(cache, ttl = PRODUCT_CACHE_TTL_MS) {
  return cache && cache.value && Date.now() - cache.at < ttl;
}
function resetProductCache(productId = "") {
  allProductsCache = { at: 0, value: null };
  if (productId) {
    productStateCache.delete(productId);
    inventoryEntriesCache.delete(productId);
  }
}
function invalidateCacheForKey(key) {
  try {
    if (!Array.isArray(key)) return;
    const group = key[0];
    const productId = key[1] ? String(key[1]) : "";
    if (group === "product_state") resetProductCache(productId);
    if (group === "custom_products") {
      customProductsCache = { at: 0, value: null };
      resetProductCache(productId);
    }
    if (group === "inventory") resetProductCache(productId);
  } catch (_error) {
    // Cache invalidation must never break the bot.
  }
}
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
  let result;
  if (kv) result = await kv.set(key, value);
  else {
    memoryStore.set(skey(key), value);
    result = { ok: true };
  }
  invalidateCacheForKey(key);
  return result;
}
async function storeDelete(key) {
  let result;
  if (kv) result = await kv.delete(key);
  else {
    memoryStore.delete(skey(key));
    result = { ok: true };
  }
  invalidateCacheForKey(key);
  return result;
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


const LANGS = {
  dual: { label: "🌐 English + عربي", name: "English + عربي" },
  en: { label: "🇬🇧 English", name: "English" },
  ar: { label: "🇸🇦 العربية", name: "العربية" },
  vi: { label: "🇻🇳 Tiếng Việt", name: "Tiếng Việt" },
  hi: { label: "🇮🇳 हिन्दी", name: "हिन्दी" },
  ur: { label: "🇵🇰 اردو", name: "اردو" },
};

const TX = {
  home_title: {
    en: "Welcome to our digital store",
    ar: "أهلاً بك في متجرنا الرقمي",
    vi: "Chào mừng bạn đến cửa hàng số của chúng tôi",
    hi: "हमारे डिजिटल स्टोर में आपका स्वागत है",
    ur: "ہمارے ڈیجیٹل اسٹور میں خوش آمدید",
  },
  products: { en: "Products", ar: "المنتجات", vi: "Sản phẩm", hi: "प्रोडक्ट्स", ur: "مصنوعات" },
  available_products: { en: "Available Products", ar: "المنتجات المتوفرة", vi: "Sản phẩm có sẵn", hi: "उपलब्ध प्रोडक्ट्स", ur: "دستیاب مصنوعات" },
  total_stock: { en: "Total stock", ar: "إجمالي الستوك", vi: "Tổng tồn kho", hi: "कुल स्टॉक", ur: "کل اسٹاک" },
  currency: { en: "Currency", ar: "العملة", vi: "Tiền tệ", hi: "करेंसी", ur: "کرنسی" },
  select_product: { en: "Please select a product below", ar: "اختاري المنتج من الأسفل", vi: "Vui lòng chọn sản phẩm bên dưới", hi: "नीचे से प्रोडक्ट चुनें", ur: "نیچے سے پروڈکٹ منتخب کریں" },
  available: { en: "Available", ar: "متوفر", vi: "Có sẵn", hi: "उपलब्ध", ur: "دستیاب" },
  out_stock: { en: "Out of stock", ar: "غير متوفر", vi: "Hết hàng", hi: "स्टॉक खत्म", ur: "اسٹاک ختم" },
  refresh: { en: "Refresh", ar: "تحديث", vi: "Làm mới", hi: "रीफ्रेश", ur: "ریفریش" },
  support: { en: "Support", ar: "الدعم", vi: "Hỗ trợ", hi: "सपोर्ट", ur: "سپورٹ" },
  home: { en: "Home", ar: "الرئيسية", vi: "Trang chính", hi: "होम", ur: "ہوم" },
  back_store: { en: "Back to Store", ar: "رجوع للمتجر", vi: "Quay lại cửa hàng", hi: "स्टोर पर वापस", ur: "اسٹور پر واپس" },
  back_product: { en: "Back to Product", ar: "رجوع للمنتج", vi: "Quay lại sản phẩm", hi: "प्रोडक्ट पर वापस", ur: "پروڈکٹ پر واپس" },
  buy_now: { en: "Buy Now", ar: "اشتري الآن", vi: "Mua ngay", hi: "अभी खरीदें", ur: "ابھی خریدیں" },
  price: { en: "Price", ar: "السعر", vi: "Giá", hi: "कीमत", ur: "قیمت" },
  stock: { en: "Stock", ar: "الستوك", vi: "Tồn kho", hi: "स्टॉक", ur: "اسٹاک" },
  delivery: { en: "Delivery", ar: "التسليم", vi: "Giao hàng", hi: "डिलीवरी", ur: "ڈیلیوری" },
  auto_delivery: { en: "Automatic after payment", ar: "تلقائي بعد الدفع", vi: "Tự động sau khi thanh toán", hi: "पेमेंट के बाद ऑटोमैटिक", ur: "ادائیگی کے بعد خودکار" },
  manual_delivery: { en: "Manual after payment", ar: "يدوي بعد الدفع", vi: "Thủ công sau khi thanh toán", hi: "पेमेंट के बाद मैनुअल", ur: "ادائیگی کے بعد مینوئل" },
  warranty: { en: "Warranty", ar: "الضمان", vi: "Bảo hành", hi: "वारंटी", ur: "وارنٹی" },
  duration: { en: "Duration", ar: "المدة", vi: "Thời hạn", hi: "अवधि", ur: "مدت" },
  description: { en: "Description", ar: "الوصف", vi: "Mô tả", hi: "विवरण", ur: "تفصیل" },
  product_id: { en: "Product ID", ar: "كود المنتج", vi: "Mã sản phẩm", hi: "प्रोडक्ट आईडी", ur: "پروڈکٹ آئی ڈی" },
  select_qty: { en: "Select Quantity", ar: "اختاري الكمية", vi: "Chọn số lượng", hi: "मात्रा चुनें", ur: "تعداد منتخب کریں" },
  quantity: { en: "Quantity", ar: "الكمية", vi: "Số lượng", hi: "मात्रा", ur: "تعداد" },
  how_many: { en: "How many do you want?", ar: "كم كمية بدك؟", vi: "Bạn muốn bao nhiêu?", hi: "आप कितनी मात्रा चाहते हैं?", ur: "آپ کتنی مقدار چاہتے ہیں؟" },
  order_summary: { en: "Order Summary", ar: "ملخص الطلب", vi: "Tóm tắt đơn hàng", hi: "ऑर्डर सारांश", ur: "آرڈر کا خلاصہ" },
  total: { en: "Total", ar: "الإجمالي", vi: "Tổng cộng", hi: "कुल", ur: "کل" },
  confirm_pay: { en: "Confirm & Pay", ar: "تأكيد والدفع", vi: "Xác nhận & Thanh toán", hi: "कन्फर्म और पेमेंट", ur: "تصدیق اور ادائیگی" },
  change_qty: { en: "Change Qty", ar: "تغيير الكمية", vi: "Đổi số lượng", hi: "मात्रा बदलें", ur: "تعداد بدلیں" },
  binance_deposit: { en: "Binance Deposit", ar: "دفع Binance", vi: "Nạp qua Binance", hi: "Binance डिपॉजिट", ur: "Binance ڈپازٹ" },
  product: { en: "Product", ar: "المنتج", vi: "Sản phẩm", hi: "प्रोडक्ट", ur: "پروڈکٹ" },
  amount: { en: "Amount", ar: "المبلغ", vi: "Số tiền", hi: "राशि", ur: "رقم" },
  order_id: { en: "Order ID", ar: "رقم الطلب", vi: "Mã đơn hàng", hi: "ऑर्डर आईडी", ur: "آرڈر آئی ڈی" },
  network: { en: "Network", ar: "الشبكة", vi: "Mạng", hi: "नेटवर्क", ur: "نیٹ ورک" },
  pay_steps: {
    en: "1️⃣ Open Binance\n2️⃣ Send USDT to this address",
    ar: "1️⃣ افتحي Binance\n2️⃣ أرسلي USDT على هذا العنوان",
    vi: "1️⃣ Mở Binance\n2️⃣ Gửi USDT đến địa chỉ này",
    hi: "1️⃣ Binance खोलें\n2️⃣ इस पते पर USDT भेजें",
    ur: "1️⃣ Binance کھولیں\n2️⃣ اس ایڈریس پر USDT بھیجیں",
  },
  exact_amount: { en: "Send exact amount only", ar: "أرسلي نفس المبلغ بالضبط", vi: "Chỉ gửi đúng số tiền", hi: "सिर्फ सही राशि भेजें", ur: "صرف درست رقم بھیجیں" },
  i_paid: { en: "I paid", ar: "دفعت", vi: "Tôi đã thanh toán", hi: "मैंने भुगतान कर दिया", ur: "میں نے ادائیگی کر دی" },
  cancel_order: { en: "Cancel order", ar: "إلغاء الطلب", vi: "Hủy đơn", hi: "ऑर्डर कैंसल", ur: "آرڈر منسوخ" },
  send_txid: { en: "Now send your Binance Pay Order ID / CXID or TXID / Transaction Hash in this chat.", ar: "الآن أرسلي Binance Pay Order ID / CXID أو TXID / Transaction Hash في الشات.", vi: "Bây giờ gửi Binance Pay Order ID / CXID hoặc TXID / Transaction Hash trong chat này.", hi: "अब इसी चैट में Binance Pay Order ID / CXID या TXID / Transaction Hash भेजें.", ur: "اب اسی چیٹ میں Binance Pay Order ID / CXID یا TXID / Transaction Hash بھیجیں۔" },
  valid_txid: { en: "Send a valid Binance Pay Order ID / CXID or a TXID starting with 0x.", ar: "أرسلي Binance Pay Order ID / CXID صحيح أو TXID يبدأ بـ 0x.", vi: "Gửi Binance Pay Order ID / CXID hợp lệ hoặc TXID bắt đầu bằng 0x.", hi: "सही Binance Pay Order ID / CXID या 0x से शुरू TXID भेजें.", ur: "درست Binance Pay Order ID / CXID یا 0x سے شروع TXID بھیجیں۔" },
  checking: { en: "Checking payment on Binance...", ar: "جاري فحص الدفع على Binance...", vi: "Đang kiểm tra thanh toán trên Binance...", hi: "Binance पर पेमेंट चेक हो रहा है...", ur: "Binance پر ادائیگی چیک ہو رہی ہے..." },
  payment_verified: { en: "Payment verified", ar: "تم تأكيد الدفع", vi: "Thanh toán đã được xác minh", hi: "पेमेंट वेरिफाई हो गया", ur: "ادائیگی کی تصدیق ہو گئی" },
  product_ready: { en: "Your product is ready", ar: "منتجك جاهز", vi: "Sản phẩm của bạn đã sẵn sàng", hi: "आपका प्रोडक्ट तैयार है", ur: "آپ کی پروڈکٹ تیار ہے" },
  processing: { en: "Your order is now being processed. Admin will deliver it soon.", ar: "طلبك الآن قيد التجهيز. سيتم التسليم قريباً.", vi: "Đơn hàng của bạn đang được xử lý. Admin sẽ giao sớm.", hi: "आपका ऑर्डर प्रोसेस हो रहा है. एडमिन जल्द डिलीवर करेगा.", ur: "آپ کا آرڈر پروسیس ہو رہا ہے۔ ایڈمن جلد ڈیلیور کرے گا۔" },
  payment_not_found: { en: "Payment not found. Check TXID, amount, network, and wait 2-5 minutes if the transfer is new.", ar: "لم يتم العثور على الدفع. تأكدي من TXID والمبلغ والشبكة وانتظري 2-5 دقائق إذا التحويل جديد.", vi: "Không tìm thấy thanh toán. Kiểm tra TXID, số tiền, mạng và chờ 2-5 phút nếu giao dịch mới.", hi: "पेमेंट नहीं मिला. TXID, राशि, नेटवर्क चेक करें और अगर ट्रांसफर नया है तो 2-5 मिनट प्रतीक्षा करें.", ur: "ادائیگی نہیں ملی۔ TXID، رقم، نیٹ ورک چیک کریں اور اگر ٹرانسفر نیا ہے تو 2-5 منٹ انتظار کریں۔" },
  amount_wrong: { en: "Payment found but amount is wrong", ar: "تم العثور على الدفع لكن المبلغ غير صحيح", vi: "Đã tìm thấy thanh toán nhưng số tiền không đúng", hi: "पेमेंट मिला लेकिन राशि गलत है", ur: "ادائیگی مل گئی لیکن رقم غلط ہے" },
  checker_config: { en: "Payment checker is not configured. Admin was notified.", ar: "فاحص الدفع غير مضبوط. تم تنبيه الأدمن.", vi: "Bộ kiểm tra thanh toán chưa được cấu hình. Admin đã được thông báo.", hi: "पेमेंट चेकर कॉन्फ़िगर नहीं है. एडमिन को सूचित किया गया है.", ur: "پیمنٹ چیکر کنفیگر نہیں ہے۔ ایڈمن کو اطلاع دے دی گئی ہے۔" },
  product_not_found: { en: "Product not found or hidden.", ar: "المنتج غير موجود أو مخفي.", vi: "Không tìm thấy sản phẩm hoặc sản phẩm đang bị ẩn.", hi: "प्रोडक्ट नहीं मिला या छिपा हुआ है.", ur: "پروڈکٹ نہیں ملی یا چھپی ہوئی ہے۔" },
  qty_not_available: { en: "Quantity not available", ar: "الكمية غير متوفرة", vi: "Số lượng không có sẵn", hi: "मात्रा उपलब्ध नहीं", ur: "تعداد دستیاب نہیں" },
  order_not_found: { en: "Order not found.", ar: "الطلب غير موجود.", vi: "Không tìm thấy đơn hàng.", hi: "ऑर्डर नहीं मिला.", ur: "آرڈر نہیں ملا۔" },
  order_cancelled: { en: "Order cancelled.", ar: "تم إلغاء الطلب.", vi: "Đơn hàng đã bị hủy.", hi: "ऑर्डर कैंसल हो गया.", ur: "آرڈر منسوخ ہو گیا۔" },
  no_orders: { en: "You do not have orders yet.", ar: "ما عندك طلبات حالياً.", vi: "Bạn chưa có đơn hàng nào.", hi: "आपके पास अभी कोई ऑर्डर नहीं है.", ur: "آپ کے پاس ابھی کوئی آرڈر نہیں ہے۔" },
  my_orders: { en: "My Orders", ar: "طلباتي", vi: "Đơn hàng của tôi", hi: "मेरे ऑर्डर", ur: "میرے آرڈرز" },
  language: { en: "Language", ar: "اللغة", vi: "Ngôn ngữ", hi: "भाषा", ur: "زبان" },
  choose_language: { en: "Choose your language", ar: "اختاري لغتك", vi: "Chọn ngôn ngữ của bạn", hi: "अपनी भाषा चुनें", ur: "اپنی زبان منتخب کریں" },
  language_saved: { en: "Language saved", ar: "تم حفظ اللغة", vi: "Đã lưu ngôn ngữ", hi: "भाषा सेव हो गई", ur: "زبان محفوظ ہو گئی" },
  use_commands: { en: "Use /products to view products or /start to begin.", ar: "استخدمي /products لعرض المنتجات أو /start للبدء.", vi: "Dùng /products để xem sản phẩm hoặc /start để bắt đầu.", hi: "/products से प्रोडक्ट देखें या /start से शुरू करें.", ur: "/products سے پروڈکٹس دیکھیں یا /start سے شروع کریں۔" },
  need_help: { en: "Need help? Contact", ar: "بحاجة لمساعدة؟ تواصلي مع", vi: "Cần hỗ trợ? Liên hệ", hi: "मदद चाहिए? संपर्क करें", ur: "مدد چاہیے؟ رابطہ کریں" },
};

function one(lang, key) {
  const row = TX[key] || {};
  return row[lang] || row.en || key;
}
function t(lang, key) {
  if (lang === "dual") return `${one("en", key)}\n${one("ar", key)}`;
  return one(lang, key);
}
function btn(lang, key) {
  if (lang === "dual") return `${one("en", key)} | ${one("ar", key)}`;
  return one(lang, key);
}
async function langOf(chatId) {
  return (await storeGet(["lang", String(chatId)])) || "dual";
}
async function setLang(chatId, lang) {
  const finalLang = LANGS[lang] ? lang : "dual";
  await storeSet(["lang", String(chatId)], finalLang);
  return finalLang;
}
function productName(p, lang) {
  if (lang === "ar") return p.name_ar || p.name_en || p.button_name || p.product_id;
  if (lang === "vi") return p.name_vi || p.name_en || p.button_name || p.product_id;
  if (lang === "hi") return p.name_hi || p.name_en || p.button_name || p.product_id;
  if (lang === "ur") return p.name_ur || p.name_en || p.button_name || p.product_id;
  if (lang === "dual") return `${p.name_en || p.button_name || p.product_id}\n${p.name_ar || p.name_en || p.button_name || p.product_id}`;
  return p.name_en || p.button_name || p.product_id;
}
function productButtonName(p, lang) {
  const name = productName(p, lang).replace(/\n/g, " / ");
  return name.length > 36 ? `${name.slice(0, 33)}...` : name;
}
function productDescription(p, lang) {
  if (lang === "ar") return p.description_ar || p.description_en || "";
  if (lang === "vi") return p.description_vi || p.description_en || p.description_ar || "";
  if (lang === "hi") return p.description_hi || p.description_en || p.description_ar || "";
  if (lang === "ur") return p.description_ur || p.description_en || p.description_ar || "";
  if (lang === "dual") {
    const en = p.description_en || "Premium digital product with secure delivery.";
    const ar = p.description_ar || "منتج رقمي ممتاز مع تسليم آمن.";
    return `${en}\n\n${ar}`;
  }
  return p.description_en || p.description_ar || "Premium digital product with secure delivery.";
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
  const chatId = String(chat.id);
  const lastWrite = userWriteCache.get(chatId) || 0;
  if (Date.now() - lastWrite < USER_WRITE_TTL_MS) return;
  userWriteCache.set(chatId, Date.now());
  const old = await storeGet(["users", chatId]);
  const user = {
    chat_id: chatId,
    type: chat.type || "private",
    username: from?.username || chat.username || "",
    first_name: from?.first_name || chat.first_name || "",
    last_name: from?.last_name || chat.last_name || "",
    blocked: false,
    updated_at: nowIso(),
    created_at: old?.created_at || nowIso(),
  };
  await storeSet(["users", chatId], user);
}
async function usersList() {
  return (await storeList(["users"])).map((x) => x.value).filter((u) => !u.blocked);
}

function baseProducts() {
  return PRODUCTS.map((p) => ({ ...p, source: "base" }));
}
async function customProducts() {
  if (cacheFresh(customProductsCache)) return customProductsCache.value;
  const value = (await storeList(["custom_products"])).map((x) => x.value);
  customProductsCache = { at: Date.now(), value };
  return value;
}
async function getProductState(productId) {
  const cached = productStateCache.get(productId);
  if (cached && Date.now() - cached.at < PRODUCT_CACHE_TTL_MS) return cached.value;
  const value = (await storeGet(["product_state", productId])) || {};
  productStateCache.set(productId, { at: Date.now(), value });
  return value;
}
async function setProductState(productId, patch) {
  const old = await getProductState(productId);
  const next = { ...old, ...patch, updated_at: nowIso() };
  productStateCache.set(productId, { at: Date.now(), value: next });
  await storeSet(["product_state", productId], next);
  resetProductCache(productId);
  return next;
}
async function inventoryEntries(productId) {
  const cached = inventoryEntriesCache.get(productId);
  if (cached && Date.now() - cached.at < PRODUCT_CACHE_TTL_MS) return cached.value;
  const value = await storeList(["inventory", productId]);
  inventoryEntriesCache.set(productId, { at: Date.now(), value });
  return value;
}
async function inventoryCount(productId) {
  return (await inventoryEntries(productId)).length;
}
async function resolveProduct(product) {
  const s = await getProductState(product.product_id);
  const mode = s.delivery_mode || (s.inventory_mode ? "auto" : "manual");
  let itemCount = 0;
  if (mode === "auto") itemCount = await inventoryCount(product.product_id);
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
    name_vi: s.name_vi ?? product.name_vi ?? "",
    name_hi: s.name_hi ?? product.name_hi ?? "",
    name_ur: s.name_ur ?? product.name_ur ?? "",
    description_vi: s.description_vi ?? product.description_vi ?? "",
    description_hi: s.description_hi ?? product.description_hi ?? "",
    description_ur: s.description_ur ?? product.description_ur ?? "",
    image_url: s.image_url ?? product.image_url ?? product.logo_preview ?? "",
    discount: s.discount ?? product.discount ?? "",
  };
}
async function getAllProducts() {
  if (cacheFresh(allProductsCache)) return allProductsCache.value;
  const map = new Map();
  for (const p of baseProducts()) map.set(p.product_id, p);
  for (const p of await customProducts()) map.set(p.product_id, { ...p, source: "custom" });
  const out = [];
  for (const p of map.values()) out.push(await resolveProduct(p));
  const value = out.sort((a, b) => a.page - b.page || a.button_order - b.button_order || String(a.button_name).localeCompare(String(b.button_name)));
  allProductsCache = { at: Date.now(), value };
  return value;
}
async function getActiveProducts() {
  return (await getAllProducts()).filter((p) => p.active);
}
async function findProduct(productId, includeHidden = false) {
  const list = includeHidden ? await getAllProducts() : await getActiveProducts();
  return list.find((p) => p.product_id === productId);
}

function homeKeyboard(lang = "dual") {
  return {
    inline_keyboard: [
      [{ text: `🛍 ${btn(lang, "available_products")}`, callback_data: "products_p1" }],
      [
        { text: `🌐 ${btn(lang, "language")}`, callback_data: "language" },
        { text: `🎧 ${btn(lang, "support")}`, callback_data: "support" },
      ],
      [{ text: `🔄 ${btn(lang, "refresh")}`, callback_data: "menu" }],
    ],
  };
}
function languageKeyboard() {
  return { inline_keyboard: [
    [{ text: "🌐 English + عربي", callback_data: "lang_dual" }],
    [{ text: "🇬🇧 English", callback_data: "lang_en" }, { text: "🇸🇦 العربية", callback_data: "lang_ar" }],
    [{ text: "🇻🇳 Tiếng Việt", callback_data: "lang_vi" }, { text: "🇮🇳 हिन्दी", callback_data: "lang_hi" }],
    [{ text: "🇵🇰 اردو", callback_data: "lang_ur" }],
    [{ text: "🏠 Home", callback_data: "menu" }],
  ] };
}
async function showLanguage(chatId, previousMessageId = null) {
  const lang = await langOf(chatId);
  const text = `🌐 ${t(lang, "choose_language")}

Current: ${LANGS[lang]?.name || "English + عربي"}`;
  return await sendCard(chatId, text, languageKeyboard(), "", previousMessageId);
}
async function showHome(chatId) {
  const lang = await langOf(chatId);
  const products = await getActiveProducts();
  const available = products.reduce((sum, p) => sum + Number(p.stock || 0), 0);
  const text = `✨ ${STORE_NAME}
${STORE_SUBTITLE}

${t(lang, "home_title")}

🛒 ${btn(lang, "available_products")}: ${products.length}
📦 ${btn(lang, "total_stock")}: ${available}
💵 ${btn(lang, "currency")}: USDT

${t(lang, "select_product")}`;
  return await sendCard(chatId, text, homeKeyboard(lang), STORE_IMAGE_URL);
}
function productLabel(p, lang = "dual") {
  const stock = Number(p.stock || 0);
  const dot = stock > 0 ? "🟢" : "🔴";
  const status = stock > 0 ? `📦 ${stock}` : btn(lang, "out_stock");
  const name = productButtonName(p, lang);
  const discount = p.discount ? ` 🔥${p.discount}` : "";
  return `${dot} ${name} | $${money(p.price)}${discount} | ${status}`;
}
async function showProductsPage(chatId, page = 1, messageId = null) {
  const lang = await langOf(chatId);
  const products = await getActiveProducts();
  const totalPages = Math.max(1, ...products.map((p) => Number(p.page || 1)));
  page = Math.max(1, Math.min(Number(page) || 1, totalPages));
  const list = products.filter((p) => Number(p.page || 1) === page);
  const rows = [];
  rows.push([{ text: `🛍 ${btn(lang, "available_products")}`, callback_data: `products_p${page}` }]);
  for (const p of list) rows.push([{ text: productLabel(p, lang), callback_data: `product_${p.product_id}` }]);
  rows.push([
    { text: `🔄 ${btn(lang, "refresh")}`, callback_data: `products_p${page}` },
    { text: `🌐 ${btn(lang, "language")}`, callback_data: "language" },
  ]);
  rows.push([
    { text: "⬅️", callback_data: `products_p${Math.max(1, page - 1)}` },
    { text: `${page}/${totalPages}`, callback_data: "noop" },
    { text: "➡️", callback_data: `products_p${Math.min(totalPages, page + 1)}` },
  ]);
  rows.push([{ text: `🏠 ${btn(lang, "home")}`, callback_data: "menu" }]);
  const text = `✨ ${STORE_NAME}
🛒 ${t(lang, "available_products")}

🟢 ${btn(lang, "available")}  |  🔴 ${btn(lang, "out_stock")}
${t(lang, "select_product")}:`;
  const markup = { inline_keyboard: rows };
  if (messageId) return await editMessage(chatId, messageId, text, markup);
  return await sendMessage(chatId, text, markup);
}
function productDetailsText(p, lang = "dual") {
  const inStock = Number(p.stock || 0) > 0;
  const warranty = p.warranty === "YES" ? `${p.warranty_days || 30} days` : "-";
  const desc = productDescription(p, lang);
  const shortDesc = String(desc).length > 650 ? `${String(desc).slice(0, 650)}...` : desc;
  return `✨ ${STORE_NAME}
${STORE_SUBTITLE}

🔮 ${productName(p, lang)}

💵 ${btn(lang, "price")}: $${money(p.price)} USDT
📦 ${btn(lang, "stock")}: ${p.stock}
${inStock ? "🟢 " + btn(lang, "available") : "🔴 " + btn(lang, "out_stock")}
🚚 ${btn(lang, "delivery")}: ${p.delivery_mode === "auto" ? btn(lang, "auto_delivery") : btn(lang, "manual_delivery")}
🛡 ${btn(lang, "warranty")}: ${warranty}
⏳ ${btn(lang, "duration")}: ${p.duration}

━━━━━━━━━━━━━━
${shortDesc}

🧾 ${btn(lang, "product_id")}: ${p.product_id}`;
}
function productKeyboard(p, lang = "dual") {
  const rows = [];
  if (Number(p.stock || 0) > 0) rows.push([{ text: `🛒 ${btn(lang, "buy_now")}`, callback_data: `buy_${p.product_id}` }]);
  else rows.push([{ text: `🔴 ${btn(lang, "out_stock")}`, callback_data: "noop" }]);
  rows.push([{ text: `↩️ ${btn(lang, "back_store")}`, callback_data: `products_p${p.page || 1}` }]);
  return { inline_keyboard: rows };
}
async function showProduct(chatId, productId, previousMessageId = null) {
  const lang = await langOf(chatId);
  const p = await findProduct(productId);
  if (!p) return await sendMessage(chatId, `⚠️ ${t(lang, "product_not_found")}`);
  return await sendCard(chatId, productDetailsText(p, lang), productKeyboard(p, lang), p.image_url, previousMessageId);
}
function quantityKeyboard(p, lang = "dual") {
  const stock = Number(p.stock || 0);
  const choices = [1, 2, 3, 5, 10, 15, 20, 25].filter((q) => q <= stock);
  const rows = [];
  for (let i = 0; i < choices.length; i += 4) {
    rows.push(choices.slice(i, i + 4).map((q) => ({ text: `📦 ${q}`, callback_data: `qty_${p.product_id}_${q}` })));
  }
  if (!choices.length) rows.push([{ text: `🔴 ${btn(lang, "out_stock")}`, callback_data: "noop" }]);
  rows.push([{ text: `↩️ ${btn(lang, "back_product")}`, callback_data: `product_${p.product_id}` }, { text: `🏠 ${btn(lang, "home")}`, callback_data: "menu" }]);
  return { inline_keyboard: rows };
}
async function showQuantity(chatId, productId, previousMessageId = null) {
  const lang = await langOf(chatId);
  const p = await findProduct(productId);
  if (!p) return await sendMessage(chatId, `⚠️ ${t(lang, "product_not_found")}`);
  const text = `🛒 ${t(lang, "select_qty")}

📦 ${productName(p, lang)}
💵 $${money(p.price)} USDT
📦 ${btn(lang, "stock")}: ${p.stock}

${productDescription(p, lang)}

${t(lang, "how_many")}`;
  return await sendCard(chatId, text, quantityKeyboard(p, lang), p.image_url, previousMessageId);
}
function parseQty(data) {
  const rest = data.replace(/^qty_/, "");
  const last = rest.lastIndexOf("_");
  return { productId: rest.slice(0, last), qty: Number(rest.slice(last + 1)) };
}
async function showSummary(chatId, data, previousMessageId = null) {
  const lang = await langOf(chatId);
  const { productId, qty } = parseQty(data);
  const p = await findProduct(productId);
  if (!p) return await sendMessage(chatId, `⚠️ ${t(lang, "product_not_found")}`);
  if (qty < 1 || qty > Number(p.stock || 0)) return await sendMessage(chatId, `🔴 ${t(lang, "qty_not_available")}. ${btn(lang, "stock")}: ${p.stock}`);
  const total = Number(p.price) * qty;
  const text = `🧾 ${t(lang, "order_summary")}

📦 ${productName(p, lang)}
📦 ${btn(lang, "quantity")}: ${qty}
💵 ${btn(lang, "total")}: $${money(total)} USDT

${productDescription(p, lang)}`;
  const markup = { inline_keyboard: [
    [{ text: `✅ ${btn(lang, "confirm_pay")}`, callback_data: `confirm_${productId}_${qty}` }],
    [{ text: `↩️ ${btn(lang, "change_qty")}`, callback_data: `buy_${productId}` }, { text: `🏠 ${btn(lang, "home")}`, callback_data: "menu" }],
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
  const lang = await langOf(chatId);
  const order = {
    order_id: makeOrderId(),
    chat_id: String(chatId),
    user_id: String(from?.id || chatId),
    username: from?.username || "",
    first_name: from?.first_name || "",
    product_id: productId,
    product_name: productName(p, lang).replace(/\n/g, " / "),
    qty: Number(qty),
    amount: Number(p.price) * Number(qty),
    currency: p.currency || "USDT",
    status: "WAITING_PAYMENT_REF",
    delivery_status: "WAITING_PAYMENT",
    payment_method: "",
    payment_reference: "",
    payment_reference_type: "",
    txid: "",
    lang,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await storeSet(["active_order", String(chatId)], order);
  await storeSet(["orders", order.order_id], order);
  return order;
}
async function showPayment(chatId, from, data, previousMessageId = null) {
  const lang = await langOf(chatId);
  const { productId, qty } = parsePay(data, "confirm");
  let order;
  try {
    order = await createOrder(chatId, from, productId, qty);
  } catch (e) {
    return await sendMessage(chatId, `❌ ${e.message}`);
  }
  const p = await findProduct(productId, true);
  const text = `🟡 ${t(lang, "binance_deposit")}

🎯 ${btn(lang, "product")}: ${order.product_name} x ${order.qty}
💵 ${btn(lang, "amount")}: ${money(order.amount)} USDT
🧾 ${btn(lang, "order_id")}: ${order.order_id}

━━━━━━━━━━━━━━
🏦 Binance Pay / Binance ID
1️⃣ Open Binance Pay
2️⃣ Send to UID: ${BINANCE_UID}
3️⃣ Amount: ${money(order.amount)} USDT
4️⃣ Copy the Order ID / CXID and send it here

━━━━━━━━━━━━━━
🟢 USDT Deposit / Wallet Transfer
1️⃣ Send USDT to this address:
${BINANCE_ADDRESS}

${btn(lang, "network")}: ${BINANCE_NETWORK}
${btn(lang, "amount")}: ${money(order.amount)} USDT
2️⃣ Copy the TXID / Transaction Hash and send it here

${t(lang, "send_txid")}

⚠️ ${t(lang, "exact_amount")}.`;
  const markup = { inline_keyboard: [
    [{ text: `✅ ${btn(lang, "i_paid")}`, callback_data: `paid_${order.order_id}` }],
    [{ text: `❌ ${btn(lang, "cancel_order")}`, callback_data: "cancel_order" }, { text: `🏠 ${btn(lang, "home")}`, callback_data: "menu" }],
  ] };
  return await sendCard(chatId, text, markup, p?.image_url || "", previousMessageId);
}
async function markPaidPrompt(chatId, orderId, previousMessageId = null) {
  const lang = await langOf(chatId);
  const order = await storeGet(["orders", orderId]);
  if (!order || String(order.chat_id) !== String(chatId)) return await sendMessage(chatId, `⚠️ ${t(lang, "order_not_found")}`);
  const next = { ...order, status: "WAITING_PAYMENT_REF", lang, updated_at: nowIso() };
  await storeSet(["active_order", String(chatId)], next);
  await storeSet(["orders", order.order_id], next);
  return await sendCard(chatId, `✅ ${t(lang, "order_summary")}

${t(lang, "send_txid")}

Examples:
• Binance Pay Order ID: 440449074789163008
• CXID: CX123456789
• TXID: 0xabc123...

${btn(lang, "order_id")}: ${order.order_id}`, undefined, "", previousMessageId);
}
async function cancelOrder(chatId) {
  const lang = await langOf(chatId);
  await storeDelete(["active_order", String(chatId)]);
  return await sendCard(chatId, `❌ ${t(lang, "order_cancelled")}`, homeKeyboard(lang));
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
function classifyPaymentRef(ref) {
  const s = String(ref || "").trim();
  if (/^0x[a-fA-F0-9]{8,}$/.test(s)) return "TXID";
  if (/^[0-9]{10,30}$/.test(s)) return "BINANCE_PAY_ORDER_ID";
  if (/^(cx|cxid|ord|bp|pay)?[-_A-Za-z0-9]{6,60}$/i.test(s) && /[0-9]/.test(s)) return "CXID";
  return "INVALID";
}
function normalizePaymentRef(ref) {
  return String(ref || "").trim().toLowerCase().replace(/\s+/g, "");
}
async function findUsedPaymentRef(ref, refType, currentOrderId = "") {
  const normalized = normalizePaymentRef(ref);
  if (!normalized || refType === "INVALID") return null;

  const direct = await storeGet(["payment_refs", refType, normalized]);
  if (direct && String(direct.order_id || "") !== String(currentOrderId || "")) return direct;

  // Backward compatibility: detect payment references saved before this protection was added.
  const orders = (await storeList(["orders"])).map((x) => x.value);
  for (const o of orders) {
    if (!o || String(o.order_id || "") === String(currentOrderId || "")) continue;
    const refs = [o.payment_reference, o.txid].filter(Boolean).map(normalizePaymentRef);
    if (refs.includes(normalized)) {
      return {
        order_id: o.order_id,
        chat_id: o.chat_id,
        user_id: o.user_id,
        username: o.username || "",
        status: o.status || "",
        delivery_status: o.delivery_status || "",
        used_at: o.updated_at || o.created_at || "",
        ref_type: o.payment_reference_type || refType,
      };
    }
  }
  return null;
}
async function claimPaymentRef(order, ref, refType) {
  const normalized = normalizePaymentRef(ref);
  const record = {
    ref: String(ref || "").trim(),
    normalized,
    ref_type: refType,
    order_id: order.order_id,
    chat_id: String(order.chat_id || ""),
    user_id: String(order.user_id || ""),
    username: order.username || "",
    product_id: order.product_id || "",
    product_name: order.product_name || "",
    amount: order.amount || 0,
    currency: order.currency || "USDT",
    status: order.status || "WAITING_PAYMENT_REF",
    claimed_at: nowIso(),
  };
  await storeSet(["payment_refs", refType, normalized], record);
  return record;
}
function duplicatePaymentMessage(lang, used, refType) {
  const label = refType === "TXID" ? "TXID" : "Order ID / CXID";
  if (lang === "ar") {
    return `⚠️ هذا ${label} مستخدم قبل هيك.

لا يمكن استخدام نفس رقم الدفع لأكثر من طلب.

الطلب السابق: ${used?.order_id || "غير معروف"}
الحالة: ${used?.status || "مسجل"}

إذا في خطأ، تواصلي مع الدعم.`;
  }
  if (lang === "dual") {
    return `⚠️ This ${label} was already used before.

You cannot use the same payment reference for more than one order.

Previous order: ${used?.order_id || "Unknown"}
Status: ${used?.status || "Recorded"}

If this is a mistake, contact support.

━━━━━━━━━━━━━━

⚠️ هذا ${label} مستخدم قبل هيك.

لا يمكن استخدام نفس رقم الدفع لأكثر من طلب.

الطلب السابق: ${used?.order_id || "غير معروف"}
الحالة: ${used?.status || "مسجل"}

إذا في خطأ، تواصلي مع الدعم.`;
  }
  return `⚠️ This ${label} was already used before.

You cannot use the same payment reference for more than one order.

Previous order: ${used?.order_id || "Unknown"}
Status: ${used?.status || "Recorded"}

If this is a mistake, contact support.`;
}
function approveKeyboard(orderId) {
  return { inline_keyboard: [
    [{ text: "✅ Approve payment", callback_data: `admin_approve_${orderId}` }],
    [{ text: "❌ Reject payment", callback_data: `admin_reject_${orderId}` }],
    [{ text: "📮 Pending", callback_data: "admin_pending" }, { text: "🧾 Orders", callback_data: "admin_orders" }],
  ] };
}
async function sendPaymentToAdmin(order, ref, refType, from) {
  if (!ADMIN_ID) return;
  const label = refType === "TXID" ? "TXID" : "Binance Pay Order ID / CXID";
  await sendMessage(ADMIN_ID, `🟡 Payment proof submitted

Order: ${order.order_id}
Customer: ${from?.first_name || order.first_name || ""} @${from?.username || order.username || "-"}
User ID: ${order.user_id}
Chat ID: ${order.chat_id}

Product: ${order.product_name}
Qty: ${order.qty}
Amount: ${money(order.amount)} ${order.currency}

${label}: ${ref}

${refType === "TXID" ? "Automatic checker failed or is unavailable. Review manually if needed." : "Review Binance Pay history, then approve or reject."}`, approveKeyboard(order.order_id));
}
async function handlePaymentReference(chatId, text, from) {
  const order = await storeGet(["active_order", String(chatId)]);
  if (!order || !["WAITING_PAYMENT_REF", "WAITING_TXID", "PAYMENT_REJECTED"].includes(order.status)) return false;
  const lang = order.lang || await langOf(chatId);
  const ref = String(text || "").trim();
  const refType = classifyPaymentRef(ref);
  if (refType === "INVALID") return await sendMessage(chatId, `⚠️ ${t(lang, "valid_txid")}`);

  const used = await findUsedPaymentRef(ref, refType, order.order_id);
  if (used) {
    await sendMessage(chatId, duplicatePaymentMessage(lang, used, refType));
    if (ADMIN_ID) {
      await sendMessage(ADMIN_ID, `🚫 Duplicate payment reference blocked

Current order: ${order.order_id}
User: ${from?.first_name || ""} @${from?.username || order.username || "-"}
User ID: ${order.user_id}
Chat ID: ${order.chat_id}

Reference type: ${refType}
Reference: ${ref}

Already used on: ${used.order_id || "Unknown"}
Previous status: ${used.status || "Recorded"}`);
    }
    return true;
  }

  await claimPaymentRef(order, ref, refType);

  order.payment_reference = ref;
  order.payment_reference_type = refType;
  order.txid = refType === "TXID" ? ref : "";
  order.status = refType === "TXID" ? "CHECKING_TXID" : "WAITING_ADMIN_APPROVAL";
  order.updated_at = nowIso();
  await storeSet(["orders", order.order_id], order);
  await storeSet(["active_order", String(chatId)], order);

  if (refType === "TXID") {
    await sendMessage(chatId, `🔎 ${t(lang, "checking")}`);
    const result = await checkBinanceDeposit({ coin: "USDT", expectedAmount: Number(order.amount), txId: ref });
    if (result.paid) {
      const delivery = await fulfillOrder(order, ref, result);
      await storeDelete(["active_order", String(chatId)]);
      await sendMessage(chatId, delivery.text);
      if (ADMIN_ID) await sendMessage(ADMIN_ID, `✅ Paid order

Order: ${order.order_id}
User: ${from?.first_name || ""} @${from?.username || ""}
User ID: ${order.user_id}
Chat ID: ${order.chat_id}
Product: ${order.product_name}
Qty: ${order.qty}
Amount: ${money(order.amount)} USDT
TXID: ${ref}
Delivery: ${delivery.adminText}`);
      return true;
    }
    if (result.status === "AMOUNT_MISMATCH") return await sendMessage(chatId, `⚠️ ${t(lang, "amount_wrong")}.
${btn(lang, "amount")}: ${money(result.amount)} USDT
Expected: ${money(result.expectedAmount)} USDT`);
    order.status = "WAITING_ADMIN_APPROVAL";
    order.binance_check = result;
    order.updated_at = nowIso();
    await storeSet(["orders", order.order_id], order);
    await sendMessage(chatId, `🟡 Your payment reference was received.

We could not verify it automatically yet. Admin will review it shortly.

Order: ${order.order_id}`);
    await sendPaymentToAdmin(order, ref, refType, from);
    return true;
  }

  await sendMessage(chatId, `✅ Order ID / CXID received.

Your payment is now waiting for admin confirmation.

Order: ${order.order_id}`);
  await sendPaymentToAdmin(order, ref, refType, from);
  return true;
}
async function approveOrder(chatId, orderId) {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const order = await storeGet(["orders", orderId]);
  if (!order) return await sendMessage(chatId, `❌ Order not found: ${orderId}`);
  if (["PAID", "DELIVERED_AUTO", "DELIVERED_MANUAL"].includes(order.status) || String(order.delivery_status || "").startsWith("DELIVERED")) {
    return await sendMessage(chatId, `⚠️ Order already processed: ${orderId}`);
  }
  const ref = order.payment_reference || order.txid || "ADMIN_APPROVED";
  const delivery = await fulfillOrder(order, ref, { paid: true, status: "MANUAL_APPROVED", reference: ref, type: order.payment_reference_type || "ADMIN" });
  await storeDelete(["active_order", String(order.chat_id)]);
  await sendMessage(order.chat_id, delivery.text);
  return await sendMessage(chatId, `✅ Approved and processed

Order: ${order.order_id}
Customer chat: ${order.chat_id}
Delivery: ${delivery.adminText}`);
}
async function rejectOrder(chatId, orderId, reason = "Payment could not be confirmed") {
  if (!isAdmin(chatId)) return await sendMessage(chatId, "⚠️ Admin only.");
  const order = await storeGet(["orders", orderId]);
  if (!order) return await sendMessage(chatId, `❌ Order not found: ${orderId}`);
  order.status = "PAYMENT_REJECTED";
  order.delivery_status = "WAITING_PAYMENT";
  order.reject_reason = reason;
  order.updated_at = nowIso();
  await storeSet(["orders", order.order_id], order);
  await storeSet(["active_order", String(order.chat_id)], { ...order, status: "WAITING_PAYMENT_REF" });
  const lang = order.lang || "dual";
  await sendMessage(order.chat_id, `❌ Payment was not confirmed.

Reason: ${reason}

${t(lang, "send_txid")}

Order: ${order.order_id}`);
  return await sendMessage(chatId, `❌ Rejected
${order.order_id}`);
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
/approve ORD-XXXX
/reject ORD-XXXX reason
/duration product_id 1 Month
/setdelivery product_id Instant
/setwarranty product_id 30
/discount product_id -20%
/button product_id Button name
/page product_id 1
/users

🛡 Duplicate payment protection: ON
Same TXID / Order ID / CXID cannot be reused.`, adminKeyboard());
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
async function adminSetName(chatId, text) {
  const match = text.match(/^\/setname\s+(\S+)\s+(en|ar|vi|hi|ur)\s+([\s\S]+)$/i);
  if (!match) return await sendMessage(chatId, "❌ /setname chatgpt_plus en ChatGPT Plus");
  const [, productId, lang, name] = match;
  const p = await findProduct(productId, true);
  if (!p) return await sendMessage(chatId, `❌ Product not found: ${productId}`);
  await setProductState(productId, { [`name_${lang}`]: name.trim() });
  return await sendMessage(chatId, `✅ Name updated\n${productId} / ${lang}\n${name.trim()}`);
}
async function adminSetDesc(chatId, text) {
  const match = text.match(/^\/setdesc\s+(\S+)\s+(en|ar|vi|hi|ur)\s+([\s\S]+)$/i);
  if (!match) return await sendMessage(chatId, "❌ /setdesc chatgpt_plus en Description here");
  const [, productId, lang, desc] = match;
  const p = await findProduct(productId, true);
  if (!p) return await sendMessage(chatId, `❌ Product not found: ${productId}`);
  await setProductState(productId, { [`description_${lang}`]: desc.trim() });
  return await sendMessage(chatId, `✅ Description updated\n${productId} / ${lang}`);
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
Payment ref: ${o.payment_reference || o.txid || "-"}
Ref type: ${o.payment_reference_type || "-"}

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
  const lang = order.lang || "dual";
  const customerText = `🎁 ${t(lang, "product_ready")}

📦 ${order.product_name} x${order.qty}
🧾 ${btn(lang, "order_id")}: ${order.order_id}

━━━━━━━━━━━━━━
${delivery}
━━━━━━━━━━━━━━

${t(lang, "need_help")} ${SUPPORT_HANDLE}`;
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
  if (text.startsWith("/setname ")) return await adminSetName(chatId, text);
  if (text.startsWith("/setdesc ")) return await adminSetDesc(chatId, text);
  if (text.startsWith("/duration ")) return await adminSetDuration(chatId, text);
  if (text.startsWith("/setdelivery ")) return await adminSetDelivery(chatId, text);
  if (text.startsWith("/setwarranty ")) return await adminSetWarranty(chatId, text);
  if (text.startsWith("/discount ")) return await adminSetDiscount(chatId, text);
  if (text.startsWith("/button ")) return await adminSetButton(chatId, text);
  if (text.startsWith("/page ")) return await adminSetPage(chatId, text);
  if (text.startsWith("/approve ")) { const [, oid] = text.split(/\s+/); return await approveOrder(chatId, String(oid || "").toUpperCase()); }
  if (text.startsWith("/reject ")) { const m = text.match(/^\/reject\s+(ORD-[A-Z0-9]+)(?:\s+([\s\S]+))?$/i); if (!m) return await sendMessage(chatId, "❌ /reject ORD-XXXXXXXXXX reason"); return await rejectOrder(chatId, m[1].toUpperCase(), m[2] || "Payment could not be confirmed"); }
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
  return text === "/admin" || text === "/stock" || text === "/orders" || text === "/pending" || text === "/users" || text === "/stats" || text === "/adminhelp" || /^\/(setstock|addstock|price|hide|show|image|setname|setdesc|duration|setdelivery|setwarranty|discount|button|page|approve|reject|mode|additem|items|order|deliver|addproduct|broadcast)\s/.test(text);
}

async function showMyOrders(chatId) {
  const lang = await langOf(chatId);
  const orders = (await storeList(["orders"]))
    .map((x) => x.value)
    .filter((o) => String(o.chat_id) === String(chatId))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 5);
  if (!orders.length) return await sendMessage(chatId, `${t(lang, "no_orders")}\n/products`);
  const text = `🧾 ${t(lang, "my_orders")}

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
  const lower = text.toLowerCase();
  if (text === "/start" || lower === "start" || text === "/menu") return await showHome(chatId);
  if (text === "/products") return await showProductsPage(chatId, 1);
  if (text === "/language" || text === "/lang") return await showLanguage(chatId);
  if (text === "/myorders") return await showMyOrders(chatId);
  if (text === "/support") {
    const lang = await langOf(chatId);
    return await sendCard(chatId, `🎧 ${t(lang, "support")}\n${SUPPORT_HANDLE}`, homeKeyboard(lang));
  }
  if (await handlePaymentReference(chatId, text, message.from)) return;
  const lang = await langOf(chatId);
  return await sendMessage(chatId, t(lang, "use_commands"));
}
async function handleCallback(q) {
  const chatId = q.message?.chat?.id;
  const messageId = q.message?.message_id;
  const data = String(q.data || "");
  if (!chatId) return;
  await registerUser(q.message.chat, q.from);
  await answerCallback(q.id);
  if (data === "noop") return;
  if (data === "language") return await showLanguage(chatId, messageId);
  if (data.startsWith("lang_")) {
    const selected = data.replace("lang_", "");
    const lang = await setLang(chatId, selected);
    return await sendCard(chatId, `✅ ${t(lang, "language_saved")}\n${LANGS[lang].label}`, homeKeyboard(lang), "", messageId);
  }
  if (data === "menu") return await showHome(chatId);
  if (data === "support") {
    const lang = await langOf(chatId);
    return await sendCard(chatId, `🎧 ${t(lang, "support")}\n${SUPPORT_HANDLE}`, homeKeyboard(lang), "", messageId);
  }
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
  if (data.startsWith("admin_approve_")) return await approveOrder(chatId, data.replace("admin_approve_", ""));
  if (data.startsWith("admin_reject_")) return await rejectOrder(chatId, data.replace("admin_reject_", ""));
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