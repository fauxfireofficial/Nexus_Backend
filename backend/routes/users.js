import express from 'express';
import User from '../models/User.js';
import CollaborationRequest from '../models/CollaborationRequest.js';
import Message from '../models/Message.js';
import SupportArchive from '../models/SupportArchive.js';
import { auth } from '../middleware/auth.js';
import { createNotification } from './notifications.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Ensure upload directory exists
const UPLOAD_DIR = './uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure Multer storage for avatars
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});


// @route   GET /api/users/investors
// @desc    Get all investors
router.get('/investors', auth, async (req, res) => {
  try {
    const investors = await User.find({ role: 'investor' });
    res.json(investors);
  } catch (error) {
    console.error('Get investors error:', error);
    res.status(500).json({ message: 'Server error retrieving investors' });
  }
});

// @route   GET /api/users/entrepreneurs
// @desc    Get all entrepreneurs/startups
router.get('/entrepreneurs', auth, async (req, res) => {
  try {
    const entrepreneurs = await User.find({ role: 'entrepreneur' });
    res.json(entrepreneurs);
  } catch (error) {
    console.error('Get entrepreneurs error:', error);
    res.status(500).json({ message: 'Server error retrieving entrepreneurs' });
  }
});

// @route   GET /api/users/profile/:id
// @desc    Get profile by user id
router.get('/profile/:id', auth, async (req, res) => {
  try {
    const profile = await User.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error retrieving profile' });
  }
});

// @route   POST /api/users/avatar
// @desc    Upload avatar file
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const avatarUrl = `/uploads/${req.file.filename}`;
    
    // Update the database field directly
    await User.findByIdAndUpdate(req.user._id, { $set: { avatarUrl } });
    
    res.json({ avatarUrl });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ message: error.message || 'Server error uploading avatar file' });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const updates = req.body;
    // Don't allow changing email, password or role directly via profile edit
    delete updates.email;
    delete updates.password;
    delete updates.role;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    res.json(user);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(400).json({ message: error.message || 'Server error updating profile' });
  }
});

// @route   POST /api/users/connect
// @desc    Send a connection request
router.post('/connect', auth, async (req, res) => {
  const { recipientId, message } = req.body;
  try {
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    // Check if investor or entrepreneur role matches
    let investorId, entrepreneurId;
    if (req.user.role === 'investor') {
      investorId = req.user.id;
      entrepreneurId = recipientId;
    } else {
      investorId = recipientId;
      entrepreneurId = req.user.id;
    }

    // Check if connection request already exists
    const existing = await CollaborationRequest.findOne({ investorId, entrepreneurId });
    if (existing) {
      return res.status(400).json({ message: 'Connection request already exists' });
    }

    const connection = new CollaborationRequest({
      investorId,
      entrepreneurId,
      message,
      status: 'pending'
    });

    await connection.save();

    // ── Real-time notification to recipient ──────────────────────────────────
    const io = req.app.get('io');
    const senderName = req.user.name || 'Someone';
    await createNotification(io, {
      recipientId: recipientId,
      senderId:    req.user.id,
      type:        'connection_request',
      content:     `${senderName} sent you a connection request`,
      link:        `/profile/${req.user.role}/${req.user.id}`
    });
    // ────────────────────────────────────────────────────────────────────────

    res.status(201).json(connection);
  } catch (error) {
    console.error('Connect error:', error);
    res.status(500).json({ message: 'Server error sending connection request' });
  }
});

// @route   GET /api/users/connect/requests
// @desc    Get all connection requests for current user
router.get('/connect/requests', auth, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'investor') {
      query = { investorId: req.user.id };
    } else {
      query = { entrepreneurId: req.user.id };
    }

    const requests = await CollaborationRequest.find(query)
      .populate('investorId', 'name email avatarUrl startupName')
      .populate('entrepreneurId', 'name email avatarUrl startupName pitchSummary')
      .sort({ createdAt: -1 });

    // Transform requests to map fields to what frontend expects
    const transformed = requests.map(reqDoc => {
      const isInvestor = req.user.role === 'investor';
      const sender = isInvestor ? reqDoc.entrepreneurId : reqDoc.investorId;
      return {
        id: reqDoc._id.toString(),
        investorId: reqDoc.investorId?._id?.toString() || reqDoc.investorId?.id,
        entrepreneurId: reqDoc.entrepreneurId?._id?.toString() || reqDoc.entrepreneurId?.id,
        message: reqDoc.message,
        status: reqDoc.status,
        createdAt: reqDoc.createdAt,
        // Helper metadata for display
        senderName: sender?.name,
        senderAvatar: sender?.avatarUrl,
        senderRole: sender?.role,
        senderDetails: sender?.startupName || sender?.pitchSummary || ''
      };
    });

    res.json(transformed);
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ message: 'Server error retrieving requests' });
  }
});

