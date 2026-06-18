// reports.js — Excel hisobot generatsiyasi
// Holland Fast Food — haftalik va oylik hisobotlar
// O'rnatish: npm install xlsx

const XLSX = require("xlsx");

function fmt(n) { return new Intl.NumberFormat("uz-UZ").format(n || 0); }

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

// ══════════════════════════════════════════════════════════
//  ASOSIY HISOBOT GENERATSIYASI
// ══════════════════════════════════════════════════════════
function generateReport(orders, period, title) {
  const wb = XLSX.utils.book_new();

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

  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1["!cols"] = [{ wch: 30 }, { wch: 25 }];

  // Stillar uchun ranglar (xlsx-style bilan ishlaydi)
  ws1["A1"] = { v: "🍔 HOLLAND FAST FOOD — HISOBOT", t: "s" };

  XLSX.utils.book_append_sheet(wb, ws1, "📊 Xulosa");

  // ── 2. BARCHA BUYURTMALAR ─────────────────────────────
  const ordersHeader = [
    ["#", "ID", "Sana", "Mijoz", "Telefon", "Manzil", "Mahsulotlar", "Jami (so'm)", "Holat"]
  ];
  const ordersRows = orders.map((o, i) => [
    i + 1,
    (o._id || o.id || "").toString().slice(-6).toUpperCase(),
    fmtDate(o.createdAt || o.created_at),
    o.name  || "",
    o.phone || "",
    o.address || "",
    (o.items || []).map(it => `${it.name} x${it.qty}`).join(", "),
    o.total || 0,
    STATUS_UZ[o.status] || o.status || "",
  ]);

  const ws2 = XLSX.utils.aoa_to_sheet([...ordersHeader, ...ordersRows]);
  ws2["!cols"] = [
    {wch:4},{wch:8},{wch:18},{wch:18},{wch:14},
    {wch:30},{wch:40},{wch:14},{wch:16},
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "📦 Buyurtmalar");

  // ── 3. MAHSULOTLAR STATISTIKASI ───────────────────────
  const prodHeader = [["#", "Mahsulot nomi", "Soni (ta)", "Umumiy (so'm)", "Ulush (%)"]];
  const totalQty   = Object.values(productMap).reduce((s, p) => s + p.qty, 0);
  const prodRows   = Object.entries(productMap)
    .sort((a, b) => b[1].qty - a[1].qty)
    .map(([name, d], i) => [
      i + 1, name, d.qty, d.sum,
      totalQty ? ((d.qty / totalQty) * 100).toFixed(1) + "%" : "0%",
    ]);

  const ws3 = XLSX.utils.aoa_to_sheet([...prodHeader, ...prodRows]);
  ws3["!cols"] = [{wch:4},{wch:30},{wch:12},{wch:18},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws3, "🍟 Mahsulotlar");

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
  const ws4 = XLSX.utils.aoa_to_sheet([...dayHeader, ...dayRows]);
  ws4["!cols"] = [{wch:14},{wch:16},{wch:14},{wch:10},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws4, "📅 Kunlik");

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

  const ws5 = XLSX.utils.aoa_to_sheet([...clientHeader, ...clientRows]);
  ws5["!cols"] = [{wch:4},{wch:20},{wch:16},{wch:14},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws5, "👥 Mijozlar");

  return wb;
}

// ── Hisobotni buffer sifatida qaytarish ───────────────────
function getReportBuffer(orders, period, title) {
  const wb = generateReport(orders, period, title);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { getReportBuffer };