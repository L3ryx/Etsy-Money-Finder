import mongoose from "mongoose";

/*
  ComparisonCache
  ----------------
  Cache les comparaisons d’images pour éviter :
  - Appels OpenAI inutiles
  - Recalcul des hashes
  - Coûts API élevés

  Structure :
  imageA → Image Etsy
  imageB → Image AliExpress
  similarity → Score 0-100
  createdAt → Timestamp automatique
*/

const ComparisonSchema = new mongoose.Schema(
  {
    imageA: {
      type: String,
      required: true
    },
    imageB: {
      type: String,
      required: true
    },
    similarity: {
      type: Number,
      required: true
    }
  },
  {
    timestamps: true
  }
);

/*
  Index important 🚀
  ------------------
  Permet de retrouver rapidement un match identique
  et évite les doublons en base.
*/

ComparisonSchema.index({ imageA: 1, imageB: 1 }, { unique: true });

export default mongoose.model("ComparisonCache", ComparisonSchema);
