require("dotenv").config()

const express = require("express")
const axios = require("axios")
const http = require("http")

const app = express()
const server = http.createServer(app)

app.use(express.json())
app.use(express.static("public"))

/* ===================================================== */
/* SEARCH ETSY */
/* ===================================================== */

app.post("/search", async(req,res)=>{

const {keyword,limit} = req.body

try{

/* ===== ETSY SCRAP VIA ZENROWS ===== */

const etsy = await axios.get("https://api.zenrows.com/v1/",{
params:{
url:`https://www.etsy.com/search?q=${keyword}`,
apikey:process.env.ZENROWS_API_KEY,
premium_proxy:"true",
js_render:"true"
}
})

const html = etsy.data

const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g
const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g

const images = [...html.matchAll(imageRegex)].map(m=>m[0])
const links = [...html.matchAll(linkRegex)].map(m=>m[0])

let results = []

for(let i=0;i<Math.min(limit,images.length);i++){

const image = images[i]
const link = links[i] || ""

results.push({
etsy:{
image,
link
}
})

}

res.json({results})

}catch(err){

console.log(err)
res.status(500).json({error:"Scraping failed"})

}

})

/* ===================================================== */
/* IMAGE REVERSE SEARCH + ALI FILTER + AI COMPARE */
/* ===================================================== */

app.post("/analyze", async(req,res)=>{

const {imageUrl,etsyLink} = req.body

try{

/* ===== GOOGLE IMAGE REVERSE VIA SERPAPI ===== */

const google = await axios.get("https://serpapi.com/search.json",{
params:{
engine:"google_reverse_image",
image_url:imageUrl,
api_key:process.env.SERPAPI_KEY
}
})

const results = google.data.image_results || []

/* ===== FILTER ALIEXPRESS ===== */

const ali = results
.filter(r=>r.link && r.link.includes("aliexpress.com"))
.slice(0,5)

let finalMatches = []

for(const item of ali){

/* ===== OPENAI IMAGE COMPARE ===== */

const ai = await axios.post(
"https://api.openai.com/v1/chat/completions",
{
model:"gpt-4o-mini",
messages:[
{
role:"user",
content:[
{type:"text",text:"Return similarity 0-100"},
{type:"image_url",image_url:{url:imageUrl}},
{type:"image_url",image_url:{url:item.thumbnail || item.image || item.link}}
]
}
]
},
{
headers:{
Authorization:`Bearer ${process.env.OPENAI_API_KEY}`
}
}
)

const text = ai.data.choices[0].message.content
const percent = parseInt(text.match(/\d+/)?.[0] || "0")

if(percent >= 70){

finalMatches.push({
etsy:{
link:etsyLink,
image:imageUrl
},
aliexpress:{
link:item.link,
image:item.thumbnail || null,
similarity:percent
}
})

}

}

res.json({matches:finalMatches})

}catch(err){

console.log(err)
res.status(500).json({error:"Analysis failed"})

}

})

/* ===================================================== */

server.listen(3000,()=>{
console.log("🚀 Server running")
})
