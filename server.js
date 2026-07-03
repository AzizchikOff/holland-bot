process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("⚠️ Uncaught Exception:", error);
});

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
const ADMIN_PASS   = process.env.ADMIN_PASS || "holland2025";
const MINI_APP_URL = process.env.MINI_APP_URL || "https://holland-namangan.netlify.app/app/";
const IMG_BASE     = process.env.IMG_BASE || "https://holland-namangan.netlify.app/images";

const isProduction = !!WEBHOOK_URL;
const bot = isProduction
  ? new TelegramBot(BOT_TOKEN, { webHook: { port: false } })
  : new TelegramBot(BOT_TOKEN, { polling: true });

bot.on("polling_error", (err) => console.error("🤖 Bot Polling error:", err.message));
bot.on("error", (err) => console.error("🤖 Bot error:", err.message));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ══════════════════════════════════════════
//  MongoDB
// ══════════════════════════════════════════
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB ulandi"))
  .catch(e => console.error("❌ MongoDB:", e.message));

const UserSchema = new mongoose.Schema({
  userId:    { type: Number, unique: true },
  firstName: String,
  username:  String,
  joinedAt:  { type: Date, default: Date.now },
});
const User = mongoose.model("User", UserSchema);

const OrderSchema = new mongoose.Schema({
  userId:  Number,
  name:    String,
  phone:   String,
  address: String,
  note:    { type: String, default: "" },
  gpsLat:  Number,
  gpsLng:  Number,
  items:   Array,
  total:   Number,
  paymentMethod: { type: String, default: "cash" }, // cash | card
  status:  { type: String, default: "new" },
  source:  { type: String, default: "miniapp" }, // miniapp | website | bot
}, { timestamps: true });
const Order = mongoose.model("Order", OrderSchema);

// ══════════════════════════════════════════
//  MENU MA'LUMOTLARI
// ══════════════════════════════════════════
const CATEGORIES = [
  { id: "free",   emoji: "🍟", label: "Holland Free",  desc: "Issiq va mazali kartoshka fri" },
  { id: "burger", emoji: "🍔", label: "Burger",        desc: "Shirador burger va sandvichlar" },
  { id: "hotdog", emoji: "🌭", label: "Hot-dog",       desc: "Klassik va asl hot-doglar" },
  { id: "sous",   emoji: "🫙", label: "Sous",          desc: "Turli xil sous va qo'shimchalar" },
  { id: "drink",  emoji: "🥤", label: "Ichimliklar",   desc: "Sovuq va shirin ichimliklar" },
];

