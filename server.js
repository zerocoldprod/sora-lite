/**
 * server.js – Main Express application
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { createZip, processFiles } = require('./utils/processor');
const cron = require('node-cron');
const winston = require('winston');

const https = require('https');
const http = require('http');

// -----------------------------------------------------------------------------
// Configuration constants
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 7841;
const PORT_SSL = process.env.PORT_SSL || 7840; // separate env var for clarity
const CLEANUP_ENABLED = true;
const CLEANUP_AFTER_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100 MiB
const MAX_FILES = 20;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OPTIMIZED_DIR = path.join(__dirname, 'optimized');

// -----------------------------------------------------------------------------
// Winston logger
// -----------------------------------------------------------------------------
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`
    )
  ),
  transports: [new winston.transports.Console()],
});

// -----------------------------------------------------------------------------
// Ensure required folders exist
// -----------------------------------------------------------------------------
async function ensureFolders() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(OPTIMIZED_DIR, { recursive: true });
}
ensureFolders().catch(err => logger.error(`Folder init error: ${err}`));

// -----------------------------------------------------------------------------
// Multer – temporary storage in /uploads
// -----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniq = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const safeName = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, '_');
    cb(null, `${safeName}-${uniq}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    files: MAX_FILES,
    fileSize: MAX_TOTAL_SIZE, // per‑file limit – total size checked later
  },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpe?g|png)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only .jpg, .jpeg and .png files are allowed'));
    }
  },
}).array('images', MAX_FILES); // field name = images

// -----------------------------------------------------------------------------
// Express app setup
// -----------------------------------------------------------------------------
const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://cdn.tailwindcss.com',
          'https://static.cloudflareinsights.com',
          "'unsafe-inline'",
        ],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'https:', 'data:'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// Helper – safely delete a file (ignore ENOENT)
// -----------------------------------------------------------------------------
async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      logger.warn(`Failed to delete ${filePath}: ${e.message}`);
    }
  }
}

// -----------------------------------------------------------------------------
// Route – POST /upload
// -----------------------------------------------------------------------------
app.post('/upload', (req, res) => {
  upload(req, res, async err => {
    if (err) {
      logger.warn(`Upload error: ${err.message}`);
      return res.status(400).json({ error: err.message });
    }

    // Total size validation (combined size of all files)
    const totalSize = req.files.reduce((acc, f) => acc + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      await Promise.all(req.files.map(f => safeUnlink(f.path)));
      return res
        .status(400)
        .json({ error: 'Total upload size exceeds 100 MiB' });
    }

    try {
      // Run optimisation
      const processed = await processFiles(req.files, {
        outDir: OPTIMIZED_DIR,
        concurrency: 6,
      });

      // If multiple files, bundle them into a ZIP archive
      let zipInfo = null;
      if (processed.length > 1) {
        const zipName = await createZip(
          processed.map(p => p.optimizedPath)
        );
        zipInfo = { url: `/download/${zipName}` };
      }

      // Build response payload
      const payload = {
        files: processed.map(p => ({
          originalName: p.originalName,
          optimizedName: path.basename(p.optimizedPath),
          downloadUrl: `/download/${path.basename(p.optimizedPath)}`,
          uploadUrl: `/upload/${path.basename(p.filename)}`,
          sizeBefore: p.sizeBefore,
          sizeAfter: p.sizeAfter,
        })),
        zip: zipInfo,
      };

      res.json(payload);
    } catch (procErr) {
      logger.error(`Processing error: ${procErr.message}`);
      await Promise.all(req.files.map(f => safeUnlink(f.path)));
      res.status(500).json({ error: 'Failed to process images' });
    }
  });
});

// -----------------------------------------------------------------------------
// Route – GET /download/:filename  (optimized images or ZIP)
// -----------------------------------------------------------------------------
app.get('/download/:filename', async (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(OPTIMIZED_DIR, safeName);

  if (!filePath.startsWith(OPTIMIZED_DIR)) {
    return res.status(400).send('Invalid file request');
  }

  try {
    await fs.access(filePath);
    res.download(filePath, safeName, err => {
      if (err) logger.warn(`Download error: ${err.message}`);
    });
  } catch {
    res.status(404).send('File not found');
  }
});

// -----------------------------------------------------------------------------
// Route – GET /upload/:filename  (original uploaded file)
// -----------------------------------------------------------------------------
app.get('/upload/:filename', async (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeName);

  if (!filePath.startsWith(UPLOAD_DIR)) {
    return res.status(400).send('Invalid file request');
  }

  try {
    await fs.access(filePath);
    res.download(filePath, safeName, err => {
      if (err) logger.warn(`Download error: ${err.message}`);
    });
  } catch {
    res.status(404).send('File not found');
  }
});

// -----------------------------------------------------------------------------
// Cleanup job – runs every minute, removes files older than CLEANUP_AFTER_MS
// -----------------------------------------------------------------------------

if (CLEANUP_ENABLED) {
  logger.info('Cleanup job is enabled');

  cron.schedule('* * * * *', async () => {
    const now = Date.now();

    async function cleanFolder(folder) {
      try {
        const entries = await fs.readdir(folder, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const filePath = path.join(folder, entry.name);
          const stats = await fs.stat(filePath);
          if (now - stats.mtimeMs > CLEANUP_AFTER_MS) {
            await safeUnlink(filePath);
            logger.info(`Cleaned up ${filePath}`);
          }
        }
      } catch (e) {
        logger.warn(`Cleanup error for ${folder}: ${e.message}`);
      }
    }

    await Promise.all([cleanFolder(UPLOAD_DIR), cleanFolder(OPTIMIZED_DIR)]);
  });
} else {
  logger.info('Cleanup job is disabled');
}

// -----------------------------------------------------------------------------
// Global error handler (fallback)
// -----------------------------------------------------------------------------
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// -----------------------------------------------------------------------------
// Start HTTP & HTTPS servers
// -----------------------------------------------------------------------------
const httpServer = http.createServer(app);
const httpsServer = https.createServer(
  {
    // Uncomment & set paths when you have SSL certificates
    // key: fs.readFileSync('/path/to/privkey.pem'),
    // cert: fs.readFileSync('/path/to/fullchain.pem'),
  },
  app
);

httpServer.listen(PORT, () => {
  logger.info(`🚀 HTTP server listening on http://localhost:${PORT}`);
});

httpsServer.listen(PORT_SSL, () => {
  logger.info(`🚀 HTTPS server listening on https://localhost:${PORT_SSL}`);
});