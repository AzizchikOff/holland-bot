require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const mongoose    = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const path        = require("path");
const crypto      = require("crypto");
const { getReportBuffer } = require("./reports");

const app          = express();
const PORT         = process.env.PORT || 3000;
const ADMIN_ID     = Number(process.env.ADMIN_ID);
const BOT_TOKEN    = process.env.BOT_TOKEN;
const WEBHOOK_URL  = process.env.WEBHOOK_URL;
const MINI_APP_URL = process.env.MINI_APP_URL || "https://holland-namangan.netlify.app/app/";
const IMG_BASE     = process.env.IMG_BASE || "https://holland-namangan.netlify.app/images";

// ✅ FIX 1e: Default parol yo'q — albatta .env da bo'lishi shart
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_PASS) { console.error("❌ ADMIN_PASS env o'zgaruvchisi yo'q!"); process.exit(1); }

// ✅ FIX 5: BOT_TOKEN tekshiruvi — aks holda new TelegramBot(undefined) yiqiladi
if (!BOT_TOKEN) { console.error("❌ BOT_TOKEN env o'zgaruvchisi yo'q!"); process.exit(1); }
if (!process.env.TOKEN_SECRET || process.env.TOKEN_SECRET.length < 32) { console.error("❌ TOKEN_SECRET kamida 32 belgidan iborat bo‘lishi shart!"); process.exit(1); }
if (!process.env.MONGO_URI) { console.error("❌ MONGO_URI env o'zgaruvchisi yo'q!"); process.exit(1); }
if (!ADMIN_ID) { console.warn("⚠️ ADMIN_ID yo'q — buyurtmalar hech kimga yuborilmaydi!"); }

const isProduction = !!WEBHOOK_URL;
const bot = isProduction
  ? new TelegramBot(BOT_TOKEN, { webHook: { port: false } })
  : new TelegramBot(BOT_TOKEN, { polling: true });

// ✅ FIX: CORS faqat ruxsat etilgan domenlar
app.use(cors({
  origin: [
    "https://holland-namangan.netlify.app",
    "https://holland-bot.onrender.com",
    ...(isProduction ? [] : ["http://localhost:5173", "http://localhost:3000"]),
  ],
  methods: ["GET","POST","PATCH"],
}));
app.disable("x-powered-by");
// Security headers for the admin UI and JSON API; no CSP yet because the admin UI uses inline scripts.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ✅ FIX: Oddiy rate-limiter (express-rate-limit o'rnatmay)
const rateLimitMap = new Map();
function rateLimit(ip, maxPerMinute = 10) {
  const now = Date.now();
  const key = String(ip || "unknown");
  if (rateLimitMap.size > 10000) {
    for (const [k, value] of rateLimitMap) if (value.resetAt < now) rateLimitMap.delete(k);
  }
  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count > maxPerMinute;
}

// ══════════════════════════════════════════
//  MongoDB
// ══════════════════════════════════════════
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB ulandi"))
  .catch(e => { console.error("❌ MongoDB:", e.message); process.exit(1); });

const UserSchema = new mongoose.Schema({
  userId:    { type: Number, unique: true },
  firstName: String,
  username:  String,
  joinedAt:  { type: Date, default: Date.now },
});
const User = mongoose.model("User", UserSchema);

const OrderSchema = new mongoose.Schema({
  userId:        Number,
  name:          String,
  phone:         String,
  address:       String,
  note:          { type: String, default: "" },
  gpsLat:        Number,
  gpsLng:        Number,
  items:         Array,   // { name, qty, price } — narx serverdan
  total:         Number,  // serverda hisoblangan
  status:        { type: String, default: "new" },
  source:        { type: String, default: "miniapp" },
  paymentMethod: { type: String, default: "cash" },
}, { timestamps: true });

// ✅ FIX: Indekslar
OrderSchema.index({ userId: 1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1 });
const Order = mongoose.model("Order", OrderSchema);

// ══════════════════════════════════════════
//  MENU — yagona manba (server + bot + API)
// ══════════════════════════════════════════
const CATEGORIES = [
  { id: "free", label: "Holland Free",  desc: "Issiq va mazali kartoshka fri" },
  { id: "burger", label: "Burger",        desc: "Shirador burger va sandvichlar" },
  { id: "hotdog", label: "Hot-dog",       desc: "Klassik va asl hot-doglar" },
  { id: "sous", label: "Sous",          desc: "Turli xil sous va qo'shimchalar" },
  { id: "drink", label: "Ichimliklar",   desc: "Sovuq va shirin ichimliklar" },
];

