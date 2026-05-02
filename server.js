require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const mongoose    = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");

const app      = express();
const PORT     = process.env.PORT || 3000;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const bot      = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

app.use(cors());
app.use(express.json());

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
//  SSE — Real-time ulanishlar
// ══════════════════════════════════════════
const clients = new Map(); // userId → [res, res, ...]

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, []);
  clients.get(userId).push(res);
}

function removeClient(userId, res) {
  if (!clients.has(userId)) return;
  const list = clients.get(userId).filter(r => r !== res);
  if (list.length === 0) clients.delete(userId);
  else clients.set(userId, list);
}

function sendToUser(userId, event, data) {
  const list = clients.get(userId);
  if (!list) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  list.forEach(res => { try { res.write(msg); } catch {} });
}

function broadcastStats() {
  (async () => {
    const users  = await User.countDocuments();
    const orders = await Order.countDocuments();
    const msg = `event: stats\ndata: ${JSON.stringify({ users, orders })}\n\n`;
    clients.forEach(list => {
      list.forEach(res => { try { res.write(msg); } catch {} });
    });
  })();
}

// Stats ni har 30 sekundda broadcast qilish
setInterval(broadcastStats, 30000);

// ── SSE endpoint ───────────────────────────
app.get("/api/stream/:userId", (req, res) => {
  const userId = Number(req.params.userId);

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Dastlabki ping
  res.write(`event: connected\ndata: {"ok":true}\n\n`);

  // Darhol joriy statistika yuborish
  (async () => {
    const users  = await User.countDocuments();
    const orders = await Order.countDocuments();
    res.write(`event: stats\ndata: ${JSON.stringify({ users, orders })}\n\n`);

    // Foydalanuvchi buyurtmalarini ham yuborish
    if (userId) {
      const userOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(10);
      res.write(`event: orders\ndata: ${JSON.stringify(userOrders)}\n\n`);
    }
  })();

  // Keep-alive ping har 20 sekund
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 20000);

  addClient(userId, res);

  req.on("close", () => {
    clearInterval(ping);
    removeClient(userId, res);
  });
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

const MINI_APP_URL = "https://holland-namangan.netlify.app/app/";

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
    resize_keyboard: true,
    persistent: true,
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
//  BOT — /start
// ══════════════════════════════════════════
bot.onText(/\/start/, async (msg) => {
  const id   = msg.chat.id;
  const name = msg.chat.first_name || "Mehmon";
  await saveUser(msg);

  const userCount  = await User.countDocuments();
  const orderCount = await Order.countDocuments({ userId: id });
  const lastOrder  = await Order.findOne({ userId: id }).sort({ createdAt: -1 });

  let text = `🍔 *Holland Fast Food*\n\n`;
  text += `Assalomu alaykum, *${name}*! Xush kelibsiz 👋\n\n`;
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
        [{ text: "📦 Buyurtmalarim",   callback_data: "my_orders" },
         { text: "📞 Bog'lanish",      callback_data: "contact"   }],
      ],
    },
  });

  await bot.sendMessage(id, "Yoki pastdagi tugmalardan foydalaning 👇", {
    reply_markup: mainKb(),
  });
});

// ── /admin ─────────────────────────────────
bot.onText(/\/admin/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  const userCount   = await User.countDocuments();
  const orderCount  = await Order.countDocuments();
  const todayStart  = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayOrders = await Order.countDocuments({ createdAt: { $gte: todayStart } });
  const todaySum    = await Order.aggregate([
    { $match: { createdAt: { $gte: todayStart }, status: { $ne: "cancelled" } } },
    { $group: { _id: null, total: { $sum: "$total" } } },
  ]);
  const pendingCount = await Order.countDocuments({ status: { $in: ["new", "accepted", "cooking"] } });

  let text = `📊 *Holland Admin Panel*\n\n`;
  text += `👥 Jami foydalanuvchilar: *${userCount}*\n`;
  text += `📦 Jami buyurtmalar: *${orderCount}*\n`;
  text += `📅 Bugungi buyurtmalar: *${todayOrders}*\n`;
  text += `⏳ Jarayondagi: *${pendingCount}*\n`;
  text += `💰 Bugungi tushum: *${fmt(todaySum[0]?.total || 0)} so'm*`;

  await bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
});

// ── Text messages ───────────────────────────
bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/")) return;
  if (msg.web_app_data) return;
  await saveUser(msg);

  const id   = msg.chat.id;
  const text = msg.text || "";

  if (text === "📦 Buyurtmalarim") {
    const orders = await Order.find({ userId: id }).sort({ createdAt: -1 }).limit(5);
    if (!orders.length) {
      return bot.sendMessage(id,
        "📭 Hali buyurtma berilmagan.\n\n🍔 Birinchi buyurtmangizni bering!",
        { reply_markup: { inline_keyboard: [[{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }]] } }
      );
    }
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach(o => {
      txt += `*#${o._id.toString().slice(-6).toUpperCase()}*\n`;
      txt += `└ ${STATUS[o.status]} — ${fmt(o.total)} so'm\n`;
      txt += `   📅 ${o.createdAt.toLocaleDateString("uz-UZ")}\n\n`;
    });
    return bot.sendMessage(id, txt, { parse_mode: "Markdown", reply_markup: mainKb() });
  }

  if (text === "ℹ️ Biz haqimizda") {
    return bot.sendMessage(id,
      `🏪 *Holland Fast Food*\n\n📍 G'alaba ko'chasi 1a, Namangan\n⏰ Ish vaqti: 11:00 – 01:00\n📞 +998 90 699 95 95\n\n✅ 100% Halol mahsulot`,
      { parse_mode: "Markdown", reply_markup: mainKb() }
    );
  }

  if (text === "📞 Bog'lanish") {
    return bot.sendMessage(id,
      `📞 *Bog'lanish:*\n\n📱 +998 90 699 95 95\n💬 @Holland_fries\n🌐 holland-namangan.netlify.app`,
      { parse_mode: "Markdown", reply_markup: mainKb() }
    );
  }

  return bot.sendMessage(id, "Buyurtma berish uchun quyidagi tugmani bosing 👇", {
    reply_markup: { inline_keyboard: [[{ text: "🍔 Buyurtma berish", web_app: { url: MINI_APP_URL } }]] },
  });
});

