const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({

email:{
type:String,
required:true,
unique:true
},

password:{
type:String,
required:true
},

tokens:{
type:Number,
default:0
},

stripeCustomerId:{
type:String
},

defaultPaymentMethod:{
type:String
},

/* 🔥 ANTI FRAUDE */

lastSearch:{
type:Number,
default:0
}

},{timestamps:true});

module.exports = mongoose.model("User",userSchema);
