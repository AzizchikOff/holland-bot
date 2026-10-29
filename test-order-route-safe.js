const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const source = fs.readFileSync("server.js", "utf8");

const startMarker = 'app.post("/api/orders", async (req, res) => {';
const endMarker = '\n// ✅ FIX 1c:';

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert(start >= 0, "Order endpoint topilmadi");
assert(end > start, "Order endpoint tugashi topilmadi");

const routeSource = source.slice(start, end);

const orders = new Map();
let created = 0;
let price = 35000;
let notifications = 0;
let rateLimited = false;
let lookupLimited = false;

const Order = {
  async findOne({ requestId }) {
    return orders.get(requestId) || null;
  },

  async create(data) {
    if (data.requestId && orders.has(data.requestId)) {
      const err = new Error("Duplicate key");
      err.code = 11000;
      throw err;
    }

    const order = {
      ...data,
      _id: `mock-order-${++created}`,
      toObject() {
        return { ...data };
      },
    };

    if (data.requestId) orders.set(data.requestId, order);
    return order;
  },
};

const app = {
  post(path, handler) {
    assert.equal(path, "/api/orders");
    this.handler = handler;
  },
};

const sandbox = {
  app,
  Order,
  crypto,
  console,
  ADMIN_ID: 0,

  verifyTelegramInitData: () => null,

  rateLimit: (key) => {
    // Lookup limit va yangi buyurtma limiti mustaqil.
    if (String(key).startsWith("order-lookup:")) return lookupLimited;
    return rateLimited;
  },

  calcOrder(clientItems) {
    const items = clientItems.map(item => ({
      id: item.id,
      name: "Test Burger",
      qty: item.qty,
      price,
    }));

    return {
      items,
      total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
      errors: [],
    };
  },

  broadcastStats() {
    notifications++;
  },

  sendToUser() {},
  sendToAdmin() {},

  bot: {
    async sendMessage() {
      notifications++;
    },
  },

  escMd: String,
  fmt: String,
  adminKb: () => ({}),
};

vm.runInNewContext(routeSource, sandbox, {
  filename: "server-order-route.js",
});

assert.equal(typeof app.handler, "function");

const baseOrder = {
  requestId: "test-request-123456789",
  name: "Test Customer",
  phone: "+998901234567",
  address: "Test address",
  items: [{ id: "burger", qty: 1 }],
  paymentMethod: "cash",
  source: "website",
};

async function submit(body) {
  let status = 200;
  let response;

  const req = {
    ip: "127.0.0.1",
    body,
  };

  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(data) {
      response = data;
      return this;
    },
  };

  await app.handler(req, res);

  return { status, body: response };
}

async function run() {
  // 1. Birinchi buyurtma
  const first = await submit(baseOrder);
  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);
  assert.equal(created, 1);
  console.log("✅ Birinchi buyurtma");

  // 2. Takroriy requestId
  const second = await submit(baseOrder);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.orderId, undefined);
  assert.equal(created, 1);
  console.log("✅ Takroriy buyurtma bloklandi");

  // 3. Boshqa manzil, bir xil requestId
  const conflict = await submit({
    ...baseOrder,
    address: "Different address",
  });
  assert.equal(conflict.status, 409);
  assert.equal(created, 1);
  console.log("✅ 409 Conflict");

  // 4. Narx o'zgargandan keyingi retry
  price = 40000;
  const retry = await submit(baseOrder);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.total, undefined);
  assert.equal(created, 1);
  console.log("✅ Narx o'zgarsa ham eski buyurtma qaytarildi");

  // 5. Rate limit paytida eski buyurtmani tekshirish
  rateLimited = true;
  const existing = await submit(baseOrder);
  assert.equal(existing.body.duplicate, true);

  const blocked = await submit({
    ...baseOrder,
    requestId: "test-request-987654321",
  });
  assert.equal(blocked.status, 429);
  assert.equal(created, 1);
  console.log("✅ Rate limit");

  // 6. Lookup rate limit
  lookupLimited = true;
  const lookupBlocked = await submit(baseOrder);
  assert.equal(lookupBlocked.status, 429);
  assert.equal(lookupBlocked.body.success, false);
  lookupLimited = false;
  console.log("✅ Lookup rate limit");

  // 7. Parallel yuborish
  rateLimited = false;
  const parallelOrder = {
    ...baseOrder,
    requestId: "test-parallel-123456789",
  };

  const [a, b] = await Promise.all([
    submit(parallelOrder),
    submit(parallelOrder),
  ]);

  assert.equal(a.body.success, true);
  assert.equal(b.body.success, true);
  assert.equal(created, 2);
  assert.equal(
    [a.body.duplicate, b.body.duplicate].filter(Boolean).length,
    1
  );
  console.log("✅ Parallel buyurtma takrorlanmadi");

  console.log("\n🎉 7 ta test muvaffaqiyatli!");
}

run().catch(err => {
  console.error("❌ Test xatosi:", err);
  process.exitCode = 1;
});
