import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['deposit', 'withdraw', 'transfer', 'escrow', 'escrow_release'], 
    required: true 
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'held'], 
    default: 'completed' 
  },
  milestoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Milestone' },
  idempotencyKey: { type: String, unique: true, sparse: true },
  agreementAccepted: { type: Boolean, default: false },
  fee: { type: Number, default: 0 },
  iban: { type: String },
  stripePayoutId: { type: String }
}, { timestamps: true });

transactionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
