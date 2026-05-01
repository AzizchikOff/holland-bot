// ============================================================
//  Holland Fast Food — Professional Telegram Bot
//  Stack: node-telegram-bot-api + MongoDB + dotenv
// ============================================================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const connectDB = require("./db");
const Order = require("./models/order");
const { formatSum, MENU, CATEGORIES } = require("./data");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = Number(process.env.ADMIN_ID);

// ── In-memory state (userId → { step, cart, name, phone, address }) ──
const STATE = {};

function getState(id) {
  if (!STATE[id])
    STATE[id] = { step: null, cart: {}, name: "", phone: "", address: "" };
  return STATE[id];
}
function clearState(id) {
  STATE[id] = { step: null, cart: {}, name: "", phone: "", address: "" };
}

// ─────────────────────────────────────────────
//  KEYBOARDS
// ─────────────────────────────────────────────
function mainMenuKeyboard() {
  return {
    keyboard: [
      [" Menu", " Savat"],
      [" Buyurtmalarim", "ℹ Biz haqimizda"],
      ["Bog'lanish"],
    ],
    resize_keyboard: true,
    persistent: true,
  };
}

function categoryKeyboard() {
  const rows = CATEGORIES.map((c) => [
    { text: c.label, callback_data: `cat_${c.id}` },
  ]);
  rows.push([{ text: "🏠 Bosh sahifa", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function productsKeyboard(catId, cart) {
  const items = MENU.filter((p) => p.category === catId);
  const rows = items.map((p) => {
    const qty = cart[p.id]?.qty || 0;
    const label =
      qty > 0
        ? `${p.name} — ${formatSum(p.price)} so'm  [${qty} ta]`
        : `${p.name} — ${formatSum(p.price)} so'm`;
    return [{ text: label, callback_data: `add_${p.id}` }];
  });
  rows.push([
    { text: "⬅️ Kategoriyalar", callback_data: "menu" },
    { text: "🛒 Savat", callback_data: "cart" },
  ]);
  return { inline_keyboard: rows };
}

function cartKeyboard(cart) {
  const rows = [];
  Object.values(cart).forEach((it) => {
    rows.push([
      { text: `➖`, callback_data: `dec_${it.product.id}` },
      { text: `${it.product.name} x${it.qty}`, callback_data: `noop` },
      { text: `➕`, callback_data: `inc_${it.product.id}` },
    ]);
  });
  rows.push([{ text: "🗑 Savatni tozalash", callback_data: "clear_cart" }]);
  rows.push([
    { text: "⬅️ Menu", callback_data: "menu" },
    { text: "✅ Buyurtma berish", callback_data: "checkout" },
  ]);
  return { inline_keyboard: rows };
}

function adminOrderKeyboard(orderId) {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Qabul qilindi",
          callback_data: `status_${orderId}_accepted`,
        },
        {
          text: "🍳 Tayyorlanmoqda",
          callback_data: `status_${orderId}_cooking`,
        },
      ],
      [
        { text: "🚀 Yetkazildi", callback_data: `status_${orderId}_delivered` },
        {
          text: "❌ Bekor qilindi",
          callback_data: `status_${orderId}_cancelled`,
        },
      ],
    ],
  };
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function cartTotal(cart) {
  return Object.values(cart).reduce(
    (sum, it) => sum + it.product.price * it.qty,
    0,
  );
}

function cartText(cart) {
  const items = Object.values(cart);
  if (!items.length) return "Savat bo'sh.";
  let text = "🛒 *Savat:*\n\n";
  items.forEach((it) => {
    text += `• ${it.product.name} × ${it.qty} = *${formatSum(it.product.price * it.qty)} so'm*\n`;
  });
  text += `\n💰 *Jami: ${formatSum(cartTotal(cart))} so'm*`;
  return text;
}

function orderText(order) {
  let text = `📦 *Yangi buyurtma #${order.orderNumber}*\n\n`;
  text += `👤 ${order.name}\n`;
  text += `📞 ${order.phone}\n`;
  text += `📍 ${order.address}\n\n`;
  text += `*Buyurtma:*\n`;
  order.items.forEach((it) => {
    text += `• ${it.name} × ${it.qty} = ${formatSum(it.price * it.qty)} so'm\n`;
  });
  text += `\n💰 *Jami: ${formatSum(order.total)} so'm*`;
  return text;
}

const STATUS_LABELS = {
  new: "🆕 Yangi",
  accepted: "✅ Qabul qilindi",
  cooking: "🍳 Tayyorlanmoqda",
  delivered: "🚀 Yetkazildi",
  cancelled: "❌ Bekor qilindi",
};

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id;
  const name = msg.chat.first_name || "Mehmon";
  clearState(id);
  await bot.sendMessage(
    id,
    `🍔 *Holland Fast Food*'ga xush kelibsiz, *${name}*!\n\n` +
      `Mazali fast food — 10–15 daqiqada yetkazib beramiz.\n` +
      `Halol • Issiq • Tez\n\n` +
      `Pastdagi tugmalardan foydalaning 👇`,
    { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() },
  );
});

