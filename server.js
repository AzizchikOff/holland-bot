require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

app.use(cors());
app.use(express.json());

// ── SQLite ─────────────────────────────────
const db = new Database(path.join(__dirname, "holland.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    address    TEXT NOT NULL,
    note       TEXT DEFAULT '',
    gps_lat    REAL,
    gps_lng    REAL,
    items      TEXT NOT NULL,
    total      INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// ── Helpers ────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

const STATUS = {
  new: "🆕 Yangi",
  accepted: "✅ Qabul qilindi",
  cooking: "🍳 Tayyorlanmoqda",
  delivered: "🚀 Yetkazildi",
  cancelled: "❌ Bekor qilindi",
};

function adminKb(id) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Qabul", callback_data: `s_${id}_accepted` },
        { text: "🍳 Tayyorlanmoqda", callback_data: `s_${id}_cooking` },
      ],
      [
        { text: "🚀 Yetkazildi", callback_data: `s_${id}_delivered` },
        { text: "❌ Bekor", callback_data: `s_${id}_cancelled` },
      ],
    ],
  };
}

// ── ROUTES ─────────────────────────────────

// Buyurtma yaratish
app.post("/api/orders", async (req, res) => {
  try {
    const { userId, name, phone, address, note, gps, items, total } = req.body;
    if (!name || !phone || !address || !items?.length)
      return res.json({ success: false, error: "Ma'lumotlar to'liq emas" });

    const r = db
      .prepare(
        `
      INSERT INTO orders (user_id,name,phone,address,note,gps_lat,gps_lng,items,total)
      VALUES (?,?,?,?,?,?,?,?,?)
    `,
      )
      .run(
        userId,
        name,
        phone,
        address,
        note || "",
        gps?.lat || null,
        gps?.lng || null,
        JSON.stringify(items),
        total,
      );

    const order = db
      .prepare("SELECT * FROM orders WHERE id=?")
      .get(r.lastInsertRowid);
    const pItems = JSON.parse(order.items);

    // Admin xabar
    if (ADMIN_ID) {
      let txt = `🛎 *Yangi buyurtma #${order.id}*\n\n`;
      txt += `👤 ${order.name}\n`;
      txt += `📞 ${order.phone}\n`;
      txt += `📍 ${order.address}\n`;
      if (order.gps_lat)
        txt += `🗺 [Xaritada ko'rish](https://maps.google.com/?q=${order.gps_lat},${order.gps_lng})\n`;
      if (order.note) txt += `💬 ${order.note}\n`;
      txt += `\n📦 *Tarkibi:*\n`;
      pItems.forEach((i) => {
        txt += `• ${i.name} × ${i.qty} = ${fmt(i.price * i.qty)} so'm\n`;
      });
      txt += `\n💰 *Jami: ${fmt(order.total)} so'm*`;
      await bot.sendMessage(ADMIN_ID, txt, {
        parse_mode: "Markdown",
        reply_markup: adminKb(order.id),
      });
    }
    res.json({ success: true, orderId: order.id });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: e.message });
  }
});

// Foydalanuvchi buyurtmalari
app.get("/api/orders/user/:uid", (req, res) => {
  try {
    const rows = db
      .prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 30")
      .all(req.params.uid);
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// Barcha buyurtmalar (admin)
app.get("/api/orders", (req, res) => {
  try {
    res.json(
      db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 100").all(),
    );
  } catch {
    res.json([]);
  }
});

// Health
app.get("/", (req, res) => res.json({ ok: true, service: "Holland API ✅" }));

// ── Bot callback (admin holat yangilash) ───
bot.on("callback_query", async (q) => {
  if (!q.data.startsWith("s_")) return;
  if (q.message.chat.id !== ADMIN_ID) return;

  const [, idStr, status] = q.data.split("_");
  const id = Number(idStr);
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, id);
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  if (!order) return;

  await bot.answerCallbackQuery(q.id, { text: STATUS[status] || status });
  await bot.editMessageReplyMarkup(adminKb(id), {
    chat_id: ADMIN_ID,
    message_id: q.message.message_id,
  });
  await bot.sendMessage(ADMIN_ID, `✅ *#${order.id}* → *${STATUS[status]}*`, {
    parse_mode: "Markdown",
  });

  // Mijozga xabar
  try {
    await bot.sendMessage(
      order.user_id,
      `🔔 *Buyurtma #${order.id}*\n\nHolat: *${STATUS[status]}*\n\nRahmat! 🙏`,
      { parse_mode: "Markdown" },
    );
  } catch {}
});

bot.startPolling();
app.listen(PORT, () => console.log(`✅ Holland API: http://localhost:${PORT}`));
