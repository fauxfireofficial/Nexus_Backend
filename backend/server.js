import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';

// Import Routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import meetingRoutes from './routes/meetings.js';
import documentRoutes from './routes/documents.js';
import paymentRoutes from './routes/payments.js';
import chatRoutes from './routes/chat.js';
import notificationRoutes from './routes/notifications.js';
import milestoneRoutes from './routes/milestones.js';
import adminRoutes from './routes/admin.js';
import helpRoutes from './routes/help.js';
import dealRoutes from './routes/deals.js';
import User from './models/User.js';
import bcrypt from 'bcryptjs';


const app = express();
const server = http.createServer(app);

// Allow Vite dev server on any localhost port (5173, 5174, etc.)
const corsOrigin = (origin, callback) => {
  if (!origin) {
    return callback(null, true);
  }
  const configured = process.env.FRONTEND_URL;
  const allowed =
    (configured && origin === configured) ||
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
  callback(null, allowed);
};

const corsOptions = {
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
};

// Configure Socket.IO with CORS settings matching the frontend
const io = new Server(server, {
  cors: corsOptions,
});

// Make `io` accessible in route handlers via req.app.get('io')
app.set('io', io);

// Middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: '100mb' })); // Allow higher payloads for video uploads, drawing canvases/e-signatures
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Serve static uploads
const __dirname = path.resolve();
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes mapping
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/milestones', milestoneRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/help', helpRoutes);
app.use('/api/deals', dealRoutes);

// Root route for health check
app.get('/', (req, res) => {
  res.json({ message: 'Nexus Full Stack API is running successfully.' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(err.status || 500).json({ 
    message: err.message || 'An internal server error occurred.' 
  });
});

// Socket.IO WebRTC Signaling handlers
io.on('connection', (socket) => {
  console.log('Socket client connected:', socket.id);

  // ── User Registration ──────────────────────────────────────────────────────
  // Each logged-in user joins a private room = their userId
  // so we can push targeted events (notifications, calls, etc.)
  socket.on('register-user', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} registered for private socket events`);
  });

  // ── Video / Audio Call Signaling ───────────────────────────────────────────
  socket.on('call-user', ({ userToCall, from, callerName, callerAvatar, callType, channelName }) => {
    socket.to(userToCall).emit('incoming-call', { 
      from, 
      callerName,
      callerAvatar,
      callType,
      channelName
    });
  });

  socket.on('accept-call', ({ to, channelName }) => {
    socket.to(to).emit('call-accepted', { channelName });
  });

  socket.on('reject-call', ({ to }) => {
    socket.to(to).emit('call-rejected');
  });

  socket.on('end-call', ({ to }) => {
    socket.to(to).emit('call-ended');
  });

  // ── WebRTC Room ────────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, userId }) => {
    socket.join(roomId);
    console.log(`User ${userId} joined WebRTC room ${roomId}`);
    
    // Notify other peers in the room
    socket.to(roomId).emit('user-connected', { userId, socketId: socket.id });

    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected from WebRTC room ${roomId}`);
      socket.to(roomId).emit('user-disconnected', { userId, socketId: socket.id });
    });
  });

  // Relay offer, answer, and ice-candidates to peers in the room
  socket.on('offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('offer', { offer, senderId: socket.id });
  });

  socket.on('answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('answer', { answer, senderId: socket.id });
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', { candidate, senderId: socket.id });
  });
});

// Database connection & start server
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('CRITICAL ERROR: MONGO_URI is not defined in .env file.');
  process.exit(1);
}

const seedAdmin = async () => {
  try {
    const adminEmail = 'nexus@admin.com';
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin@123', 10);
      const adminUser = new User({
        name: 'Nexus Admin',
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        avatarUrl: `https://ui-avatars.com/api/?name=Nexus+Admin&background=4f46e5&color=fff`,
        isOnline: false,
        isVerified: true,
        walletBalance: 0
      });
      await adminUser.save();
      console.log('SUCCESS: Seeded admin user nexus@admin.com / admin@123');
    } else {
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        await existingAdmin.save();
        console.log('SUCCESS: Updated existing nexus@admin.com user role to admin');
      }
    }
  } catch (err) {
    console.error('Error seeding admin user:', err);
  }
};

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('SUCCESS: Connected to MongoDB Atlas Cloud Database.');
    await seedAdmin();
    server.listen(PORT, () => {
      console.log(`SUCCESS: Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('CRITICAL ERROR: Failed to connect to MongoDB Atlas:', err);
    process.exit(1);
  });
