const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------------------------------------
// 1. DATABASE CONNECTION
// ----------------------------------------------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/seren_db";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ----------------------------------------------------
// 2. MONGOOSE MODELS (USER, REFERRAL, MINING, WITHDRAW)
// ----------------------------------------------------

const MiningHistorySchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  date: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const TaskCompletedSchema = new mongoose.Schema({
  taskId: { type: String, required: true },
  completedAt: { type: Date, default: Date.now },
  rewardCoins: { type: Number, default: 0 }
});

const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, default: null },
  firstName: { type: String, default: null },
  lastName: { type: String, default: null },
  photoUrl: { type: String, default: null },
  isPremium: { type: Boolean, default: false },
  
  // Balances & Progress
  coins: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  totalEarned: { type: Number, default: 0 },

  // Referral System
  referredBy: { type: String, default: null, index: true }, // Who invited this user
  referralCode: { type: String, unique: true, index: true },
  totalReferralCoinsEarned: { type: Number, default: 0 },
  
  // Check-In Streak
  checkInStreak: { type: Number, default: 0 },
  lastCheckInDate: { type: String, default: null },
  
  // Mining Session State
  miningState: {
    isMining: { type: Boolean, default: false },
    sessionStartTime: { type: Number, default: null },
    lastUpdated: { type: Number, default: null }
  },
  
  miningHistory: [MiningHistorySchema],
  completedTasks: [TaskCompletedSchema],

  createdAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now }
});

const WithdrawSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  network: { type: String, required: true }, // 'BEP20' | 'TRC20'
  address: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: 'Pending' }, // 'Pending' | 'Completed' | 'Rejected'
  date: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Withdraw = mongoose.model('Withdraw', WithdrawSchema);

// ----------------------------------------------------
// 3. TELEGRAM DATA VALIDATION (OPTIONAL SECURE AUTH)
// ----------------------------------------------------
function verifyTelegramWebAppData(initData, botToken) {
  if (!botToken || !initData) return true; // bypass if botToken not configured yet
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    
    const dataCheckString = Array.from(urlParams.entries())
      .map(([key, val]) => `${key}=${val}`)
      .sort()
      .join('\n');
      
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return calculatedHash === hash;
  } catch (err) {
    return false;
  }
}

// ----------------------------------------------------
// 4. REST API ROUTES
// ----------------------------------------------------

/**
 * 1. User Sync & Registration with Referral Linking
 * POST /api/user/sync
 */
