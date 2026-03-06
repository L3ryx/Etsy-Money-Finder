require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Server } = require("socket.io");
const { GoogleSearch } = require("google-search-results-nodejs");

/* ===================================================== */
/* GLOBAL ERROR HANDLING */
/* ===================================================== */

process.on("uncaughtException", err => {
console.error("🔥 CRASH:", err);
});

process.on("unhandledRejection", err => {
console.error("🔥 PROMISE ERROR:", err);
});

/* ===================================================== */
/* APP SETUP */
/* ===================================================== */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* DATABASE */
/* ===================================================== */

mongoose.connect(
`mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(()=>console.log("✅ Mongo Connected"))
.catch(err=>console.log("❌ Mongo Error",err));

/* ===================================================== */
/* MODELS */
/* ===================================================== */

const User = require("./models/User");

const CacheSchema = new mongoose.Schema({
keyword:String,
results:Array,
updatedAt:{type:Date,default:Date.now}
});

const EtsyCache = mongoose.model("EtsyCache",CacheSchema);

/* ===================================================== */
/* AUTH */
/* ===================================================== */

function auth(req,res,next){

const token = req.headers.authorization?.split(" ")[1];
if(!token) return res.status(401).json({message:"No token"});

try{
req.user = jwt.verify(token,process.env.JWT_SECRET);
next();
}catch(err){
return res.status(401).json({message:"Invalid token"});
}

}

/* ===================================================== */
/* REGISTER / LOGIN */
/* ===================================================== */

app.post("/register", async(req,res)=>{
try{
const {email,password} = req.body;
const exists = await User.findOne({email});
if(exists) return res.status(400).json({message:"User exists"});

const hashed = await bcrypt.hash(password,10);

const user = await User.create({
email,
password:hashed,
credits:5,
role:"user",
searchHistory:[],
purchaseHistory:[]
});

res.json({message:"User created"});
}catch(err){
console.error(err);
res.status(500).json({message:"Register error"});
}
});

app.post("/login", async(req,res)=>{
try{

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

}catch(err){
res.status(500).json({message:"Login error"});
}
});

/* ===================================================== */
/* SMART SEARCH (ETSY + SERPAPI GOOGLE SHOPPING) */
/* ===================================================== */

app.post("/search-etsy", auth, async(req,res)=>{

try{

const user = await User.findById(req.user.userId);
if(!user) return res.status(401).json({message:"User not found"});

if(user.role !== "unlimited" && user.credits <= 0){
return res.status(403).json({message:"No credits"});
}

const {keyword,limit} = req.body;
if(!keyword) return res.status(400).json({message:"Keyword required"});

/* ================= CACHE CHECK ================= */

const cache = await EtsyCache.findOne({keyword});
if(cache){
console.log("✅ Using cache");
return res.json({results:cache.results,creditsLeft:user.credits});
}

/* ================= ETSY SCRAPE ================= */

const etsyUrl =
`https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const scraperResponse = await axios.get(
"https://api.scraperapi.com/",
{
params:{
api_key:process.env.SCRAPAPI_KEY,
url:etsyUrl,
render:true
}
}
);

const html = scraperResponse.data;

const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

const images = [...html.matchAll(imageRegex)].map(m=>m[0]);
const links = [...html.matchAll(linkRegex)].map(m=>m[0]);

const maxItems = Math.min(parseInt(limit) || 5,10);

let finalResults = [];

/* ================= SERPAPI ================= */

const serpapiClient = new GoogleSearch(process.env.SERPAPI_KEY);

for(let i=0;i<Math.min(maxItems,images.length);i++){

const etsyImage = images[i];
const etsyLink = links[i] || etsyUrl;

const params = {
engine:"google_shopping",
q:etsyImage,
google_domain:"google.com",
hl:"fr",
gl:"fr"
};

const serpData = await new Promise((resolve)=>{

serpapiClient.json(params,(data)=>{
resolve(data || {});
});

});

let aliMatches = [];

if(serpData.shopping_results){

for(const product of serpData.shopping_results){

if(product.link && product.link.includes("aliexpress")){

const similarity = 80; // 🔥 TU PEUX INTÉGRER OPENAI ICI PLUS TARD

if(similarity >= 70){

aliMatches.push({
image:product.thumbnail || product.image,
link:product.link,
similarity
});

}

}

}

}

if(aliMatches.length > 0){

finalResults.push({
etsy:{
image:etsyImage,
link:etsyLink
},
aliexpressMatches:aliMatches
});

}

}

/* ================= SAVE CACHE ================= */

await EtsyCache.create({
keyword,
results:finalResults
});

/* ================= CREDIT DEDUCTION ================= */

if(user.role !== "unlimited"){
user.credits -= 1;
user.searchHistory.push({
query:keyword,
date:new Date()
});
await user.save();
}

res.json({
results:finalResults,
creditsLeft:user.credits
});

}catch(err){

console.error("🔥 SEARCH ERROR:",err);
res.status(500).json({message:"Search failed"});

}

});

/* ===================================================== */
/* SOCKET */
/* ===================================================== */

io.on("connection",(socket)=>{
console.log("🟢 Client connected");
socket.emit("connected",{socketId:socket.id});
});

/* ===================================================== */
/* START SERVER */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 Server Running on port",PORT);
});
