import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// Configure Cloudinary credentials from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── General storage (documents, videos, images, etc.) ────────────────────────
const generalStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'nexus_uploads',
    resource_type: 'auto', // supports image, video, raw (PDF, etc.)
  },
});

// ── Avatar-specific storage ───────────────────────────────────────────────────
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'nexus_avatars',
    resource_type: 'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
  },
});

// Multer instances
export const upload        = multer({ storage: generalStorage });
export const uploadAvatar  = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

export { cloudinary };
