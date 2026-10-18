const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------------------------------------
// 1. CONFIGURATION & DATABASE CONNECTION
// ----------------------------------------------------
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/pinkhorse_db";
const JWT_SECRET = process.env.JWT_SECRET || "pinkhorse_super_secret_jwt_key_2026";

const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "chamikasanjan03@gmail.com").toLowerCase().trim();
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Chamika123@";

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected Successfully");
    initAdminUser();
  })
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ----------------------------------------------------
// 2. MONGOOSE SCHEMAS & MODELS
// ----------------------------------------------------

// Admin Schema
const AdminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }
}, { timestamps: true });

const Admin = mongoose.model('Admin', AdminSchema);

// Video / Gallery Item Schema
const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  image: { type: String, default: '' },
  link: { type: String, default: '' },
  country: { type: String, default: 'US' },
  isRemoved: { type: Boolean, default: false },
  embedUrl: { type: String, default: '' },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  description: { type: String, default: '' },
  duration: { type: String, default: '' }
}, { timestamps: true });

// To maintain seamless compatibility with frontend using item._id as $id
VideoSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.$id = ret._id.toString();
    ret.$createdAt = ret.createdAt;
    ret.$updatedAt = ret.updatedAt;
    return ret;
  }
});

const Video = mongoose.model('Video', VideoSchema);

// Broken Link / Content Reports Schema
const ReportSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  videoTitle: { type: String, default: '' },
  captchaToken: { type: String, default: '' },
  status: { type: String, default: 'pending' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

ReportSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.$id = ret._id.toString();
    ret.$createdAt = ret.createdAt;
    ret.$updatedAt = ret.updatedAt;
    return ret;
  }
});

const Report = mongoose.model('Report', ReportSchema);

// Initialize default admin user if not present
async function initAdminUser() {
  try {
    const existing = await Admin.findOne({ email: DEFAULT_ADMIN_EMAIL });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      await Admin.create({
        email: DEFAULT_ADMIN_EMAIL,
        password: hashedPassword
      });
      console.log(`👤 Default admin initialized: ${DEFAULT_ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error("Error creating default admin:", err.message);
  }
}

// ----------------------------------------------------
// 3. AUTH MIDDLEWARE
// ----------------------------------------------------
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ----------------------------------------------------
// 4. API ROUTES
// ----------------------------------------------------

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Pink Horse Video API' });
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const admin = await Admin.findOne({ email: cleanEmail });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      admin: {
        $id: admin._id.toString(),
        email: admin.email
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Get Current Logged-in Admin (Session verification)
app.get('/api/admin/me', authMiddleware, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId).select('-password');
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }
    res.json({
      $id: admin._id.toString(),
      email: admin.email
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ==================== VIDEOS / GALLERY ====================

// Public: Get all videos (sorted by latest)
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    res.json(videos);
  } catch (err) {
    console.error("Fetch videos error:", err);
    res.status(500).json({ error: 'Failed to fetch videos.' });
  }
});

// Public: Increment real view count when video is opened/played
app.post('/api/videos/:id/view', async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }
    res.json({ views: video.views, likes: video.likes || 0, dislikes: video.dislikes || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register view.' });
  }
});

// Public: React to video (like / dislike)
app.post('/api/videos/:id/react', async (req, res) => {
  try {
    const { action } = req.body; // 'like', 'unlike', 'dislike', 'undislike', 'like_from_dislike', 'dislike_from_like'
    let update = {};

    if (action === 'like') {
      update = { $inc: { likes: 1 } };
    } else if (action === 'unlike') {
      update = { $inc: { likes: -1 } };
    } else if (action === 'dislike') {
      update = { $inc: { dislikes: 1 } };
    } else if (action === 'undislike') {
      update = { $inc: { dislikes: -1 } };
    } else if (action === 'like_from_dislike') {
      update = { $inc: { likes: 1, dislikes: -1 } };
    } else if (action === 'dislike_from_like') {
      update = { $inc: { likes: -1, dislikes: 1 } };
    } else {
      return res.status(400).json({ error: 'Invalid reaction action.' });
    }

    const video = await Video.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found.' });
    }

    // Ensure non-negative numbers
    if (video.likes < 0) {
      video.likes = 0;
      await video.save();
    }
    if (video.dislikes < 0) {
      video.dislikes = 0;
      await video.save();
    }

    res.json({ likes: video.likes, dislikes: video.dislikes });
  } catch (err) {
    console.error("Reaction error:", err);
    res.status(500).json({ error: 'Failed to update reaction.' });
  }
});

// Admin: Create video
app.post('/api/videos', authMiddleware, async (req, res) => {
  try {
    const { title, image, link, country, isRemoved, embedUrl, description, duration } = req.body;
    const newVideo = await Video.create({
      title,
      image: image || '',
      link: link || '',
      country: country || 'US',
      isRemoved: Boolean(isRemoved),
      embedUrl: embedUrl || '',
      description: description || '',
      duration: duration || ''
    });
    res.status(201).json(newVideo);
  } catch (err) {
    console.error("Create video error:", err);
    res.status(500).json({ error: 'Failed to create video.' });
  }
});

// Admin: Update video
app.put('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    const { title, image, link, country, isRemoved, embedUrl, description, duration } = req.body;
    const updated = await Video.findByIdAndUpdate(
      req.params.id,
      {
        title,
        image,
        link,
        country,
        isRemoved: Boolean(isRemoved),
        embedUrl,
        description: description || '',
        duration: duration || ''
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Video not found.' });
    }
    res.json(updated);
  } catch (err) {
    console.error("Update video error:", err);
    res.status(500).json({ error: 'Failed to update video.' });
  }
});

// Admin: Delete video
app.delete('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await Video.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Video not found.' });
    }
    res.json({ success: true, message: 'Video deleted.' });
  } catch (err) {
    console.error("Delete video error:", err);
    res.status(500).json({ error: 'Failed to delete video.' });
  }
});

// ==================== REPORTS ====================

// Public: Submit report
app.post('/api/reports', async (req, res) => {
  try {
    const { videoId, videoTitle, captchaToken } = req.body;
    const report = await Report.create({
      videoId,
      videoTitle,
      captchaToken: captchaToken || '',
      status: 'pending'
    });
    res.status(201).json(report);
  } catch (err) {
    console.error("Submit report error:", err);
    res.status(500).json({ error: 'Failed to submit report.' });
  }
});

// Admin: Get all reports
app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    console.error("Get reports error:", err);
    res.status(500).json({ error: 'Failed to fetch reports.' });
  }
});

// Admin: Delete report
app.delete('/api/reports/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await Report.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Report not found.' });
    }
    res.json({ success: true, message: 'Report deleted.' });
  } catch (err) {
    console.error("Delete report error:", err);
    res.status(500).json({ error: 'Failed to delete report.' });
  }
});

// ----------------------------------------------------
// 5. START SERVER
// ----------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Pink Horse API running on http://localhost:${PORT}`);
});
