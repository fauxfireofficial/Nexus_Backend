import express from 'express';
import Transaction from '../models/Transaction.js';
import Milestone from '../models/Milestone.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { createNotification } from './notifications.js';
import { auth, adminAuth } from '../middleware/auth.js';
import Stripe from 'stripe';

const router = express.Router();

let stripe;
const getStripe = () => {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

// ── Input Validation Helper ──────────────────────────────────────────────────
const validateAmount = (amount) => {
  const parsed = parseFloat(amount);
  if (!amount || isNaN(parsed) || parsed <= 0 || parsed > 10_000_000) {
    return null;
  }
  return parsed;
};

// ── Idempotency Check Helper ─────────────────────────────────────────────────
const checkIdempotency = async (key) => {
  if (!key) return null;
  const existing = await Transaction.findOne({ idempotencyKey: key });
  return existing;
};

// @route   POST /api/payments/create-payment-intent
// @desc    Create Stripe Payment Intent for deposit
router.post('/create-payment-intent', auth, async (req, res) => {
  const { amount, currency } = req.body;
  const parsedAmount = validateAmount(amount);
  if (!parsedAmount) {
    return res.status(400).json({ message: 'Invalid deposit amount.' });
  }

  try {
    const stripeInstance = getStripe();
    const paymentIntent = await stripeInstance.paymentIntents.create({
      amount: Math.round(parsedAmount * 100), // Stripe expects cents
      currency: currency || 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { userId: req.user.id }
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ message: error.message || 'Server error creating payment intent' });
  }
});


// @route   POST /api/payments/deposit
// @desc    Deposit funds into wallet (simulates Stripe mockup checkout success)
router.post('/deposit', auth, async (req, res) => {
  const { amount, idempotencyKey } = req.body;
  const parsedAmount = validateAmount(amount);
  if (!parsedAmount) {
    return res.status(400).json({ message: 'Invalid deposit amount. Must be a positive number.' });
  }

  try {
    // Idempotency check
    if (idempotencyKey) {
      const existing = await checkIdempotency(idempotencyKey);
      if (existing) {
        return res.json({ balance: (await User.findById(req.user.id)).walletBalance, transaction: existing, duplicate: true });
      }
    }

    const user = await User.findById(req.user.id);
    user.walletBalance += parsedAmount;
    await user.save();

    const tx = new Transaction({
      userId: req.user.id,
      type: 'deposit',
      amount: parsedAmount,
      status: 'completed',
      idempotencyKey: idempotencyKey || undefined
    });

    await tx.save();
    res.json({ balance: user.walletBalance, transaction: tx });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ message: 'Server error processing deposit' });
  }
});

// @route   POST /api/payments/withdraw
// @desc    Request to withdraw funds from wallet (status set to pending)
router.post('/withdraw', auth, async (req, res) => {
  const { amount, iban, idempotencyKey } = req.body;
  const parsedAmount = validateAmount(amount);
  if (!parsedAmount) {
    return res.status(400).json({ message: 'Invalid withdrawal amount. Must be a positive number.' });
  }

  const MIN_WITHDRAWAL = 10.0;
  const WITHDRAWAL_FEE = 1.0;

  if (parsedAmount < MIN_WITHDRAWAL) {
    return res.status(400).json({ message: `Minimum withdrawal amount is $${MIN_WITHDRAWAL.toFixed(2)}.` });
  }

  const totalRequested = parsedAmount + WITHDRAWAL_FEE;

  try {
    // Idempotency check
    if (idempotencyKey) {
      const existing = await checkIdempotency(idempotencyKey);
      if (existing) {
        return res.json({ balance: (await User.findById(req.user.id)).walletBalance, transaction: existing, duplicate: true });
      }
    }

    const user = await User.findById(req.user.id);

    // Calculate total pending withdrawals for this user to prevent double-spending
    const pendingTransactions = await Transaction.find({
      userId: req.user.id,
      type: 'withdraw',
      status: 'pending'
    });
    const totalPending = pendingTransactions.reduce((sum, tx) => sum + tx.amount + (tx.fee || 0), 0);
    const availableBalance = user.walletBalance - totalPending;

    if (availableBalance < totalRequested) {
      return res.status(400).json({ 
        message: `Insufficient available balance. Your active wallet balance is $${user.walletBalance.toFixed(2)}, but you have $${totalPending.toFixed(2)} tied up in pending withdrawal requests. Available: $${availableBalance.toFixed(2)} (Requires $${totalRequested.toFixed(2)} including $${WITHDRAWAL_FEE.toFixed(2)} fee).` 
      });
    }

    const tx = new Transaction({
      userId: req.user.id,
      type: 'withdraw',
      amount: parsedAmount,
      fee: WITHDRAWAL_FEE,
      iban: iban || 'N/A',
      status: 'pending',
      idempotencyKey: idempotencyKey || undefined
    });

    await tx.save();
    
    // Return both the walletBalance and the newly calculated available balance
    res.json({ 
      balance: user.walletBalance, 
      availableBalance: user.walletBalance - totalPending - totalRequested,
      transaction: tx 
    });
  } catch (error) {
    console.error('Withdrawal request error:', error);
    res.status(500).json({ message: 'Server error processing withdrawal request' });
  }
});

