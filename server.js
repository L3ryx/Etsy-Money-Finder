require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { GoogleSearch } = require("google-search-results-nodejs");
const crypto = require("crypto");

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
.then(()=>console.log("✅ Mongo Connected"))
.catch(err=>console.log("❌ Mongo Error",err));

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
/* HASH QUICK FILTER (ANTI OPENAI COST) */
/* ===================================================== */

function imageHash(value){
return crypto.createHash("md5").update(value).digest("hex");
}

/* ===================================================== */
/* 🔥 SEARCH ENGINE */
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
console.log("✅ Cache used");
return res.json({results:cache.results,creditsLeft:user.credits});
}

/* ================= ETSY SCRAPE ================= */

const etsyUrl =
`https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const etsyResponse = await axios.get(
"https://api.scraperapi.com/",
{
params:{
api_key:process.env.SCRAPAPI_KEY,
url:etsyUrl,
render:true
}
}
);

const html = etsyResponse.data;

/* ===== Improved Extraction (More Stable Regex) ===== */

const titleRegex = /data-listing-title="([^"]+)"/g;
const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

const titles = [...html.matchAll(titleRegex)].map(m=>m[1]);
const images = [...html.matchAll(imageRegex)].map(m=>m[0]);
const links = [...html.matchAll(linkRegex)].map(m=>m[0]);

console.log("🔥 Titles:",titles.length);
console.log("🔥 Images:",images.length);

const maxItems = Math.min(parseInt(limit) || 5,10);

let finalResults = [];

const serpapi = new GoogleSearch(process.env.SERPAPI_KEY);

/* ================= LOOP ETSY PRODUCTS ================= */

for(let i=0;i<Math.min(maxItems,titles.length);i++){

const etsyTitle = titles[i] || keyword;
const etsyImage = images[i];
const etsyLink = links[i];

/* ================= GOOGLE SHOPPING TEXT SEARCH ================= */

const params = {
engine:"google_shopping",
q: etsyTitle.split(" ").slice(0,4).join(" ") + " aliexpress",
hl:"fr",
gl:"fr"
};

const serpData = await new Promise(resolve=>{
serpapi.json(params,(data)=>resolve(data || {}));
});

let aliProducts = [];

if(serpData.shopping_results){

aliProducts = serpData.shopping_results
.filter(p => (p.link || "").includes("aliexpress"))
.slice(0,10);

}

console.log("🔥 Ali Products:",aliProducts.length);

let verifiedMatches = [];

/* ================= LOOP ALI PRODUCTS ================= */

for(const ali of aliProducts){

const aliImage = ali.thumbnail || ali.image || "";
const aliLink = ali.link || "";

/* ================= QUICK FILTER ================= */

let similarity = 0;

/* Text quick match */
if(ali.title && etsyTitle){
if(ali.title.toLowerCase().includes(etsyTitle.toLowerCase())){
similarity += 40;
}
}

/* Hash quick match */
if(etsyImage && aliImage){
if(imageHash(etsyImage) === imageHash(aliImage)){
similarity += 40;
}
}

/* ================= OPENAI ONLY IF NECESSARY ================= */

if(similarity < 70 && etsyImage && aliImage){

try{

const vision = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model:"gpt-4o-mini",
messages:[
{
role:"user",
content:[
{type:"text",text:"Return similarity 0-100 between these images"},
{type:"image_url",image_url:{url:etsyImage}},
{type:"image_url",image_url:{url:aliImage}}
]
}
]
},
{
headers:{
Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
"Content-Type":"application/json"
}
}
);

const text = vision.data.choices[0].message.content;
const match = text.match(/\d+/);
similarity = match ? parseInt(match[0]) : 0;

}catch(err){
console.log("OpenAI skipped");
}

}

/* ================= FINAL FILTER ================= */

if(similarity >= 70){

verifiedMatches.push({
aliexpress:{
image:aliImage,
link:aliLink
},
similarity
});

}

}

if(verifiedMatches.length > 0){

finalResults.push({
etsy:{
title:etsyTitle,
image:etsyImage,
link:etsyLink
},
aliexpressMatches:verifiedMatches
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