app.post('/api/user/sync', async (req, res) => {
  const { userId, username, firstName, lastName, photoUrl, isPremium, startParam } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

  try {
    let user = await User.findOne({ userId: userId.toString() });

    if (!user) {
      // New user registration
      let referredBy = null;
      
      // Parse referral param (e.g. "ref_123456" or "123456")
      if (startParam) {
        const potentialInviterId = startParam.replace('ref_', '').trim();
        if (potentialInviterId && potentialInviterId !== userId.toString()) {
          const inviter = await User.findOne({ userId: potentialInviterId });
          if (inviter) {
            referredBy = inviter.userId;
            // Welcome bonus for referrer (optional reward on sign up)
            await User.updateOne({ userId: inviter.userId }, { $inc: { coins: 50, totalReferralCoinsEarned: 50 } });
          }
        }
      }

      user = new User({
        userId: userId.toString(),
        username: username || null,
        firstName: firstName || null,
        lastName: lastName || null,
        photoUrl: photoUrl || null,
        isPremium: !!isPremium,
        referralCode: userId.toString(),
        referredBy: referredBy,
        coins: 100, // Welcome Bonus
        miningState: { isMining: false, sessionStartTime: null, lastUpdated: Date.now() }
      });

      await user.save();
    } else {
      // Update basic Telegram profile changes
      user.username = username || user.username;
      user.firstName = firstName || user.firstName;
      user.photoUrl = photoUrl || user.photoUrl;
      user.isPremium = !!isPremium;
      user.lastActiveAt = new Date();
      await user.save();
    }

    // Fetch referral list & statistics
    const frensCount = await User.countDocuments({ referredBy: user.userId });
    
    return res.json({
      success: true,
      user,
      frensCount
    });
  } catch (err) {
    console.error("Sync Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. Get User Full Profile & Referral List
 * GET /api/user/:userId
 */
app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const frens = await User.find({ referredBy: user.userId })
      .select('userId username firstName photoUrl coins createdAt')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      user,
      frensCount: frens.length,
      frens
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3. Save / Update Mining State
 * POST /api/mining/start
 */
app.post('/api/mining/start', async (req, res) => {
  const { userId } = req.body;
  const now = Date.now();
  try {
    const user = await User.findOneAndUpdate(
      { userId: userId.toString() },
      { 
        $set: { 
          'miningState.isMining': true, 
          'miningState.sessionStartTime': now,
          'miningState.lastUpdated': now
        }
      },
      { new: true }
    );
    res.json({ success: true, miningState: user.miningState });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 4. Claim Mining Reward (with 10% Referrer Bonus distribution)
 * POST /api/mining/claim
 */
app.post('/api/mining/claim', async (req, res) => {
  const { userId, amount, date } = req.body;
  const claimAmount = parseFloat(amount) || 0;

  if (claimAmount <= 0) return res.status(400).json({ success: false, message: "Invalid amount" });

  try {
    const user = await User.findOne({ userId: userId.toString() });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Update user's coins and add to history
    user.coins += claimAmount;
    user.totalEarned += claimAmount;
    user.miningState = { isMining: false, sessionStartTime: null, lastUpdated: Date.now() };
    user.miningHistory.unshift({
      amount: claimAmount,
      date: date || new Date().toLocaleString()
    });
    if (user.miningHistory.length > 30) user.miningHistory = user.miningHistory.slice(0, 30);

    await user.save();

    // 10% Referrer Bonus Distribution
    if (user.referredBy) {
      const bonus10 = parseFloat((claimAmount * 0.10).toFixed(2));
      if (bonus10 > 0) {
        await User.updateOne(
          { userId: user.referredBy },
          { 
            $inc: { 
              coins: bonus10, 
              totalReferralCoinsEarned: bonus10 
            } 
          }
        );
      }
    }

    res.json({
      success: true,
      coins: user.coins,
      miningState: user.miningState,
      miningHistory: user.miningHistory
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. Daily Check-In
 * POST /api/tasks/checkin
 */
app.post('/api/tasks/checkin', async (req, res) => {
  const { userId, rewardCoins, dayNumber, dateStr } = req.body;
  try {
    const user = await User.findOne({ userId: userId.toString() });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (user.lastCheckInDate === dateStr) {
      return res.status(400).json({ success: false, message: "Already checked in today!" });
    }

    user.coins += rewardCoins;
    user.totalEarned += rewardCoins;
    user.lastCheckInDate = dateStr;
    user.checkInStreak = dayNumber;

    await user.save();
    res.json({ success: true, coins: user.coins, checkInStreak: user.checkInStreak });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 6. Submit Withdrawal Request (with 5% Inviter bonus)
 * POST /api/withdraw
 */
app.post('/api/withdraw', async (req, res) => {
  const { userId, network, address, amount, date } = req.body;
  const withdrawAmount = parseInt(amount, 10);

  try {
    const user = await User.findOne({ userId: userId.toString() });
    if (!user || user.coins < withdrawAmount) {
      return res.status(400).json({ success: false, message: "Insufficient coins!" });
    }

    user.coins -= withdrawAmount;
    await user.save();

    const record = new Withdraw({
      userId: user.userId,
      network,
      address,
      amount: withdrawAmount,
      date: date || new Date().toLocaleString()
    });
    await record.save();

    // 5% Inviter Withdrawal Bonus
    if (user.referredBy) {
      const bonus5 = parseFloat((withdrawAmount * 0.05).toFixed(2));
      if (bonus5 > 0) {
        await User.updateOne(
          { userId: user.referredBy },
          { $inc: { coins: bonus5, totalReferralCoinsEarned: bonus5 } }
        );
      }
    }

    res.json({ success: true, coins: user.coins, withdrawRecord: record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 7. ADMIN API ROUTES (Secret Key Protected)
// ----------------------------------------------------

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'seren_admin_2026';

// Middleware: Admin Secret Key check
function adminAuth(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

/**
 * Admin: Overall Stats Summary
 * GET /api/admin/stats?key=xxx
 */
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalCoinsResult = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$coins' }, totalEarned: { $sum: '$totalEarned' } } }
    ]);
    const totalWithdrawals = await Withdraw.countDocuments();
    const pendingWithdrawals = await Withdraw.countDocuments({ status: 'Pending' });
    const withdrawAmountResult = await Withdraw.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalReferrals = await User.countDocuments({ referredBy: { $ne: null } });
    const premiumUsers = await User.countDocuments({ isPremium: true });

    // New users in last 24h
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const newUsers24h = await User.countDocuments({ createdAt: { $gte: since24h } });

    // Real Growth: Last 7 days user registration breakdown
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const growthAgg = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Build continuous 7-day timeline
    const userGrowth7d = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      const found = growthAgg.find(g => g._id === dateKey);
      userGrowth7d.push({
        date: dateKey,
        day: dayName,
        users: found ? found.count : 0
      });
    }

    res.json({
      success: true,
      stats: {
        totalUsers,
        newUsers24h,
        premiumUsers,
        totalCoins: totalCoinsResult[0]?.total || 0,
        totalCoinsEarned: totalCoinsResult[0]?.totalEarned || 0,
        totalWithdrawals,
        pendingWithdrawals,
        totalWithdrawAmount: withdrawAmountResult[0]?.total || 0,
        totalReferrals,
        userGrowth7d
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin: All Users List (paginated)
 * GET /api/admin/users?key=xxx&page=1&limit=50&search=username
 */
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const query = search
      ? {
          $or: [
            { userId: { $regex: search, $options: 'i' } },
            { username: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } }
          ]
        }
      : {};

    const [users, total] = await Promise.all([
      User.find(query)
        .select('userId username firstName lastName photoUrl coins totalEarned isPremium referredBy referralCode totalReferralCoinsEarned checkInStreak createdAt lastActiveAt miningState')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query)
    ]);

    // Attach referral counts
    const usersWithRefs = await Promise.all(users.map(async (u) => {
      const refCount = await User.countDocuments({ referredBy: u.userId });
      return { ...u.toObject(), refCount };
    }));

    res.json({
      success: true,
      users: usersWithRefs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin: All Withdrawals List
 * GET /api/admin/withdrawals?key=xxx&status=Pending
 * PATCH /api/admin/withdrawals/:id?key=xxx  - Update status
 */
app.get('/api/admin/withdrawals', adminAuth, async (req, res) => {
  try {
    const statusFilter = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const query = statusFilter ? { status: statusFilter } : {};
    const [withdrawals, total] = await Promise.all([
      Withdraw.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit),
      Withdraw.countDocuments(query)
    ]);

    // Attach user info
    const withUsers = await Promise.all(withdrawals.map(async (w) => {
      const user = await User.findOne({ userId: w.userId }).select('username firstName');
      return { ...w.toObject(), userInfo: user };
    }));

    res.json({
      success: true,
      withdrawals: withUsers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin: Update Withdrawal Status (Approve / Reject)
 * PATCH /api/admin/withdrawals/:id?key=xxx
 */
app.patch('/api/admin/withdrawals/:id', adminAuth, async (req, res) => {
  try {
    const { status } = req.body; // 'Completed' | 'Rejected'
    const updated = await Withdraw.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, withdrawal: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin: Get single user detail + full mining history
 * GET /api/admin/users/:userId?key=xxx
 */
app.get('/api/admin/users/:userId', adminAuth, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const refCount = await User.countDocuments({ referredBy: user.userId });
    const frens = await User.find({ referredBy: user.userId })
      .select('userId username firstName lastName photoUrl coins createdAt')
      .sort({ createdAt: -1 });
    const withdrawals = await Withdraw.find({ userId: user.userId }).sort({ timestamp: -1 });
    res.json({ success: true, user, refCount, frens, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 8. SERVER LAUNCH
// ----------------------------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Seren Backend Server running on port ${PORT}`));
