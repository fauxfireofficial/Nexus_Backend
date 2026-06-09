import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import nodemailer from 'nodemailer';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Email transporter using Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'fauxfireofficial@gmail.com',
    pass: process.env.EMAIL_PASS || 'mreo ofxk dbre jjwx'
  }
});

// Helper to send OTP email
const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_USER || 'fauxfireofficial@gmail.com',
    to: email,
    subject: 'Nexus Security: Your 2FA OTP Code',
    text: `Your One-Time Password (OTP) for logging into Nexus is: ${otp}. It will expire in 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 500px;">
        <h2 style="color: #4f46e5;">Nexus Verification Code</h2>
        <p>Use the following security code to complete your login:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4f46e5; margin: 20px 0; text-align: center;">
          ${otp}
        </div>
        <p style="font-size: 12px; color: #718096;">This code is valid for 10 minutes. If you did not request this, please secure your account.</p>
      </div>
    `
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`OTP sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending OTP email:', error);
    return false;
  }
};
// Helper to send registration verification email
const sendVerificationEmail = async (email, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_USER || 'fauxfireofficial@gmail.com',
    to: email,
    subject: 'Nexus: Verify Your Email Address',
    text: `Welcome to Nexus! Your email verification OTP code is: ${otp}. It will expire in 15 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 500px;">
        <h2 style="color: #4f46e5;">Welcome to Nexus!</h2>
        <p>Thank you for signing up. Please verify your email using the verification code below:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4f46e5; margin: 20px 0; text-align: center;">
          ${otp}
        </div>
        <p style="font-size: 12px; color: #718096;">If you did not request this, please ignore this email.</p>
      </div>
    `
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`Verification OTP sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
};

// @route   POST /api/auth/register
// @desc    Register a user (initiates email verification)
router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    if (role === 'admin') {
      return res.status(400).json({ message: 'Cannot register with administrator privileges.' });
    }

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate 6 digit OTP for verification
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    const isTestEmail = email && email.endsWith('@nexus.io');

    // Create temporary unverified user state (NOT SAVED TO DB YET)
    const newUserParams = {
      name,
      email,
      password: hashedPassword,
      role,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
      isOnline: isTestEmail,
      isVerified: isTestEmail,
      walletBalance: role === 'investor' ? 100000 : 0
    };

    if (isTestEmail) {
      // Test emails bypass OTP and save directly
      const user = new User(newUserParams);
      await user.save();
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || 'nexus_super_secret_key_123',
        { expiresIn: '7d' }
      );
      return res.status(201).json({ token, user });
    }
    
    // Send email with OTP code
    await sendVerificationEmail(email, otp);

    // Sign all user data + OTP into a temporary token (valid for 15 mins)
    const tempToken = jwt.sign(
      { ...newUserParams, otp },
      process.env.JWT_SECRET || 'nexus_super_secret_key_123',
      { expiresIn: '15m' }
    );

    res.status(200).json({ 
      requiresVerification: true, 
      tempToken, 
      email, 
      message: 'Verification OTP sent to your email.' 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: error.message || 'Server error during registration' });
  }
});

// @route   POST /api/auth/verify-email
// @desc    Verify email address using registration OTP code
router.post('/verify-email', async (req, res) => {
  const { tempToken, code } = req.body;
  try {
    if (!tempToken || !code) {
      return res.status(400).json({ message: 'Token and OTP code required' });
    }

    // Decode the temporary token
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET || 'nexus_super_secret_key_123');
    } catch (err) {
      return res.status(400).json({ message: 'Session expired or invalid. Please register again.' });
    }

    if (decoded.otp !== code) {
      return res.status(400).json({ message: 'Invalid verification OTP code' });
    }
    
    // Make sure user doesn't already exist (in case of double submission)
    let exists = await User.findOne({ email: decoded.email });
    if (exists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Now securely save the user to the Database!
    const user = new User({
      name: decoded.name,
      email: decoded.email,
      password: decoded.password, // Already hashed
      role: decoded.role,
      avatarUrl: decoded.avatarUrl,
      isOnline: true,
      isVerified: true,
      walletBalance: decoded.walletBalance
    });

    await user.save();

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET || 'nexus_super_secret_key_123',
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ message: 'Server error during email verification' });
  }
});

// @route   POST /api/auth/login
// @desc    Login user & get token (or trigger 2FA/Verification)
router.post('/login', async (req, res) => {
  const { email, password, role } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Set online status
    user.isOnline = true;
    await user.save();

    // Check if 2FA is enabled
    if (user.isTwoFactorEnabled) {
      // Generate 6 digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      user.twoFactorSecret = otp;
      await user.save();

      // Send OTP via Email
      const emailSent = await sendOTPEmail(user.email, otp);
      
      return res.json({
        require2FA: true,
        userId: user.id,
        emailSent,
        devOTP: otp
      });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET || 'nexus_super_secret_key_123',
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// @route   POST /api/auth/verify-2fa
// @desc    Verify 2FA code & login
router.post('/verify-2fa', async (req, res) => {
  const { userId, code } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    if (user.twoFactorSecret !== code) {
      return res.status(400).json({ message: 'Invalid OTP code' });
    }

    // Clear OTP code
    user.twoFactorSecret = null;
    await user.save();

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET || 'nexus_super_secret_key_123',
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ message: 'Server error during 2FA verification' });
  }
});

// @route   POST /api/auth/toggle-2fa
// @desc    Enable/Disable 2FA
router.post('/toggle-2fa', auth, async (req, res) => {
  const { enable } = req.body;
  try {
    const user = await User.findById(req.user.id);
    user.isTwoFactorEnabled = !!enable;
    await user.save();
    res.json({ success: true, isTwoFactorEnabled: user.isTwoFactorEnabled });
  } catch (error) {
    console.error('Toggle 2FA error:', error);
    res.status(500).json({ message: 'Server error toggle 2FA' });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email code
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'No account found with this email' });
    }

    // Generate random reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactorSecret = resetCode; // Temporarily reuse twoFactorSecret for reset code
    await user.save();

    const mailOptions = {
      from: process.env.EMAIL_USER || 'fauxfireofficial@gmail.com',
      to: email,
      subject: 'Nexus: Password Reset Code',
      text: `Your password reset verification code is: ${resetCode}. Use this to reset your password.`,
      html: `<h3>Nexus Password Reset</h3><p>Your verification code to reset password is:</p><h2>${resetCode}</h2>`
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: 'Password reset code sent to your email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error during forgot password' });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password using email code
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    if (user.twoFactorSecret !== code) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.twoFactorSecret = null;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error resetting password' });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user details
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving current user' });
  }
});

export default router;