const MENU = [
  { id:"1",  cat:"free",   name:"Free Holland",              price:19000,  img:"free-classik.jpg",     desc:"Klassik Holland fri — chip-chip, issiq" },
  { id:"2",  cat:"free",   name:"Free Holland Big",          price:23000,  img:"free-classik.jpg",     desc:"Katta porsiya — to'yimli va mazali" },
  { id:"3",  cat:"free",   name:"Free Holland Special",      price:35000,  img:"special.jpg",          desc:"Maxsus sous bilan — eng mashhur tanlov" },
  { id:"4",  cat:"free",   name:"Loaded Fries",              price:32000,  img:"loaded.png",           desc:"Sous va toppinglar bilan to'ldirilgan fri" },
  { id:"5",  cat:"free",   name:"Loaded Fries & Sausage",    price:28000,  img:"Loaded fries.jpg",     desc:"Kolbasa va sous bilan fri" },
  { id:"6",  cat:"free",   name:"Loaded Cheese",             price:26000,  img:"loaded-cheese.jpg",    desc:"Pishloq sous bilan tez taom" },
  { id:"7",  cat:"free",   name:"Chicken Cheese",            price:42000,  img:"Chickencheese.jpg",    desc:"Tovuq go'shti va pishloq kombinatsiyasi" },
  { id:"8",  cat:"free",   name:"Crispy Chicken",            price:38000,  img:"crispy.jpg",           desc:"Qaynoq yog'da qovurilgan crispy tovuq" },
  { id:"9",  cat:"free",   name:"Beef Box",                  price:55000,  img:"bifbox.jpg",           desc:"Mol go'shti bilan premium box" },
  { id:"13", cat:"free",   name:"Kapsalan (lahm)",           price:75000,  img:"kapsalan.jpg",         desc:"Qo'y go'shti bilan maxsus kapsalan" },
  { id:"14", cat:"free",   name:"Kapsalan (qiyma)",          price:58000,  img:"kapsalan.jpg",         desc:"Qiyma go'sht bilan kapsalan" },
  { id:"15", cat:"free",   name:"Berlin Style (lahm)",       price:58000,  img:"berlin.jpg",           desc:"Berlin uslubida qo'y go'shti bilan" },
  { id:"16", cat:"free",   name:"Berlin Style (qiyma)",      price:48000,  img:"berlin.jpg",           desc:"Berlin uslubida qiyma bilan" },
  { id:"17", cat:"free",   name:"Briosh Steak Box",          price:65000,  img:"BrioshSteak.jpg",      desc:"Premium steak va briosh non bilan box" },
  { id:"10", cat:"burger", name:"Chicken Burger",            price:35000,  img:"burger.jpg",           desc:"Juicy tovuq burger — klassik ta'm" },
  { id:"19", cat:"burger", name:"Bon File (lahm)",           price:48000,  img:"Bonfile.jpg",          desc:"Qo'y go'shti bilan premium sandvich" },
  { id:"20", cat:"burger", name:"Bon File (qiyma)",          price:38000,  img:"Bonfile.jpg",          desc:"Qiyma go'sht bilan shirador sandvich" },
  { id:"11", cat:"hotdog", name:"Hot-Dog Classic",           price:15000,  img:"hotdog.jpg",           desc:"An'anaviy klassik hot-dog" },
  { id:"12", cat:"hotdog", name:"Hot-Dog Canada",            price:20000,  img:"hotdog-canada.jpg",    desc:"Kanada uslubida premium hot-dog" },
  { id:"18", cat:"hotdog", name:"Free-Dog",                  price:28000,  img:"free-dog.jpg",         desc:"Holland fri va hot-dog kombinatsiyasi" },
  { id:"21", cat:"sous",   name:"Berlin Sous",               price:4000,   img:"berlinSous.png",       desc:"Berlin uslubida maxsus sous" },
  { id:"22", cat:"sous",   name:"Burger Sous",               price:4000,   img:"burgerSous.png",       desc:"Burger uchun maxsus sous" },
  { id:"23", cat:"sous",   name:"BBQ Sous",                  price:4000,   img:"bbq.png",              desc:"Shashlik va barbekyu uchun sous" },
  { id:"24", cat:"sous",   name:"Ketchup-Mayonez",           price:4000,   img:"ketchup.png",          desc:"Aralash ketchup va mayonez" },
  { id:"25", cat:"drink",  name:"Sprite Mojito 0.5L",        price:8000,   img:"sprite-moxito.jpg",    desc:"Yangi ta'mli mojito sprite" },
  { id:"26", cat:"drink",  name:"Sprite 0.5L",               price:8000,   img:"sprite.jpg",           desc:"Klassik sovuq Sprite" },
  { id:"27", cat:"drink",  name:"Sprite 0.25L",              price:7000,   img:"sprite-banochniy.jpg", desc:"Kichik o'lchamli Sprite" },
  { id:"28", cat:"drink",  name:"Fanta 0.25L (banonchik)",   price:7000,   img:"fanta-banochniy.jpg",  desc:"Shirin apelsin ta'mli Fanta" },
  { id:"30", cat:"drink",  name:"Fanta 0.25L (plastik)",     price:10000,  img:"fanta.jpg",            desc:"Fanta plastik shishada" },
  { id:"32", cat:"drink",  name:"Coca Cola 0.25L",           price:7000,   img:"cola-banochniy.jpg",   desc:"Klassik Coca Cola — sovuq" },
  { id:"34", cat:"drink",  name:"Coca Cola (shisha)",        price:10000,  img:"cola.jpg",             desc:"Shishada Coca Cola" },
  { id:"35", cat:"drink",  name:"Fuse Tea 0.5L",             price:10000,  img:"fusetea-banochniy.jpg",desc:"Limonlu Fuse Tea" },
  { id:"37", cat:"drink",  name:"Bonaqua 0.5L",              price:3000,   img:"bon-aqua.jpg",         desc:"Toza ichimlik suvi" },
  { id:"38", cat:"drink",  name:"Cappy Pulpy 0.5L",          price:8000,   img:"cappy.jpg",            desc:"Mevali Cappy sharbat" },
];

