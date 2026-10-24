const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// ----------------------------------------------------
// 1. MIDDLEWARES & CONFIGURATION
// ----------------------------------------------------
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/oxenora_db";
const JWT_SECRET = process.env.JWT_SECRET || "oxenora_super_secret_jwt_key_2026";

const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "chamikasanjan03@gmail.com").toLowerCase().trim();
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Chamika123@";

// ----------------------------------------------------
// 2. DATABASE CONNECTION & AUTO ADMIN SEED
// ----------------------------------------------------
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("=========================================");
    console.log("✅ MongoDB Connected: " + MONGO_URI);
    console.log("=========================================");
    initAdminUser();
  })
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ----------------------------------------------------
// 3. MONGOOSE SCHEMAS & MODELS
// ----------------------------------------------------

// Admin User Schema
const AdminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
}, { timestamps: true });

const Admin = mongoose.model('Admin', AdminSchema);

// Episode Schema for Short Drama Series
const EpisodeSchema = new mongoose.Schema({
  episodeNumber: { type: Number, required: true },
  title: { type: String, default: '' },
  videoUrl: { type: String, required: true },
  duration: { type: String, default: '1:00' }
}, { _id: true });

// Video / Drama Schema for Oxenora Platform
const VideoSchema = new mongoose.Schema({
  videoId: { type: String, required: true, unique: true, index: true },
  slug: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  videoUrl: { type: String, required: true },
  thumbnailUrl: { type: String, required: true },
  category: { type: String, default: 'Urban', index: true },
  prompt: { type: String, default: '' },
  tags: [{ type: String }],
  modelUsed: { type: String, default: 'Sora / Kling AI' },
  duration: { type: String, default: '0:30' },
  episodes: [EpisodeSchema],
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  downloads: { type: Number, default: 0 },
  isFeatured: { type: Boolean, default: false, index: true },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

// Virtuals to ensure compatibility
VideoSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.$id = ret._id.toString();
    ret.id = ret._id.toString();
    return ret;
  }
});

const Video = mongoose.model('Video', VideoSchema);

