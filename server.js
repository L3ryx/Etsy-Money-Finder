import "dotenv/config";
import express from "express";
import http from "http";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import multer from "multer";
import axios from "axios";
import { createHash } from "crypto";
import imageHash from "image-hash";

import User from "./models/User.js";
import ComparisonCache from "./models/ComparisonCache.js";

const app = express();
const server = http.createServer(app);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================== DATABASE ===================== */
mongoose.connect(
  `mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(()=>console.log("✅ Mongo Connected"))
.catch(err=>console.log("❌ Mongo Error",err));

/* ===================== AUTH ===================== */
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

/* ===================== REGISTER / LOGIN ===================== */
app.post("/register", async(req,res)=>{
  const {email,password} = req.body;
  const exists = await User.findOne({email});
  if(exists) return res.status(400).json({message:"User exists"});
  const hashed = await bcrypt.hash(password,10);
  const user = await User.create({
    email,
    password:hashed,
    credits:5,
    role:"user",
    paid:false,
    searchHistory:[],
    purchaseHistory:[]
  });
  const customer = await stripe.customers.create({email});
  user.stripeCustomerId = customer.id;
  await user.save();
  res.json({message:"User created"});
});

app.post("/login", async(req,res)=>{
  const {email,password} = req.body;
  const user = await User.findOne({email});
  if(!user) return res.status(400).json({message:"Invalid"});
  const match = await bcrypt.compare(password,user.password);
  if(!match) return res.status(400).json({message:"Invalid"});
  const token = jwt.sign({userId:user._id}, process.env.JWT_SECRET, {expiresIn:"7d"});
  res.json({token});
});

/* ===================== SMART HASH ===================== */
function getHash(imageUrl){
  return new Promise((resolve,reject)=>{
    imageHash(imageUrl,16,true,(err,data)=>{
      if(err) return reject(err);
      resolve(data);
    });
  });
}

function calculateDistance(hash1,hash2){
  let distance = 0;
  for(let i=0;i<hash1.length;i++){
    if(hash1[i] !== hash2[i]) distance++;
  }
  return distance;
}

/* ===================== SMART COMPARE ===================== */
async function smartCompare(etsyImage, aliImage){
  const cached = await ComparisonCache.findOne({imageA:etsyImage,imageB:aliImage});
  if(cached) return cached.similarity;

  try{
    const hash1 = await getHash(etsyImage);
    const hash2 = await getHash(aliImage);
    const distance = calculateDistance(hash1,hash2);
    if(distance>15) return 0;
  }catch(err){ console.log("Hash failed"); }

  try{
    const vision = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model:"gpt-4o-mini",
        messages:[{
          role:"user",
          content:[
            {type:"text",text:"Return similarity 0-100"},
            {type:"image_url",image_url:{url:etsyImage}},
            {type:"image_url",image_url:{url:aliImage}}
          ]
        }]
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
    const similarity = match ? parseInt(match[0]) : 0;
    await ComparisonCache.create({imageA:etsyImage,imageB:aliImage,similarity});
    return similarity;
  }catch(err){ console.log("OpenAI failed"); return 0; }
}

/* ===================== DEEP SEARCH ===================== */
app.post("/deep-search", auth, async(req,res)=>{
  const user = await User.findById(req.user.userId);
  if(!user) return res.status(401).json({message:"User not found"});
  if(user.role!=="unlimited" && user.credits<=0) return res.status(403).json({message:"No credits"});

  const {keyword,limit} = req.body;
  if(!keyword) return res.status(400).json({message:"Keyword required"});
  const maxItems = Math.min(parseInt(limit)||5,10);
  let finalResults = [];

  try{
    console.log("🔥 Keyword:", keyword);

    /* ----------- ETSY SCRAPE ----------- */
    const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;
    const scraperResponse = await axios.get(
      "https://api.scraperapi.com/",
      {params:{api_key:process.env.SCRAPAPI_KEY,url:etsyUrl,render:true}}
    );
    const html = scraperResponse.data;
    const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
    const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;
    const etsyImages = [...html.matchAll(imageRegex)].map(m=>m[0]);
    const etsyLinks = [...html.matchAll(linkRegex)].map(m=>m[0]);
    console.log("🖼️ Etsy images:", etsyImages.length);

    for(let i=0;i<Math.min(maxItems,etsyImages.length);i++){
      const etsyImage = etsyImages[i];
      const etsyLink = etsyLinks[i]||etsyUrl;

      /* ----------- GOOGLE LENS SEARCH / ALIEXPRESS FILTER ----------- */
      const searchUrl = `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(etsyImage)}&tbm=shop&q=site:aliexpress.com`;
      const googleResponse = await axios.get(
        "https://api.scraperapi.com/",
        {params:{api_key:process.env.SCRAPAPI_KEY,url:searchUrl,render:true}}
      );
      const googleHtml = googleResponse.data;
      const aliImageRegex = /https:\/\/[^"]+\.jpg/g;
      const aliLinkRegex = /https:\/\/www\.aliexpress\.com\/item\/\d+\.html/g;
      const aliImages = [...googleHtml.matchAll(aliImageRegex)].slice(0,10).map(m=>m[0]);
      const aliLinks = [...googleHtml.matchAll(aliLinkRegex)].slice(0,10).map(m=>m[0]);

      let aliexpressMatches = [];
      for(let j=0;j<aliImages.length;j++){
        const similarity = await smartCompare(etsyImage,aliImages[j]);
        if(similarity>=70){
          aliexpressMatches.push({image:aliImages[j],link:aliLinks[j]||null,similarity});
        }
      }

      if(aliexpressMatches.length>0){
        finalResults.push({etsy:{image:etsyImage,link:etsyLink},aliexpressMatches});
      }
    }

    /* ----------- CREDIT DEDUCTION ----------- */
    if(user.role!=="unlimited"){
      user.credits-=1;
      user.searchHistory.push({query:keyword,date:new Date()});
      await user.save();
    }

    res.json({results:finalResults,creditsLeft:user.credits});
  }catch(err){
    console.log(err);
    res.status(500).json({message:"Deep search failed"});
  }
});

/* ===================== SERVER START ===================== */
const PORT = process.env.PORT||10000;
server.listen(PORT,()=>console.log("🚀 Server running on port",PORT));
