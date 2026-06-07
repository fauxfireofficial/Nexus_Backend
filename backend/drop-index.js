import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MONGO_URI is not defined in .env');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB Atlas Cloud Database.');
    try {
      // Access the raw collection and drop the username index
      await mongoose.connection.db.collection('users').dropIndex('username_1');
      console.log('SUCCESS: Dropped the legacy unique index "username_1" from the "users" collection.');
    } catch (err) {
      console.log('INFO: Could not drop index, or index does not exist:', err.message);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('Connection error:', err);
    process.exit(1);
  });