const MENU = [
  { id:"1",  cat:"free",   name:"Free Holland",              price:19000,  img:"free-classik.jpg"     },
  { id:"2",  cat:"free",   name:"Free Holland Big",          price:23000,  img:"free-classik.jpg"     },
  { id:"3",  cat:"free",   name:"Free Holland Special",      price:35000,  img:"special.jpg"          },
  { id:"4",  cat:"free",   name:"Loaded Fries",              price:32000,  img:"loaded.png"           },
  { id:"5",  cat:"free",   name:"Loaded Fries & Sausage",    price:28000,  img:"Loaded fries.jpg"     },
  { id:"6",  cat:"free",   name:"Loaded Cheese",             price:26000,  img:"loaded-cheese.jpg"    },
  { id:"7",  cat:"free",   name:"Chicken Cheese",            price:42000,  img:"Chickencheese.jpg"    },
  { id:"8",  cat:"free",   name:"Crispy Chicken",            price:38000,  img:"crispy.jpg"           },
  { id:"9",  cat:"free",   name:"Beef Box",                  price:55000,  img:"bifbox.jpg"           },
  { id:"13", cat:"free",   name:"Kapsalan (lahm)",           price:75000,  img:"kapsalan.jpg"         },
  { id:"14", cat:"free",   name:"Kapsalan (qiyma)",          price:58000,  img:"kapsalan.jpg"         },
  { id:"15", cat:"free",   name:"Berlin Style (lahm)",       price:58000,  img:"berlin.jpg"           },
  { id:"16", cat:"free",   name:"Berlin Style (qiyma)",      price:48000,  img:"berlin.jpg"           },
  { id:"17", cat:"free",   name:"Briosh Steak Box",          price:65000,  img:"BrioshSteak.jpg"      },
  { id:"10", cat:"burger", name:"Chicken Burger",            price:35000,  img:"burger.jpg"           },
  { id:"19", cat:"burger", name:"Bon File (lahm)",           price:48000,  img:"Bonfile.jpg"          },
  { id:"20", cat:"burger", name:"Bon File (qiyma)",          price:38000,  img:"Bonfile.jpg"          },
  { id:"11", cat:"hotdog", name:"Hot-Dog Classic",           price:15000,  img:"hotdog.jpg"           },
  { id:"12", cat:"hotdog", name:"Hot-Dog Canada",            price:20000,  img:"hotdog-canada.jpg"    },
  { id:"18", cat:"hotdog", name:"Free-Dog",                  price:28000,  img:"free-dog.jpg"         },
  { id:"21", cat:"sous",   name:"Berlin Sous",               price:4000,   img:"berlinSous.png"       },
  { id:"22", cat:"sous",   name:"Burger Sous",               price:4000,   img:"burgerSous.png"       },
  { id:"23", cat:"sous",   name:"BBQ Sous",                  price:4000,   img:"bbq.png"              },
  { id:"24", cat:"sous",   name:"Ketchup-Mayonez",           price:4000,   img:"ketchup.png"          },
  { id:"25", cat:"drink",  name:"Sprite Mojito 0.5L",        price:8000,   img:"sprite-moxito.jpg"    },
  { id:"26", cat:"drink",  name:"Sprite 0.5L",               price:8000,   img:"sprite.jpg"           },
  { id:"27", cat:"drink",  name:"Sprite 0.25L",              price:7000,   img:"sprite-banochniy.jpg" },
  { id:"28", cat:"drink",  name:"Fanta 0.25L (banka)",   price:7000,   img:"fanta-banochniy.jpg"  },
  { id:"30", cat:"drink",  name:"Fanta 0.25L (plastik)",     price:10000,  img:"fanta.jpg"            },
  { id:"32", cat:"drink",  name:"Coca Cola 0.25L (banka)",           price:7000,   img:"cola-banochniy.jpg"   },
  { id:"34", cat:"drink",  name:"Coca Cola (shisha)",        price:10000,  img:"cola.jpg"             },
  { id:"35", cat:"drink",  name:"Fuse Tea 0.5L",             price:10000,  img:"fusetea-banochniy.jpg"},
  { id:"37", cat:"drink",  name:"Bonaqua 0.5L",              price:3000,   img:"bon-aqua.jpg"         },
  { id:"38", cat:"drink",  name:"Cappy Pulpy 0.5L",          price:8000,   img:"cappy.jpg"            },
];

// ✅ FIX 1a: Narxni serverda hisoblash
const MENU_MAP = Object.fromEntries(MENU.map(m => [m.id, m]));

function calcOrder(clientItems) {
  const errors = [];
  const items  = [];
  let total    = 0;

  for (const it of clientItems) {
    const menuItem = MENU_MAP[String(it.id || it.productId)];
    if (!menuItem) { errors.push(`Noma'lum mahsulot: ${it.id}`); continue; }
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) { errors.push("Mahsulot miqdori noto'g'ri"); continue; }
    const lineTotal = menuItem.price * qty;
    total += lineTotal;
    items.push({ id: menuItem.id, name: menuItem.name, price: menuItem.price, qty });
  }

  return { items, total, errors };
}

