import mongoose from 'mongoose';

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  startupId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  investorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetAmount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'completed', 'released'], 
    default: 'pending' 
  },
  deadline: { type: Date },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  completedAt: { type: Date },
  releasedAt: { type: Date }
}, { timestamps: true });

milestoneSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const Milestone = mongoose.model('Milestone', milestoneSchema);
export default Milestone;
