// ============================================================
//  Holland Bot — Mahsulotlar ma'lumotlari
//  Sayt bilan bir xil (src/data/products.js dan ko'chirilgan)
// ============================================================

function formatSum(amount) {
  return new Intl.NumberFormat("uz-UZ").format(Math.round(Number(amount || 0)));
}

const CATEGORIES = [
  { id: "free", label: " Holland Free" },
  { id: "burger", label: " Burger" },
  { id: "hotdog", label: " Hot-dog" },
  { id: "sous", label: " Sous" },
  { id: "drink", label: " Ichimliklar" },
];

const MENU = [
  // ── Holland Free ───────────────────────────
  { id: "1", name: "Free Holland", category: "free", price: 19000 },
  { id: "2", name: "Free Holland Big", category: "free", price: 23000 },
  { id: "3", name: "Free Holland Special", category: "free", price: 35000 },
  { id: "4", name: "Loaded Fries", category: "free", price: 32000 },
  { id: "5", name: "Loaded Fries & Sausage", category: "free", price: 28000 },
  { id: "6", name: "Loaded Cheese", category: "free", price: 26000 },
  { id: "7", name: "Chicken Cheese", category: "free", price: 42000 },
  { id: "8", name: "Crispy Chicken", category: "free", price: 38000 },
  { id: "9", name: "Beef Box", category: "free", price: 55000 },
  { id: "13", name: "Kapsalan (lahm)", category: "free", price: 75000 },
  { id: "14", name: "Kapsalan (qiyma)", category: "free", price: 58000 },
  { id: "15", name: "Berlin Style (lahm)", category: "free", price: 58000 },
  { id: "16", name: "Berlin Style (qiyma)", category: "free", price: 48000 },
  { id: "17", name: "Briosh Steak Box", category: "free", price: 65000 },

  // ── Burger ─────────────────────────────────
  { id: "10", name: "Chicken Burger", category: "burger", price: 35000 },
  {
    id: "19",
    name: "Bon File in Ciabatta (lahm)",
    category: "burger",
    price: 48000,
  },
  {
    id: "20",
    name: "Bon File in Ciabatta (qiyma)",
    category: "burger",
    price: 38000,
  },

  // ── Hot-dog ────────────────────────────────
  { id: "11", name: "Hot-Dog Classic", category: "hotdog", price: 15000 },
  { id: "12", name: "Hot-Dog Canada", category: "hotdog", price: 20000 },
  { id: "18", name: "Free-Dog", category: "hotdog", price: 28000 },

  // ── Sous ───────────────────────────────────
  { id: "21", name: "Berlin Sous", category: "sous", price: 4000 },
  { id: "22", name: "Burger Sous", category: "sous", price: 4000 },
  { id: "23", name: "BBQ Sous", category: "sous", price: 4000 },
  { id: "24", name: "Ketchup-Mayonez", category: "sous", price: 4000 },

  // ── Ichimliklar ────────────────────────────
  { id: "25", name: "Sprite Mojito 0.5L", category: "drink", price: 8000 },
  { id: "26", name: "Sprite 0.5L", category: "drink", price: 8000 },
  { id: "27", name: "Sprite 0.25L", category: "drink", price: 7000 },
  { id: "28", name: "Fanta 0.25L", category: "drink", price: 7000 },
  { id: "29", name: "Fanta 0.5L", category: "drink", price: 10000 },
  { id: "30", name: "Fanta 0.25L (shisha)", category: "drink", price: 10000 },
  { id: "31", name: "Fanta 0.5L", category: "drink", price: 8000 },
  { id: "32", name: "Coca Cola 0.25L", category: "drink", price: 7000 },
  { id: "33", name: "Coca Cola 0.5L", category: "drink", price: 10000 },
  { id: "34", name: "Coca Cola 0.25L (shisha)", category: "drink", price: 10000 },
  { id: "35", name: "Fuse Tea 0.5L", category: "drink", price: 10000 },
  { id: "36", name: "Fuse Tea 0.5L (plastik)", category: "drink", price: 8000 },
  { id: "37", name: "Bonaqua 0.5L", category: "drink", price: 3000 },
  { id: "38", name: "Cappy Pulpy 0.5L", category: "drink", price: 8000 },
];

module.exports = { MENU, CATEGORIES, formatSum };