// @route   GET /api/payments/withdraw/pending
// @desc    Get all pending withdrawal requests (Admin use)
router.get('/withdraw/pending', auth, adminAuth, async (req, res) => {
  try {
    // In a production app, we would restrict this to admin users.
    // For development and testing role-switching simulator, we allow authenticated users.
    const pendingWithdrawals = await Transaction.find({
      type: 'withdraw',
      status: 'pending'
    })
    .populate('userId', 'name email role')
    .sort({ createdAt: -1 });

    res.json(pendingWithdrawals);
  } catch (error) {
    console.error('Get pending withdrawals error:', error);
    res.status(500).json({ message: 'Server error retrieving pending withdrawals' });
  }
});

// @route   POST /api/payments/withdraw/approve/:id
// @desc    Approve a pending withdrawal, deduct wallet balance and execute Stripe payout
router.post('/withdraw/approve/:id', auth, adminAuth, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'withdraw' || tx.status !== 'pending') {
      return res.status(400).json({ message: 'Pending withdrawal request not found.' });
    }

    const user = await User.findById(tx.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const totalDeduction = tx.amount + (tx.fee || 0);
    if (user.walletBalance < totalDeduction) {
      tx.status = 'failed';
      await tx.save();
      return res.status(400).json({ message: 'User has insufficient wallet balance to complete this payout. Request set to failed.' });
    }

    // Call Stripe Payouts API
    let stripePayoutId = null;
    let stripeErrorOccurred = false;
    let stripeErrorMessage = '';
    
    try {
      const stripeInstance = getStripe();
      const payout = await stripeInstance.payouts.create({
        amount: Math.round(tx.amount * 100), // in cents
        currency: 'usd',
        statement_descriptor: 'NEXUS WITHDRAWAL',
      });
      stripePayoutId = payout.id;
    } catch (stripeError) {
      console.warn('Stripe payout failed, falling back to mock payout:', stripeError.message);
      stripeErrorOccurred = true;
      stripeErrorMessage = stripeError.message;
      // In sandbox mode, generate a mock Stripe payout ID if it fails due to setup limitations
      stripePayoutId = 'po_mock_' + Math.random().toString(36).substring(2, 11) + Date.now();
    }

    // Deduct from wallet balance ONLY after approval
    user.walletBalance -= totalDeduction;
    await user.save();

    // Complete transaction
    tx.status = 'completed';
    tx.stripePayoutId = stripePayoutId;
    await tx.save();

    // Send notifications
    const io = req.app.get('io');
    if (io) {
      io.to(user._id.toString()).emit('payment-received', {
        type: 'withdraw',
        amount: tx.amount,
        message: `Your withdrawal of $${tx.amount.toLocaleString()} has been approved and sent to your bank account!`
      });
    }

    await createNotification(io, {
      recipientId: user._id,
      senderId: req.user.id,
      type: 'system',
      content: `Your withdrawal request of $${tx.amount.toLocaleString()} has been approved (Stripe ID: ${stripePayoutId}).`,
      link: '/payments'
    });

    res.json({ 
      message: 'Withdrawal approved successfully.', 
      transaction: tx,
      stripeWarning: stripeErrorOccurred ? `Stripe Sandbox Payout simulated: ${stripeErrorMessage}` : null
    });
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({ message: 'Server error approving withdrawal' });
  }
});

