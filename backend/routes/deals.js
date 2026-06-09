import express from 'express';
import Deal from '../models/Deal.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/deals
// @desc    Get all public deals (for investors) or user's own deals (for entrepreneurs)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    let query = {};
    
    // If entrepreneur, only show their own startup deals
    if (req.user.role === 'entrepreneur') {
      query = { startup: req.user.id };
    } else {
      // Investors and admins can see public deals
      query = { visibility: 'public' };
    }

    const deals = await Deal.find(query)
      .populate('startup', 'name startupName avatarUrl industry')
      .sort({ createdAt: -1 });
      
    res.json(deals);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST /api/deals
// @desc    Create a new deal
// @access  Private
router.post('/', auth, async (req, res) => {
  // Check if user role is entrepreneur
  if (req.user.role !== 'entrepreneur') {
    return res.status(403).json({ message: 'Only entrepreneurs can create deals.' });
  }

  const { amount, equity, stage, status, visibility, notes } = req.body;

  try {
    const newDeal = new Deal({
      startup: req.user.id, // Authenticated entrepreneur's ID
      amount,
      equity,
      stage: stage || 'Seed',
      status: status || 'Due Diligence',
      visibility: visibility || 'public',
      notes: notes || '',
      activities: [{
        type: 'status_change',
        description: `Deal created at stage: ${stage || 'Seed'}, Status: ${status || 'Due Diligence'}`,
        by: req.user.name || 'Founder'
      }]
    });

    const deal = await newDeal.save();
    
    // Populate startup data before returning so frontend can display it immediately
    await deal.populate('startup', 'name startupName avatarUrl industry');
    
    res.json(deal);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

export default router;
