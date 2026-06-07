import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  size: { type: String, required: true },
  url: { type: String, required: true }, // URL path to access/download the file
  path: { type: String, required: true }, // Local path where file is saved on disk
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shared: { type: Boolean, default: false },
  signatureImage: { type: String, default: null }, // Base64 string of drawn signature image
  signedAt: { type: Date, default: null }
}, { timestamps: true });

documentSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const Document = mongoose.model('Document', documentSchema);
export default Document;
