const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema(
  {
    videoId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    videoUrl: {
      type: String,
      required: true,
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      required: true,
      trim: true,
    },
    prompt: {
      type: String,
      default: '',
      trim: true,
    },
    negativePrompt: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      default: 'General',
      index: true,
      trim: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    duration: {
      type: Number,
      default: 0,
    },
    aspectRatio: {
      type: String,
      default: '9:16',
    },
    modelUsed: {
      type: String,
      default: 'Sora / Kling / Runway Gen-3',
      trim: true,
    },
    views: {
      type: Number,
      default: 0,
    },
    downloads: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    source: {
      type: String,
      default: 'clipgo.xyz',
    },
    syncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

VideoSchema.index({ title: 'text', description: 'text', prompt: 'text', tags: 'text' });

module.exports = mongoose.model('Video', VideoSchema);