// ✅ FIX 2d: Markdown escape
function escMd(text) {
  return String(text || "").replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function fmt(n) { return new Intl.NumberFormat("uz-UZ").format(n); }

// ✅ FIX 1d: XSS uchun HTML escape
function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATUS = {
  new:       "🆕 Yangi",
  accepted:  "✅ Qabul qilindi",
  cooking:   "🍳 Tayyorlanmoqda",
  delivered: "🚀 Yetkazildi",
  cancelled: "❌ Bekor qilindi",
};

// ══════════════════════════════════════════
//  ADMIN TOKEN — signed, expiring sessions
// ══════════════════════════════════════════
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const SSE_TICKET_MS = 60 * 1000;
function signAdmin(value) {
  return crypto.createHmac("sha256", process.env.TOKEN_SECRET)
    .update("holland-admin:" + ADMIN_PASS + ":" + value).digest("hex");
}
function createSignedToken(purpose, ttl) {
  const expires = Date.now() + ttl;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = purpose + "." + expires + "." + nonce;
  return payload + "." + signAdmin(payload);
}
function verifySignedToken(token, purpose) {
  if (typeof token !== "string" || token.length > 300) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== purpose || !/^\d{13}$/.test(parts[1]) ||
      !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false;
  const expires = Number(parts[1]);
  const ttl = purpose === "sse" ? SSE_TICKET_MS : ADMIN_SESSION_MS;
  if (expires <= Date.now() || expires > Date.now() + ttl) return false;
  const expected = signAdmin(parts.slice(0, 3).join("."));
  return crypto.timingSafeEqual(Buffer.from(parts[3], "hex"), Buffer.from(expected, "hex"));
}
function checkBearer(req) {
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") && verifySignedToken(auth.slice(7), "admin");
}
function checkSseToken(req) {
  return verifySignedToken(req.query.token, "sse");
}

// ══════════════════════════════════════════
//  TELEGRAM initData TEKSHIRUVI (HMAC-SHA256)
//  ✅ FIX 1b: userId ni soxtalashtirib bo'lmaydi
//  Rasmiy algoritm: core.telegram.org/bots/webapps#validating-data
// ══════════════════════════════════════════
function verifyTelegramInitData(initData) {
  if (!initData || typeof initData !== "string") return null;
  try {
    const params = new URLSearchParams(initData);
    const hash   = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    // Kalitlarni alifbo tartibida joylash
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const computed  = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computed !== hash) return null;

    // auth_date — 24 soatdan eski bo'lmasin
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

    const userRaw = params.get("user");
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════
//  SSE
// ══════════════════════════════════════════
const clients      = new Map();
const adminClients = new Set();

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, []);
  clients.get(userId).push(res);
}
function removeClient(userId, res) {
  if (!clients.has(userId)) return;
  const list = clients.get(userId).filter(r => r !== res);
  if (!list.length) clients.delete(userId); else clients.set(userId, list);
}
function sendToUser(userId, event, data) {
  (clients.get(userId) || []).forEach(res => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  });
}
function sendToAdmin(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  adminClients.forEach(res => { try { res.write(msg); } catch {} });
}
function broadcastStats() {
  (async () => {
    // ✅ FIX: Ulangan mijoz bo'lmasа skip
    if (clients.size === 0 && adminClients.size === 0) return;
    const [users, orders] = await Promise.all([User.countDocuments(), Order.countDocuments()]);
    const msg = `event: stats\ndata: ${JSON.stringify({ users, orders })}\n\n`;
    clients.forEach(list => list.forEach(res => { try { res.write(msg); } catch {} }));
    adminClients.forEach(res => { try { res.write(msg); } catch {} });
  })();
}
setInterval(broadcastStats, 30000);

// ✅ FIX 1c: SSE — faqat o'z buyurtmalarini ko'ra oladi (Telegram initData tekshiruvi)
app.get("/api/stream/:userId", (req, res) => {
  const userId = Number(req.params.userId);

  // ✅ FIX 1c: SSE ham himoyalangan — faqat o'z ma'lumotlarini oladi
  const tgUser = verifyTelegramInitData(req.query.initData || "");
  const authorized = tgUser && tgUser.id === userId;

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "https://holland-namangan.netlify.app");
  res.flushHeaders();
  res.write(`event: connected\ndata: {"ok":true}\n\n`);

  (async () => {
    // Statistika hammaga ochiq (shaxsiy ma'lumot emas)
    const [users, orders] = await Promise.all([User.countDocuments(), Order.countDocuments()]);
    res.write(`event: stats\ndata: ${JSON.stringify({ users, orders })}\n\n`);

    // Buyurtmalar faqat tasdiqlangan foydalanuvchiga
    if (authorized) {
      const userOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(10)
        .select("-gpsLat -gpsLng -__v");
      res.write(`event: orders\ndata: ${JSON.stringify(userOrders)}\n\n`);
    }
  })();

  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 20000);
  // Faqat tasdiqlangan foydalanuvchi holat yangilanishlarini oladi
  if (authorized) addClient(userId, res);
  req.on("close", () => { clearInterval(ping); if (authorized) removeClient(userId, res); });
});

app.post("/api/admin/sse-ticket", (req, res) => {
  if (!checkBearer(req)) return res.status(401).json({ error: "Ruxsat yo‘q" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ticket: createSignedToken("sse", SSE_TICKET_MS) });
});

app.get("/api/admin/stream", (req, res) => {
  if (!checkSseToken(req)) return res.status(401).end();
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();
  res.write(`event: connected\ndata: {"ok":true}\n\n`);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 20000);
  adminClients.add(res);
  req.on("close", () => { clearInterval(ping); adminClients.delete(res); });
});

