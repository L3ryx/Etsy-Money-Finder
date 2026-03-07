import mongoose from "mongoose";

const ComparisonCacheSchema = new mongoose.Schema({
  imageA: { type: String, required: true },
  imageB: { type: String, required: true },
  similarity: { type: Number, required: true },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 7 // auto delete after 7 days
  }
});

const ComparisonCache = mongoose.model(
  "ComparisonCache",
  ComparisonCacheSchema
);

export default ComparisonCache;
