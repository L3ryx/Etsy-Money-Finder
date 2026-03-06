const mongoose = require("mongoose");

const ComparisonSchema = new mongoose.Schema({

imageA:{
type:String,
index:true
},

imageB:{
type:String,
index:true
},

similarity:Number,

createdAt:{
type:Date,
default:Date.now,
expires:60 * 60 * 24 * 7 // 🔥 expire après 7 jours
}

});

module.exports = mongoose.model("ComparisonCache", ComparisonSchema);
