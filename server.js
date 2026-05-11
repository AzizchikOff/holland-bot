require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const mongoose    = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const path        = require("path");
const crypto      = require("crypto");

const app        = express();
const PORT       = process.env.PORT || 3000;
const ADMIN_ID   = Number(process.env.ADMIN_ID);
const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://holland-bot.onrender.com
const ADMIN_PASS  = process.env.ADMIN_PASS || "holland2025";

// ── Webhook yoki polling ────────────────────
const isProduction = !!WEBHOOK_URL;
const bot = isProduction
  ? new TelegramBot(BOT_TOKEN, { webHook: { port: false } })
  : new TelegramBot(BOT_TOKEN, { polling: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── MongoDB ────────────────────────────────
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
  status:  { type: String, default: "new" },
}, { timestamps: true });
const Order = mongoose.model("Order", OrderSchema);

// ══════════════════════════════════════════
//  SSE — Real-time
// ══════════════════════════════════════════
const clients = new Map();

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
function broadcastStats() {
  (async () => {
    const users  = await User.countDocuments();
    const orders = await Order.countDocuments();
    const msg = `event: stats\ndata: ${JSON.stringify({ users, orders })}\n\n`;
    clients.forEach(list => list.forEach(res => { try { res.write(msg); } catch {} }));
  })();
}

let statsIntervalId = null;
if (!statsIntervalId) {
  statsIntervalId = setInterval(broadcastStats, 30000);
}
process.on("beforeExit", () => {
  if (statsIntervalId) clearInterval(statsIntervalId);
});

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

// Admin SSE
const adminClients = new Set();
function sendToAdmin(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  adminClients.forEach(res => { try { res.write(msg); } catch {} });
}
app.get("/api/admin/stream", (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(401).end();
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();
  res.write(`event: connected\ndata: {"ok":true}\n\n`);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 20000);
  adminClients.add(res);
  req.on("close", () => { clearInterval(ping); adminClients.delete(res); });
});

// ── Helpers ────────────────────────────────
function fmt(n) { return new Intl.NumberFormat("uz-UZ").format(n); }

const STATUS = {
  new:       "🆕 Yangi",
  accepted:  "✅ Qabul qilindi",
  cooking:   "🍳 Tayyorlanmoqda",
  delivered: "🚀 Yetkazildi",
  cancelled: "❌ Bekor qilindi",
};
const MINI_APP_URL = process.env.MINI_APP_URL || "https://holland-namangan.netlify.app/app/";

function adminKb(id) {
  return { inline_keyboard: [
    [{ text: "✅ Qabul",          callback_data: `s_${id}_accepted`  },
     { text: "🍳 Tayyorlanmoqda", callback_data: `s_${id}_cooking`   }],
    [{ text: "🚀 Yetkazildi",     callback_data: `s_${id}_delivered` },
     { text: "❌ Bekor",           callback_data: `s_${id}_cancelled` }],
  ]};
}
function mainKb() {
  return {
    keyboard: [
      [{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
      [{ text: "📦 Buyurtmalarim" }, { text: "ℹ️ Biz haqimizda" }],
      [{ text: "📞 Bog'lanish" }],
    ],
    resize_keyboard: true, persistent: true,
  };
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
//  WEBHOOK setup
// ══════════════════════════════════════════
if (isProduction) {
  const secretToken = crypto.randomBytes(32).toString("hex");
  bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`, { secret_token: secretToken });
  app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  console.log("✅ Webhook rejimida ishlayapti (tez!)");
} else {
  console.log("⚡ Polling rejimida ishlayapti");
}

// ══════════════════════════════════════════
//  BOT HANDLERS
// ══════════════════════════════════════════
bot.onText(/\/start/, async (msg) => {
  const id   = msg.chat.id;
  const name = msg.chat.first_name || "Mehmon";
  await saveUser(msg);
  const [userCount, orderCount, lastOrder] = await Promise.all([
    User.countDocuments(),
    Order.countDocuments({ userId: id }),
    Order.findOne({ userId: id }).sort({ createdAt: -1 }),
  ]);
  let text = `🍔 *Holland Fast Food*\n\nAssalomu alaykum, *${name}*! 👋\n\n`;
  text += `┌ ⚡ Yetkazib berish: *10–15 daqiqa*\n`;
  text += `├ ✅ Mahsulot: *100% Halol*\n`;
  text += `├ 🔥 Taom: *Har doim issiq*\n`;
  text += `└ 👥 Mijozlar: *${userCount} ta*\n\n`;
  if (orderCount > 0 && lastOrder) {
    text += `📦 *So'nggi buyurtma:*\n`;
    text += `#${lastOrder._id.toString().slice(-6).toUpperCase()} — ${STATUS[lastOrder.status]}\n`;
    text += `💰 ${fmt(lastOrder.total)} so'm\n\n`;
  }
  text += `🛒 Buyurtma berish uchun quyidagi tugmani bosing 👇`;
  await bot.sendMessage(id, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }],
        [{ text: "📦 Buyurtmalarim", callback_data: "my_orders" },
         { text: "📞 Bog'lanish",    callback_data: "contact"   }],
      ],
    },
  });
  await bot.sendMessage(id, "Yoki pastdagi tugmalardan foydalaning 👇", { reply_markup: mainKb() });
});

