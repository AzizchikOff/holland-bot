const { getReportBuffer } = require("./reports");

const mockOrders = [
  {
    _id: "60c72b2f9b1d8b2bad7f6c01",
    userId: 12345,
    name: "Toshmat",
    phone: "+998901234567",
    address: "Namangan, G'alaba ko'chasi 5-uy",
    source: "miniapp",
    items: [
      { name: "Free Holland", price: 19000, qty: 2 },
      { name: "Sprite 0.5L", price: 8000, qty: 1 }
    ],
    total: 46000,
    status: "delivered",
    createdAt: new Date("2026-06-25T10:00:00Z")
  },
  {
    _id: "60c72b2f9b1d8b2bad7f6c02",
    userId: 12345,
    name: "Eshmat",
    phone: "+998907654321",
    address: "Namangan, Nodira ko'chasi 12-uy",
    source: "website",
    items: [
      { name: "Chicken Burger", price: 35000, qty: 1 }
    ],
    total: 35000,
    status: "cancelled",
    createdAt: new Date("2026-06-26T11:00:00Z")
  }
];

try {
  console.log("⏳ Hisobot generatsiyasini test qilish boshlandi...");
  const buf = getReportBuffer(mockOrders, "today", "Bugungi Test Hisoboti");
  if (buf && buf.length > 0) {
    console.log(`✅ Test muvaffaqiyatli yakunlandi! Generatsiya qilingan fayl hajmi: ${buf.length} bayt`);
    process.exit(0);
  } else {
    console.error("❌ Xatolik: Generatsiya qilingan buffer bo'sh!");
    process.exit(1);
  }
} catch (error) {
  console.error("❌ Testda xatolik yuz berdi:", error);
  process.exit(1);
}