// ══════════════════════════════════════════
//  Keyboards
// ══════════════════════════════════════════
function mainKb() {
  return {
    keyboard: [
      [{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
      [{ text: "📋 Menu ko'rish" }, { text: "📦 Buyurtmalarim" }],
      [{ text: "ℹ️ Biz haqimizda" }, { text: "📞 Bog'lanish" }],
    ],
    resize_keyboard: true, persistent: true,
  };
}
function menuKb() {
  return {
    inline_keyboard: [
      ...CATEGORIES.map(c => [{ text: `${c.label}`, callback_data: `cat_${c.id}` }]),
      [{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
    ],
  };
}
function catProductsKb(catId, page = 0) {
  const items   = MENU.filter(m => m.cat === catId);
  const perPage = 5;
  const start   = page * perPage;
  const rows    = items.slice(start, start + perPage)
    .map(p => [{ text: `${p.name} — ${fmt(p.price)} so'm`, callback_data: `prod_${p.id}` }]);
  const nav = [];
  if (page > 0) nav.push({ text: "⬅️ Ortga", callback_data: `page_${catId}_${page - 1}` });
  if (start + perPage < items.length) nav.push({ text: "Keyingi ➡️", callback_data: `page_${catId}_${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🔙 Kategoriyalar", callback_data: "show_menu" }]);
  rows.push([{ text: "🛒 Buyurtma berish", web_app: { url: MINI_APP_URL } }]);
  return { inline_keyboard: rows };
}
function adminKb(id) {
  return { inline_keyboard: [
    [{ text: "✅ Qabul",          callback_data: `s_${id}_accepted`  },
     { text: "🍳 Tayyorlanmoqda", callback_data: `s_${id}_cooking`   }],
    [{ text: "🚀 Yetkazildi",     callback_data: `s_${id}_delivered` },
     { text: "❌ Bekor",           callback_data: `s_${id}_cancelled` }],
  ]};
}

async function saveUser(msg) {
  try {
    await User.findOneAndUpdate(
      { userId: msg.chat.id },
      { userId: msg.chat.id, firstName: msg.chat.first_name, username: msg.chat.username },
      { upsert: true }
    );
  } catch {}
}

// ══════════════════════════════════════════
//  WEBHOOK
// ══════════════════════════════════════════
if (isProduction) {
  bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
  app.post(`/bot${BOT_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
  console.log("✅ Webhook rejimida");
}

// ══════════════════════════════════════════
//  BOT HANDLERS
// ══════════════════════════════════════════
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id, name = msg.chat.first_name || "Mehmon";
  await saveUser(msg);
  const [userCount, lastOrder] = await Promise.all([
    User.countDocuments(),
    Order.findOne({ userId: id }).sort({ createdAt: -1 }),
  ]);
  let text = `🍔 *Holland Fast Food*\n\nAssalomu alaykum, *${escMd(name)}*\\! 👋\n\n`;
  text += `┌ ⚡ Yetkazib berish: *Buyurtma asosidaa*\n`;
  text += `├ ✅ Mahsulot: *100% Halol*\n`;
  text += `├ 🔥 Taom: *Har doim issiq*\n`;
  text += `└ 👥 Mijozlar: *${userCount} ta*\n\n`;
  if (lastOrder) {
    text += `📦 *So'nggi buyurtma:*\n`;
    text += `\\#${escMd(lastOrder._id.toString().slice(-6).toUpperCase())} — ${STATUS[lastOrder.status]}\n\n`;
  }
  text += `👇 Quyidagi tugmani bosib buyurtma bering\\!`;
  await bot.sendMessage(id, text, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
        [{ text: "📋 Menu ko'rish", callback_data: "show_menu" },
         { text: "📦 Buyurtmalarim", callback_data: "my_orders" }],
      ],
    },
  });
  await bot.sendMessage(id, "Pastdagi tugmalardan ham foydalanishingiz mumkin 👇", { reply_markup: mainKb() });
});

bot.onText(/\/admin/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const [users, total, today, pending, sumArr] = await Promise.all([
    User.countDocuments(), Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: todayStart } }),
    Order.countDocuments({ status: { $in: ["new","accepted","cooking"] } }),
    Order.aggregate([{ $match:{ createdAt:{ $gte: todayStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, t:{ $sum:"$total" } } }]),
  ]);
  await bot.sendMessage(ADMIN_ID,
    `📊 *Holland Admin*\n\n👥 Foydalanuvchilar: *${users}*\n📦 Jami: *${total}*\n📅 Bugun: *${today}*\n⏳ Jarayonda: *${pending}*\n💰 Bugungi tushum: *${fmt(sumArr[0]?.t||0)} so'm*\n\n🌐 [Admin panel](${WEBHOOK_URL}/admin)`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/hisobot/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  const month = new Date().toLocaleString("uz-UZ", { month: "long", year: "numeric" });
  await bot.sendMessage(ADMIN_ID, `📊 *Hisobot — Holland Fast Food*\n\nQaysi davrni yuklab olmoqchisiz?`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [
      [{ text: "☀️ Bugungi",  callback_data: "report_today"   }],
      [{ text: "📅 Haftalik", callback_data: "report_weekly"  }],
      [{ text: `📆 Oylik (${month})`, callback_data: "report_monthly" }],
    ]},
  });
});

bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/") || msg.web_app_data) return;
  await saveUser(msg);
  const id = msg.chat.id, text = msg.text || "";

  if (text === "📋 Menu ko'rish") return bot.sendMessage(id, `🍽 *Menu*\n\nKategoriyani tanlang:`, { parse_mode:"Markdown", reply_markup: menuKb() });
  if (text === "📦 Buyurtmalarim") {
    const orders = await Order.find({ userId: id }).sort({ createdAt: -1 }).limit(5);
    if (!orders.length) return bot.sendMessage(id, "📭 Hali buyurtma berilmagan.", {
      reply_markup: { inline_keyboard: [[{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }]] }
    });
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach(o => {
      txt += `*\\#${escMd(o._id.toString().slice(-6).toUpperCase())}*\n`;
      txt += `└ ${STATUS[o.status]} — ${fmt(o.total)} so'm\n`;
      txt += `   📅 ${o.createdAt.toLocaleDateString("uz-UZ")}\n\n`;
    });
    return bot.sendMessage(id, txt, { parse_mode: "MarkdownV2", reply_markup: mainKb() });
  }
  if (text === "ℹ️ Biz haqimizda") return bot.sendMessage(id,
    `🏪 *Holland Fast Food*\n\n📍 G'alaba ko'chasi 1a, Namangan\n⏰ 11:00 – 01:00\n📞 \\+998 90 699 95 95\n\n✅ 100% Halol mahsulot`,
    { parse_mode: "MarkdownV2", reply_markup: mainKb() }
  );
  if (text === "📞 Bog'lanish") return bot.sendMessage(id,
    `📞 *Bog'lanish:*\n\n📱 \\+998 90 699 95 95\n💬 @Holland\\_fries`,
    { parse_mode: "MarkdownV2", reply_markup: mainKb() }
  );
  return bot.sendMessage(id, "Buyurtma berish uchun quyidagi tugmani bosing 👇", {
    reply_markup: { inline_keyboard: [[{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }]] }
  });
});

bot.on("callback_query", async (q) => {
  const id = q.message.chat.id, data = q.data;
  await bot.answerCallbackQuery(q.id);

  // ── Hisobot ──
  if (data.startsWith("report_") && id === ADMIN_ID) {
    let from = new Date(), title = "", fname = "";
    if (data === "report_today") {
      from.setHours(0,0,0,0);
      title = `Bugungi — ${from.toLocaleDateString("uz-UZ")}`;
      fname = `Holland_bugun_${from.toISOString().slice(0,10)}.xlsx`;
    } else if (data === "report_weekly") {
      from.setDate(from.getDate()-7); from.setHours(0,0,0,0);
      title = `Haftalik (${from.toLocaleDateString("uz-UZ")} — ${new Date().toLocaleDateString("uz-UZ")})`;
      fname = `Holland_haftalik_${new Date().toISOString().slice(0,10)}.xlsx`;
    } else if (data === "report_monthly") {
      from.setDate(1); from.setHours(0,0,0,0);
      title = `Oylik — ${new Date().toLocaleString("uz-UZ",{month:"long",year:"numeric"})}`;
      fname = `Holland_oylik_${new Date().toISOString().slice(0,7)}.xlsx`;
    }
    const orders    = await Order.find({ createdAt: { $gte: from } }).sort({ createdAt: -1 });
    const delivered = orders.filter(o => o.status === "delivered");
    const totalSum  = delivered.reduce((s,o) => s+(o.total||0), 0);
    if (!orders.length) return bot.sendMessage(ADMIN_ID, "📭 Bu davrda buyurtma topilmadi.");
    let txt = `📊 *${escMd(title)}*\n\n`;
    txt += `📦 Jami: *${orders.length}*\n✅ Yetkazilgan: *${delivered.length}*\n`;
    txt += `💰 Tushum: *${fmt(totalSum)} so'm*`;
    await bot.sendMessage(ADMIN_ID, txt, { parse_mode: "MarkdownV2" });
    const buf = await getReportBuffer(orders, data.replace("report_",""), title);
    await bot.sendDocument(ADMIN_ID, Buffer.from(buf),
      { caption: `📎 ${fname}` },
      { filename: fname, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    return;
  }

  // ── Admin holat ──
  if (data.startsWith("s_") && id === ADMIN_ID) {
    const [, oid, status] = data.split("_");
    if (!/^[a-f0-9]{24}$/i.test(oid) || !Object.hasOwn(STATUS, status)) return;
    const order = await Order.findByIdAndUpdate(oid, { status }, { new: true });
    if (!order) return;
    // ✅ FIX 2g: editMessageReplyMarkup xatoligini handle qilish
    try {
      await bot.editMessageReplyMarkup(adminKb(oid), { chat_id: ADMIN_ID, message_id: q.message.message_id });
    } catch (e) { if (!e.message?.includes("not modified")) console.error(e.message); }
    await bot.sendMessage(ADMIN_ID, `✅ \\#${escMd(oid.slice(-6).toUpperCase())} → ${STATUS[status]}`, { parse_mode: "MarkdownV2" });
    sendToUser(order.userId, "order_update", { orderId: oid, status, statusLabel: STATUS[status] });
    sendToAdmin("order_updated", { orderId: oid, status });
    try { await bot.sendMessage(order.userId, `🔔 Buyurtma holati:\n${STATUS[status]}\n\nRahmat\\! 🙏`, { parse_mode: "MarkdownV2" }); } catch {}
    return;
  }

  if (data === "show_menu") {
    await bot.editMessageText(`🍽 *Menu*\n\nKategoriyani tanlang:`, { chat_id: id, message_id: q.message.message_id, parse_mode: "Markdown", reply_markup: menuKb() });
    return;
  }
  if (data.startsWith("cat_")) {
    const catId = data.replace("cat_","");
    const cat   = CATEGORIES.find(c => c.id === catId);
    if (!cat) return;
    await bot.editMessageText(`*${cat.label}*\n${cat.desc}\n\n📦 ${MENU.filter(m=>m.cat===catId).length} ta mahsulot:`,
      { chat_id:id, message_id:q.message.message_id, parse_mode:"Markdown", reply_markup: catProductsKb(catId,0) });
    return;
  }
  if (data.startsWith("page_")) {
    const [,catId,pageStr] = data.split("_");
    try { await bot.editMessageReplyMarkup(catProductsKb(catId, Number(pageStr)), { chat_id:id, message_id:q.message.message_id }); } catch {}
    return;
  }
  if (data.startsWith("prod_")) {
    const prod = MENU.find(m => m.id === data.replace("prod_",""));
    if (!prod) return;
    const cat = CATEGORIES.find(c => c.id === prod.cat);
    const caption = `*${escMd(prod.name)}*\n\n💰 Narxi: *${fmt(prod.price)} so'm*\n\nBuyurtma berish uchun Mini App ni oching 👇`;
    const kb = { inline_keyboard: [
      [{ text:"🛒 Buyurtma berish", web_app:{ url: MINI_APP_URL } }],
      [{ text:"🔙 Menuga qaytish", callback_data:`cat_${prod.cat}` }],
    ]};
    try { await bot.sendPhoto(id, `${IMG_BASE}/${prod.img}`, { caption, parse_mode:"MarkdownV2", reply_markup: kb }); }
    catch { await bot.sendMessage(id, caption, { parse_mode:"MarkdownV2", reply_markup: kb }); }
    return;
  }
  if (data === "my_orders") {
    const orders = await Order.find({ userId: id }).sort({ createdAt:-1 }).limit(5);
    if (!orders.length) return bot.sendMessage(id, "📭 Hali buyurtma berilmagan.", { reply_markup: mainKb() });
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach(o => { txt += `*\\#${escMd(o._id.toString().slice(-6).toUpperCase())}*\n└ ${STATUS[o.status]} — ${fmt(o.total)} so'm\n\n`; });
    return bot.sendMessage(id, txt, { parse_mode:"MarkdownV2", reply_markup: mainKb() });
  }
});

// ══════════════════════════════════════════
//  API — Menu (yagona manba)
// ══════════════════════════════════════════
app.get("/api/menu", (req, res) => {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ categories: CATEGORIES, items: MENU });
});

