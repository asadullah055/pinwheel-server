import mongoose from 'mongoose';

export const MetaDataSchema = new mongoose.Schema(
  {
    metaTitle: {
      type: String,
    },
    metaDescription: {
      type: String,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);