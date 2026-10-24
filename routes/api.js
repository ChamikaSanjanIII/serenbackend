const express = require('express');
const router = express.Router();
const Video = require('../models/Video');
const { syncFromClipGo } = require('../controllers/clipgoSyncController');

/**
 * GET /api/videos
 * Query params: page, limit, category, search, sort
 */
router.get('/videos', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const category = req.query.category;
    const search = req.query.search;
    const featured = req.query.featured;
    const sort = req.query.sort || 'newest';

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
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    let sortOptions = { createdAt: -1 };
    if (sort === 'popular') sortOptions = { views: -1 };
    if (sort === 'downloads') sortOptions = { downloads: -1 };
    if (sort === 'likes') sortOptions = { likes: -1 };

    const skip = (page - 1) * limit;

    const [videos, total] = await Promise.all([
      Video.find(filter).sort(sortOptions).skip(skip).limit(limit).lean(),
      Video.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: videos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + videos.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/videos/:id
 * Fetch single video by videoId or slug, increments views
 */
router.get('/videos/:id', async (req, res) => {
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

    // Get 6 related videos in same category
    const related = await Video.find({
      category: video.category,
      _id: { $ne: video._id },
      isActive: true,
    })
      .limit(6)
      .lean();

    return res.json({
      success: true,
      data: video,
      related,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/videos/:id/like
 */
router.post('/videos/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Video.findOneAndUpdate(
      { $or: [{ videoId: id }, { slug: id }] },
      { $inc: { likes: 1 } },
      { new: true }
    );
    return res.json({ success: true, likes: updated ? updated.likes : 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/videos/:id/download
 */
router.post('/videos/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Video.findOneAndUpdate(
      { $or: [{ videoId: id }, { slug: id }] },
      { $inc: { downloads: 1 } },
      { new: true }
    );
    return res.json({ success: true, downloads: updated ? updated.downloads : 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sync
 * Trigger sync process manually from admin dashboard or curl
 */
router.post('/sync', syncFromClipGo);

/**
 * GET /api/sitemap-data
 * Raw metadata for dynamic XML sitemap generators
 */
router.get('/sitemap-data', async (req, res) => {
  try {
    const videos = await Video.find({ isActive: true })
      .select('slug videoId title updatedAt createdAt category')
      .sort({ updatedAt: -1 })
      .limit(5000)
      .lean();

    return res.json({
      success: true,
      data: videos,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Admin CRUD endpoints
 */
router.patch('/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Video.findByIdAndUpdate(id, req.body, { new: true });
    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Video.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/admin/stats', async (req, res) => {
  try {
    const totalVideos = await Video.countDocuments();
    const activeVideos = await Video.countDocuments({ isActive: true });
    const featuredVideos = await Video.countDocuments({ isFeatured: true });
    const totalViews = await Video.aggregate([{ $group: { _id: null, sum: { $sum: '$views' } } }]);
    const totalDownloads = await Video.aggregate([{ $group: { _id: null, sum: { $sum: '$downloads' } } }]);

    const categoriesAgg = await Video.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return res.json({
      success: true,
      data: {
        totalVideos,
        activeVideos,
        featuredVideos,
        totalViews: totalViews[0]?.sum || 0,
        totalDownloads: totalDownloads[0]?.sum || 0,
        categories: categoriesAgg.map(c => ({ name: c._id, count: c.count })),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
