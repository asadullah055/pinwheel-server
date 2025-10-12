import mongoose from 'mongoose';

export const MetaDataSchema = new mongoose.Schema(
  {
     // SEO
    seoTitle: { type: String, required: true },
    seoContent: { type: String, required: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);