// ══════════════════════════════════════════
//  API — Buyurtma yaratish
// ══════════════════════════════════════════
app.post("/api/orders", async (req, res) => {
  // ✅ FIX: Rate limit
  const ip = req.ip;
  if (rateLimit(ip, 5)) return res.status(429).json({ success:false, error:"Juda ko'p so'rov. Biroz kuting." });

  try {
    const { userId: clientUserId, name, phone, address, note, gps, items: clientItems, paymentMethod, source, initData } = req.body;

    // ✅ FIX 1b: Telegram initData ni tekshiramiz — soxtalashtirishning oldini oladi
    // Tekshirilgan userId mijoz yuborganidan ustun turadi
    const tgUser  = verifyTelegramInitData(initData);
    const isValid = !!tgUser;
    const userId  = isValid ? tgUser.id : 0;   // tasdiqlanmasa 0 (anonim sayt buyurtmasi)

    // Validatsiya
    if (typeof name !== "string" || typeof phone !== "string" || typeof address !== "string" || !name.trim() || !phone.trim() || !address.trim()) {
      return res.status(400).json({ success: false, error: "Ism, telefon va manzil to'ldirilishi shart" });
    }
    // Reject oversized inputs instead of silently truncating customer details.
    if (name.length > 100 || phone.length > 20 || address.length > 300 ||
        (typeof note === "string" && note.length > 200)) {
      return res.status(400).json({ success:false, error:"Kiritilgan ma'lumot juda uzun" });
    }
    if (typeof note !== "undefined" && typeof note !== "string") {
      return res.status(400).json({ success:false, error:"Izoh noto‘g‘ri" });
    }
    if (!Array.isArray(clientItems) || clientItems.length === 0 || clientItems.length > 50) {
      return res.status(400).json({ success: false, error: "Savat bo'sh" });
    }
    // ✅ Telefon: kamida 9 raqam
    if (phone.replace(/\D/g, "").length < 9 || phone.replace(/\D/g, "").length > 15) {
      return res.status(400).json({ success: false, error: "Telefon raqam noto'g'ri" });
    }

    // ✅ FIX 1a: Narxni serverda hisoblash — mijoz yuborgan narxlarga ISHONMAYMIZ
    const { items, total, errors } = calcOrder(clientItems);
    if (errors.length || !items.length) {
      return res.status(400).json({ success: false, error: "Menyu'da mavjud bo'lmagan mahsulotlar" });
    }

    // Mini App dan kelgan, lekin tasdiqlanmagan buyurtmani belgilaymiz
    const realSource = isValid ? "miniapp"
                     : (["website","bot"].includes(source) ? source : "website");

    const order = await Order.create({
      userId,
      name:          name.trim().slice(0, 100),
      phone:         phone.trim().slice(0, 20),
      address:       address.trim().slice(0, 300),
      note:          (note || "").trim().slice(0, 200),
      gpsLat:        Number.isFinite(Number(gps?.lat)) && Math.abs(Number(gps.lat)) <= 90 ? Number(gps.lat) : null,
      gpsLng:        Number.isFinite(Number(gps?.lng)) && Math.abs(Number(gps.lng)) <= 180 ? Number(gps.lng) : null,
      items,   // ← serverdan
      total,   // ← serverdan
      paymentMethod: ["cash","card"].includes(paymentMethod) ? paymentMethod : "cash",
      source:        realSource,
    });

    broadcastStats();

    if (ADMIN_ID) {
      const srcLabel = { website:"🌐 Sayt", miniapp:"📱 Mini App", bot:"🤖 Bot" }[order.source] || "📦";
      const payLabel = order.paymentMethod === "card" ? "💳 Karta" : "💵 Naqd";
      // ✅ FIX 2d: Markdown escape — mijoz kiritgan matn xavfsiz
      let txt = `🛎 *Yangi buyurtma \\#${escMd(order._id.toString().slice(-6).toUpperCase())}* ${srcLabel}\n\n`;
      txt += `👤 ${escMd(order.name)}\n📞 ${escMd(order.phone)}\n📍 ${escMd(order.address)}\n`;
      txt += `💳 To'lov: ${payLabel}\n`;
      if (order.gpsLat) txt += `🗺 [Xaritada](https://maps\\.google\\.com/?q=${order.gpsLat},${order.gpsLng})\n`;
      if (order.note)   txt += `💬 ${escMd(order.note)}\n`;
      txt += `\n📦 *Tarkibi:*\n`;
      order.items.forEach(i => { txt += `• ${escMd(i.name)} × ${i.qty} \\= ${fmt(i.price*i.qty)} so'm\n`; });
      txt += `\n💰 *Jami: ${fmt(order.total)} so'm*`;
      try {
        await bot.sendMessage(ADMIN_ID, txt, { parse_mode: "MarkdownV2", reply_markup: adminKb(order._id.toString()) });
      } catch (notificationError) {
        console.error("Admin notification failed for order", order._id.toString(), notificationError.message);
      }
    }

    if (userId && userId > 0) {
      try {
        await bot.sendMessage(userId,
          `✅ Buyurtmangiz qabul qilindi\\! \\#${escMd(order._id.toString().slice(-6).toUpperCase())}\n\n💰 ${fmt(order.total)} so'm\n\nTez yetkazib beramiz\\! 🚀`,
          { parse_mode: "MarkdownV2" }
        );
      } catch {}
    }

    if (userId) sendToUser(userId, "new_order", { orderId: order._id.toString(), status:"new", total: order.total, items: order.items });
    sendToAdmin("new_order", { order: { ...order.toObject(), id: order._id } });

    res.json({ success: true, orderId: order._id, total: order.total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Server xatosi" });
  }
});

// ✅ FIX 1c: Faqat tasdiqlangan foydalanuvchi o'z buyurtmalarini ko'radi
// initData query yoki header orqali kelishi mumkin
app.get("/api/orders/user/:uid", async (req, res) => {
  const uid = Number(req.params.uid);
  if (!uid || uid <= 0) return res.status(400).json([]);

  const initData = req.query.initData || req.headers["x-telegram-init-data"] || "";
  const tgUser   = verifyTelegramInitData(initData);

  // Tasdiqlanmagan yoki boshqa odamning ID si so'ralsa — rad etiladi
  if (!tgUser || tgUser.id !== uid) {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  try {
    const orders = await Order.find({ userId: uid }).sort({ createdAt: -1 }).limit(30)
      .select("-gpsLat -gpsLng -__v");
    res.json(orders);
  } catch { res.json([]); }
});

app.get("/api/stats", (req, res, next) => {
  if (!checkBearer(req)) return res.status(401).json({error:"Ruxsat yo‘q"});
  next();
}, async (req, res) => {
  try { res.json({ users: await User.countDocuments(), orders: await Order.countDocuments() }); }
  catch { res.json({ users:0, orders:0 }); }
});

// ══════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════
app.post("/api/admin/login", (req, res) => {
  if (rateLimit(`admin:${req.ip}`, 5)) return res.status(429).json({success:false,error:"Ko‘p urinish. Keyinroq urinib ko‘ring."});
  const { pass } = req.body || {};
  if (typeof pass === "string" && crypto.timingSafeEqual(crypto.createHash("sha256").update(pass).digest(), crypto.createHash("sha256").update(ADMIN_PASS).digest())) {
    return res.json({ success: true, token: createSignedToken("admin", ADMIN_SESSION_MS) });
  }
  res.status(401).json({ success: false });
});

app.use("/api/admin", (req, res, next) => {
  if (checkBearer(req)) return next();
  res.status(401).json({ error: "Ruxsat yo'q" });
});

app.get("/api/admin/orders", async (req, res) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    // ✅ FIX: limit cheklash
    const safeLimit = Math.min(Number(limit) || 50, 100);
    const filter = status && status !== "all" ? { status } : {};
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).limit(safeLimit).skip(Number(skip) || 0),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total });
  } catch { res.json({ orders:[], total:0 }); }
});

