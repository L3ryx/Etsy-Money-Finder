/* ===================================================== */
/* ===================== IMPORTS ======================= */
/* ===================================================== */

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cheerio = require("cheerio");
const Stripe = require("stripe");

/* ===================================================== */
/* ================= CONFIG ============================ */
/* ===================================================== */

const app = express();
const server = http.createServer(app);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ===================================================== */
/* ================= MODELS ============================ */
/* ===================================================== */

const User = require("./models/User");
const SavedProduct = require("./models/SavedProduct");

/* ===================================================== */
/* ================= DATABASE ========================== */
/* ===================================================== */

mongoose.connect(
`mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(()=>console.log("✅ Mongo Connected"))
.catch(err=>console.log("❌ Mongo Error",err));

/* ===================================================== */
/* ================= MIDDLEWARE ======================== */
/* ===================================================== */

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

/* ===================================================== */
/* ================= AUTH ============================== */
/* ===================================================== */

function auth(req,res,next){

const token = req.headers.authorization?.split(" ")[1];

if(!token){
return res.status(401).json({message:"No token"});
}

try{
const decoded = jwt.verify(token,process.env.JWT_SECRET);
req.user = decoded;
next();
}catch(err){
return res.status(401).json({message:"Invalid token"});
}

}

/* ===================================================== */
/* ================= REGISTER ========================== */
/* ===================================================== */

app.post("/register", async(req,res)=>{

const {email,password} = req.body;

const exists = await User.findOne({email});

if(exists){
return res.status(400).json({message:"User exists"});
}

const hashed = await bcrypt.hash(password,10);

const user = await User.create({
email,
password:hashed,
paid:false
});

/* 🔥 CREATE STRIPE CUSTOMER */

const customer = await stripe.customers.create({
email
});

user.stripeCustomerId = customer.id;
await user.save();

res.json({message:"User created"});

});

/* ===================================================== */
/* ================= LOGIN ============================= */
/* ===================================================== */

app.post("/login", async(req,res)=>{

const {email,password} = req.body;

const user = await User.findOne({email});

if(!user){
return res.status(400).json({message:"Invalid"});
}

const match = await bcrypt.compare(password,user.password);

if(!match){
return res.status(400).json({message:"Invalid"});
}

const token = jwt.sign(
{userId:user._id},
process.env.JWT_SECRET,
{expiresIn:"7d"}
);

res.json({token});

});

/* ===================================================== */
/* ========== AUTO CHARGE 0.50€ ======================== */
/* ===================================================== */

async function chargeUser(user){

if(!user.stripeCustomerId || !user.defaultPaymentMethod){
throw new Error("No card");
}

await stripe.paymentIntents.create({
amount:50, // 0.50€
currency:"eur",
customer:user.stripeCustomerId,
payment_method:user.defaultPaymentMethod,
off_session:true,
confirm:true
});

}

/* ===================================================== */
/* ============== SEARCH + PRELEVEMENT ================== */
/* ===================================================== */

app.post("/search-etsy", auth, async(req,res)=>{

const {keyword,limit} = req.body;

try{

const user = await User.findById(req.user.userId);

/* 🔥 PRELEVEMENT AVANT RECHERCHE */

await chargeUser(user);

const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const response = await axios.get("https://api.scraperapi.com/",{
params:{
api_key:process.env.SCRAPAPI_KEY,
url,
render:true
}
});

const $ = cheerio.load(response.data);

const results = [];

$("a").each((i,el)=>{

if(results.length >= limit) return;

const href = $(el).attr("href");
if(!href || !href.includes("/listing/")) return;

let image =
$(el).find("img").first().attr("src") ||
$(el).find("img").first().attr("data-src");

if(!image) return;

if(image.startsWith("//")){
image = "https:" + image;
}

results.push({
image,
link: href.startsWith("http")
? href
: "https://www.etsy.com"+href
});

});

res.json({results});

}catch(err){

console.log("❌ Payment failed or card issue");

return res.status(400).json({
message:"Paiement échoué ou carte invalide"
});

}

});

/* ===================================================== */
/* ================= CHECK PAYMENT ===================== */
/* ===================================================== */

app.get("/check-payment", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

res.json({
paid:user.paid
});

});

/* ===================================================== */
/* ================= WEBHOOK =========================== */
/* ===================================================== */

app.post("/webhook",
express.raw({type:"application/json"}),
async(req,res)=>{

const sig = req.headers["stripe-signature"];

let event;

try{

event = stripe.webhooks.constructEvent(
req.body,
sig,
process.env.STRIPE_WEBHOOK_SECRET
);

}catch(err){

return res.status(400).send("Webhook Error");

}

/* 🔥 Paiement validé */

if(event.type === "payment_intent.succeeded"){

const payment = event.data.object;

console.log("✅ Payment succeeded");

}

res.json({received:true});

});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 Server running on port",PORT);
});
