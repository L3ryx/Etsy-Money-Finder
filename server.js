const express = require("express")
const { spawn } = require("child_process")
const path = require("path")
require("dotenv").config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static("public"))

app.get("/", (req,res)=>{
res.sendFile(path.join(__dirname,"public/index.html"))
})

app.post("/scrape",(req,res)=>{

const {keyword,limit} = req.body

const python = spawn("python3",[
"scripts/scraper.py",
keyword,
limit
])

let data=""

python.stdout.on("data",(chunk)=>{
data+=chunk.toString()
})

python.stderr.on("data",(err)=>{
console.error(err.toString())
})

python.on("close",()=>{
try{
res.json(JSON.parse(data))
}catch{
res.json({error:"Erreur serveur"})
}
})

})

app.listen(PORT,()=>{
console.log("Server running "+PORT)
})
