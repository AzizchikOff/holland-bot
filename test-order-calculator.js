"use strict";

const assert = require("node:assert/strict");
const { createOrderCalculator } = require("./order-calculator");

const calcOrder = createOrderCalculator([
  { id: "1", name: "Burger", price: 25000 },
  { id: "2", name: "Fri", price: 12000 }
]);

function valid(input, expectedTotal) {
  const result = calcOrder(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, expectedTotal);
}

function invalid(input) {
  const result = calcOrder(input);
  assert.ok(result.errors.length > 0);
}

valid([{ id: "1", qty: 2 }], 50000);
console.log("✅ To'g'ri buyurtma: 50000 so'm");

valid([{ id: "1", qty: 2, price: 1 }], 50000);
console.log("✅ Soxta narx e'tiborga olinmadi");

for (const qty of [-1, 0, 21, 1.5]) {
  invalid([{ id: "1", qty }]);
}
console.log("✅ Noto'g'ri miqdorlar rad etildi");

invalid([{ id: "999", qty: 1 }]);
console.log("✅ Noma'lum mahsulot rad etildi");

invalid([null]);
console.log("✅ null mahsulot rad etildi");

invalid("invalid");
console.log("✅ Noto'g'ri savat rad etildi");

valid([
  { id: "1", qty: 1 },
  { id: "2", qty: 2 }
], 49000);
console.log("✅ Bir nechta mahsulot to'g'ri hisoblandi");

console.log("\n✅ Buyurtma kalkulyatori testlari muvaffaqiyatli!");
