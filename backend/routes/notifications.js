import express from 'express';
import Notification from '../models/Notification.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// ─── Utility (called internally by other routes) ─────────────────────────────
/**
 * Creates a notification in DB and emits a real-time socket event to recipient.
 * @param {object} io          - Socket.IO server instance
 * @param {object} data        - { recipientId, senderId, type, content, link? }
 */
export async function createNotification(io, { recipientId, senderId, type, content, link = '' }) {
  try {
    const notification = await Notification.create({
      recipientId,
      senderId,
      type,
      content,
      link,
      isRead: false
    });

    // Populate sender info for the socket payload
    const populated = await Notification.findById(notification._id)
      .populate('senderId', 'name avatarUrl');

    // Emit to the recipient's personal socket room
    if (io) {
      io.to(recipientId.toString()).emit('new-notification', populated.toJSON());
    }

    return populated;
  } catch (err) {
    console.error('createNotification error:', err);
  }
}

// ─── REST Routes ──────────────────────────────────────────────────────────────

// @route   GET /api/notifications
// @desc    Get all notifications for current user (newest first)
router.get('/', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipientId: req.user.id })
      .populate('senderId', 'name avatarUrl')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Server error retrieving notifications' });
  }
});

// @route   GET /api/notifications/unread-count
// @desc    Get count of unread notifications
router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipientId: req.user.id,
      isRead: false
    });
    res.json({ count });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/notifications/:id/read
// @desc    Mark a single notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: req.user.id },
      { isRead: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json(notification);
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/notifications/mark-all-read
// @desc    Mark all notifications as read for current user
router.put('/mark-all-read', auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipientId: req.user.id, isRead: false },
      { isRead: true }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete a single notification
router.delete('/:id', auth, async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, recipientId: req.user.id });
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/notifications
// @desc    Clear all notifications for current user
router.delete('/', auth, async (req, res) => {
  try {
    await Notification.deleteMany({ recipientId: req.user.id });
    res.json({ message: 'All notifications cleared' });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