// Auto-seed admin user if not exists
async function initAdminUser() {
  try {
    const existing = await Admin.findOne({ email: DEFAULT_ADMIN_EMAIL });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      await Admin.create({
        email: DEFAULT_ADMIN_EMAIL,
        password: hashedPassword
      });
      console.log(`👤 Initialized Default Admin Account: ${DEFAULT_ADMIN_EMAIL}`);
    } else {
      console.log(`👤 Admin user ready: ${DEFAULT_ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error("Error creating default admin:", err.message);
  }
}

// ----------------------------------------------------
// 4. AUTHENTICATION MIDDLEWARE
// ----------------------------------------------------
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: "Authorization token missing." });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid or expired session token." });
    }
    req.admin = decoded;
    next();
  });
};

// ----------------------------------------------------
// 5. API ROUTES
// ----------------------------------------------------

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'oxenora-unified-api', timestamp: new Date().toISOString() });
});

// Admin Login Route
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const cleanEmail = email.toLowerCase().trim();
    const admin = await Admin.findOne({ email: cleanEmail });

    if (!admin) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: "Login successful",
      token,
      admin: { id: admin._id, email: admin.email }
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// Admin Verify Token Session
app.get('/api/admin/me', authenticateAdmin, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// Public GET /api/videos (Supports category filter, search, pagination)
app.get('/api/videos', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const category = req.query.category;
    const search = req.query.search;
    const featured = req.query.featured;

    const filter = { isActive: true };

    if (category && category !== 'All') {
      filter.category = new RegExp(`^${category}$`, 'i');
    }

    if (featured === 'true') {
      filter.isFeatured = true;
    }

    if (search && search.trim() !== '') {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { prompt: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [videos, total] = await Promise.all([
      Video.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Video.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: videos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Public GET Single Video by ID or Slug (Increments view counter)
app.get('/api/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const video = await Video.findOneAndUpdate(
      { $or: [{ videoId: id }, { slug: id }, { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }] },
      { $inc: { views: 1 } },
      { new: true }
    ).lean();

    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    // Get 6 related videos
    const related = await Video.find({
      category: video.category,
      _id: { $ne: video._id },
      isActive: true
    }).limit(6).lean();

    return res.json({ success: true, data: video, related });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin CREATE New Video / Drama
app.post('/api/admin/videos', async (req, res) => {
  try {
    const { title, videoUrl, thumbnailUrl, category, prompt, tags, modelUsed, isFeatured, episodes } = req.body;

    if (!title || !videoUrl || !thumbnailUrl) {
      return res.status(400).json({ success: false, message: 'Title, Video URL, and Thumbnail URL are required.' });
    }

    const videoId = 'ox_' + Math.random().toString(36).substring(2, 9);
    const slugBase = title.toString().toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
    const slug = `${slugBase}-${videoId}`;

    const tagsArray = Array.isArray(tags)
      ? tags
      : (tags ? String(tags).split(',').map(t => t.trim().toLowerCase()) : ['ai', 'shortvideo']);

    // Format episodes if provided
    let episodesList = [];
    if (Array.isArray(episodes) && episodes.length > 0) {
      episodesList = episodes.map((ep, idx) => ({
        episodeNumber: ep.episodeNumber || idx + 1,
        title: ep.title || `Episode ${idx + 1}`,
        videoUrl: ep.videoUrl || videoUrl,
        duration: ep.duration || '1:00'
      }));
    } else {
      // Default Episode 1 using primary videoUrl
      episodesList = [{
        episodeNumber: 1,
        title: 'Episode 1',
        videoUrl: videoUrl,
        duration: '1:00'
      }];
    }

    const newVideo = await Video.create({
      videoId,
      slug,
      title,
      description: prompt || title,
      videoUrl,
      thumbnailUrl,
      category: category || 'Urban',
      prompt: prompt || '',
      tags: tagsArray,
      modelUsed: modelUsed || 'Kling 1.5 HD',
      episodes: episodesList,
      isFeatured: Boolean(isFeatured),
      isActive: true,
      views: 1,
      downloads: 0,
      likes: 1,
    });

    return res.status(201).json({ success: true, message: 'Drama published with episodes successfully!', data: newVideo });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin ADD or UPDATE an Episode to existing Drama
app.post('/api/admin/videos/:id/episodes', async (req, res) => {
  try {
    const { id } = req.params;
    const { episodeNumber, title, videoUrl, duration } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ success: false, message: 'Episode Video URL is required.' });
    }

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Drama not found.' });
    }

    const nextEpNum = episodeNumber || (video.episodes.length + 1);
    video.episodes.push({
      episodeNumber: nextEpNum,
      title: title || `Episode ${nextEpNum}`,
      videoUrl,
      duration: duration || '1:00'
    });

    await video.save();
    return res.json({ success: true, message: `Episode ${nextEpNum} added successfully!`, data: video });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin UPDATE Drama
app.patch('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Video.findByIdAndUpdate(id, req.body, { new: true });
    return res.json({ success: true, data: updated, message: 'Updated successfully!' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin DELETE Video
app.delete('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Video.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Dashboard Overview Stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalVideos = await Video.countDocuments({ isActive: true });
    const featuredVideos = await Video.countDocuments({ isFeatured: true });
    const totalViews = await Video.aggregate([{ $group: { _id: null, sum: { $sum: '$views' } } }]);
    const totalDownloads = await Video.aggregate([{ $group: { _id: null, sum: { $sum: '$downloads' } } }]);

    const categoriesAgg = await Video.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    return res.json({
      success: true,
      data: {
        totalVideos,
        featuredVideos,
        totalViews: totalViews[0]?.sum || 0,
        totalDownloads: totalDownloads[0]?.sum || 0,
        categories: categoriesAgg.map(c => ({ name: c._id, count: c.count }))
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Sync endpoint (Reserved for future external feed syncs)
app.post('/api/sync', async (req, res) => {
  return res.json({ success: true, message: 'Sync complete. Ready for new video uploads.' });
});

// Global 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint Not Found' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Oxenora Unified Backend Server running on port ${PORT}`);
  console.log(`🌐 Ready for Next.js Site & React Dashboard`);
});