function fmt(n) { return new Intl.NumberFormat("uz-UZ").format(n); }

// ══════════════════════════════════════════
//  ADMIN TOKEN — deterministik, sessiya saqlashga hojat yo'q
// ══════════════════════════════════════════
function computeAdminToken() {
  return crypto.createHash("sha256").update(ADMIN_PASS + ":holland_secret").digest("hex");
}
function checkBearer(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token === computeAdminToken();
}
function checkSseToken(req) {
  const token = req.query.token || "";
  return token === computeAdminToken().slice(0, 16);
}

const STATUS = {
  new:       "🆕 Yangi",
  accepted:  "✅ Qabul qilindi",
  cooking:   "🍳 Tayyorlanmoqda",
  delivered: "🚀 Yetkazildi",
  cancelled: "❌ Bekor qilindi",
};

// ══════════════════════════════════════════
//  SSE — Real-time
// ══════════════════════════════════════════
const clients = new Map();
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
    const users  = await User.countDocuments();
    const orders = await Order.countDocuments();
    const msg = `event: stats\ndata: ${JSON.stringify({ users, orders })}\n\n`;
    clients.forEach(list => list.forEach(res => { try { res.write(msg); } catch {} }));
    adminClients.forEach(res => { try { res.write(msg); } catch {} });
  })();
}
setInterval(broadcastStats, 30000);

app.get("/api/stream/:userId", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  const userId = Number(req.params.userId);
  res.write(`event: connected\ndata: {"ok":true}\n\n`);
  (async () => {
    const users  = await User.countDocuments();
    const orders = await Order.countDocuments();
    res.write(`event: stats\ndata: ${JSON.stringify({ users, orders })}\n\n`);
    if (userId) {
      const userOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(10);
      res.write(`event: orders\ndata: ${JSON.stringify(userOrders)}\n\n`);
    }
  })();
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 20000);
  addClient(userId, res);
  req.on("close", () => { clearInterval(ping); removeClient(userId, res); });
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
      ...CATEGORIES.map(c => [{ text: `${c.emoji} ${c.label}`, callback_data: `cat_${c.id}` }]),
      [{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
    ],
  };
}
function catProductsKb(catId, page = 0) {
  const items = MENU.filter(m => m.cat === catId);
  const perPage = 5;
  const start = page * perPage;
  const pageItems = items.slice(start, start + perPage);
  const rows = pageItems.map(p => [{ text: `${p.name} — ${fmt(p.price)} so'm`, callback_data: `prod_${p.id}` }]);
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
  app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  console.log("✅ Webhook rejimida ishlayapti (tez!)");
} else {
  console.log("⚡ Polling rejimida ishlayapti");
}

