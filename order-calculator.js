"use strict";

function createOrderCalculator(menu) {
  const menuMap = new Map(menu.map(item => [String(item.id), item]));

  return function calcOrder(clientItems) {
    const errors = [];
    const items = [];
    let total = 0;

    if (!Array.isArray(clientItems)) {
      return { items, total, errors: ["Savat noto'g'ri"] };
    }

    for (const it of clientItems) {
      if (!it || typeof it !== "object" || Array.isArray(it)) {
        errors.push("Mahsulot ma'lumoti noto'g'ri");
        continue;
      }

      const productId = it.id ?? it.productId;
      const menuItem = menuMap.get(String(productId));

      if (!menuItem) {
        errors.push("Noma'lum mahsulot");
        continue;
      }

      const qty = Number(it.qty);

      if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
        errors.push("Mahsulot miqdori noto'g'ri");
        continue;
      }

      const lineTotal = menuItem.price * qty;

      if (!Number.isSafeInteger(lineTotal) || lineTotal < 0 ||
          !Number.isSafeInteger(total + lineTotal)) {
        errors.push("Buyurtma summasi noto'g'ri");
        continue;
      }

      total += lineTotal;

      items.push({
        id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        qty
      });
    }

    return { items, total, errors };
  };
}

module.exports = { createOrderCalculator };
