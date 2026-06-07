import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['open', 'replied', 'closed'], default: 'open' },
  adminReply: { type: String, default: '' },
  repliedAt: { type: Date }
}, { timestamps: true });

// Virtuals for id mapping
ticketSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Ticket', ticketSchema);
