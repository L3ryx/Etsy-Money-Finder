import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({

  email: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  credits: {
    type: Number,
    default: 5
  },

  role: {
    type: String,
    default: "user"
  },

  paid: {
    type: Boolean,
    default: false
  },

  stripeCustomerId: {
    type: String
  },

  searchHistory: [
    {
      query: String,
      date: {
        type: Date,
        default: Date.now
      }
    }
  ],

  purchaseHistory: [
    {
      productId: String,
      date: {
        type: Date,
        default: Date.now
      },
      amount: Number
    }
  ]

}, {
  timestamps: true
});

const User = mongoose.model("User", UserSchema);

export default User;
