import express from 'express';
import Milestone from '../models/Milestone.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { createNotification } from './notifications.js';

const router = express.Router();

// Helper to validate amount
const validateAmount = (amount) => {
  const parsed = parseFloat(amount);
  if (!amount || isNaN(parsed) || parsed <= 0 || parsed > 10_000_000) {
    return null;
  }
  return parsed;
};

// @route   POST /api/milestones
// @desc    Create a proposed milestone (by startup/entrepreneur)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'entrepreneur') {
    return res.status(403).json({ message: 'Only entrepreneurs can propose milestones.' });
  }

  const { title, description, targetAmount, deadline } = req.body;
  const parsedAmount = validateAmount(targetAmount);

  if (!title) {
    return res.status(400).json({ message: 'Milestone title is required.' });
  }
  if (!parsedAmount) {
    return res.status(400).json({ message: 'Invalid target amount. Must be a positive number.' });
  }

  try {
    const milestone = new Milestone({
      title,
      description: description || '',
      startupId: req.user.id,
      targetAmount: parsedAmount,
      status: 'pending',
      deadline: deadline ? new Date(deadline) : undefined
    });

    await milestone.save();
    res.status(201).json(milestone);
  } catch (error) {
    console.error('Create milestone error:', error);
    res.status(500).json({ message: 'Server error creating milestone' });
  }
});

// @route   GET /api/milestones
// @desc    Get milestones for the current user (investor or startup)
router.get('/', auth, async (req, res) => {
  try {
    const query = req.user.role === 'entrepreneur' 
      ? { startupId: req.user.id } 
      : { investorId: req.user.id };

    const milestones = await Milestone.find(query)
      .populate('startupId', 'name startupName avatarUrl')
      .populate('investorId', 'name avatarUrl')
      .populate('transactionId', 'amount status type')
      .sort({ createdAt: -1 });

    res.json(milestones);
  } catch (error) {
    console.error('Get milestones error:', error);
    res.status(500).json({ message: 'Server error fetching milestones' });
  }
});

// @route   GET /api/milestones/:startupId
// @desc    Get milestones proposed by a specific startup (visible to connected investors)
router.get('/:startupId', auth, async (req, res) => {
  try {
    const milestones = await Milestone.find({ startupId: req.params.startupId })
      .populate('startupId', 'name startupName avatarUrl')
      .populate('investorId', 'name avatarUrl')
      .populate('transactionId', 'amount status type')
      .sort({ createdAt: -1 });

    res.json(milestones);
  } catch (error) {
    console.error('Get startup milestones error:', error);
    res.status(500).json({ message: 'Server error fetching startup milestones' });
  }
});

// @route   PUT /api/milestones/:id/complete
// @desc    Mark a milestone as completed (by entrepreneur)
router.put('/:id/complete', auth, async (req, res) => {
  try {
    const milestone = await Milestone.findById(req.params.id);
    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found.' });
    }

    if (milestone.startupId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the startup owner can complete this milestone.' });
    }

    if (milestone.status === 'completed' || milestone.status === 'released') {
      return res.status(400).json({ message: 'Milestone is already completed or released.' });
    }

    milestone.status = 'completed';
    milestone.completedAt = new Date();
    await milestone.save();

    const io = req.app.get('io');
    const startup = await User.findById(req.user.id);

    // If there is an investor tied to it, notify them
    if (milestone.investorId) {
      await createNotification(io, {
        recipientId: milestone.investorId,
        senderId: req.user.id,
        type: 'investment',
        content: `Milestone "${milestone.title}" has been marked completed by ${startup.startupName || startup.name}. Please review and release escrow funds.`,
        link: '/payments'
      });
    }

    res.json(milestone);
  } catch (error) {
    console.error('Complete milestone error:', error);
    res.status(500).json({ message: 'Server error marking milestone complete' });
  }
});