// ══════════════════════════════════════════
//  BOT — /start
// ══════════════════════════════════════════
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id, name = msg.chat.first_name || "Mehmon";
  await saveUser(msg);
  const [userCount, lastOrder] = await Promise.all([
    User.countDocuments(),
    Order.findOne({ userId: id }).sort({ createdAt: -1 }),
  ]);
  let text = `🍔 *Holland Fast Food*\n\nAssalomu alaykum, *${name}*! Xush kelibsiz 👋\n\n`;
  text += `┌ ⚡ Yetkazib berish: *10–15 daqiqa*\n`;
  text += `├ ✅ Mahsulot: *100% Halol*\n`;
  text += `├ 🔥 Taom: *Har doim issiq*\n`;
  text += `└ 👥 Mijozlar: *${userCount} ta*\n\n`;
  if (lastOrder) {
    text += `📦 *So'nggi buyurtma:*\n`;
    text += `#${lastOrder._id.toString().slice(-6).toUpperCase()} — ${STATUS[lastOrder.status]}\n\n`;
  }
  text += `👇 Quyidagi tugmani bosib buyurtma bering!`;
  await bot.sendMessage(id, text, {
    parse_mode: "Markdown",
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

// ══════════════════════════════════════════
//  BOT — /admin
// ══════════════════════════════════════════
bot.onText(/\/admin/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const [users, totalOrders, todayOrders, pending, todaySumArr] = await Promise.all([
    User.countDocuments(),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: todayStart } }),
    Order.countDocuments({ status: { $in: ["new","accepted","cooking"] } }),
    Order.aggregate([{ $match: { createdAt:{ $gte: todayStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
  ]);
  let text = `📊 *Holland Admin Panel*\n\n`;
  text += `👥 Foydalanuvchilar: *${users}*\n`;
  text += `📦 Jami buyurtmalar: *${totalOrders}*\n`;
  text += `📅 Bugungi buyurtmalar: *${todayOrders}*\n`;
  text += `⏳ Jarayondagi: *${pending}*\n`;
  text += `💰 Bugungi tushum: *${fmt(todaySumArr[0]?.total || 0)} so'm*\n\n`;
  text += `🌐 [Admin panelni ochish](${WEBHOOK_URL}/admin)`;
  await bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
});

// ══════════════════════════════════════════
//  BOT — /hisobot (Excel)
// ══════════════════════════════════════════
bot.onText(/\/hisobot/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  const month = new Date().toLocaleString("uz-UZ", { month: "long", year: "numeric" });
  await bot.sendMessage(ADMIN_ID,
    `📊 *Hisobot — Holland Fast Food*\n\nQaysi davrni yuklab olmoqchisiz? 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "☀️ Bugungi hisobot",  callback_data: "report_today"   }],
          [{ text: "📅 Haftalik hisobot",  callback_data: "report_weekly"  }],
          [{ text: `📆 Oylik (${month})`, callback_data: "report_monthly" }],
        ],
      },
    }
  );
});

// ══════════════════════════════════════════
//  BOT — text messages
// ══════════════════════════════════════════
bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/") || msg.web_app_data) return;
  await saveUser(msg);
  const id = msg.chat.id, text = msg.text || "";

  if (text === "📋 Menu ko'rish") {
    return bot.sendMessage(id, `🍽 *Holland Fast Food Menu*\n\nKategoriyani tanlang:`, {
      parse_mode: "Markdown", reply_markup: menuKb(),
    });
  }
  if (text === "📦 Buyurtmalarim") {
    const orders = await Order.find({ userId: id }).sort({ createdAt: -1 }).limit(5);
    if (!orders.length) return bot.sendMessage(id, "📭 Hali buyurtma berilmagan.", {
      reply_markup: { inline_keyboard: [[{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }]] }
    });
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach(o => {
      txt += `*#${o._id.toString().slice(-6).toUpperCase()}*\n`;
      txt += `└ ${STATUS[o.status]} — ${fmt(o.total)} so'm\n`;
      txt += `   📅 ${o.createdAt.toLocaleDateString("uz-UZ")}\n\n`;
    });
    return bot.sendMessage(id, txt, { parse_mode: "Markdown", reply_markup: mainKb() });
  }
  if (text === "ℹ️ Biz haqimizda") return bot.sendMessage(id,
    `🏪 *Holland Fast Food*\n\n📍 G'alaba ko'chasi 1a, Namangan\n⏰ 11:00 – 01:00\n📞 +998 90 699 95 95\n\n✅ 100% Halol mahsulot\n🔥 Har buyurtma yangi tayyorlanadi`,
    { parse_mode: "Markdown", reply_markup: mainKb() }
  );
  if (text === "📞 Bog'lanish") return bot.sendMessage(id,
    `📞 *Bog'lanish:*\n\n📱 +998 90 699 95 95\n💬 @Holland_fries\n🌐 holland-namangan.netlify.app`,
    { parse_mode: "Markdown", reply_markup: mainKb() }
  );
  return bot.sendMessage(id, "Buyurtma berish uchun quyidagi tugmani bosing 👇", {
    reply_markup: { inline_keyboard: [[{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }]] },
  });
});

