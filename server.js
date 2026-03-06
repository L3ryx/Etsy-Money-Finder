require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cheerio = require("cheerio");
const Stripe = require("stripe");

/* ================= CONFIG ================= */

const app = express();
const server = http.createServer(app);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ================= MODELS ================= */

const User = require("./models/User");
const SavedProduct = require("./models/SavedProduct");
const Transaction = require("./models/Transaction");

/* ================= DATABASE ================= */

mongoose.connect(
`mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(()=>console.log("✅ Mongo Connected"))
.catch(err=>console.log("❌ Mongo Error",err));

/* ================= MIDDLEWARE ================= */

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

/* ================= AUTH ================= */

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
password:hashed
});

/* 🔥 Create Stripe Customer */

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
/* ============ BUY CREDIT PACK ======================== */
/* ===================================================== */

app.post("/buy-pack", auth, async(req,res)=>{

const {pack} = req.body;

let amount = 0;
let credits = 0;

if(pack === "15"){
amount = 999;
credits = 15;
}

if(pack === "50"){
amount = 2999;
credits = 50;
}

if(pack === "200"){
amount = 7999;
credits = 200;
}

if(amount === 0){
return res.status(400).json({message:"Invalid pack"});
}

const user = await User.findById(req.user.userId);

const session = await stripe.checkout.sessions.create({

payment_method_types:["card"],
mode:"payment",

line_items:[{
price_data:{
currency:"eur",
product_data:{
name:`Pack ${credits} recherches`
},
unit_amount:amount
},
quantity:1
}],

customer:user.stripeCustomerId,

metadata:{
userId:user._id.toString(),
credits:credits
},

success_url:"https://"+req.headers.host+"/dashboard.html",
cancel_url:"https://"+req.headers.host+"/payment.html"

});

res.json({url:session.url});

});

/* ===================================================== */
/* ========== SEARCH WITH CREDIT DEDUCTION ============= */
/* ===================================================== */

app.post("/search-etsy", auth, async(req,res)=>{

const {keyword,limit} = req.body;

const user = await User.findById(req.user.userId);

if(user.credits <= 0){
return res.status(402).json({
message:"No credits",
redirect:"/payment.html"
});
}

/* 🔥 Decrement credit */

await User.findByIdAndUpdate(user._id,{
$inc:{credits:-1}
});

/* 🔥 Scraping */

try{

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

res.json({
results,
creditsLeft:user.credits - 1
});

}catch(err){

res.status(500).json({message:"Search failed"});

}

});

/* ===================================================== */
/* ============ CHECK CREDITS ========================== */
/* ===================================================== */

app.get("/check-credits", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

res.json({
credits:user.credits
});

});

/* ===================================================== */
/* ============ TRANSACTIONS =========================== */
/* ===================================================== */

app.get("/transactions", auth, async(req,res)=>{

const transactions = await Transaction.find({
userId:req.user.userId
}).sort({createdAt:-1});

res.json({transactions});

});

/* ===================================================== */
/* ============ STRIPE CHECKOUT ======================== */
/* ===================================================== */

app.post("/create-checkout-session", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

const session = await stripe.checkout.sessions.create({

payment_method_types:["card"],
mode:"payment",

line_items:[{
price_data:{
currency:"eur",
product_data:{
name:"Activation Premium"
},
unit_amount:50
},
quantity:1
}],

customer:user.stripeCustomerId,

metadata:{
userId:user._id.toString(),
credits:0
},

success_url:"https://"+req.headers.host+"/dashboard.html",
cancel_url:"https://"+req.headers.host+"/payment.html"

});

res.json({url:session.url});

});

/* ===================================================== */
/* ============ WEBHOOK ================================ */
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
return res.status(400).send("Webhook error");
}

if(event.type === "checkout.session.completed"){

const session = event.data.object;

const userId = session.metadata.userId;
const credits = parseInt(session.metadata.credits || 0);

/* 🔥 Pack achat */

if(credits > 0){

await User.findByIdAndUpdate(userId,{
$inc:{credits:credits}
});

await Transaction.create({
userId,
type:"pack",
amount:session.amount_total,
credits
});

}else{

await User.findByIdAndUpdate(userId,{
paid:true
});

await Transaction.create({
userId,
type:"activation",
amount:session.amount_total,
credits:0
});

}

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
