require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Stripe = require("stripe");
const { Server } = require("socket.io");
const FormData = require("form-data");
const imageHash = require("image-hash");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

/* ============================ */
/* DATABASE */
/* ============================ */

mongoose.connect(
`mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(()=>console.log("✅ Mongo Connected"))
.catch(err=>console.log("Mongo Error",err));

const User = require("./models/User");

/* ============================ */
/* AUTH */
/* ============================ */

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

/* ============================ */
/* IMAGE HASH */
/* ============================ */

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

/* ============================ */
/* OPENAI IMAGE COMPARISON */
/* ============================ */

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

}catch(err){

console.log("OpenAI error");
return 0;

}

}

/* ============================ */
/* IMGBB UPLOAD */
/* ============================ */

async function uploadIMGBB(url){

try{

const img = await axios.get(url,{responseType:"arraybuffer"});

const form = new FormData();

form.append(
"image",
Buffer.from(img.data).toString("base64")
);

const res = await axios.post(
`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`,
form,
{ headers: form.getHeaders() }
);

return res.data.data.url;

}catch(err){

console.log("IMGBB upload failed");
return url;

}

}

/* ============================ */
/* ETSY SCRAPER */
/* ============================ */

async function scrapeEtsy(keyword){

console.log("Scraping Etsy...");

const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const response = await axios.get(
"https://api.scraperapi.com/",
{
params:{
api_key:process.env.SCRAPERAPI_KEY,
url,
render:true
}
}
);

const html = response.data;

const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

const images = [...html.matchAll(imageRegex)].map(m=>m[0]);
const links = [...html.matchAll(linkRegex)].map(m=>m[0]);

let results = [];

for(let i=0;i<images.length;i++){

results.push({
image:images[i],
link:links[i] || null
});

}

return results;

}

/* ============================ */
/* GOOGLE LENS SEARCH */
/* ============================ */

async function googleLensSearch(imageUrl){

try{

const res = await axios.get("https://serpapi.com/search",{

params:{
engine:"google_lens",
url:imageUrl,
api_key:process.env.SERPAPI_KEY
}

});

let matches = [];

const data = res.data.visual_matches || [];

for(let item of data){

if(item.link && item.link.includes("aliexpress")){

matches.push({
image:item.thumbnail,
link:item.link
});

}

}

return matches.slice(0,10);

}catch(err){

console.log("Lens failed");

return [];

}

}

/* ============================ */
/* MAIN SEARCH */
/* ============================ */

app.post("/deep-search",auth,async(req,res)=>{

try{

const user = await User.findById(req.user.userId);

if(!user){
return res.status(401).json({message:"User"});
}

if(user.credits <= 0 && user.role !== "unlimited"){
return res.status(403).json({message:"No credits"});
}

const keyword = req.body.keyword;

if(!keyword){
return res.status(400).json({message:"Keyword required"});
}

console.log("Keyword:",keyword);

const etsyProducts = await scrapeEtsy(keyword);

let finalResults = [];

for(let product of etsyProducts.slice(0,10)){

console.log("Etsy:",product.image);

const imgbbUrl = await uploadIMGBB(product.image);

const lensMatches = await googleLensSearch(imgbbUrl);

for(let match of lensMatches){

try{

const hash1 = await getHash(product.image);
const hash2 = await getHash(match.image);

const diff = distance(hash1,hash2);

if(diff > 15){
continue;
}

const similarity = await openAICompare(product.image,match.image);

if(similarity >= 70){

finalResults.push({

etsy:{
image:product.image,
link:product.link
},

aliexpress:{
image:match.image,
link:match.link
},

similarity

});

}

}catch(err){

console.log("compare error");

}

}

}

if(user.role !== "unlimited"){
user.credits -= 1;
await user.save();
}

res.json({
results:finalResults,
credits:user.credits
});

}catch(err){

console.log(err);

res.status(500).json({
message:"Search failed"
});

}

});

/* ============================ */
/* SERVER */
/* ============================ */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
console.log("🚀 Server running on port",PORT);
});
