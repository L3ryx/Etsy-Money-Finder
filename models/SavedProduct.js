const mongoose = require("mongoose");

const savedProductSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  image: String,
  link: String
}, { timestamps: true });

module.exports = mongoose.model("SavedProduct", savedProductSchema);
