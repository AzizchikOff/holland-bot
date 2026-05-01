require("dotenv").config();
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

app.use(cors());
app.use(express.json());

// ── SQLite ─────────────────────────────────
const db = new sqlite3.Database(path.join(__dirname, "holland.db"));

db.run(`
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
  )
`);

// ── Helpers ────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}
function dbRun(sql, params = []) {
  return new Promise((res, rej) =>
    db.run(sql, params, function (e) {
      e ? rej(e) : res(this);
    }),
  );
}
function dbGet(sql, params = []) {
  return new Promise((res, rej) =>
    db.get(sql, params, (e, row) => (e ? rej(e) : res(row))),
  );
}
function dbAll(sql, params = []) {
  return new Promise((res, rej) =>
    db.all(sql, params, (e, rows) => (e ? rej(e) : res(rows))),
  );
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

    const r = await dbRun(
      `
      INSERT INTO orders (user_id,name,phone,address,note,gps_lat,gps_lng,items,total)
      VALUES (?,?,?,?,?,?,?,?,?)
    `,
      [
        userId,
        name,
        phone,
        address,
        note || "",
        gps?.lat || null,
        gps?.lng || null,
        JSON.stringify(items),
        total,
      ],
    );

    const order = await dbGet("SELECT * FROM orders WHERE id=?", [r.lastID]);
    const pItems = JSON.parse(order.items);

    // Adminga xabar
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
app.get("/api/orders/user/:uid", async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 30",
      [req.params.uid],
    );
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// Barcha buyurtmalar
app.get("/api/orders", async (req, res) => {
  try {
    res.json(await dbAll("SELECT * FROM orders ORDER BY id DESC LIMIT 100"));
  } catch {
    res.json([]);
  }
});

// Health check
app.get("/", (req, res) => res.json({ ok: true, service: "Holland API ✅" }));

// ── Bot callback ───────────────────────────
bot.on("callback_query", async (q) => {
  if (!q.data.startsWith("s_")) return;
  if (q.message.chat.id !== ADMIN_ID) return;

  const [, idStr, status] = q.data.split("_");
  const id = Number(idStr);

  await dbRun("UPDATE orders SET status=? WHERE id=?", [status, id]);
  const order = await dbGet("SELECT * FROM orders WHERE id=?", [id]);
  if (!order) return;

  await bot.answerCallbackQuery(q.id, { text: STATUS[status] || status });
  await bot.editMessageReplyMarkup(adminKb(id), {
    chat_id: ADMIN_ID,
    message_id: q.message.message_id,
  });
  await bot.sendMessage(ADMIN_ID, `✅ *#${order.id}* → *${STATUS[status]}*`, {
    parse_mode: "Markdown",
  });

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