// ══════════════════════════════════════════
//  BOT — callback queries
// ══════════════════════════════════════════
bot.on("callback_query", async (q) => {
  const id = q.message.chat.id, data = q.data;
  await bot.answerCallbackQuery(q.id);

  // ── Excel hisobot ──
  if (data.startsWith("report_") && id === ADMIN_ID) {
    let from = new Date(), title = "", fname = "";

    if (data === "report_today") {
      from.setHours(0, 0, 0, 0);
      title = `Bugungi — ${from.toLocaleDateString("uz-UZ")}`;
      fname = `Holland_bugun_${from.toISOString().slice(0,10)}.xlsx`;
    } else if (data === "report_weekly") {
      from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
      title = `Haftalik (${from.toLocaleDateString("uz-UZ")} — ${new Date().toLocaleDateString("uz-UZ")})`;
      fname = `Holland_haftalik_${new Date().toISOString().slice(0,10)}.xlsx`;
    } else if (data === "report_monthly") {
      from.setDate(1); from.setHours(0, 0, 0, 0);
      title = `Oylik — ${new Date().toLocaleString("uz-UZ", { month: "long", year: "numeric" })}`;
      fname = `Holland_oylik_${new Date().toISOString().slice(0,7)}.xlsx`;
    }

    const orders    = await Order.find({ createdAt: { $gte: from } }).sort({ createdAt: -1 });
    const delivered = orders.filter(o => o.status === "delivered");
    const cancelled = orders.filter(o => o.status === "cancelled");
    const totalSum  = delivered.reduce((s, o) => s + (o.total || 0), 0);

    if (!orders.length) return bot.sendMessage(ADMIN_ID, "📭 Bu davrda buyurtma topilmadi.");

    let txt = `📊 *${title}*\n\n`;
    txt += `📦 Jami buyurtma: *${orders.length}*\n`;
    txt += `✅ Yetkazilgan: *${delivered.length}*\n`;
    txt += `❌ Bekor qilingan: *${cancelled.length}*\n`;
    txt += `⏳ Jarayondagi: *${orders.length - delivered.length - cancelled.length}*\n\n`;
    txt += `💰 Jami tushum: *${fmt(totalSum)} so'm*\n`;
    txt += `📈 O'rtacha check: *${fmt(delivered.length ? Math.round(totalSum / delivered.length) : 0)} so'm*`;

    await bot.sendMessage(ADMIN_ID, txt, { parse_mode: "Markdown" });

    const buf = getReportBuffer(orders, data.replace("report_", ""), title);
    await bot.sendDocument(
      ADMIN_ID,
      Buffer.from(buf),
      { caption: `📎 ${fname}\n\n5 ta varaq:\n📊 Xulosa\n📦 Buyurtmalar\n🍟 Mahsulotlar\n📅 Kunlik\n👥 Mijozlar` },
      { filename: fname, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    return;
  }

  // ── Admin: holat yangilash ──
  if (data.startsWith("s_") && id === ADMIN_ID) {
    const [, oid, status] = data.split("_");
    const order = await Order.findByIdAndUpdate(oid, { status }, { new: true });
    if (!order) return;
    await bot.editMessageReplyMarkup(adminKb(oid), { chat_id: ADMIN_ID, message_id: q.message.message_id });
    await bot.sendMessage(ADMIN_ID, `✅ *#${oid.slice(-6).toUpperCase()}* → *${STATUS[status]}*`, { parse_mode: "Markdown" });
    sendToUser(order.userId, "order_update", { orderId: oid, status, statusLabel: STATUS[status] });
    sendToAdmin("order_updated", { orderId: oid, status });
    try { await bot.sendMessage(order.userId, `🔔 *Buyurtma #${oid.slice(-6).toUpperCase()}*\n\nHolat: *${STATUS[status]}*\n\nRahmat! 🙏`, { parse_mode: "Markdown" }); } catch {}
    return;
  }

  // ── Menu ──
  if (data === "show_menu") {
    await bot.editMessageText(`🍽 *Holland Fast Food Menu*\n\nKategoriyani tanlang:`, {
      chat_id: id, message_id: q.message.message_id,
      parse_mode: "Markdown", reply_markup: menuKb(),
    });
    return;
  }

  if (data.startsWith("cat_")) {
    const catId = data.replace("cat_", "");
    const cat = CATEGORIES.find(c => c.id === catId);
    const count = MENU.filter(m => m.cat === catId).length;
    await bot.editMessageText(
      `${cat.emoji} *${cat.label}*\n${cat.desc}\n\n📦 ${count} ta mahsulot mavjud.\nTanlang:`,
      { chat_id: id, message_id: q.message.message_id, parse_mode: "Markdown", reply_markup: catProductsKb(catId, 0) }
    );
    return;
  }

  if (data.startsWith("page_")) {
    const [, catId, pageStr] = data.split("_");
    await bot.editMessageReplyMarkup(catProductsKb(catId, Number(pageStr)), {
      chat_id: id, message_id: q.message.message_id,
    });
    return;
  }

  if (data.startsWith("prod_")) {
    const prodId = data.replace("prod_", "");
    const prod = MENU.find(m => m.id === prodId);
    if (!prod) return;
    const cat = CATEGORIES.find(c => c.id === prod.cat);
    const caption = `${cat.emoji} *${prod.name}*\n\n📝 ${prod.desc}\n\n💰 Narxi: *${fmt(prod.price)} so'm*\n\nBuyurtma berish uchun Mini App ni oching 👇`;
    try {
      await bot.sendPhoto(id, `${IMG_BASE}/${prod.img}`, {
        caption, parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "🛒 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
          [{ text: "🔙 Menuga qaytish", callback_data: `cat_${prod.cat}` }],
        ]},
      });
    } catch {
      await bot.sendMessage(id, caption, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "🛒 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
          [{ text: "🔙 Menuga qaytish", callback_data: `cat_${prod.cat}` }],
        ]},
      });
    }
    return;
  }

  if (data === "my_orders") {
    const orders = await Order.find({ userId: id }).sort({ createdAt: -1 }).limit(5);
    if (!orders.length) return bot.sendMessage(id, "📭 Hali buyurtma berilmagan.", { reply_markup: mainKb() });
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach(o => { txt += `*#${o._id.toString().slice(-6).toUpperCase()}*\n└ ${STATUS[o.status]} — ${fmt(o.total)} so'm\n\n`; });
    return bot.sendMessage(id, txt, { parse_mode: "Markdown", reply_markup: mainKb() });
  }
});

