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

mongoose
.connect(
`mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(()=>console.log("✅ MongoDB Connected"))
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
req.user = jwt.verify(token,process.env.JWT_SECRET);
next();
}catch{
return res.status(401).json({message:"Invalid token"});
}

}

/* ===================================================== */
/* ================= ROUTES HTML ======================= */
/* ===================================================== */

app.get("/",(req,res)=>res.sendFile(__dirname+"/public/index.html"));
app.get("/register",(req,res)=>res.sendFile(__dirname+"/public/index.html"));
app.get("/login",(req,res)=>res.sendFile(__dirname+"/public/index.html"));
app.get("/dashboard",(req,res)=>res.sendFile(__dirname+"/public/dashboard.html"));
app.get("/payment",(req,res)=>res.sendFile(__dirname+"/public/payment.html"));

/* ===================================================== */
/* ================= REGISTER ========================== */
/* ===================================================== */

app.post("/register",async(req,res)=>{

const {email,password} = req.body;

const exists = await User.findOne({email});
if(exists){
return res.status(400).json({message:"User already exists"});
}

const hashed = await bcrypt.hash(password,10);

const customer = await stripe.customers.create({
email
});

const user = await User.create({
email,
password:hashed,
tokens:0,
stripeCustomerId:customer.id
});

res.json({message:"User created",userId:user._id});

});

/* ===================================================== */
/* ================= LOGIN ============================= */
/* ===================================================== */

app.post("/login",async(req,res)=>{

const {email,password} = req.body;

const user = await User.findOne({email});
if(!user) return res.status(400).json({message:"Invalid"});

const match = await bcrypt.compare(password,user.password);
if(!match) return res.status(400).json({message:"Invalid"});

const token = jwt.sign(
{userId:user._id},
process.env.JWT_SECRET,
{expiresIn:"7d"}
);

res.json({token});

});

/* ===================================================== */
/* ================= ATTACH CARD ======================= */
/* ===================================================== */

app.post("/attach-card",auth,async(req,res)=>{

const {paymentMethodId} = req.body;

const user = await User.findById(req.user.userId);

await stripe.paymentMethods.attach(paymentMethodId,{
customer:user.stripeCustomerId
});

await stripe.customers.update(user.stripeCustomerId,{
invoice_settings:{
default_payment_method:paymentMethodId
}
});

user.defaultPaymentMethod = paymentMethodId;
await user.save();

res.json({success:true});

});

/* ===================================================== */
/* ================= SEARCH (AUTO CHARGE) ============== */
/* ===================================================== */

app.post("/search-etsy",auth,async(req,res)=>{

const {keyword,limit} = req.body;

const user = await User.findById(req.user.userId);

/* 🔴 BLOQUE SI PAS DE CARTE */

if(!user.defaultPaymentMethod){
return res.status(403).json({
message:"Carte bancaire obligatoire"
});
}

/* 🔥 PRELEVEMENT AUTOMATIQUE 0.50€ */

try{

await stripe.paymentIntents.create({
amount:50,
currency:"eur",
customer:user.stripeCustomerId,
payment_method:user.defaultPaymentMethod,
off_session:true,
confirm:true
});

}catch(err){
return res.status(400).json({
message:"Paiement refusé"
});
}

/* 🔥 SCRAPING */

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
if(image.startsWith("//")) image="https:"+image;

results.push({
image,
link:href.startsWith("http")?href:"https://www.etsy.com"+href
});

});

res.json({results});

});

/* ===================================================== */
/* ================= DASHBOARD ========================= */
/* ===================================================== */

app.get("/dashboard",auth,async(req,res)=>{

const user = await User.findById(req.user.userId);

const products = await SavedProduct.find({
userId:user._id
});

res.json({
tokens:user.tokens,
hasCard:!!user.defaultPaymentMethod,
products
});

});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 Server running on port",PORT);
});
