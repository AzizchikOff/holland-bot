const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");

const checks = [
  [
    "Buyurtma sanasi",
    'escMd(o.createdAt.toLocaleDateString("uz-UZ"))'
  ],
  [
    "Buyurtma narxi",
    'escMd(fmt(o.total))'
  ],
  [
    "Admin holat xabari",
    'escMd(STATUS[status])'
  ],
  [
    "Yangi buyurtma jami",
    'escMd(fmt(order.total))'
  ],
  [
    "Mahsulot narxi",
    'escMd(fmt(i.price*i.qty))'
  ]
];

for (const [name, pattern] of checks) {
  assert.ok(source.includes(pattern), `${name} himoyalanmagan`);
  console.log(`✅ ${name}`);
}

console.log("\n✅ MarkdownV2 statik tekshiruvdan o'tdi!");
