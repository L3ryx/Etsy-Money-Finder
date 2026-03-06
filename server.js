const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const mongoose = require("mongoose")
const cors = require("cors")
const crypto = require("crypto")
const OpenAI = require("openai")

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.static("public"))

const PORT = process.env.PORT || 10000

const openai = new OpenAI({
 apiKey: process.env.OPENAI_API_KEY
})

/* ---------------- MONGO ---------------- */

mongoose.connect(process.env.MONGO_URI)

const CacheSchema = new mongoose.Schema({
 keyword:String,
 results:Array
})

const Cache = mongoose.model("cache",CacheSchema)

/* ---------------- IMAGE HASH ---------------- */

async function imageHash(url){

 try{

 const img = await axios.get(url,{responseType:"arraybuffer"})
 const hash = crypto.createHash("md5").update(img.data).digest("hex")

 return hash

 }catch(e){

 return null

 }

}

/* ---------------- HASH SIMILARITY ---------------- */

function similarity(hash1,hash2){

 if(!hash1 || !hash2) return 0

 let same = 0

 for(let i=0;i<hash1.length;i++){

  if(hash1[i] === hash2[i]) same++

 }

 return (same/hash1.length)*100

}

/* ---------------- OPENAI IMAGE COMPARISON ---------------- */

async function aiCompare(img1,img2){

 try{

 const response = await openai.chat.completions.create({

  model:"gpt-4o-mini",

  messages:[
  {
   role:"user",
   content:[
    {type:"text",text:"Compare these 2 product images and return similarity percentage only"},
    {type:"image_url",image_url:{url:img1}},
    {type:"image_url",image_url:{url:img2}}
   ]
  }
  ]

 })

 const text = response.choices[0].message.content

 const number = parseInt(text.match(/\d+/)?.[0])

 return number || 0

 }catch(e){

 console.log("OpenAI error")

 return 0

 }

}

/* ---------------- ROUTE ---------------- */

app.get("/search", async(req,res)=>{

 try{

 console.log("🚀 ROUTE CALLED")

 const keyword = req.query.keyword

 console.log("🔥 KEYWORD:",keyword)

 /* ----- CACHE ----- */

 const cache = await Cache.findOne({keyword})

 if(cache){

 console.log("✅ CACHE HIT")

 return res.json(cache.results)

 }

 /* ----- SCRAPE ETSY ----- */

 console.log("🌍 Scraping Etsy...")

 const etsyURL = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`

 const {data} = await axios.get(etsyURL)

 const $ = cheerio.load(data)

 const titles = []
 const images = []
 const links = []

 $("a.listing-link").each((i,el)=>{

 const title = $(el).attr("title")
 const link = "https://etsy.com"+$(el).attr("href")

 const img = $(el).find("img").attr("src")

 if(title && img){

 titles.push(title)
 images.push(img)
 links.push(link)

 }

 })

 console.log("🔥 ETSY TITLES:",titles.length)

 const results = []

 /* ----- LOOP ETSY ----- */

 for(let i=0;i<Math.min(10,titles.length);i++){

 const title = titles[i]
 const etsyImage = images[i]
 const etsyLink = links[i]

 console.log("🔎 GOOGLE SEARCH:",title)

 /* ----- GOOGLE SHOPPING ----- */

 const serp = await axios.get("https://serpapi.com/search",{

 params:{
  api_key:process.env.SERPAPI_KEY,
  engine:"google",
  tbm:"shop",
  q:title
 }

 })

 const shopping = serp.data.shopping_results || []

 const aliProducts = shopping.filter(p=>

 p.link && p.link.includes("aliexpress")

 )

 console.log("🛒 ALI PRODUCTS:",aliProducts.length)

 const etsyHash = await imageHash(etsyImage)

 for(let ali of aliProducts.slice(0,10)){

 const aliImg = ali.thumbnail
 const aliLink = ali.link

 const aliHash = await imageHash(aliImg)

 const sim = similarity(etsyHash,aliHash)

 console.log("⚡ HASH SIM:",sim)

 if(sim > 60){

 const aiScore = await aiCompare(etsyImage,aliImg)

 console.log("🤖 AI SCORE:",aiScore)

 if(aiScore >= 70){

 results.push({

 etsyImage,
 etsyLink,
 aliImage:aliImg,
 aliLink,
 similarity:aiScore

 })

 }

 }

 }

 }

 /* ----- SAVE CACHE ----- */

 await Cache.create({

 keyword,
 results

 })

 console.log("💾 CACHE SAVED")

 res.json(results)

 }catch(e){

 console.log("SERVER ERROR",e)

 res.status(500).json({error:"server error"})

 }

})

/* ---------------- START ---------------- */

app.listen(PORT,()=>{

 console.log("🚀 SERVER RUNNING ON PORT",PORT)

})
