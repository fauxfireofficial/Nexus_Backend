import express from 'express';
import Ticket from '../models/Ticket.js';
import { auth } from '../middleware/auth.js';
import nodemailer from 'nodemailer';

const router = express.Router();

// Nodemailer transporter using the admin Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // fauxfireofficial@gmail.com
    pass: process.env.EMAIL_PASS
  }
});

// @route   POST /api/help/submit
// @desc    User submits a support ticket. Email notification sent to admin.
router.post('/submit', auth, async (req, res) => {
  const { subject, message } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required.' });
  }

  try {
    const ticket = new Ticket({
      userId: req.user.id,
      name: req.user.name || 'Unknown User',
      email: req.user.email || '',
      subject,
      message
    });
    await ticket.save();

    // Send email notification to admin
    try {
      await transporter.sendMail({
        from: `"Nexus Support" <${process.env.EMAIL_USER}>`,
        to: 'fauxfireofficial@gmail.com',
        subject: `[New Support Ticket] ${subject}`,
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 24px; text-align: center;">
              <h1 style="color: #fff; margin: 0; font-size: 22px;">🎫 New Support Ticket</h1>
            </div>
            <div style="padding: 24px;">
              <p style="color: #374151; font-size: 14px;"><strong>From:</strong> ${ticket.name} (${ticket.email})</p>
              <p style="color: #374151; font-size: 14px;"><strong>Subject:</strong> ${subject}</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
              <p style="color: #1f2937; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${message}</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
              <p style="color: #6b7280; font-size: 12px;">Ticket ID: ${ticket._id}</p>
              <p style="color: #6b7280; font-size: 12px;">Reply from the Admin Portal to respond to this ticket.</p>
            </div>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('Failed to send support ticket email to admin:', emailErr);
      // Don't fail the ticket creation if email fails
    }

    res.status(201).json({ message: 'Your support ticket has been submitted successfully! We will get back to you soon.', ticket });
  } catch (error) {
    console.error('Submit ticket error:', error);
    res.status(500).json({ message: 'Server error submitting support ticket.' });
  }
});

// @route   GET /api/help/my-tickets
// @desc    Get current user's tickets
router.get('/my-tickets', auth, async (req, res) => {
  try {
    const tickets = await Ticket.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(tickets);
  } catch (error) {
    console.error('Get my tickets error:', error);
    res.status(500).json({ message: 'Server error retrieving tickets.' });
  }
});

export default router;
