require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Stripe = require("stripe");
const imageHash = require("image-hash");
const FormData = require("form-data");

const app = express();
const server = http.createServer(app);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const User = require("./models/User");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

/* ===================================================== */
/* DATABASE */
/* ===================================================== */

mongoose.connect(
`mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(() => console.log("✅ Mongo Connected"))
.catch(err => console.log("Mongo Error", err));

/* ===================================================== */
/* AUTH */
/* ===================================================== */

function auth(req,res,next){

const token = req.headers.authorization?.split(" ")[1];
if(!token) return res.status(401).json({message:"No token"});

try{
req.user = jwt.verify(token,process.env.JWT_SECRET);
next();
}catch{
return res.status(401).json({message:"Invalid token"});
}

}

/* ===================================================== */
/* IMAGE HASH */
/* ===================================================== */

function getHash(url){
return new Promise((resolve,reject)=>{
imageHash(url,16,true,(err,data)=>{
if(err) reject(err);
resolve(data);
});
});
}

function distance(h1,h2){

let diff = 0;

for(let i=0;i<h1.length;i++){
if(h1[i] !== h2[i]) diff++;
}

return diff;
}

/* ===================================================== */
/* IMGBB UPLOAD */
/* ===================================================== */

async function uploadToImgBB(imageUrl){

try{

const img = await axios.get(imageUrl,{responseType:"arraybuffer"});

const base64 = Buffer.from(img.data).toString("base64");

const form = new FormData();
form.append("image",base64);

const res = await axios.post(
`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`,
form,
{headers:form.getHeaders()}
);

return res.data.data.url;

}catch(err){

console.log("IMGBB error");
return imageUrl;

}

}

/* ===================================================== */
/* OPENAI COMPARISON */
/* ===================================================== */

async function openAICompare(img1,img2){

try{

const response = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model:"gpt-4o-mini",
messages:[
{
role:"user",
content:[
{type:"text",text:"Return similarity 0-100"},
{type:"image_url",image_url:{url:img1}},
{type:"image_url",image_url:{url:img2}}
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

const text = response.data.choices[0].message.content;
const match = text.match(/\d+/);

return match ? parseInt(match[0]) : 0;

}catch{

return 0;

}

}

/* ===================================================== */
/* SMART COMPARE */
/* ===================================================== */

async function smartCompare(img1,img2){

try{

const hash1 = await getHash(img1);
const hash2 = await getHash(img2);

const diff = distance(hash1,hash2);

/* Filtre rapide */
if(diff > 15){
return 0;
}

}catch{}

return await openAICompare(img1,img2);

}

/* ===================================================== */
/* ETSY SCRAPER */
/* ===================================================== */

async function scrapeEtsy(keyword){

const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const response = await axios.get(
"https://api.scraperapi.com/",
{
params:{
api_key:process.env.SCRAPAPI_KEY,
url,
render:true
}
}
);

const html = response.data;

const images = [...html.matchAll(/https:\/\/i\.etsystatic\.com[^"]+/g)].map(m=>m[0]);
const links = [...html.matchAll(/https:\/\/www\.etsy\.com\/listing\/\d+/g)].map(m=>m[0]);

let results = [];

for(let i=0;i<Math.min(images.length,10);i++){

results.push({
image:images[i],
link:links[i] || null
});

}

return results;

}

/* ===================================================== */
/* GOOGLE LENS (SERPAPI) */
/* ===================================================== */

async function googleLensSearch(imageUrl){

try{

const res = await axios.get("https://serpapi.com/search",{

params:{
engine:"google_lens",
url:imageUrl,
api_key:process.env.SERPAPI_KEY
}

});

const matches = res.data.visual_matches || [];

let results = [];

for(let item of matches){

if(item.link && item.link.includes("aliexpress")){

results.push({
image:item.thumbnail,
link:item.link
});

}

}

return results.slice(0,10);

}catch(err){

console.log("Lens error");
return [];

}

}

/* ===================================================== */
/* DEEP SEARCH ROUTE */
/* ===================================================== */

app.post("/deep-search",auth,async(req,res)=>{

console.log("🚀 ROUTE CALLED");

const user = await User.findById(req.user.userId);

if(!user) return res.status(401).json({message:"User not found"});

if(user.credits <= 0 && user.role !== "unlimited"){
return res.status(403).json({message:"No credits"});
}

const {keyword} = req.body;

if(!keyword){
return res.status(400).json({message:"Keyword required"});
}

console.log("🔥 Keyword:",keyword);

let finalResults = [];

try{

const etsyProducts = await scrapeEtsy(keyword);

for(let product of etsyProducts){

const hostedImage = await uploadToImgBB(product.image);

const lensResults = await googleLensSearch(hostedImage);

for(let ali of lensResults){

const similarity = await smartCompare(product.image,ali.image);

if(similarity >= 70){

finalResults.push({

etsy:{
image:product.image,
link:product.link
},

aliexpress:{
image:ali.image,
link:ali.link
},

similarity

});

}

}

}

/* CREDIT DEDUCTION */

if(user.role !== "unlimited"){
user.credits -= 1;
await user.save();
}

res.json({
results:finalResults,
credits:user.credits
});

}catch(err){

console.log("Search failed",err);

res.status(500).json({message:"Search failed"});

}

});

/* ===================================================== */
/* SERVER START */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{

console.log("🚀 Server running on port",PORT);

});
