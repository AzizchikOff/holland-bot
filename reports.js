// reports.js — Excel hisobot generatsiyasi
// Holland Fast Food — haftalik va oylik hisobotlar
// O'rnatish: npm install xlsx

const ExcelJS = require("exceljs");

function fmt(n) { return new Intl.NumberFormat("uz-UZ").format(n || 0); }

// Keep user-provided values as literal text when exporting spreadsheets.
// Spreadsheet applications may interpret leading formula characters as formulas.
function safeCell(value) {
  if (typeof value !== "string") return value;
  return /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value;
}


// ── Sanani formatlash ──────────────────────────────────────
function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("uz-UZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDay(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("uz-UZ");
}

// ── Status o'zbek tilida ───────────────────────────────────
const STATUS_UZ = {
  new:       "Yangi",
  accepted:  "Qabul qilindi",
  cooking:   "Tayyorlanmoqda",
  delivered: "Yetkazildi",
  cancelled: "Bekor qilindi",
};

const SOURCE_UZ = {
  website: "Sayt",
  miniapp: "Mini App",
  bot:     "Bot",
};

// ══════════════════════════════════════════════════════════
//  ASOSIY HISOBOT GENERATSIYASI
// ══════════════════════════════════════════════════════════
function generateReport(orders, period, title) {
  const wb = new ExcelJS.Workbook();

  // ── 1. UMUMIY XULOSА ──────────────────────────────────
  const delivered   = orders.filter(o => o.status === "delivered");
  const cancelled   = orders.filter(o => o.status === "cancelled");
  const active      = orders.filter(o => !["delivered","cancelled"].includes(o.status));
  const totalSum    = delivered.reduce((s, o) => s + (o.total || 0), 0);
  const avgCheck    = delivered.length ? Math.round(totalSum / delivered.length) : 0;

  // Mahsulotlar hisobi
  const productMap = {};
  delivered.forEach(o => {
    (o.items || []).forEach(it => {
      if (!productMap[it.name]) productMap[it.name] = { qty: 0, sum: 0 };
      productMap[it.name].qty += it.qty || 1;
      productMap[it.name].sum += (it.price || 0) * (it.qty || 1);
    });
  });
  const topProduct = Object.entries(productMap).sort((a,b) => b[1].qty - a[1].qty)[0];

  const summaryData = [
    ["🍔 HOLLAND FAST FOOD — HISOBOT"],
    [`Davr: ${title}`],
    [`Yaratilgan: ${new Date().toLocaleString("uz-UZ")}`],
    [],
    ["UMUMIY KO'RSATKICHLAR", ""],
    ["Jami buyurtmalar",      orders.length],
    ["Yetkazilgan",           delivered.length],
    ["Bekor qilingan",        cancelled.length],
    ["Jarayondagi",           active.length],
    [],
    ["MOLIYAVIY KO'RSATKICHLAR", ""],
    ["Jami tushum (so'm)",    totalSum],
    ["O'rtacha check (so'm)", avgCheck],
    ["Eng katta buyurtma",    Math.max(...delivered.map(o => o.total || 0), 0)],
    ["Eng kichik buyurtma",   delivered.length ? Math.min(...delivered.map(o => o.total || 0)) : 0],
    [],
    ["ENG KO'P SOTILGAN", ""],
    topProduct ? [topProduct[0], `${topProduct[1].qty} ta — ${fmt(topProduct[1].sum)} so'm`] : ["—", "—"],
  ];

  const ws1 = wb.addWorksheet("Xulosa");
  (summaryData.map(row => row.map(safeCell))).forEach(row => ws1.addRow(row));
  ws1.columns = [{ width: 30 }, { width: 25 }];

  // Stillar uchun ranglar (xlsx-style bilan ishlaydi)
  ws1.getCell("A1").value = "🍔 HOLLAND FAST FOOD — HISOBOT";


  // ── 2. BARCHA BUYURTMALAR ─────────────────────────────
  const ordersHeader = [
    ["#", "ID", "Sana", "Manba", "Mijoz", "Telefon", "Manzil", "Mahsulotlar", "Jami (so'm)", "To'lov turi", "Holat"]
  ];
  const ordersRows = orders.map((o, i) => [
    i + 1,
    (o._id || o.id || "").toString().slice(-6).toUpperCase(),
    fmtDate(o.createdAt || o.created_at),
    SOURCE_UZ[o.source] || "Mini App",
    o.name  || "",
    o.phone || "",
    o.address || "",
    (o.items || []).map(it => `${it.name} x${it.qty}`).join(", "),
    o.total || 0,
    o.paymentMethod === "card" ? "Karta 💳" : "Naqd 💵",
    STATUS_UZ[o.status] || o.status || "",
  ]);

  const ws2 = wb.addWorksheet("Buyurtmalar");
  ([...ordersHeader, ...ordersRows.map(row => row.map(safeCell))]).forEach(row => ws2.addRow(row));
  ws2.columns = [
    {width:4},{width:8},{width:18},{width:10},{width:18},{width:14},
    {width:30},{width:40},{width:14},{width:14},{width:16},
  ];

  // ── 3. MAHSULOTLAR STATISTIKASI ───────────────────────
  const prodHeader = [["#", "Mahsulot nomi", "Soni (ta)", "Umumiy (so'm)", "Ulush (%)"]];
  const totalQty   = Object.values(productMap).reduce((s, p) => s + p.qty, 0);
  const prodRows   = Object.entries(productMap)
    .sort((a, b) => b[1].qty - a[1].qty)
    .map(([name, d], i) => [
      i + 1, name, d.qty, d.sum,
      totalQty ? ((d.qty / totalQty) * 100).toFixed(1) + "%" : "0%",
    ]);

  const ws3 = wb.addWorksheet("Mahsulotlar");
  ([...prodHeader, ...prodRows.map(row => row.map(safeCell))]).forEach(row => ws3.addRow(row));
  ws3.columns = [{width:4},{width:30},{width:12},{width:18},{width:10}];

  // ── 4. KUNLIK TAQSIMOT ────────────────────────────────
  const dayMap = {};
  orders.forEach(o => {
    const day = fmtDay(o.createdAt || o.created_at);
    if (!dayMap[day]) dayMap[day] = { total: 0, count: 0, delivered: 0, cancelled: 0, sum: 0 };
    dayMap[day].count++;
    if (o.status === "delivered") { dayMap[day].delivered++; dayMap[day].sum += o.total || 0; }
    if (o.status === "cancelled") dayMap[day].cancelled++;
  });

  const dayHeader = [["Sana", "Jami buyurtma", "Yetkazilgan", "Bekor", "Tushum (so'm)"]];
  const dayRows   = Object.entries(dayMap).map(([day, d]) => [
    day, d.count, d.delivered, d.cancelled, d.sum,
  ]);
  const ws4 = wb.addWorksheet("Kunlik");
  ([...dayHeader, ...dayRows]).forEach(row => ws4.addRow(row));
  ws4.columns = [{width:14},{width:16},{width:14},{width:10},{width:18}];

  // ── 5. MIJOZLAR ───────────────────────────────────────
  const clientMap = {};
  delivered.forEach(o => {
    const key = o.phone || o.name || "Noma'lum";
    if (!clientMap[key]) clientMap[key] = { name: o.name, phone: o.phone, count: 0, sum: 0 };
    clientMap[key].count++;
    clientMap[key].sum += o.total || 0;
  });

  const clientHeader = [["#", "Ism", "Telefon", "Buyurtmalar", "Jami xarid (so'm)"]];
  const clientRows   = Object.values(clientMap)
    .sort((a, b) => b.sum - a.sum)
    .map((c, i) => [i + 1, c.name || "", c.phone || "", c.count, c.sum]);

  const ws5 = wb.addWorksheet("Mijozlar");
  ([...clientHeader, ...clientRows.map(row => row.map(safeCell))]).forEach(row => ws5.addRow(row));
  ws5.columns = [{width:4},{width:20},{width:16},{width:14},{width:18}];

  return wb;
}

// ── Hisobotni buffer sifatida qaytarish ───────────────────
async function getReportBuffer(orders, period, title) {
  const wb = generateReport(orders, period, title);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { getReportBuffer };