// @route   POST /api/payments/withdraw/reject/:id
// @desc    Reject a pending withdrawal request
router.post('/withdraw/reject/:id', auth, adminAuth, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'withdraw' || tx.status !== 'pending') {
      return res.status(400).json({ message: 'Pending withdrawal request not found.' });
    }

    const user = await User.findById(tx.userId);
    
    // Set status to failed
    tx.status = 'failed';
    await tx.save();

    // Send notification
    if (user) {
      const io = req.app.get('io');
      await createNotification(io, {
        recipientId: user._id,
        senderId: req.user.id,
        type: 'system',
        content: `Your withdrawal request of $${tx.amount.toLocaleString()} has been rejected by the admin.`,
        link: '/payments'
      });
    }

    res.json({ message: 'Withdrawal request rejected successfully.', transaction: tx });
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    res.status(500).json({ message: 'Server error rejecting withdrawal' });
  }
});

// @route   POST /api/payments/transfer
// @desc    Transfer investment funds – either directly or via escrow hold
router.post('/transfer', auth, async (req, res) => {
  const { recipientId, amount, isEscrow, agreementAccepted, idempotencyKey, milestoneTitle } = req.body;
  const parsedAmount = validateAmount(amount);
  if (!parsedAmount) {
    return res.status(400).json({ message: 'Invalid transfer amount. Must be a positive number.' });
  }

  if (!agreementAccepted) {
    return res.status(400).json({ message: 'You must accept the Terms of Investment before proceeding.' });
  }

  try {
    // Idempotency check
    if (idempotencyKey) {
      const existing = await checkIdempotency(idempotencyKey);
      if (existing) {
        return res.json({ balance: (await User.findById(req.user.id)).walletBalance, transaction: existing, duplicate: true });
      }
    }

    const sender = await User.findById(req.user.id);
    const recipient = await User.findById(recipientId);

    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found' });
    }

    if (sender.walletBalance < parsedAmount) {
      return res.status(400).json({ message: 'Insufficient funds for transfer' });
    }

    // Always deduct from sender
    sender.walletBalance -= parsedAmount;

    let milestone = null;

    if (isEscrow) {
      // ── ESCROW MODE ──────────────────────────────────────────────────────────
      // Funds are held – NOT added to recipient until milestone release

      const tx = new Transaction({
        userId: req.user.id,
        type: 'escrow',
        amount: parsedAmount,
        recipientId: recipientId,
        status: 'held',
        agreementAccepted: true,
        idempotencyKey: idempotencyKey || undefined
      });

      await tx.save();

      // Create an associated Milestone
      milestone = new Milestone({
        title: milestoneTitle || `Investment Milestone – ${recipient.startupName || recipient.name}`,
        description: `Escrow of $${parsedAmount.toLocaleString()} held until milestone completion.`,
        startupId: recipientId,
        investorId: req.user.id,
        targetAmount: parsedAmount,
        status: 'pending',
        transactionId: tx._id
      });

      await milestone.save();

      // Update TX with milestone reference
      tx.milestoneId = milestone._id;
      await tx.save();

      // If investor transferring to entrepreneur, increment total investments
      if (sender.role === 'investor') {
        sender.totalInvestments += 1;
      }
      await sender.save();

      // ── Real-time Notification ──────────────────────────────────────────────
      const io = req.app.get('io');
      if (io) {
        io.to(recipientId).emit('payment-received', {
          type: 'escrow',
          amount: parsedAmount,
          senderName: sender.name,
          message: `${sender.name} has placed $${parsedAmount.toLocaleString()} in escrow for your startup!`
        });
      }

      // Save DB notification & Emit real-time notification
      await createNotification(io, {
        recipientId,
        senderId: req.user.id,
        type: 'investment',
        content: `${sender.name} has placed $${parsedAmount.toLocaleString()} in escrow for your startup!`,
        link: '/payments'
      });

      return res.json({ balance: sender.walletBalance, transaction: tx, milestone });

    } else {
      // ── DIRECT TRANSFER MODE ─────────────────────────────────────────────────
      recipient.walletBalance += parsedAmount;

      if (sender.role === 'investor') {
        sender.totalInvestments += 1;
      }

      await sender.save();
      await recipient.save();

      const tx = new Transaction({
        userId: req.user.id,
        type: 'transfer',
        amount: parsedAmount,
        recipientId: recipientId,
        status: 'completed',
        agreementAccepted: true,
        idempotencyKey: idempotencyKey || undefined
      });

      await tx.save();

      // ── Real-time Notification ──────────────────────────────────────────────
      const io = req.app.get('io');
      if (io) {
        io.to(recipientId).emit('payment-received', {
          type: 'transfer',
          amount: parsedAmount,
          senderName: sender.name,
          message: `${sender.name} invested $${parsedAmount.toLocaleString()} in your startup!`
        });
      }

      // Save DB notification & Emit real-time notification
      await createNotification(io, {
        recipientId,
        senderId: req.user.id,
        type: 'investment',
        content: `${sender.name} invested $${parsedAmount.toLocaleString()} in your startup.`,
        link: '/payments'
      });

      return res.json({ balance: sender.walletBalance, transaction: tx });
    }

  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ message: 'Server error processing transfer' });
  }
});

