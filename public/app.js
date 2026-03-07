async function search(){

console.log("click detected")

const keyword = document.getElementById("keyword").value
const limit = document.getElementById("limit").value

try{

const res = await fetch("/scrape",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
keyword,
limit
})

})

const data = await res.json()

console.log(data)

const results = document.getElementById("results")

results.innerHTML = JSON.stringify(data)

}catch(e){

console.error(e)

}

}
