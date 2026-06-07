import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['message', 'connection_request', 'connection_accepted', 'investment_interest', 'investment', 'escrow_release'],
    required: true
  },
  content: { type: String, required: true },
  isRead:  { type: Boolean, default: false },
  // Optional link for deep-navigation on click
  link: { type: String, default: '' }
}, { timestamps: true });

notificationSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