bot.onText(/\/admin/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  const [userCount, orderCount, todayOrders, pending, todaySum] = await Promise.all([
    User.countDocuments(),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } }),
    Order.countDocuments({ status: { $in: ["new","accepted","cooking"] } }),
    Order.aggregate([
      { $match: { createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }, status: { $ne: "cancelled" } } },
      { $group: { _id: null, total: { $sum: "$total" } } }
    ]),
  ]);
  let text = `📊 *Holland Admin Panel*\n\n`;
  text += `👥 Foydalanuvchilar: *${userCount}*\n`;
  text += `📦 Jami buyurtmalar: *${orderCount}*\n`;
  text += `📅 Bugungi buyurtmalar: *${todayOrders}*\n`;
  text += `⏳ Jarayondagi: *${pending}*\n`;
  text += `💰 Bugungi tushum: *${fmt(todaySum[0]?.total || 0)} so'm*\n\n`;
  text += `🌐 [Admin panelni ochish](${WEBHOOK_URL}/admin?pass=${ADMIN_PASS})`;
  await bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
});

bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/")) return;
  if (msg.web_app_data) return;
  await saveUser(msg);
  const id = msg.chat.id, text = msg.text || "";

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
    `🏪 *Holland Fast Food*\n\n📍 G'alaba ko'chasi 1a, Namangan\n⏰ 11:00 – 01:00\n📞 +998 90 699 95 95\n\n✅ 100% Halol mahsulot`,
    { parse_mode: "Markdown", reply_markup: mainKb() }
  );
  if (text === "📞 Bog'lanish") return bot.sendMessage(id,
    `📞 *Bog'lanish:*\n\n📱 +998 90 699 95 95\n💬 @Holland_fries\n🌐 holland-namangan.netlify.app`,
    { parse_mode: "Markdown", reply_markup: mainKb() }
  );
  return bot.sendMessage(id, "Buyurtma berish uchun quyidagi tugmani bosing 👇", {
    reply_markup: { inline_keyboard: [[{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }]] }
  });
});

bot.on("callback_query", async (q) => {
  const id = q.message.chat.id, data = q.data;
  await bot.answerCallbackQuery(q.id);

  if (data.startsWith("s_") && id === ADMIN_ID) {
    const [, oid, status] = data.split("_");
    const order = await Order.findByIdAndUpdate(oid, { status }, { new: true });
    if (!order) return;
    await Promise.all([
      bot.editMessageReplyMarkup(adminKb(oid), { chat_id: ADMIN_ID, message_id: q.message.message_id }),
      bot.sendMessage(ADMIN_ID, `✅ *#${oid.slice(-6).toUpperCase()}* → *${STATUS[status]}*`, { parse_mode: "Markdown" }),
    ]);
    sendToUser(order.userId, "order_update", { orderId: oid, status, statusLabel: STATUS[status] });
    sendToAdmin("order_updated", { orderId: oid, status });
    try { await bot.sendMessage(order.userId, `🔔 *Buyurtma #${oid.slice(-6).toUpperCase()}*\n\nHolat: *${STATUS[status]}*\n\nRahmat! 🙏`, { parse_mode: "Markdown" }); } catch {}
    return;
  }
  if (data === "my_orders") {
    const orders = await Order.find({ userId: id }).sort({ createdAt: -1 }).limit(5);
    if (!orders.length) return bot.sendMessage(id, "📭 Hali buyurtma berilmagan.", { reply_markup: mainKb() });
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach(o => { txt += `*#${o._id.toString().slice(-6).toUpperCase()}*\n└ ${STATUS[o.status]} — ${fmt(o.total)} so'm\n\n`; });
    return bot.sendMessage(id, txt, { parse_mode: "Markdown", reply_markup: mainKb() });
  }
  if (data === "contact") return bot.sendMessage(id, `📞 *Bog'lanish:*\n\n📱 +998 90 699 95 95\n💬 @Holland_fries`, { parse_mode: "Markdown", reply_markup: mainKb() });
});

