async function search(){

const keyword = document.getElementById("keyword").value
const limit = document.getElementById("limit").value
const resultsDiv = document.getElementById("results")

if(!keyword){

alert("Entrez un mot clé")
return

}

resultsDiv.innerHTML = "<p>Recherche en cours...</p>"

try{

const response = await fetch("/scrape",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({

keyword:keyword,
limit:limit

})

})

const data = await response.json()

resultsDiv.innerHTML = ""

if(!data || data.length === 0){

resultsDiv.innerHTML = "<p>Aucun produit similaire trouvé</p>"
return

}

data.forEach(item=>{

const card = document.createElement("div")
card.className="result-card"

card.innerHTML=`

<h3>${item.etsy_title}</h3>

<img src="${item.etsy_image}" />

<p>
<a href="${item.etsy_link}" target="_blank">
Voir l'annonce Etsy
</a>
</p>

<hr>

<h4>Fournisseur AliExpress</h4>

<img src="${item.ali_image}" />

<p>
<a href="${item.ali_link}" target="_blank">
Voir l'annonce AliExpress
</a>
</p>

<p>
Similarité : <strong>${item.similarity}%</strong>
</p>

`

resultsDiv.appendChild(card)

})

}catch(error){

console.error(error)

resultsDiv.innerHTML = "<p>Erreur serveur</p>"

}

}
