async function search(){

const keyword=document.getElementById("keyword").value
const limit=document.getElementById("limit").value

const res=await fetch("/scrape",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({keyword,limit})
})

const data=await res.json()

const results=document.getElementById("results")
results.innerHTML=""

data.forEach(item=>{

const card=document.createElement("div")
card.className="card"

card.innerHTML=`

<img src="${item.etsy.image}">

<h3>${item.etsy.title}</h3>

<a href="${item.etsy.link}" target="_blank">Etsy</a>

`

results.appendChild(card)

})

}
