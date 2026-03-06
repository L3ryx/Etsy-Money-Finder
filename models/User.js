const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({

email:{
type:String,
required:true,
unique:true
},

password:{
type:String,
required:true
},

/* ================= STRIPE ================= */

stripeCustomerId:{
type:String
},

defaultPaymentMethod:{
type:String
},

/* ================= PAYMENT STATUS ================= */

paid:{
type:Boolean,
default:false
},

/* ================= OPTIONAL ================= */

tokens:{
type:Number,
default:0
},

createdAt:{
type:Date,
default:Date.now
}

});

module.exports = mongoose.model("User",UserSchema);