app.patch("/api/admin/orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    if (!STATUS[status]) return res.status(400).json({ success:false, error:"Noto'g'ri holat" });
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ success: false });
    sendToUser(order.userId, "order_update", { orderId: req.params.id, status, statusLabel: STATUS[status] });
    sendToAdmin("order_updated", { orderId: req.params.id, status });
    try { await bot.sendMessage(order.userId, `🔔 Buyurtma holati:\n${STATUS[status]}`, {}); } catch {}
    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ success:false, error: e.message }); }
});

app.get("/api/admin/stats", async (req, res) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate()-7);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

    const [users, totalOrders, todayOrders, weekOrders, monthOrders, pending,
           todaySumArr, weekSumArr, monthSumArr, statusCounts, daily] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ createdAt:{ $gte: todayStart } }),
      Order.countDocuments({ createdAt:{ $gte: weekStart  } }),
      Order.countDocuments({ createdAt:{ $gte: monthStart } }),
      Order.countDocuments({ status:{ $in:["new","accepted","cooking"] } }),
      Order.aggregate([{ $match:{ createdAt:{ $gte:todayStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $match:{ createdAt:{ $gte:weekStart  }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $match:{ createdAt:{ $gte:monthStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $group:{ _id:"$status", count:{ $sum:1 } } }]),
      Order.aggregate([
        { $match:{ createdAt:{ $gte: weekStart } } },
        { $group:{ _id:{ $dateToString:{ format:"%Y-%m-%d", date:"$createdAt" } }, count:{ $sum:1 }, total:{ $sum:"$total" } } },
        { $sort:{ _id:1 } }
      ]),
    ]);

    res.json({
      users, totalOrders, todayOrders, weekOrders, monthOrders, pending,
      todaySum: todaySumArr[0]?.total||0,
      weekSum:  weekSumArr[0]?.total||0,
      monthSum: monthSumArr[0]?.total||0,
      statusCounts, daily,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Excel hisobotlar ────────────────────────────────────────
app.get("/api/admin/report/weekly", async (req, res) => {
  try {
    const from = new Date(); from.setDate(from.getDate()-7); from.setHours(0,0,0,0);
    const orders = await Order.find({ createdAt:{ $gte:from } }).sort({ createdAt:-1 });
    const title  = `Haftalik (${from.toLocaleDateString("uz-UZ")} — ${new Date().toLocaleDateString("uz-UZ")})`;
    const buf    = await getReportBuffer(orders, "weekly", title);
    const fname  = `Holland_haftalik_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="${fname}"`);
    res.send(buf);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get("/api/admin/report/monthly", async (req, res) => {
  try {
    const from = new Date(); from.setDate(1); from.setHours(0,0,0,0);
    const orders = await Order.find({ createdAt:{ $gte:from } }).sort({ createdAt:-1 });
    const title  = `Oylik — ${new Date().toLocaleString("uz-UZ",{month:"long",year:"numeric"})}`;
    const buf    = await getReportBuffer(orders, "monthly", title);
    const fname  = `Holland_oylik_${new Date().toISOString().slice(0,7)}.xlsx`;
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="${fname}"`);
    res.send(buf);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get("/api/admin/report/today", async (req, res) => {
  try {
    const from = new Date(); from.setHours(0,0,0,0);
    const orders = await Order.find({ createdAt:{ $gte:from } }).sort({ createdAt:-1 });
    const title  = `Bugungi — ${from.toLocaleDateString("uz-UZ")}`;
    const buf    = await getReportBuffer(orders, "today", title);
    const fname  = `Holland_bugun_${from.toISOString().slice(0,10)}.xlsx`;
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="${fname}"`);
    res.send(buf);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get("/api/admin/report/custom", async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now()-30*86400000);
    const to   = req.query.to   ? new Date(req.query.to)   : new Date();
    from.setHours(0,0,0,0); to.setHours(23,59,59,999);
    const orders = await Order.find({ createdAt:{ $gte:from, $lte:to } }).sort({ createdAt:-1 });
    const title  = `${from.toLocaleDateString("uz-UZ")} — ${to.toLocaleDateString("uz-UZ")}`;
    const buf    = await getReportBuffer(orders, "custom", title);
    const fname  = `Holland_hisobot_${from.toISOString().slice(0,10)}_${to.toISOString().slice(0,10)}.xlsx`;
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="${fname}"`);
    res.send(buf);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/health", (req, res) => res.json({ok: true, database: mongoose.connection.readyState === 1 ? "connected" : "unavailable"}));
app.get("/",      (req, res) => res.json({ ok:true, service:"Holland API" }));

app.listen(PORT, () => console.log(`✅ Holland API: http://localhost:${PORT}`));