// @route   PUT /api/users/connect/requests/:id
// @desc    Accept/reject connection request
router.put('/connect/requests/:id', auth, async (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status update' });
  }

  try {
    const request = await CollaborationRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Connection request not found' });
    }

    // Verify authorized to update (recipient should update)
    if (req.user.role === 'investor' && request.investorId.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    if (req.user.role === 'entrepreneur' && request.entrepreneurId.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    request.status = status;
    await request.save();

    // ── Real-time notification on acceptance ─────────────────────────────────
    if (status === 'accepted') {
      const io = req.app.get('io');
      const acceptorName = req.user.name || 'Someone';
      // Notify the one who SENT the request (the other party)
      const notifyUserId =
        req.user.role === 'investor'
          ? request.entrepreneurId.toString()
          : request.investorId.toString();

      await createNotification(io, {
        recipientId: notifyUserId,
        senderId:    req.user.id,
        type:        'connection_accepted',
        content:     `${acceptorName} accepted your connection request`,
        link:        `/profile/${req.user.role}/${req.user.id}`
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    res.json(request);
  } catch (error) {
    console.error('Update request error:', error);
    res.status(500).json({ message: 'Server error updating request' });
  }
});

// @route   GET /api/users/admin-id
// @desc    Get the primary admin ID for support chat
router.get('/admin-id', async (req, res) => {
  try {
    const admin = await User.findOne({ email: 'nexus@admin.com' });
    if (!admin) {
      return res.status(404).json({ message: 'Support Admin not found' });
    }
    res.json({ adminId: admin._id });
  } catch (error) {
    console.error('Get admin ID error:', error);
    res.status(500).json({ message: 'Server error retrieving admin id' });
  }
});

// @route   POST /api/users/support/start
// @desc    Start a support session for the current user
router.post('/support/start', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { supportSessionActive: true } },
      { new: true }
    );
    res.json({ message: 'Support session started', supportSessionActive: user.supportSessionActive });
  } catch (error) {
    console.error('Start support session error:', error);
    res.status(500).json({ message: 'Server error starting support session' });
  }
});

// @route   POST /api/users/support/end
// @desc    End a support session for a user, archive chat, and mark closed
router.post('/support/end', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can end a support session' });
    }
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    
    // 1. Mark user's session as inactive
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { supportSessionActive: false } },
      { new: true }
    );

    // 2. Fetch all messages between admin and user
    const messages = await Message.find({
      $or: [
        { senderId: req.user._id, receiverId: userId },
        { senderId: userId, receiverId: req.user._id }
      ]
    }).sort({ createdAt: 1 });

    if (messages.length > 0) {
      // 3. Create SupportArchive
      const archiveData = {
        userId: userId,
        adminId: req.user._id,
        messages: messages.map(m => ({
          senderId: m.senderId,
          receiverId: m.receiverId,
          content: m.content,
          isEdited: m.isEdited,
          timestamp: m.createdAt
        })),
        status: 'closed',
        closedAt: new Date()
      };
      const archive = new SupportArchive(archiveData);
      await archive.save();

      // 4. Delete messages from active queue
      await Message.deleteMany({
        _id: { $in: messages.map(m => m._id) }
      });
    }

    res.json({ message: 'Support session ended and archived', supportSessionActive: user?.supportSessionActive });
  } catch (error) {
    console.error('End support session error:', error);
    res.status(500).json({ message: 'Server error ending support session' });
  }
});

// @route   GET /api/users/support/archives/:userId
// @desc    Get past support archives for a user
router.get('/support/archives/:userId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can view support archives' });
    }
    const archives = await SupportArchive.find({ userId: req.params.userId })
      .populate('adminId', 'name email avatarUrl')
      .sort({ closedAt: -1 });
    
    res.json(archives);
  } catch (error) {
    console.error('Get support archives error:', error);
    res.status(500).json({ message: 'Server error retrieving support archives' });
  }
});

export default router;
