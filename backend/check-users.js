import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

async function checkAndSeed() {
  console.log('Connecting to database...');
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected successfully!');

    // 1. List existing users
    const users = await User.find({}, 'name email role isVerified');
    console.log('\n--- REGISTERED USERS ---');
    if (users.length === 0) {
      console.log('No users found in the database!');
    } else {
      users.forEach(u => {
        console.log(`- Name: ${u.name} | Email: ${u.email} | Role: ${u.role} | Verified: ${u.isVerified}`);
      });
    }

    // 2. Auto-seed two default test users if the database is empty or we want to guarantee their existence
    const testUsers = [
      { name: 'Entrepreneur Test', email: 'entrepreneur@nexus.io', password: 'password123', role: 'entrepreneur' },
      { name: 'Investor Test', email: 'investor@nexus.io', password: 'password123', role: 'investor' }
    ];

    console.log('\nChecking / seeding test accounts...');
    for (const testU of testUsers) {
      let existing = await User.findOne({ email: testU.email });
      if (!existing) {
        const hashedPassword = await bcrypt.hash(testU.password, 10);
        const newUser = new User({
          name: testU.name,
          email: testU.email,
          password: hashedPassword,
          role: testU.role,
          avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(testU.name)}&background=random`,
          isVerified: true,
          isOnline: false,
          walletBalance: testU.role === 'investor' ? 100000 : 0
        });
        await newUser.save();
        console.log(`✓ Created test user: ${testU.email} with password: "${testU.password}"`);
      } else {
        console.log(`✓ Test user already exists: ${testU.email}`);
      }
    }

    console.log('\nAll done!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkAndSeed();
