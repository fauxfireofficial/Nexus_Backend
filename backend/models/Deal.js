import mongoose from 'mongoose';

const dealSchema = new mongoose.Schema({
  startup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: String,
    required: true
  },
  equity: {
    type: String,
    required: true
  },
  stage: {
    type: String,
    enum: ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Growth'],
    default: 'Seed'
  },
  status: {
    type: String,
    enum: ['Due Diligence', 'Term Sheet', 'Negotiation', 'Closed', 'Passed'],
    default: 'Due Diligence'
  },
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public'
  },
  notes: {
    type: String,
    default: ''
  },
  activities: [{
    type: {
      type: String,
      default: 'note'
    },
    description: String,
    date: {
      type: Date,
      default: Date.now
    },
    by: String
  }],
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

export default mongoose.model('Deal', dealSchema);
