require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const mongoose    = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");

const app      = express();
const PORT     = process.env.PORT || 3000;
const bot      = new TelegramBot(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

app.use(cors());
app.use(express.json());

// ── MongoDB ────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(()=>console.log("✅ MongoDB ulandi"))
  .catch(e=>console.error("❌ MongoDB xato:", e.message));

const OrderSchema = new mongoose.Schema({
  userId:    Number,
  name:      String,
  phone:     String,
  address:   String,
  note:      { type: String, default: "" },
  gpsLat:    Number,
  gpsLng:    Number,
  items:     Array,
  total:     Number,
  status:    { type: String, default: "new" },
}, { timestamps: true });

const Order = mongoose.model("Order", OrderSchema);

// ── Helpers ────────────────────────────────
function fmt(n){ return new Intl.NumberFormat("uz-UZ").format(n); }

const STATUS = {
  new:"🆕 Yangi", accepted:"✅ Qabul qilindi",
  cooking:"🍳 Tayyorlanmoqda", delivered:"🚀 Yetkazildi", cancelled:"❌ Bekor qilindi"
};

function adminKb(id){
  return { inline_keyboard:[
    [{text:"✅ Qabul",           callback_data:`s_${id}_accepted`},
     {text:"🍳 Tayyorlanmoqda",  callback_data:`s_${id}_cooking`}],
    [{text:"🚀 Yetkazildi",      callback_data:`s_${id}_delivered`},
     {text:"❌ Bekor",            callback_data:`s_${id}_cancelled`}],
  ]};
}

// ── ROUTES ─────────────────────────────────

// Buyurtma yaratish
app.post("/api/orders", async (req,res)=>{
  try{
    const {userId,name,phone,address,note,gps,items,total} = req.body;
    if(!name||!phone||!address||!items?.length)
      return res.json({success:false, error:"Ma'lumotlar to'liq emas"});

    const order = await Order.create({
      userId, name, phone, address,
      note: note||"",
      gpsLat: gps?.lat||null,
      gpsLng: gps?.lng||null,
      items, total
    });

    // Adminga xabar
    if(ADMIN_ID){
      let txt = `🛎 *Yangi buyurtma #${order._id.toString().slice(-6).toUpperCase()}*\n\n`;
      txt += `👤 ${order.name}\n`;
      txt += `📞 ${order.phone}\n`;
      txt += `📍 ${order.address}\n`;
      if(order.gpsLat) txt += `🗺 [Xaritada ko'rish](https://maps.google.com/?q=${order.gpsLat},${order.gpsLng})\n`;
      if(order.note)   txt += `💬 ${order.note}\n`;
      txt += `\n📦 *Tarkibi:*\n`;
      order.items.forEach(i=>{ txt+=`• ${i.name} × ${i.qty} = ${fmt(i.price*i.qty)} so'm\n`; });
      txt += `\n💰 *Jami: ${fmt(order.total)} so'm*`;
      await bot.sendMessage(ADMIN_ID, txt, {
        parse_mode:"Markdown",
        reply_markup: adminKb(order._id.toString())
      });
    }
    res.json({success:true, orderId:order._id});
  } catch(e){
    console.error(e);
    res.json({success:false, error:e.message});
  }
});

// Foydalanuvchi buyurtmalari
app.get("/api/orders/user/:uid", async (req,res)=>{
  try{
    const orders = await Order.find({userId:Number(req.params.uid)})
      .sort({createdAt:-1}).limit(30);
    res.json(orders);
  } catch{ res.json([]); }
});

// Barcha buyurtmalar
app.get("/api/orders", async (req,res)=>{
  try{
    const orders = await Order.find().sort({createdAt:-1}).limit(100);
    res.json(orders);
  } catch{ res.json([]); }
});

// Health check
app.get("/", (req,res)=>res.json({ok:true, service:"Holland API ✅"}));

// ── Bot callback ───────────────────────────
bot.on("callback_query", async q=>{
  if(!q.data.startsWith("s_")) return;
  if(q.message.chat.id !== ADMIN_ID) return;

  const parts  = q.data.split("_");
  const id     = parts[1];
  const status = parts[2];

  const order = await Order.findByIdAndUpdate(id, {status}, {new:true});
  if(!order) return;

  await bot.answerCallbackQuery(q.id, {text: STATUS[status]||status});
  await bot.editMessageReplyMarkup(adminKb(id), {
    chat_id: ADMIN_ID, message_id: q.message.message_id
  });
  await bot.sendMessage(ADMIN_ID,
    `✅ Holat yangilandi: *${STATUS[status]}*`,
    {parse_mode:"Markdown"}
  );

  try{
    await bot.sendMessage(order.userId,
      `🔔 *Buyurtma holati yangilandi*\n\n${STATUS[status]}\n\nRahmat! 🙏`,
      {parse_mode:"Markdown"}
    );
  } catch{}
});

bot.startPolling();
app.listen(PORT, ()=>console.log(`✅ Holland API: http://localhost:${PORT}`));