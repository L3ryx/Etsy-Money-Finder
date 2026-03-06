require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const User = require("./models/User");

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

const upload = multer({ storage: multer.memoryStorage() });

function auth(req,res,next){

const token = req.headers.authorization?.split(" ")[1];

if(!token){
return res.status(401).json({message:"No token"});
}

try{
req.user = jwt.verify(token,process.env.JWT_SECRET);
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
credits:0,
searchesUsed:0,
role:"user",
paid:false,
purchaseHistory:[],
searchHistory:[]
});

/* 🔥 Stripe customer */

const customer = await stripe.customers.create({email});
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
/* ================= DASHBOARD ========================= */
/* ===================================================== */

app.get("/me", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

res.json({
email:user.email,
role:user.role,
credits:user.credits,
searchesUsed:user.searchesUsed,
purchaseHistory:user.purchaseHistory || [],
searchHistory:user.searchHistory || []
});
});

/* ===================================================== */
/* ================= STRIPE CHECKOUT =================== */
/* ===================================================== */

app.post("/create-checkout-session", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

const {amount,plan,searches} = req.body;

const session = await stripe.checkout.sessions.create({

payment_method_types:["card"],
mode:"payment",
customer:user.stripeCustomerId,

metadata:{
plan,
searches
},

line_items:[
{
price_data:{
currency:"eur",
product_data:{
name:`Plan ${plan}`
},
unit_amount:amount
},
quantity:1
}
],

success_url:"http://localhost:10000/success.html",
cancel_url:"http://localhost:10000/payment.html"

});

res.json({url:session.url});

});

/* ===================================================== */
/* ================= WEBHOOK =========================== */
/* ===================================================== */

app.post("/webhook", express.raw({type:"application/json"}), async(req,res)=>{

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

let event;

try{
event = stripe.webhooks.constructEvent(
req.body,
req.headers["stripe-signature"],
endpointSecret
);
}catch(err){
return res.status(400).send("Webhook error");
}

if(event.type === "checkout.session.completed"){

const session = event.data.object;

const user = await User.findOne({
stripeCustomerId: session.customer
});

if(user){

const searches = parseInt(session.metadata.searches) || 0;

if(session.metadata.plan === "Unlimited"){
user.role = "unlimited";
}else{
user.credits = searches;
}

user.paid = true;

user.purchaseHistory.push({
plan:session.metadata.plan,
searches,
date:new Date()
});

await user.save();
}

}

res.json({received:true});
});

/* ===================================================== */
/* ================= SEARCH SYSTEM ===================== */
/* ===================================================== */

app.post("/search", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

if(user.role !== "unlimited" && user.credits <= 0){
return res.status(403).json({message:"No credits"});
}

if(user.role !== "unlimited"){
user.credits -= 1;
user.searchesUsed += 1;
}

user.searchHistory.push({
query:req.body.query,
date:new Date()
});

await user.save();

res.json({
message:"Search executed",
creditsLeft:user.credits
});

});

/* ===================================================== */
/* ================= ETSY SCRAPER ====================== */
/* ===================================================== */

app.post("/search-etsy", async(req,res)=>{

const {keyword,limit} = req.body;

const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const scraperResponse = await axios.get("https://api.scraperapi.com/",{
params:{
api_key:process.env.SCRAPAPI_KEY,
url,
render:true
}
});

const html = scraperResponse.data;

const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;

const images = [...html.matchAll(imageRegex)];

const results = images.slice(0,limit || 10).map(img=>({
image:img[0]
}));

res.json({results});

});

/* ===================================================== */
/* ================= IMAGE ANALYSIS ===================== */
/* ===================================================== */

app.post("/analyze-images", upload.array("images"), async(req,res)=>{

const results = [];

for(const file of req.files){

const base64 = file.buffer.toString("base64");

const uploadRes = await axios.post(
"https://api.imgbb.com/1/upload",
new URLSearchParams({
key:process.env.IMGBB_KEY,
image:base64
})
);

const imageUrl = uploadRes.data.data.url;

const vision = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model:"gpt-4o-mini",
messages:[
{
role:"user",
content:[
{type:"text",text:"Return similarity score 0-100"},
{type:"image_url",image_url:{url:imageUrl}}
]
}
]
},
{
headers:{
Authorization:`Bearer ${process.env.OPENAI_API_KEY}`
}
}
);

results.push({
image:file.originalname,
analysis:vision.data.choices[0].message.content
});

}

res.json({results});

});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 Server Running");
});
