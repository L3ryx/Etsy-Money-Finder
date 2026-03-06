require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const FormData = require("form-data");
const { Server } = require("socket.io");
const imageHash = require("image-hash");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const User = require("./models/User");

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
.catch(err=>console.log("Mongo error",err));

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
/* REGISTER */
/* ===================================================== */

app.post("/register", async(req,res)=>{

const {email,password} = req.body;

const exists = await User.findOne({email});
if(exists) return res.status(400).json({message:"User exists"});

const hashed = await bcrypt.hash(password,10);

const user = await User.create({
email,
password:hashed,
credits:5,
role:"user"
});

const customer = await stripe.customers.create({email});
user.stripeCustomerId = customer.id;

await user.save();

res.json({message:"User created"});

});

/* ===================================================== */
/* LOGIN */
/* ===================================================== */

app.post("/login", async(req,res)=>{

const {email,password} = req.body;

const user = await User.findOne({email});
if(!user) return res.status(400).json({message:"Invalid login"});

const match = await bcrypt.compare(password,user.password);
if(!match) return res.status(400).json({message:"Invalid login"});

const token = jwt.sign(
{userId:user._id},
process.env.JWT_SECRET,
{expiresIn:"7d"}
);

res.json({token});

});

/* ===================================================== */
/* IMAGE HASH */
/* ===================================================== */

function getHash(imageUrl){

return new Promise((resolve,reject)=>{

imageHash(imageUrl,16,true,(err,data)=>{

if(err) reject(err);
else resolve(data);

});

});

}

function hashDistance(hash1,hash2){

let distance = 0;

for(let i=0;i<hash1.length;i++){

if(hash1[i] !== hash2[i]) distance++;

}

return distance;

}

/* ===================================================== */
/* UPLOAD IMAGE TO IMGBB */
/* ===================================================== */

async function uploadToImgBB(imageUrl){

try{

const img = await axios.get(imageUrl,{responseType:"arraybuffer"});

const form = new FormData();

form.append("image",Buffer.from(img.data).toString("base64"));

const upload = await axios.post(
`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
form,
{headers:form.getHeaders()}
);

return upload.data.data.url;

}catch{

console.log("IMGBB upload failed");

return imageUrl;

}

}

/* ===================================================== */
/* SMART COMPARE */
/* ===================================================== */

async function smartCompare(etsyImage,aliImage){

/* HASH FILTER */

try{

const hash1 = await getHash(etsyImage);
const hash2 = await getHash(aliImage);

const distance = hashDistance(hash1,hash2);

/* trop différent */

if(distance > 15){

return 0;

}

}catch{

console.log("Hash error");

}

/* OPENAI COMPARE */

try{

const response = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model:"gpt-4o-mini",
messages:[
{
role:"user",
content:[
{type:"text",text:"Return similarity percentage between these two product images"},
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

const text = response.data.choices[0].message.content;

const match = text.match(/\d+/);

return match ? parseInt(match[0]) : 0;

}catch{

console.log("OpenAI error");

return 0;

}

}

/* ===================================================== */
/* DEEP SEARCH */
/* ===================================================== */

app.post("/deep-search", auth, async(req,res)=>{

console.log("🚀 SEARCH START");

const user = await User.findById(req.user.userId);

if(!user) return res.status(401).json({message:"User not found"});

if(user.credits <= 0 && user.role !== "unlimited"){

return res.status(403).json({message:"No credits"});

}

const {keyword,limit} = req.body;

const maxItems = Math.min(parseInt(limit)||5,10);

let results = [];

try{

/* ================= ETSY SCRAPE ================= */

const etsyUrl =
`https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

const scrape = await axios.get(
"https://api.scraperapi.com/",
{
params:{
api_key:process.env.SCRAPAPI_KEY,
url:etsyUrl,
render:true
}
}
);

const html = scrape.data;

const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

const etsyImages = [...html.matchAll(imageRegex)].map(m=>m[0]);
const etsyLinks = [...html.matchAll(linkRegex)].map(m=>m[0]);

console.log("Etsy images:",etsyImages.length);

/* ================= LOOP ETSY ================= */

for(let i=0;i<Math.min(maxItems,etsyImages.length);i++){

const etsyImage = etsyImages[i];
const etsyLink = etsyLinks[i] || etsyUrl;

/* IMGBB */

const hostedImage = await uploadToImgBB(etsyImage);

/* GOOGLE IMAGE SEARCH */

const googleUrl =
`https://www.google.com/searchbyimage?image_url=${encodeURIComponent(hostedImage)}&tbm=shop&q=site:aliexpress.com`;

const google = await axios.get(
"https://api.scraperapi.com/",
{
params:{
api_key:process.env.SCRAPAPI_KEY,
url:googleUrl,
render:true
}
}
);

const googleHtml = google.data;

const aliImageRegex = /https:\/\/[^"]+\.jpg/g;
const aliLinkRegex = /https:\/\/www\.aliexpress\.com\/item\/\d+\.html/g;

const aliImages = [...googleHtml.matchAll(aliImageRegex)]
.slice(0,10)
.map(m=>m[0]);

const aliLinks = [...googleHtml.matchAll(aliLinkRegex)]
.slice(0,10)
.map(m=>m[0]);

let matches = [];

/* SMARTCOMPARE */

for(let j=0;j<aliImages.length;j++){

const similarity = await smartCompare(etsyImage,aliImages[j]);

if(similarity >= 70){

matches.push({

image:aliImages[j],
link:aliLinks[j] || null,
similarity

});

}

}

if(matches.length>0){

results.push({

etsy:{
image:etsyImage,
link:etsyLink
},

aliexpress:matches

});

}

}

/* CREDIT */

if(user.role !== "unlimited"){

user.credits -= 1;
await user.save();

}

res.json({
results,
credits:user.credits
});

}catch(err){

console.log(err);

res.status(500).json({message:"Search failed"});

}

});

/* ===================================================== */
/* SERVER */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{

console.log("🚀 Server running on port",PORT);

});
