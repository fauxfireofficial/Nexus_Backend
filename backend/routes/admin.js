import express from 'express';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Milestone from '../models/Milestone.js';
import Notification from '../models/Notification.js';
import Ticket from '../models/Ticket.js';
import { createNotification } from './notifications.js';
import { auth, adminAuth } from '../middleware/auth.js';
import nodemailer from 'nodemailer';

const router = express.Router();

// Apply auth and adminAuth to all routes in this router
router.use(auth);
router.use(adminAuth);

// @route   GET /api/admin/users
// @desc    Get all users on the platform
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ message: 'Server error retrieving users' });
  }
});

// @route   PUT /api/admin/users/:id/balance
// @desc    Update a user's wallet balance (admin adjustment)
router.put('/users/:id/balance', async (req, res) => {
  const { amount, action } = req.body; // action: 'add' or 'deduct'
  const parsedAmount = parseFloat(amount);
  
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ message: 'Amount must be a positive number.' });
  }
  
  if (!['add', 'deduct'].includes(action)) {
    return res.status(400).json({ message: 'Action must be "add" or "deduct".' });
  }

  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const previousBalance = user.walletBalance;
    if (action === 'add') {
      user.walletBalance += parsedAmount;
    } else {
      if (user.walletBalance < parsedAmount) {
        return res.status(400).json({ message: `Insufficient balance to deduct. User current balance: $${user.walletBalance.toFixed(2)}` });
      }
      user.walletBalance -= parsedAmount;
    }

    await user.save();

    // Create a transaction record for audit logging
    const tx = new Transaction({
      userId: user._id,
      type: action === 'add' ? 'deposit' : 'withdraw',
      amount: parsedAmount,
      status: 'completed',
      iban: 'Admin Adjustment',
      idempotencyKey: `adj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
    });
    await tx.save();

    // Send real-time notification to the user if online
    const io = req.app.get('io');
    if (io) {
      io.to(user._id.toString()).emit('payment-received', {
        type: action === 'add' ? 'deposit' : 'withdraw',
        amount: parsedAmount,
        message: `Admin has adjusted your balance: ${action === 'add' ? 'Added' : 'Deducted'} $${parsedAmount.toLocaleString()}`
      });
    }

    // Save notification in database
    await createNotification(io, {
      recipientId: user._id,
      senderId: req.user.id,
      type: 'system',
      content: `Your wallet balance was adjusted by admin. Previous: $${previousBalance.toFixed(2)}, New: $${user.walletBalance.toFixed(2)}.`,
      link: '/payments'
    });

    res.json({ message: 'User balance updated successfully.', user, transaction: tx });
  } catch (error) {
    console.error('Admin update balance error:', error);
    res.status(500).json({ message: 'Server error updating balance' });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete a user account
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (user.email === 'nexus@admin.com') {
      return res.status(400).json({ message: 'Cannot delete the primary administrator account.' });
    }

    await User.findByIdAndDelete(req.params.id);
    
    // Send standard success message
    res.json({ message: `User ${user.name} was successfully deleted.` });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ message: 'Server error deleting user.' });
  }
});

// @route   GET /api/admin/transactions
// @desc    Get all transactions across the platform
router.get('/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find({})
      .populate('userId', 'name email role')
      .populate('recipientId', 'name email role startupName')
      .populate('milestoneId', 'title status')
      .sort({ createdAt: -1 });
    res.json(transactions);
  } catch (error) {
    console.error('Admin get transactions error:', error);
    res.status(500).json({ message: 'Server error retrieving transaction ledger' });
  }
});

// @route   GET /api/admin/milestones
// @desc    Get all milestones/escrow agreements across the platform
router.get('/milestones', async (req, res) => {
  try {
    const milestones = await Milestone.find({})
      .populate('startupId', 'name startupName avatarUrl')
      .populate('investorId', 'name avatarUrl')
      .populate('transactionId', 'amount status')
      .sort({ createdAt: -1 });
    res.json(milestones);
  } catch (error) {
    console.error('Admin get milestones error:', error);
    res.status(500).json({ message: 'Server error retrieving milestone agreements' });
  }
});

// @route   PUT /api/admin/milestones/:id/status
// @desc    Override milestone status (Force Release, Dispute Release, or Cancel)
router.put('/milestones/:id/status', async (req, res) => {
  const { status } = req.body; // 'released' or 'cancelled' / 'pending' / 'in_progress'

  if (!['released', 'cancelled', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ message: 'Invalid milestone status override.' });
  }

  try {
    const milestone = await Milestone.findById(req.params.id);
    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found.' });
    }

    const previousStatus = milestone.status;
    if (previousStatus === status) {
      return res.status(400).json({ message: `Milestone is already in status "${status}".` });
    }

    const escrowTx = await Transaction.findById(milestone.transactionId);
    const io = req.app.get('io');

    if (status === 'released') {
      // Release locked funds to entrepreneur
      if (previousStatus === 'released') {
        return res.status(400).json({ message: 'Milestone funds are already released.' });
      }

      if (!escrowTx) {
        return res.status(400).json({ message: 'Associated transaction not found.' });
      }

      const entrepreneur = await User.findById(milestone.startupId);
      if (!entrepreneur) {
        return res.status(404).json({ message: 'Recipient entrepreneur not found.' });
      }

      // Add money to entrepreneur balance
      entrepreneur.walletBalance += escrowTx.amount;
      await entrepreneur.save();

      // Update escrow transaction status
      escrowTx.status = 'completed';
      await escrowTx.save();

      // Create a release record
      const releaseTx = new Transaction({
        userId: milestone.investorId,
        type: 'escrow_release',
        amount: escrowTx.amount,
        recipientId: milestone.startupId,
        status: 'completed',
        milestoneId: milestone._id,
        iban: 'Admin Force Release'
      });
      await releaseTx.save();

      milestone.status = 'released';
      milestone.releasedAt = new Date();
      await milestone.save();

      // Notify entrepreneur
      if (io) {
        io.to(milestone.startupId.toString()).emit('payment-received', {
          type: 'escrow_release',
          amount: escrowTx.amount,
          message: `Admin has force-released escrow funds of $${escrowTx.amount.toLocaleString()} to your wallet!`
        });
      }

      await createNotification(io, {
        recipientId: milestone.startupId,
        senderId: req.user.id,
        type: 'escrow_release',
        content: `Admin force-released $${escrowTx.amount.toLocaleString()} escrow funds for milestone "${milestone.title}" to your wallet.`,
        link: '/payments'
      });

      // Notify investor
      await createNotification(io, {
        recipientId: milestone.investorId,
        senderId: req.user.id,
        type: 'system',
        content: `Admin force-released escrow funds for milestone "${milestone.title}" to the startup wallet.`,
        link: '/payments'
      });

    } else if (status === 'cancelled') {
      // Cancel milestone, return funds to investor
      if (!escrowTx) {
        return res.status(400).json({ message: 'Associated transaction not found.' });
      }

      const investor = await User.findById(milestone.investorId);
      if (!investor) {
        return res.status(404).json({ message: 'Investor not found.' });
      }

      // Refund the investor
      investor.walletBalance += escrowTx.amount;
      await investor.save();

      // Mark escrow transaction as failed/refunded
      escrowTx.status = 'failed';
      await escrowTx.save();

      // Create a refund transaction
      const refundTx = new Transaction({
        userId: req.user.id,
        type: 'deposit',
        amount: escrowTx.amount,
        recipientId: milestone.investorId,
        status: 'completed',
        milestoneId: milestone._id,
        iban: 'Admin Escrow Refund'
      });
      await refundTx.save();

      milestone.status = 'pending'; // revert to pending, or cancel
      // Add custom field or set status to something else if needed, but let's change milestone status to 'pending' and set target amount to 0 or mark it cancelled
      // Let's set milestone status to 'pending' to allow re-funding or simply mark it as cancelled.
      // Wait, milestone schema has status: 'pending', 'in_progress', 'completed', 'released'.
      // If we cancel the escrow, we set status back to 'pending' so it's not active/funded.
      milestone.status = 'pending';
      // Clear transactional references
      milestone.transactionId = null; 
      await milestone.save();

      // Notify investor
      if (io) {
        io.to(milestone.investorId.toString()).emit('payment-received', {
          type: 'deposit',
          amount: escrowTx.amount,
          message: `Admin has cancelled escrow milestone "${milestone.title}" and refunded $${escrowTx.amount.toLocaleString()} to your wallet!`
        });
      }

      await createNotification(io, {
        recipientId: milestone.investorId,
        senderId: req.user.id,
        type: 'system',
        content: `Admin cancelled milestone "${milestone.title}" and refunded $${escrowTx.amount.toLocaleString()} to your wallet.`,
        link: '/payments'
      });

      // Notify entrepreneur
      await createNotification(io, {
        recipientId: milestone.startupId,
        senderId: req.user.id,
        type: 'system',
        content: `Admin cancelled the escrow agreement for milestone "${milestone.title}". Funds refunded to investor.`,
        link: '/payments'
      });
    } else {
      // Revert status to completed or in_progress manually without transferring money
      milestone.status = status;
      await milestone.save();
    }

    res.json({ message: `Milestone status overridden to ${status} successfully.`, milestone });
  } catch (error) {
    console.error('Admin override milestone error:', error);
    res.status(500).json({ message: 'Server error overriding milestone status' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SUPPORT TICKETS MANAGEMENT
// ──────────────────────────────────────────────────────────────────────────────

// @route   GET /api/admin/tickets
// @desc    Get all support tickets
router.get('/tickets', async (req, res) => {
  try {
    const tickets = await Ticket.find({}).populate('userId', 'name email role avatarUrl').sort({ createdAt: -1 });
    res.json(tickets);
  } catch (error) {
    console.error('Admin get tickets error:', error);
    res.status(500).json({ message: 'Server error retrieving support tickets.' });
  }
});

// @route   POST /api/admin/tickets/:id/reply
// @desc    Admin replies to a support ticket and sends email to user
router.post('/tickets/:id/reply', async (req, res) => {
  const { reply } = req.body;

  if (!reply || !reply.trim()) {
    return res.status(400).json({ message: 'Reply message is required.' });
  }

  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }

    ticket.adminReply = reply;
    ticket.status = 'replied';
    ticket.repliedAt = new Date();
    await ticket.save();

    // Send email reply to the user from admin Gmail
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      await transporter.sendMail({
        from: `"Nexus Support" <${process.env.EMAIL_USER}>`,
        to: ticket.email,
        subject: `Re: ${ticket.subject} - Nexus Support`,
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 24px; text-align: center;">
              <h1 style="color: #fff; margin: 0; font-size: 22px;">📩 Support Reply</h1>
            </div>
            <div style="padding: 24px;">
              <p style="color: #374151; font-size: 14px;">Hello <strong>${ticket.name}</strong>,</p>
              <p style="color: #374151; font-size: 14px;">We have reviewed your support ticket regarding:</p>
              <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 12px 0;">
                <p style="color: #6b7280; font-size: 13px; margin: 0;"><strong>Subject:</strong> ${ticket.subject}</p>
                <p style="color: #6b7280; font-size: 13px; margin: 4px 0 0;"><strong>Your Message:</strong> ${ticket.message}</p>
              </div>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
              <p style="color: #1f2937; font-size: 15px; line-height: 1.6;"><strong>Admin Response:</strong></p>
              <p style="color: #1f2937; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${reply}</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
              <p style="color: #6b7280; font-size: 12px;">If you need further assistance, please submit a new ticket through the Help & Support page.</p>
              <p style="color: #6b7280; font-size: 12px;">- Nexus Support Team</p>
            </div>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send reply email to user:', emailErr);
    }

    // Also send in-app notification to the user
    const io = req.app.get('io');
    await createNotification(io, {
      recipientId: ticket.userId,
      senderId: req.user.id,
      type: 'system',
      content: `Your support ticket "${ticket.subject}" has been replied to by the admin.`,
      link: '/help'
    });

    res.json({ message: 'Reply sent successfully and user notified via email.', ticket });
  } catch (error) {
    console.error('Admin reply ticket error:', error);
    res.status(500).json({ message: 'Server error replying to ticket.' });
  }
});

// @route   PUT /api/admin/tickets/:id/close
// @desc    Close a support ticket
router.put('/tickets/:id/close', async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }
    ticket.status = 'closed';
    await ticket.save();
    res.json({ message: 'Ticket closed successfully.', ticket });
  } catch (error) {
    console.error('Admin close ticket error:', error);
    res.status(500).json({ message: 'Server error closing ticket.' });
  }
});

export default router;
