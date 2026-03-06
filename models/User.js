const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({

/* ================= AUTH ================= */

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

/* ================= ACCESS ================= */

/* 🔥 Activé uniquement par ADMIN */
freeUnlimited:{
type:Boolean,
default:false
},

paid:{
type:Boolean,
default:false
},

/* ================= CREDITS ================= */

credits:{
type:Number,
default:0
},

/* ================= ROLES ================= */

role:{
type:String,
enum:["user","admin"],
default:"user"
},

createdAt:{
type:Date,
default:Date.now
}

});

module.exports = mongoose.model("User",UserSchema);