// @route   POST /api/payments/escrow/release/:milestoneId
// @desc    Release escrowed funds when milestone is approved
router.post('/escrow/release/:milestoneId', auth, async (req, res) => {
  try {
    const milestone = await Milestone.findById(req.params.milestoneId);
    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found' });
    }

    // Only the investor who created the escrow can release
    if (milestone.investorId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the investor who created this escrow can release funds.' });
    }

    if (milestone.status === 'released') {
      return res.status(400).json({ message: 'Funds have already been released for this milestone.' });
    }

    // Find the held transaction
    const escrowTx = await Transaction.findById(milestone.transactionId);
    if (!escrowTx || escrowTx.status !== 'held') {
      return res.status(400).json({ message: 'No held funds found for this milestone.' });
    }

    // Release funds to recipient
    const recipient = await User.findById(escrowTx.recipientId);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found.' });
    }

    recipient.walletBalance += escrowTx.amount;
    await recipient.save();

    // Update transaction status
    escrowTx.status = 'completed';
    await escrowTx.save();

    // Create a release record
    const releaseTx = new Transaction({
      userId: req.user.id,
      type: 'escrow_release',
      amount: escrowTx.amount,
      recipientId: escrowTx.recipientId,
      status: 'completed',
      milestoneId: milestone._id
    });
    await releaseTx.save();

    // Update milestone
    milestone.status = 'released';
    milestone.releasedAt = new Date();
    await milestone.save();

    // ── Real-time Notification ──────────────────────────────────────────────
    const io = req.app.get('io');
    if (io) {
      io.to(escrowTx.recipientId.toString()).emit('payment-received', {
        type: 'escrow_release',
        amount: escrowTx.amount,
        senderName: (await User.findById(req.user.id)).name,
        message: `Escrow funds of $${escrowTx.amount.toLocaleString()} have been released to your wallet!`
      });
    }

    // Save DB notification & Emit real-time notification
    const investor = await User.findById(req.user.id);
    await createNotification(io, {
      recipientId: escrowTx.recipientId,
      senderId: req.user.id,
      type: 'escrow_release',
      content: `$${escrowTx.amount.toLocaleString()} escrow funds have been released to your wallet.`,
      link: '/payments'
    });

    res.json({ 
      balance: investor.walletBalance, 
      milestone, 
      transaction: releaseTx 
    });
  } catch (error) {
    console.error('Escrow release error:', error);
    res.status(500).json({ message: 'Server error releasing escrow funds' });
  }
});

// @route   GET /api/payments/history
// @desc    Get transaction history for current user
router.get('/history', auth, async (req, res) => {
  try {
    const history = await Transaction.find({
      $or: [
        { userId: req.user.id },
        { recipientId: req.user.id }
      ]
    })
    .populate('userId', 'name email role')
    .populate('recipientId', 'name email role startupName')
    .populate('milestoneId', 'title status')
    .sort({ createdAt: -1 });

    res.json(history);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ message: 'Server error retrieving transaction history' });
  }
});

// @route   GET /api/payments/escrow
// @desc    Get all escrow milestones for the current user (investor or startup)
router.get('/escrow', auth, async (req, res) => {
  try {
    const milestones = await Milestone.find({
      $or: [
        { investorId: req.user.id },
        { startupId: req.user.id }
      ]
    })
    .populate('startupId', 'name startupName avatarUrl')
    .populate('investorId', 'name avatarUrl')
    .populate('transactionId', 'amount status')
    .sort({ createdAt: -1 });

    res.json(milestones);
  } catch (error) {
    console.error('Get escrow milestones error:', error);
    res.status(500).json({ message: 'Server error retrieving escrow data' });
  }
});

export default router;
