require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { GoogleSearch } = require("google-search-results-nodejs");
const { Server } = require("socket.io");

/* ===================================================== */
/* APP SETUP */
/* ===================================================== */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* DATABASE */
/* ===================================================== */

mongoose.connect(
`mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(()=>console.log("✅ Mongo connected"))
.catch(err=>console.log("❌ Mongo error",err));

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
/* 🔥 SEARCH SYSTEM (TITLE BASED — MUCH MORE STABLE) */
/* ===================================================== */

app.post("/search-etsy", auth, async(req,res)=>{

try{

const user = await User.findById(req.user.userId);
if(!user) return res.status(401).json({message:"User not found"});

if(user.role !== "unlimited" && user.credits <= 0){
return res.status(403).json({message:"No credits"});
}

const { keyword, limit } = req.body;
if(!keyword) return res.status(400).json({message:"Keyword required"});

/* ================= CACHE ================= */

const cache = await EtsyCache.findOne({keyword});
if(cache){
return res.json({results:cache.results,creditsLeft:user.credits});
}

/* ================= ETSY SCRAPE ================= */

const etsyUrl =
`https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const scraper = await axios.get(
"https://api.scraperapi.com/",
{
params:{
api_key:process.env.SCRAPAPI_KEY,
url:etsyUrl,
render:true
}
}
);

const html = scraper.data;

/* ================= EXTRACT TITLE + IMAGE + LINK ================= */

const titleRegex = /<h3[^>]*>(.*?)<\/h3>/g;
const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

const titles = [...html.matchAll(titleRegex)].map(m=>m[1]);
const images = [...html.matchAll(imageRegex)].map(m=>m[0]);
const links = [...html.matchAll(linkRegex)].map(m=>m[0]);

const maxItems = Math.min(parseInt(limit) || 5,10);

let finalResults = [];

/* ================= SERPAPI TEXT SEARCH ================= */

const serpapiClient = new GoogleSearch(process.env.SERPAPI_KEY);

for(let i=0;i<Math.min(maxItems,images.length,titles.length);i++){

const etsyImage = images[i];
const etsyLink = links[i] || etsyUrl;
const etsyTitle = titles[i] || keyword;

/* 🔥 TEXT SEARCH (NOT IMAGE SEARCH) */

const params = {
engine:"google_shopping",
q: etsyTitle + " aliexpress",
google_domain:"google.com",
hl:"fr",
gl:"fr"
};

const serpData = await new Promise(resolve=>{
serpapiClient.json(params,(data)=>{
resolve(data || {});
});
});

let aliMatches = [];

if(serpData.shopping_results){

for(const product of serpData.shopping_results){

const productLink =
product.link ||
product.product_link ||
product.url ||
"";

const isAli =
productLink.includes("aliexpress") ||
(product.source || "").toLowerCase().includes("aliexpress");

if(isAli){

aliMatches.push({
image:product.thumbnail || product.image,
link:productLink,
similarity:75 // 🔥 Ici tu peux mettre OpenAI plus tard
});

}

}

}

/* ================= IF MATCH FOUND ================= */

if(aliMatches.length > 0){

finalResults.push({
etsy:{
title:etsyTitle,
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

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 Server running on port",PORT);
});
