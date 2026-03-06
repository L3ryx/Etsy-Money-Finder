require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { GoogleSearch } = require("google-search-results-nodejs");
const crypto = require("crypto");

/* ===================================================== */
/* SETUP */
/* ===================================================== */

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* DB */
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
/* HASH */
/* ===================================================== */

function hash(val){
return crypto.createHash("md5").update(val).digest("hex");
}

/* ===================================================== */
/* 🔥 SEARCH ROUTE WITH FULL DEBUG */
/* ===================================================== */

app.post("/search-etsy", auth, async(req,res)=>{

console.log("🚀 ROUTE CALLED");

try{

const user = await User.findById(req.user.userId);
if(!user) return res.status(401).json({message:"User not found"});

const { keyword, limit } = req.body;

console.log("🔥 KEYWORD:",keyword);

if(!keyword) return res.status(400).json({message:"Keyword required"});

/* ================= CACHE ================= */

const cache = await EtsyCache.findOne({keyword});
if(cache){
console.log("✅ CACHE HIT");
return res.json({results:cache.results,creditsLeft:user.credits});
}

/* ================= ETSY SCRAPE ================= */

const etsyUrl =
`https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

console.log("🌍 Scraping Etsy...");

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

/* Extract */

const titleRegex = /data-listing-title="([^"]+)"/g;
const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

const titles = [...html.matchAll(titleRegex)].map(m=>m[1]);
const images = [...html.matchAll(imageRegex)].map(m=>m[0]);
const links = [...html.matchAll(linkRegex)].map(m=>m[0]);

console.log("🔥 ETSY TITLES:",titles.length);
console.log("🔥 ETSY IMAGES:",images.length);

/* ================= SERPAPI ================= */

const serpapi = new GoogleSearch(process.env.SERPAPI_KEY);

let finalResults = [];

const maxItems = Math.min(parseInt(limit)||5,10);

for(let i=0;i<Math.min(maxItems,titles.length);i++){

const etsyTitle = titles[i];
const etsyImage = images[i];
const etsyLink = links[i];

console.log("🔎 Searching Google for:",etsyTitle);

const params = {
engine:"google_shopping",
q: etsyTitle.split(" ").slice(0,4).join(" ") + " aliexpress",
hl:"fr",
gl:"fr"
};

const serpData = await new Promise(resolve=>{
serpapi.json(params,(data)=>resolve(data || {}));
});

console.log("🔥 SERP RESULTS:",serpData.shopping_results?.length || 0);

let aliProducts = [];

if(serpData.shopping_results){

aliProducts = serpData.shopping_results
.filter(p=> (p.link||"").includes("aliexpress"))
.slice(0,10);

}

console.log("🔥 ALI PRODUCTS:",aliProducts.length);

let verified = [];

for(const ali of aliProducts){

const aliImage = ali.thumbnail || ali.image || "";
const aliLink = ali.link || "";

let similarity = 0;

/* Quick hash */

if(etsyImage && aliImage){
if(hash(etsyImage) === hash(aliImage)){
similarity += 40;
}
}

/* Call OpenAI ONLY if needed */

if(similarity < 70 && etsyImage && aliImage){

console.log("🤖 Calling OpenAI...");

try{

const vision = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model:"gpt-4o-mini",
messages:[
{
role:"user",
content:[
{type:"text",text:"Return similarity 0-100"},
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
console.log("❌ OpenAI error");
}

}

console.log("⭐ Similarity:",similarity);

if(similarity >= 70){

verified.push({
aliexpress:{
image:aliImage,
link:aliLink
},
similarity
});

}

}

if(verified.length > 0){

finalResults.push({
etsy:{
title:etsyTitle,
image:etsyImage,
link:etsyLink
},
aliexpressMatches:verified
});

}

}

/* ================= SAVE CACHE ================= */

await EtsyCache.create({
keyword,
results:finalResults
});

res.json({
results:finalResults
});

}catch(err){

console.error("🔥 SERVER ERROR:",err);
res.status(500).json({message:"Search failed"});

}

});

/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 SERVER RUNNING ON PORT",PORT);
});