// ══════════════════════════════════════════
//  API ROUTES — Orders
// ══════════════════════════════════════════
app.post("/api/orders", async (req, res) => {
  try {
    const { userId, name, phone, address, note, gps, items, total, paymentMethod, source } = req.body;
    if (!name || !phone || !address || !items?.length) return res.json({ success: false, error: "Ma'lumotlar to'liq emas" });
    const order = await Order.create({
      userId: userId || 0,
      name,
      phone,
      address,
      note: note||"",
      gpsLat: gps?.lat||null,
      gpsLng: gps?.lng||null,
      items,
      total,
      paymentMethod: paymentMethod || "cash",
      source: source || "miniapp"
    });
    broadcastStats();
    if (ADMIN_ID) {
      const sourceLabel = { website: "🌐 Sayt", miniapp: "📱 Mini App", bot: "🤖 Bot" }[order.source] || "📦";
      const payLabel = order.paymentMethod === "card" ? "💳 Karta" : "💵 Naqd";
      let txt = `🛎 *Yangi buyurtma #${order._id.toString().slice(-6).toUpperCase()}* ${sourceLabel}\n\n`;
      txt += `👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.address}\n💳 To'lov: ${payLabel}\n`;
      if (order.gpsLat) txt += `🗺 [Xaritada](https://maps.google.com/?q=${order.gpsLat},${order.gpsLng})\n`;
      if (order.note) txt += `💬 ${order.note}\n`;
      txt += `\n📦 *Tarkibi:*\n`;
      order.items.forEach(i => { txt += `• ${i.name} × ${i.qty} = ${fmt(i.price*i.qty)} so'm\n`; });
      txt += `\n💰 *Jami: ${fmt(order.total)} so'm*`;
      await bot.sendMessage(ADMIN_ID, txt, { parse_mode: "Markdown", reply_markup: adminKb(order._id.toString()) });
    }
    
    // Foydalanuvchiga to'g'ridan-to'g'ri Telegram xabar yuborish
    if (userId && userId > 0) {
      try {
        const payLabel = order.paymentMethod === "card" ? "💳 Karta" : "💵 Naqd";
        let userTxt = `🛎 *Yangi buyurtmangiz qabul qilindi!* (#${order._id.toString().slice(-6).toUpperCase()})\n\n`;
        userTxt += `💰 Jami summasi: *${fmt(order.total)} so'm*\n`;
        userTxt += `💳 To'lov turi: *${payLabel}*\n\n`;
        if (order.paymentMethod === "card") {
          userTxt += `⚠️ *To'lovni amalga oshiring:*\n`;
          userTxt += `Iltimos, buyurtmangiz tezroq tayyorlanishi uchun to'lovni Click/Payme orqali quyidagi karta raqamiga o'tkazing va chekini ushbu chatga yuboring:\n\n`;
          userTxt += `💳 Karta: *8600 0524 8888 8888* (Holland Fast Food)\n`;
        } else {
          userTxt += `Taom yetkazib berilgach, kuryerga naqd pulda to'lashingiz mumkin.`;
        }
        await bot.sendMessage(userId, userTxt, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("Error sending confirmation to user:", err.message);
      }
    }

    if (userId) sendToUser(userId, "new_order", { orderId: order._id.toString(), status: "new", total: order.total, items: order.items });
    sendToAdmin("new_order", { order: { ...order.toObject(), id: order._id } });
    res.json({ success: true, orderId: order._id });
  } catch (e) { console.error(e); res.json({ success: false, error: e.message }); }
});

app.get("/api/orders/user/:uid", async (req, res) => {
  try { res.json(await Order.find({ userId: Number(req.params.uid) }).sort({ createdAt: -1 }).limit(30)); }
  catch { res.json([]); }
});

app.get("/api/stats", async (req, res) => {
  try { res.json({ users: await User.countDocuments(), orders: await Order.countDocuments() }); }
  catch { res.json({ users: 0, orders: 0 }); }
});

// ══════════════════════════════════════════
//  ADMIN API — auth middleware
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  ADMIN LOGIN — token qaytaradi
// ══════════════════════════════════════════
app.post("/api/admin/login", (req, res) => {
  const { pass } = req.body;
  if (pass === ADMIN_PASS) {
    return res.json({ success: true, token: computeAdminToken() });
  }
  res.json({ success: false });
});

app.use("/api/admin", (req, res, next) => {
  if (checkBearer(req) || req.query.pass === ADMIN_PASS || req.headers["x-admin-pass"] === ADMIN_PASS) return next();
  res.status(401).json({ error: "Ruxsat yo'q" });
});

app.get("/api/admin/orders", async (req, res) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const filter = status && status !== "all" ? { status } : {};
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).limit(Number(limit)).skip(Number(skip)),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total });
  } catch { res.json({ orders: [], total: 0 }); }
});