// ── Callback queries ────────────────────────
bot.on("callback_query", async (q) => {
  const id   = q.message.chat.id;
  const data = q.data;
  await bot.answerCallbackQuery(q.id);

  // Admin: holat yangilash
  if (data.startsWith("s_") && id === ADMIN_ID) {
    const parts  = data.split("_");
    const oid    = parts[1];
    const status = parts[2];

    const order = await Order.findByIdAndUpdate(oid, { status }, { new: true });
    if (!order) return;

    await bot.editMessageReplyMarkup(adminKb(oid), {
      chat_id: ADMIN_ID, message_id: q.message.message_id,
    });
    await bot.sendMessage(ADMIN_ID,
      `✅ *#${oid.slice(-6).toUpperCase()}* → *${STATUS[status]}*`,
      { parse_mode: "Markdown" }
    );

    // ✅ Real-time: Mini App ga SSE orqali yuborish
    sendToUser(order.userId, "order_update", {
      orderId: oid,
      status,
      statusLabel: STATUS[status],
    });

    // Mijozga Telegram xabari
    try {
      await bot.sendMessage(order.userId,
        `🔔 *Buyurtma #${oid.slice(-6).toUpperCase()}*\n\nYangi holat: *${STATUS[status]}*\n\nRahmat! 🙏`,
        { parse_mode: "Markdown" }
      );
    } catch {}
    return;
  }

  if (data === "my_orders") {
    const orders = await Order.find({ userId: id }).sort({ createdAt: -1 }).limit(5);
    if (!orders.length) {
      return bot.sendMessage(id, "📭 Hali buyurtma berilmagan.", { reply_markup: mainKb() });
    }
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach(o => {
      txt += `*#${o._id.toString().slice(-6).toUpperCase()}*\n`;
      txt += `└ ${STATUS[o.status]} — ${fmt(o.total)} so'm\n\n`;
    });
    return bot.sendMessage(id, txt, { parse_mode: "Markdown", reply_markup: mainKb() });
  }

  if (data === "contact") {
    return bot.sendMessage(id,
      `📞 *Bog'lanish:*\n\n📱 +998 90 699 95 95\n💬 @Holland_fries`,
      { parse_mode: "Markdown", reply_markup: mainKb() }
    );
  }
});

// ══════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════

// Buyurtma yaratish
app.post("/api/orders", async (req, res) => {
  try {
    const { userId, name, phone, address, note, gps, items, total } = req.body;
    if (!name || !phone || !address || !items?.length)
      return res.json({ success: false, error: "Ma'lumotlar to'liq emas" });

    const order = await Order.create({
      userId, name, phone, address,
      note:   note || "",
      gpsLat: gps?.lat || null,
      gpsLng: gps?.lng || null,
      items, total,
    });

    // ✅ Real-time: stats yangilash
    broadcastStats();

    // Adminga xabar
    if (ADMIN_ID) {
      let txt = `🛎 *Yangi buyurtma #${order._id.toString().slice(-6).toUpperCase()}*\n\n`;
      txt += `👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.address}\n`;
      if (order.gpsLat) txt += `🗺 [Xaritada ko'rish](https://maps.google.com/?q=${order.gpsLat},${order.gpsLng})\n`;
      if (order.note)   txt += `💬 ${order.note}\n`;
      txt += `\n📦 *Tarkibi:*\n`;
      order.items.forEach(i => { txt += `• ${i.name} × ${i.qty} = ${fmt(i.price * i.qty)} so'm\n`; });
      txt += `\n💰 *Jami: ${fmt(order.total)} so'm*`;
      await bot.sendMessage(ADMIN_ID, txt, {
        parse_mode: "Markdown",
        reply_markup: adminKb(order._id.toString()),
      });
    }

    // ✅ Real-time: Mini App dagi profil sahifasini yangilash
    sendToUser(userId, "new_order", {
      orderId: order._id.toString(),
      status:  "new",
      total:   order.total,
      items:   order.items,
    });

    res.json({ success: true, orderId: order._id });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: e.message });
  }
});

// Foydalanuvchi buyurtmalari
app.get("/api/orders/user/:uid", async (req, res) => {
  try {
    const orders = await Order.find({ userId: Number(req.params.uid) })
      .sort({ createdAt: -1 }).limit(30);
    res.json(orders);
  } catch { res.json([]); }
});

// Barcha buyurtmalar
app.get("/api/orders", async (req, res) => {
  try {
    res.json(await Order.find().sort({ createdAt: -1 }).limit(100));
  } catch { res.json([]); }
});

// Statistika
app.get("/api/stats", async (req, res) => {
  try {
    const users  = await User.countDocuments();
    const orders = await Order.countDocuments();
    res.json({ users, orders });
  } catch { res.json({ users: 0, orders: 0 }); }
});

// Health
app.get("/", (req, res) => res.json({ ok: true, service: "Holland API ✅" }));

app.listen(PORT, () => console.log(`✅ Holland API: http://localhost:${PORT}`));