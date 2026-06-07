import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  isEdited: { type: Boolean, default: false }
}, { timestamps: true });

messageSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    ret.timestamp = ret.createdAt;
    ret.isEdited = ret.isEdited || false;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const Message = mongoose.model('Message', messageSchema);
export default Message;
