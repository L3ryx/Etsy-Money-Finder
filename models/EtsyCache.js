const mongoose = require("mongoose");

const EtsyCacheSchema = new mongoose.Schema({

keyword:{
type:String,
index:true
},

etsyImage:{
type:String,
required:true
},

etsyLink:{
type:String,
required:true
},

aliexpressMatches:[
{
image:String,
link:String,
similarity:Number
}
],

createdAt:{
type:Date,
default:Date.now,
expires:60 * 60 * 24 // 🔥 expire automatique après 24h
}

});

module.exports = mongoose.model("EtsyCache", EtsyCacheSchema);