// @route   POST /api/milestones/:id/fund
// @desc    Fund a proposed milestone via escrow (by investor)
router.post('/:id/fund', auth, async (req, res) => {
  if (req.user.role !== 'investor') {
    return res.status(403).json({ message: 'Only investors can fund milestones.' });
  }

  const { agreementAccepted, idempotencyKey } = req.body;

  if (!agreementAccepted) {
    return res.status(400).json({ message: 'You must accept the Terms of Investment before proceeding.' });
  }

  try {
    const milestone = await Milestone.findById(req.params.id);
    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found.' });
    }

    if (milestone.status !== 'pending' || milestone.investorId) {
      return res.status(400).json({ message: 'Milestone is already funded or complete.' });
    }

    // Check duplicate transaction key
    if (idempotencyKey) {
      const existing = await Transaction.findOne({ idempotencyKey });
      if (existing) {
        return res.status(400).json({ message: 'Duplicate transaction. This milestone is already being funded.' });
      }
    }

    const investor = await User.findById(req.user.id);
    const startup = await User.findById(milestone.startupId);

    if (investor.walletBalance < milestone.targetAmount) {
      return res.status(400).json({ message: 'Insufficient wallet balance to fund this milestone.' });
    }

    // Deduct from investor
    investor.walletBalance -= milestone.targetAmount;
    investor.totalInvestments += 1;
    await investor.save();

    // Create escrow transaction
    const tx = new Transaction({
      userId: req.user.id,
      type: 'escrow',
      amount: milestone.targetAmount,
      recipientId: milestone.startupId,
      status: 'held',
      agreementAccepted: true,
      milestoneId: milestone._id,
      idempotencyKey: idempotencyKey || undefined
    });
    await tx.save();

    // Update milestone
    milestone.investorId = req.user.id;
    milestone.transactionId = tx._id;
    milestone.status = 'in_progress';
    await milestone.save();

    // Notify startup
    const io = req.app.get('io');
    if (io) {
      io.to(milestone.startupId.toString()).emit('payment-received', {
        type: 'escrow',
        amount: milestone.targetAmount,
        senderName: investor.name,
        message: `${investor.name} funded your milestone "${milestone.title}" with $${milestone.targetAmount.toLocaleString()} in escrow!`
      });
    }

    await createNotification(io, {
      recipientId: milestone.startupId,
      senderId: req.user.id,
      type: 'investment',
      content: `${investor.name} funded your milestone "${milestone.title}" with $${milestone.targetAmount.toLocaleString()} in escrow!`,
      link: '/payments'
    });

    res.json({ milestone, balance: investor.walletBalance });
  } catch (error) {
    console.error('Fund milestone error:', error);
    res.status(500).json({ message: 'Server error funding milestone' });
  }
});

// @route   POST /api/milestones/:id/release
// @desc    Approve and release escrow funds (by investor)
router.post('/:id/release', auth, async (req, res) => {
  try {
    const milestone = await Milestone.findById(req.params.id);
    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found.' });
    }

    if (milestone.investorId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the funding investor can release escrow funds.' });
    }

    if (milestone.status === 'released') {
      return res.status(400).json({ message: 'Escrow funds have already been released.' });
    }

    const escrowTx = await Transaction.findById(milestone.transactionId);
    if (!escrowTx || escrowTx.status !== 'held') {
      return res.status(400).json({ message: 'No held escrow funds found for this milestone.' });
    }

    const recipient = await User.findById(escrowTx.recipientId);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found.' });
    }

    // Add wallet balance to startup
    recipient.walletBalance += escrowTx.amount;
    await recipient.save();

    // Complete the original escrow transaction
    escrowTx.status = 'completed';
    await escrowTx.save();

    // Create a release transaction log
    const releaseTx = new Transaction({
      userId: req.user.id,
      type: 'escrow_release',
      amount: escrowTx.amount,
      recipientId: escrowTx.recipientId,
      status: 'completed',
      milestoneId: milestone._id
    });
    await releaseTx.save();

    // Complete milestone
    milestone.status = 'released';
    milestone.releasedAt = new Date();
    await milestone.save();

    const io = req.app.get('io');
    const investor = await User.findById(req.user.id);

    if (io) {
      io.to(escrowTx.recipientId.toString()).emit('payment-received', {
        type: 'escrow_release',
        amount: escrowTx.amount,
        senderName: investor.name,
        message: `Escrow funds of $${escrowTx.amount.toLocaleString()} have been released to your wallet!`
      });
    }

    await createNotification(io, {
      recipientId: escrowTx.recipientId,
      senderId: req.user.id,
      type: 'escrow_release',
      content: `$${escrowTx.amount.toLocaleString()} escrow funds released to your wallet by ${investor.name}.`,
      link: '/payments'
    });

    res.json({ milestone, balance: investor.walletBalance });
  } catch (error) {
    console.error('Release milestone error:', error);
    res.status(500).json({ message: 'Server error releasing escrow funds' });
  }
});

export default router;