// ══════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════
app.post("/api/orders", async (req, res) => {
  try {
    const { userId, name, phone, address, note, gps, items, total } = req.body;
    if (!name || !phone || !address || !items?.length) return res.json({ success: false, error: "Ma'lumotlar to'liq emas" });
    const order = await Order.create({ userId, name, phone, address, note: note||"", gpsLat: gps?.lat||null, gpsLng: gps?.lng||null, items, total });
    broadcastStats();
    if (ADMIN_ID) {
      let txt = `🛎 *Yangi buyurtma #${order._id.toString().slice(-6).toUpperCase()}*\n\n`;
      txt += `👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.address}\n`;
      if (order.gpsLat) txt += `🗺 [Xaritada](https://maps.google.com/?q=${order.gpsLat},${order.gpsLng})\n`;
      if (order.note)   txt += `💬 ${order.note}\n`;
      txt += `\n📦 *Tarkibi:*\n`;
      order.items.forEach(i => { txt += `• ${i.name} × ${i.qty} = ${fmt(i.price*i.qty)} so'm\n`; });
      txt += `\n💰 *Jami: ${fmt(order.total)} so'm*`;
      await bot.sendMessage(ADMIN_ID, txt, { parse_mode: "Markdown", reply_markup: adminKb(order._id.toString()) });
    }
    sendToUser(userId, "new_order", { orderId: order._id.toString(), status: "new", total: order.total, items: order.items });
    sendToAdmin("new_order", { order: { ...order.toObject(), id: order._id } });
    res.json({ success: true, orderId: order._id });
  } catch (e) { console.error(e); res.json({ success: false, error: e.message }); }
});

app.get("/api/orders/user/:uid", async (req, res) => {
  try { res.json(await Order.find({ userId: Number(req.params.uid) }).sort({ createdAt: -1 }).limit(30)); }
  catch { res.json([]); }
});

// Admin API routes
app.use("/api/admin", (req, res, next) => {
  if (req.query.pass === ADMIN_PASS || req.headers["x-admin-pass"] === ADMIN_PASS) return next();
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
    const [users, totalOrders, todayOrders, weekOrders, pending, todaySumArr, weekSumArr, statusCounts] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: todayStart } }),
      Order.countDocuments({ createdAt: { $gte: weekStart } }),
      Order.countDocuments({ status: { $in: ["new","accepted","cooking"] } }),
      Order.aggregate([{ $match: { createdAt:{ $gte: todayStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $match: { createdAt:{ $gte: weekStart }, status:{ $ne:"cancelled" } } }, { $group:{ _id:null, total:{ $sum:"$total" } } }]),
      Order.aggregate([{ $group:{ _id:"$status", count:{ $sum:1 } } }]),
    ]);
    const daily = await Order.aggregate([
      { $match: { createdAt:{ $gte: weekStart } } },
      { $group:{ _id:{ $dateToString:{ format:"%Y-%m-%d", date:"$createdAt" } }, count:{ $sum:1 }, total:{ $sum:"$total" } } },
      { $sort:{ _id:1 } }
    ]);
    res.json({
      users, totalOrders, todayOrders, weekOrders, pending,
      todaySum: todaySumArr[0]?.total || 0,
      weekSum:  weekSumArr[0]?.total  || 0,
      statusCounts, daily,
    });
  } catch(e) { res.json({ error: e.message }); }
});

app.get("/api/stats", async (req, res) => {
  try { res.json({ users: await User.countDocuments(), orders: await Order.countDocuments() }); }
  catch { res.json({ users: 0, orders: 0 }); }
});

// Admin panel HTML
app.get("/admin", (req, res) => {
  if (req.query.pass !== ADMIN_PASS) {
    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Holland Admin</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .box{background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.1);width:320px}
    h2{font-size:20px;margin-bottom:20px;color:#111}input{width:100%;padding:12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:15px;margin-bottom:12px;outline:none}
    button{width:100%;padding:14px;background:#E8342A;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}</style></head>
    <body><div class="box"><h2>🍔 Holland Admin</h2>
    <form method="get"><input type="password" name="pass" placeholder="Parol..." autofocus/><button type="submit">Kirish</button></form></div></body></html>`);
  }
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => res.json({ ok: true, service: "Holland API ✅" }));
app.listen(PORT, () => console.log(`✅ Holland API: http://localhost:${PORT}`));
