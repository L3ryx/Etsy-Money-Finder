require("dotenv").config();

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");

const app = express();
const server = http.createServer(app);
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
credits:0,
searchesUsed:0,
paid:false,
role:"user",
purchaseHistory:[],
searchHistory:[]
});

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
/* ================= DASHBOARD DATA ==================== */
/* ===================================================== */

app.get("/me", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

if(!user){
return res.status(404).json({message:"User not found"});
}

res.json({
email:user.email,
credits:user.credits,
searchesUsed:user.searchesUsed,
purchaseHistory:user.purchaseHistory || [],
searchHistory:user.searchHistory || []
});

});

/* ===================================================== */
/* ============== STRIPE CHECKOUT ====================== */
/* ===================================================== */

app.post("/create-checkout-session", async(req,res)=>{

try{

const token = req.headers.authorization?.split(" ")[1];
if(!token){
return res.status(401).json({message:"No token"});
}

const decoded = jwt.verify(token,process.env.JWT_SECRET);
const user = await User.findById(decoded.userId);

if(!user){
return res.status(404).json({message:"User not found"});
}

const {amount, plan, searches} = req.body;

const session = await stripe.checkout.sessions.create({

payment_method_types:["card"],
mode:"payment",
customer:user.stripeCustomerId,

metadata:{
plan:plan,
searches:searches
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

}catch(err){
console.log(err);
res.status(500).json({message:"Stripe error"});
}

});

/* ===================================================== */
/* ================= STRIPE WEBHOOK ==================== */
/* ===================================================== */

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.post("/webhook", express.raw({type:"application/json"}), async(req,res)=>{

let event;

try{
event = stripe.webhooks.constructEvent(
req.body,
req.headers["stripe-signature"],
endpointSecret
);
}catch(err){
return res.status(400).send(`Webhook Error: ${err.message}`);
}

if(event.type === "checkout.session.completed"){

const session = event.data.object;

const user = await User.findOne({
stripeCustomerId: session.customer
});

if(user){

const searches = parseInt(session.metadata.searches) || 0;

user.paid = true;
user.credits = searches;
user.searchesUsed = 0;

user.purchaseHistory = user.purchaseHistory || [];

user.purchaseHistory.push({
plan: session.metadata.plan,
searches: searches,
date: new Date()
});

await user.save();

console.log("✅ Credits added");
}

}

res.json({received:true});
});

/* ===================================================== */
/* ================= SEARCH ROUTE ====================== */
/* ===================================================== */

app.post("/search", auth, async(req,res)=>{

const user = await User.findById(req.user.userId);

if(!user){
return res.status(404).json({message:"User not found"});
}

if(user.credits <= 0){
return res.status(403).json({message:"No credits"});
}

/* 🔥 Déduction crédit */

user.credits -= 1;
user.searchesUsed += 1;

/* 🔥 Sauvegarde historique recherche */

user.searchHistory = user.searchHistory || [];

user.searchHistory.push({
query:req.body.query || "Unknown",
result:"RESULTAT ICI",
date:new Date()
});

await user.save();

res.json({
message:"Search success",
creditsLeft:user.credits
});

});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 Server running on port",PORT);
});
