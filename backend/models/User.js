import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['entrepreneur', 'investor', 'admin'], required: true },
  avatarUrl: { type: String },
  avatarPublicId: { type: String }, // Cloudinary public_id for deletion
  bio: { type: String, default: '' },
  isOnline: { type: Boolean, default: false },
  walletBalance: { type: Number, default: 0 },
  twoFactorSecret: { type: String },
  isTwoFactorEnabled: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  verificationCode: { type: String },
  supportSessionActive: { type: Boolean, default: false },
  
  // Entrepreneur-specific fields
  startupName: { type: String, default: '' },
  pitchSummary: { type: String, default: '' },
  fundingNeeded: { type: String, default: '' },
  industry: { type: String, default: '' },
  location: { type: String, default: '' },
  foundedYear: { type: Number, default: 2024 },
  teamSize: { type: Number, default: 1 },
  
  // Investor-specific fields
  investmentInterests: [{ type: String }],
  investmentStage: [{ type: String }],
  portfolioCompanies: [{ type: String }],
  totalInvestments: { type: Number, default: 0 },
  minimumInvestment: { type: String, default: '' },
  maximumInvestment: { type: String, default: '' }
}, { timestamps: true });

// Convert schema to JSON options to ensure virtuals or formatting fits
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    return ret;
  }
});

const User = mongoose.model('User', userSchema);
export default User;
