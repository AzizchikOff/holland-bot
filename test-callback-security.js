"use strict";

const assert = require("node:assert/strict");
const { canRunAdminCallback } = require("./callback-security");

const ADMIN_ID = 123456;

function callback(fromId, chatId) {
  return {
    id: "test_callback",
    from: { id: fromId },
    message: { chat: { id: chatId }, message_id: 10 },
    data: "s_507f1f77bcf86cd799439011_delivered"
  };
}

assert.equal(canRunAdminCallback(callback(ADMIN_ID, ADMIN_ID), ADMIN_ID), true);
console.log("✅ Admin o'z chatida: ruxsat");

assert.equal(canRunAdminCallback(callback(999999, ADMIN_ID), ADMIN_ID), false);
console.log("✅ Begona foydalanuvchi admin chatida: rad etildi");

assert.equal(canRunAdminCallback(callback(ADMIN_ID, 999999), ADMIN_ID), false);
console.log("✅ Admin boshqa chatda: rad etildi");

assert.equal(canRunAdminCallback({ from: { id: ADMIN_ID } }, ADMIN_ID), false);
console.log("✅ Xabarsiz callback: rad etildi");

assert.equal(canRunAdminCallback(callback(ADMIN_ID, ADMIN_ID), 0), false);
console.log("✅ ADMIN_ID noto'g'ri: rad etildi");

assert.equal(canRunAdminCallback(null, ADMIN_ID), false);
console.log("✅ null callback: rad etildi");

console.log("\n✅ Admin callback xavfsizlik testlari muvaffaqiyatli!");
