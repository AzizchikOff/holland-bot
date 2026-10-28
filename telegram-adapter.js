"use strict";

const { Bot, InputFile } = require("node-telegram-bot-api");

function createTelegramAdapter(token) {
  if (!token) throw new Error("BOT_TOKEN kiritilmagan");

  const bot = new Bot(token);

  bot.catch(async (err, ctx) => {
    console.error(
      "Telegram handler error:",
      err?.message || err,
      "update_id:",
      ctx?.update?.update_id
    );
    throw err;
  });

  return {
    bot,

    onText(regex, handler) {
      return bot.on("message", async (ctx, next) => {
        const msg = ctx.message;
        if (!msg?.text) return next();

        regex.lastIndex = 0;
        const match = regex.exec(msg.text);
        if (!match) return next();

        await handler(msg, match);
        return next();
      });
    },

    on(event, handler) {
      if (!["message", "callback_query"].includes(event)) {
        throw new Error(`Unsupported event: ${event}`);
      }

      return bot.on(event, async (ctx, next) => {
        const data = event === "message"
          ? ctx.message
          : ctx.callbackQuery;

        if (!data) return next();

        await handler(data);
        return next();
      });
    },

    sendMessage(chatId, text, options = {}) {
      return bot.api.sendMessage({
        chat_id: chatId,
        text,
        ...options
      });
    },

    sendPhoto(chatId, photo, options = {}) {
      return bot.api.sendPhoto({
        chat_id: chatId,
        photo,
        ...options
      });
    },

    sendDocument(chatId, document, options = {}, fileOptions = {}) {
      const filename = fileOptions.filename || "report.xlsx";

      const file = Buffer.isBuffer(document)
        ? new InputFile(new Uint8Array(document), {
            filename,
            contentType: fileOptions.contentType ||
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          })
        : document;

      return bot.api.sendDocument({
        chat_id: chatId,
        document: file,
        ...options
      });
    },

    answerCallbackQuery(callbackId, options = {}) {
      return bot.api.answerCallbackQuery({
        callback_query_id: callbackId,
        ...options
      });
    },

    editMessageText(text, options = {}) {
      return bot.api.editMessageText({
        text,
        ...options
      });
    },

    editMessageReplyMarkup(markup, options = {}) {
      return bot.api.editMessageReplyMarkup({
        ...options,
        reply_markup: markup
      });
    },

    setWebHook(url, options = {}) {
      return bot.api.setWebhook({
        url,
        ...options
      });
    },

    startPolling(options = {}) {
      return bot.startPolling(undefined, options);
    },

    stopPolling() {
      return bot.stop();
    },

    handleUpdate(update) {
      return bot.handleUpdate(update);
    }
  };
}

module.exports = { createTelegramAdapter };
