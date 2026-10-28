"use strict";

const crypto = require("node:crypto");

function createTelegramWebhookHandler(bot, secret) {
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET noto'g'ri");
  }

  return async (req, res) => {
    const provided = req.get("X-Telegram-Bot-Api-Secret-Token");

    if (!provided) return res.sendStatus(403);

    const expected = Buffer.from(secret);
    const actual = Buffer.from(provided);

    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      return res.sendStatus(403);
    }

    try {
      await bot.handleUpdate(req.body);
      return res.sendStatus(200);
    } catch (err) {
      console.error("Telegram webhook error:", err);
      return res.sendStatus(500);
    }
  };
}

module.exports = { createTelegramWebhookHandler };
