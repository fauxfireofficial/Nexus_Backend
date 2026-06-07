import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Document from '../models/Document.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Ensure upload directory exists
const UPLOAD_DIR = './uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit (supports video uploads)
});

// Helper for formatting file size
const formatBytes = (bytes, decimals = 1) => {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// @route   POST /api/documents/upload
// @desc    Upload a new document
router.post('/upload', auth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const docName = req.file.originalname;
    const docSize = formatBytes(req.file.size);
    const docType = path.extname(docName).replace('.', '').toUpperCase();
    const docUrl = `/uploads/${req.file.filename}`;

    const newDoc = new Document({
      name: docName,
      type: docType,
      size: docSize,
      url: docUrl,
      path: req.file.path,
      ownerId: req.user.id,
      shared: false
    });

    await newDoc.save();
    res.status(201).json(newDoc);
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ message: 'Server error uploading file' });
  }
});

// @route   GET /api/documents/download/:filename
// @desc    Download a file with its original filename (or a custom query filename)
router.get('/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join('./uploads', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Use custom name from query parameter if provided, otherwise extract original name
    let downloadName = req.query.name;
    if (!downloadName) {
      const match = filename.match(/^\d+-\d+-(.+)$/);
      downloadName = match ? match[1] : filename;
    }

    res.download(filePath, downloadName);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ message: 'Server error downloading file' });
  }
});


// @route   GET /api/documents
// @desc    Get all documents for the current user (owned or shared)
router.get('/', auth, async (req, res) => {
  try {
    // If entrepreneur, get their documents. If investor, get files they own plus all shared files.
    let query = {};
    if (req.user.role === 'investor') {
      // Investors can see their own uploaded files, or any entrepreneur's file that is flagged as shared
      query = {
        $or: [
          { ownerId: req.user.id },
          { shared: true } // Shared documents are accessible to matching partners
        ]
      };
    } else {
      // Entrepreneurs see their own files
      query = { ownerId: req.user.id };
    }

    const docs = await Document.find(query).sort({ createdAt: -1 });
    res.json(docs);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ message: 'Server error retrieving files' });
  }
});

// @route   POST /api/documents/share/:id
// @desc    Toggle shared status of document
router.post('/share/:id', auth, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Verify ownership
    if (doc.ownerId.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized to share this document' });
    }

    doc.shared = !doc.shared;
    await doc.save();
    res.json(doc);
  } catch (error) {
    console.error('Share document error:', error);
    res.status(500).json({ message: 'Server error toggle share status' });
  }
});

// @route   POST /api/documents/sign/:id
// @desc    E-sign a document (save handdrawn signature)
router.post('/sign/:id', auth, async (req, res) => {
  const { signatureImage } = req.body;
  if (!signatureImage) {
    return res.status(400).json({ message: 'Signature image is required' });
  }

  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Mark as signed
    doc.signatureImage = signatureImage;
    doc.signedAt = new Date();
    await doc.save();

    res.json(doc);
  } catch (error) {
    console.error('Sign document error:', error);
    res.status(500).json({ message: 'Server error signing document' });
  }
});

// @route   DELETE /api/documents/:id
// @desc    Delete a document
router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Verify ownership
    if (doc.ownerId.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized to delete this document' });
    }

    // Delete local file from disk
    if (fs.existsSync(doc.path)) {
      fs.unlinkSync(doc.path);
    }

    // Delete record from DB
    await Document.deleteOne({ _id: req.params.id });

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ message: 'Server error deleting document' });
  }
});

export default router;
