import mongoose from 'mongoose';

const supportArchiveSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [{
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: { type: String },
    isEdited: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
  }],
  status: { type: String, default: 'closed' },
  closedAt: { type: Date, default: Date.now }
}, { timestamps: true });

supportArchiveSchema.index({ userId: 1 });
supportArchiveSchema.index({ closedAt: -1 });

const SupportArchive = mongoose.model('SupportArchive', supportArchiveSchema);
export default SupportArchive;