// ─────────────────────────────────────────────
//  TEXT MESSAGES (reply keyboard)
// ─────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/")) return;
  const id = msg.chat.id;
  const text = msg.text || "";
  const state = getState(id);

  // ── Buyurtma oqimi ──────────────────────────
  if (state.step === "name") {
    if (!text.trim()) {
      return bot.sendMessage(id, "Iltimos, ismingizni kiriting:");
    }
    state.name = text.trim();
    state.step = "phone";
    return bot.sendMessage(
      id,
      "📞 Telefon raqamingizni kiriting:\n_(masalan: +998901234567)_",
      {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "📱 Raqamni yuborish", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
    );
  }

  if (state.step === "phone") {
    const phone = msg.contact?.phone_number || text.trim();
    if (!phone) return bot.sendMessage(id, "Iltimos, telefon raqam kiriting:");
    state.phone = phone;
    state.step = "address";
    return bot.sendMessage(
      id,
      "📍 Manzilingizni kiriting:\n_(ko'cha, uy, mo'ljal)_",
      { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } },
    );
  }

  if (state.step === "address") {
    if (!text.trim()) return bot.sendMessage(id, "Iltimos, manzil kiriting:");
    state.address = text.trim();
    state.step = "confirm";

    const summary =
      cartText(state.cart) +
      `\n\n👤 *Ism:* ${state.name}` +
      `\n📞 *Tel:* ${state.phone}` +
      `\n📍 *Manzil:* ${state.address}`;

    return bot.sendMessage(id, summary, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Tasdiqlash", callback_data: "confirm_order" },
            { text: "❌ Bekor qilish", callback_data: "cancel_order" },
          ],
        ],
      },
    });
  }

  // ── Reply keyboard ───────────────────────────
  if (text === "🍔 Menu") {
    return bot.sendMessage(id, "📋 *Kategoriyani tanlang:*", {
      parse_mode: "Markdown",
      reply_markup: categoryKeyboard(),
    });
  }

  if (text === "🛒 Savat") {
    const cart = state.cart;
    if (!Object.keys(cart).length) {
      return bot.sendMessage(
        id,
        "🛒 Savat bo'sh.\nMenu'dan mahsulot qo'shing 👇",
        {
          reply_markup: categoryKeyboard(),
        },
      );
    }
    return bot.sendMessage(id, cartText(cart), {
      parse_mode: "Markdown",
      reply_markup: cartKeyboard(cart),
    });
  }

  if (text === "📦 Buyurtmalarim") {
    const orders = await Order.find({ userId: id })
      .sort({ createdAt: -1 })
      .limit(5);
    if (!orders.length) {
      return bot.sendMessage(id, "📭 Hali buyurtma berilmagan.", {
        reply_markup: mainMenuKeyboard(),
      });
    }
    let txt = "📦 *So'nggi buyurtmalaringiz:*\n\n";
    orders.forEach((o) => {
      const date = o.createdAt.toLocaleDateString("uz-UZ");
      txt += `*#${o.orderNumber}* — ${date}\n`;
      txt += `Holati: ${STATUS_LABELS[o.status] || o.status}\n`;
      txt += `Jami: ${formatSum(o.total)} so'm\n\n`;
    });
    return bot.sendMessage(id, txt, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  }

  if (text === "ℹ️ Biz haqimizda") {
    return bot.sendMessage(
      id,
      `🏪 *Holland Fast Food*\n\n` +
        `📍 G'alaba ko'chasi 1a, Namangan\n` +
        `⏰ Ish vaqti: 11:00 – 01:00\n` +
        `📞 +998 (90) 699 95 95\n\n` +
        `Har bir buyurtma yangi tayyorlanadi.\n` +
        `✅ 100% Halol mahsulot`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() },
    );
  }

  if (text === "📞 Bog'lanish") {
    return bot.sendMessage(
      id,
      `📞 *Bog'lanish:*\n\n` +
        `Telefon: [+998 90 699 95 95](tel:+998906999595)\n` +
        `Telegram: @Holland\\_fries\n` +
        `Sayt: hollandfries.netlify.app`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() },
    );
  }
});

