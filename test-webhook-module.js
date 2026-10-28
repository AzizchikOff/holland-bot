"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const { createTelegramWebhookHandler } = require("./telegram-webhook");

async function main() {
  const app = express();
  app.use(express.json());

  let processed = 0;
  const secret = "LOCAL_TEST_SECRET_123";

  const bot = {
    async handleUpdate(update) {
      assert.equal(update.update_id, 123);
      processed++;
    }
  };

  app.post(
    "/telegram/webhook",
    createTelegramWebhookHandler(bot, secret)
  );

  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise(resolve => server.once("listening", resolve));

    const url = `http://127.0.0.1:${server.address().port}/telegram/webhook`;

    async function request(token) {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["X-Telegram-Bot-Api-Secret-Token"] = token;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ update_id: 123 })
      });

      return response.status;
    }

    assert.equal(await request(null), 403);
    console.log("✅ Secretsiz: 403");

    assert.equal(await request("WRONG_SECRET"), 403);
    console.log("✅ Noto'g'ri secret: 403");

    assert.equal(await request(secret), 200);
    console.log("✅ To'g'ri secret: 200");

    assert.equal(processed, 1);
    console.log("✅ Update bir marta qayta ishlandi");

    console.log("\n✅ Asl webhook moduli HTTP testidan o'tdi!");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
