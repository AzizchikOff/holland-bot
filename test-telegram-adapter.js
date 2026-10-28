"use strict";

const assert = require("node:assert/strict");
const { createTelegramAdapter } = require("./telegram-adapter");

async function main() {
  const adapter = createTelegramAdapter("123456:TEST_TOKEN");

  const received = [];
  const pattern = /^\/start(?:@\w+)?(?:\s|$)/;

  adapter.onText(pattern, async (msg) => {
    received.push(`start:${msg.text}`);
  });

  adapter.on("message", async (msg) => {
    if (!msg.text?.startsWith("/")) {
      received.push(`message:${msg.text}`);
    }
  });

  adapter.on("callback_query", async (q) => {
    received.push(`callback:${q.data}`);
  });

  let updateId = 100;

  async function message(text) {
    await adapter.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: 1700000000,
        chat: { id: 123, type: "private" },
        from: {
          id: 123,
          is_bot: false,
          first_name: "Test"
        },
        text
      }
    });
  }

  await message("/start");
  await message("/start123");
  await message("/start test");
  await message("Salom");

  await adapter.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: "callback-test",
      from: {
        id: 123,
        is_bot: false,
        first_name: "Test"
      },
      chat_instance: "test",
      message: {
        message_id: 10,
        date: 1700000000,
        chat: { id: 123, type: "private" }
      },
      data: "show_menu"
    }
  });

  assert.deepEqual(received, [
    "start:/start",
    "start:/start test",
    "message:Salom",
    "callback:show_menu"
  ]);

  console.log("✅ /start ishladi");
  console.log("✅ /start123 rad etildi");
  console.log("✅ Oddiy xabar ishladi");
  console.log("✅ Callback ishladi");
  console.log("\n✅ Telegram adapter testlari muvaffaqiyatli!");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