app.patch("/api/admin/orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.json({ success: false });
    sendToUser(order.userId, "order_update", { orderId: req.params.id, status, statusLabel: STATUS[status] });
    sendToAdmin("order_updated", { orderId: req.params.id, status });
    try { await bot.sendMessage(order.userId, `🔔 *Buyurtma holati:*\n${STATUS[status]}`, { parse_mode: "Markdown" }); } catch {}
    res.json({ success: true, order });
  } catch (e) { res.json({ success: false, error: e.message }); }
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
      Order.countDocuments({ createdAt: { $gte: todayStart } }),
      Order.countDocuments({ createdAt: { $gte: weekStart } }),
      Order.countDocuments({ createdAt: { $gte: monthStart } }),
      Order.countDocuments({ status: { $in: ["new","accepted","cooking"] } }),
      Order.aggregate([{ $match: { createdAt:{ $gte: todayStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $match: { createdAt:{ $gte: weekStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $match: { createdAt:{ $gte: monthStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $group:{ _id:"$status", count:{ $sum:1 } } }]),
      Order.aggregate([
        { $match: { createdAt:{ $gte: weekStart } } },
        { $group:{ _id:{ $dateToString:{ format:"%Y-%m-%d", date:"$createdAt" } }, count:{ $sum:1 }, total:{ $sum:"$total" } } },
        { $sort:{ _id:1 } }
      ]),
    ]);

    res.json({
      users, totalOrders, todayOrders, weekOrders, monthOrders, pending,
      todaySum: todaySumArr[0]?.total || 0,
      weekSum:  weekSumArr[0]?.total  || 0,
      monthSum: monthSumArr[0]?.total || 0,
      statusCounts, daily,
    });
  } catch(e) { res.json({ error: e.message }); }
});

// ══════════════════════════════════════════
//  ADMIN API — Excel hisobotlar
// ══════════════════════════════════════════
app.get("/api/admin/report/weekly", async (req, res) => {
  try {
    const from = new Date(); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
    const orders = await Order.find({ createdAt: { $gte: from } }).sort({ createdAt: -1 });
    const title  = `Haftalik (${from.toLocaleDateString("uz-UZ")} — ${new Date().toLocaleDateString("uz-UZ")})`;
    const buf    = getReportBuffer(orders, "weekly", title);
    const fname  = `Holland_haftalik_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/report/monthly", async (req, res) => {
  try {
    const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
    const orders = await Order.find({ createdAt: { $gte: from } }).sort({ createdAt: -1 });
    const title  = `Oylik — ${new Date().toLocaleString("uz-UZ", { month: "long", year: "numeric" })}`;
    const buf    = getReportBuffer(orders, "monthly", title);
    const fname  = `Holland_oylik_${new Date().toISOString().slice(0,7)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/report/today", async (req, res) => {
  try {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const orders = await Order.find({ createdAt: { $gte: from } }).sort({ createdAt: -1 });
    const title  = `Bugungi — ${from.toLocaleDateString("uz-UZ")}`;
    const buf    = getReportBuffer(orders, "today", title);
    const fname  = `Holland_bugun_${from.toISOString().slice(0,10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/report/custom", async (req, res) => {
  try {
    const { from: fromStr, to: toStr } = req.query;
    const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 30 * 86400000);
    const to   = toStr   ? new Date(toStr)   : new Date();
    from.setHours(0, 0, 0, 0); to.setHours(23, 59, 59, 999);
    const orders = await Order.find({ createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 });
    const title  = `${from.toLocaleDateString("uz-UZ")} — ${to.toLocaleDateString("uz-UZ")}`;
    const buf    = getReportBuffer(orders, "custom", title);
    const fname  = `Holland_hisobot_${from.toISOString().slice(0,10)}_${to.toISOString().slice(0,10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════
//  ADMIN PANEL (HTML)
// ══════════════════════════════════════════
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => res.json({ ok: true, service: "Holland API ✅" }));
app.listen(PORT, () => console.log(`✅ Holland API: http://localhost:${PORT}`));