// ─────────────────────────────────────────────
//  CALLBACK QUERIES
// ─────────────────────────────────────────────
bot.on("callback_query", async (q) => {
  const id = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;
  const state = getState(id);

  await bot.answerCallbackQuery(q.id);

  // ── Navigatsiya ─────────────────────────────
  if (data === "home") {
    await bot.editMessageText("🏠 Bosh sahifa", {
      chat_id: id,
      message_id: msgId,
      reply_markup: {
        inline_keyboard: [[{ text: "🍔 Menu", callback_data: "menu" }]],
      },
    });
    return;
  }

  if (data === "menu") {
    await bot.editMessageText("📋 *Kategoriyani tanlang:*", {
      chat_id: id,
      message_id: msgId,
      parse_mode: "Markdown",
      reply_markup: categoryKeyboard(),
    });
    return;
  }

  if (data === "cart") {
    const cart = state.cart;
    const txt = Object.keys(cart).length ? cartText(cart) : "🛒 Savat bo'sh.";
    await bot.editMessageText(txt, {
      chat_id: id,
      message_id: msgId,
      parse_mode: "Markdown",
      reply_markup: Object.keys(cart).length
        ? cartKeyboard(cart)
        : { inline_keyboard: [[{ text: "🍔 Menu", callback_data: "menu" }]] },
    });
    return;
  }

  if (data === "noop") return;

  // ── Kategoriya ──────────────────────────────
  if (data.startsWith("cat_")) {
    const catId = data.replace("cat_", "");
    const cat = CATEGORIES.find((c) => c.id === catId);
    await bot.editMessageText(
      `📂 *${cat?.label || "Mahsulotlar"}*\nQo'shish uchun bosing 👇`,
      {
        chat_id: id,
        message_id: msgId,
        parse_mode: "Markdown",
        reply_markup: productsKeyboard(catId, state.cart),
      },
    );
    return;
  }

  // ── Mahsulot qo'shish ────────────────────────
  if (data.startsWith("add_")) {
    const pid = data.replace("add_", "");
    const product = MENU.find((p) => p.id === pid);
    if (!product) return;

    if (!state.cart[pid]) state.cart[pid] = { product, qty: 0 };
    state.cart[pid].qty = Math.min(99, state.cart[pid].qty + 1);

    await bot.answerCallbackQuery(q.id, {
      text: `✅ ${product.name} qo'shildi`,
      show_alert: false,
    });
    await bot.editMessageReplyMarkup(
      productsKeyboard(product.category, state.cart),
      { chat_id: id, message_id: msgId },
    );
    return;
  }

  // ── Miqdor oshirish ──────────────────────────
  if (data.startsWith("inc_")) {
    const pid = data.replace("inc_", "");
    if (state.cart[pid]) {
      state.cart[pid].qty = Math.min(99, state.cart[pid].qty + 1);
    }
    const cart = state.cart;
    const txt = Object.keys(cart).length ? cartText(cart) : "🛒 Savat bo'sh.";
    await bot.editMessageText(txt, {
      chat_id: id,
      message_id: msgId,
      parse_mode: "Markdown",
      reply_markup: cartKeyboard(cart),
    });
    return;
  }

  // ── Miqdor kamaytirish ────────────────────────
  if (data.startsWith("dec_")) {
    const pid = data.replace("dec_", "");
    if (state.cart[pid]) {
      state.cart[pid].qty -= 1;
      if (state.cart[pid].qty <= 0) delete state.cart[pid];
    }
    const cart = state.cart;
    if (!Object.keys(cart).length) {
      await bot.editMessageText(
        "🛒 Savat bo'sh.\nMenu'dan mahsulot qo'shing:",
        {
          chat_id: id,
          message_id: msgId,
          reply_markup: categoryKeyboard(),
        },
      );
    } else {
      await bot.editMessageText(cartText(cart), {
        chat_id: id,
        message_id: msgId,
        parse_mode: "Markdown",
        reply_markup: cartKeyboard(cart),
      });
    }
    return;
  }

  // ── Savatni tozalash ─────────────────────────
  if (data === "clear_cart") {
    state.cart = {};
    await bot.editMessageText("🗑 Savat tozalandi.", {
      chat_id: id,
      message_id: msgId,
      reply_markup: {
        inline_keyboard: [[{ text: "🍔 Menu", callback_data: "menu" }]],
      },
    });
    return;
  }

  // ── Checkout ─────────────────────────────────
  if (data === "checkout") {
    if (!Object.keys(state.cart).length) {
      await bot.answerCallbackQuery(q.id, {
        text: "Savat bo'sh!",
        show_alert: true,
      });
      return;
    }
    state.step = "name";
    await bot.sendMessage(id, "👤 Ismingizni kiriting:", {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  // ── Buyurtmani tasdiqlash ─────────────────────
  if (data === "confirm_order") {
    const items = Object.values(state.cart).map((it) => ({
      name: it.product.name,
      price: it.product.price,
      qty: it.qty,
    }));
    const total = cartTotal(state.cart);

    // Oxirgi buyurtma raqamini topish
    const lastOrder = await Order.findOne().sort({ orderNumber: -1 });
    const orderNumber = (lastOrder?.orderNumber || 0) + 1;

    const order = await Order.create({
      userId: id,
      orderNumber,
      name: state.name,
      phone: state.phone,
      address: state.address,
      items,
      total,
      status: "new",
    });

    await bot.sendMessage(
      id,
      `✅ *Buyurtmangiz qabul qilindi!*\n\n` +
        `📦 Buyurtma raqami: *#${orderNumber}*\n` +
        `⏱ 10–15 daqiqada yetkazib beramiz.\n\n` +
        `Buyurtma holati uchun "📦 Buyurtmalarim" ni bosing.`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() },
    );

    // Adminga xabar
    if (ADMIN_ID) {
      await bot.sendMessage(ADMIN_ID, orderText(order), {
        parse_mode: "Markdown",
        reply_markup: adminOrderKeyboard(order._id.toString()),
      });
    }

    clearState(id);
    return;
  }

  // ── Buyurtmani bekor qilish ───────────────────
  if (data === "cancel_order") {
    clearState(id);
    await bot.sendMessage(id, "❌ Buyurtma bekor qilindi.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  // ── Admin: buyurtma holati ────────────────────
  if (data.startsWith("status_")) {
    if (id !== ADMIN_ID) return;
    const parts = data.split("_");
    const orderId = parts[1];
    const status = parts[2];

    const order = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true },
    );
    if (!order) return bot.sendMessage(ADMIN_ID, "Buyurtma topilmadi.");

    // Adminga yangilangan klaviatura
    await bot.editMessageReplyMarkup(adminOrderKeyboard(orderId), {
      chat_id: ADMIN_ID,
      message_id: q.message.message_id,
    });
    await bot.sendMessage(
      ADMIN_ID,
      `✅ *#${order.orderNumber}* holati: *${STATUS_LABELS[status]}*`,
      { parse_mode: "Markdown" },
    );

    // Mijozga ham xabar
    await bot.sendMessage(
      order.userId,
      `📦 *Buyurtma #${order.orderNumber}*\n\nHolati yangilandi: *${STATUS_LABELS[status]}*`,
      { parse_mode: "Markdown" },
    );
    return;
  }
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
(async () => {
  await connectDB();
  console.log("🤖 Holland Bot ishga tushdi ✅");
})();
