/**
 * utils/processor.js
 *
 * Core image‑processing logic.
 *   • Reads uploaded files,
 *   • Optimises JPEG (mozjpeg) or PNG (pngquant) using imagemin,
 *   • Writes the optimized version to the output folder,
 *   • Returns useful metadata for the caller.
 *
 * Concurrency is limited via p‑limit (default 6 workers).
 */

const path = require('path');
const fs = require('fs').promises;
const pLimit = require('p-limit').default;
const imagemin = require('imagemin').default;
const imageminMozjpeg = require('imagemin-mozjpeg').default;
const imageminPngquant = require('imagemin-pngquant').default;
const archiver = require('archiver');
const crypto = require('crypto');

/**
 * Optimise a single image file.
 *
 * @param {Object} file   Multer file object – { path, originalname }
 * @param {string} outDir Destination directory for the optimized file
 * @returns {Promise<Object>} Metadata about the optimisation
 */
async function optimiseFile(file, outDir) {
  const buffer = await fs.readFile(file.path);
  const ext = path.extname(file.originalname).toLowerCase();
  const plugins = [];

  if (ext === '.png') {
    plugins.push(imageminPngquant({ quality: [0.6, 0.8] }));
  } else if (ext === '.jpg' || ext === '.jpeg') {
    plugins.push(
      imageminMozjpeg({
        quality: 75,
        // progressive: true,
        // chromaSubsampling: '4:2:0',
      })
    );
  } else {
    throw new Error('Unsupported file type');
  }

  const optimizedBuffer = await imagemin.buffer(buffer, { plugins });

  const optimizedName = `${path.basename(file.originalname, ext)}-opt${ext}`;
  const optimizedPath = path.join(outDir, optimizedName);
  await fs.writeFile(optimizedPath, optimizedBuffer);

  return {
    filename: file.filename,
    originalName: file.originalname,
    optimizedPath,
    sizeBefore: buffer.length,
    sizeAfter: optimizedBuffer.length,
  };
}

/**
 * Process an array of Multer files with a concurrency limit.
 *
 * @param {Array<Object>} files   Multer file objects
 * @param {Object} options
 * @param {string} options.outDir Destination folder
 * @param {number} [options.concurrency=6] Max parallel jobs
 * @returns {Promise<Array<Object>>} Array of file‑metadata objects
 */
async function processFiles(files, { outDir, concurrency = 6 }) {
  const limit = pLimit(concurrency);
  const jobs = files.map(f => limit(() => optimiseFile(f, outDir)));
  return Promise.all(jobs);
}

/**
 * Create a ZIP archive containing a list of file paths.
 *
 * @param {Array<string>} filePaths Full paths to the files to zip
 * @returns {Promise<string>} Name of the generated ZIP (saved in the optimized folder)
 */
async function createZip(filePaths) {
  const zipName = `bundle-${crypto.randomBytes(8).toString('hex')}.zip`;
  const zipPath = path.join(__dirname, '..', 'optimized', zipName);

  const output = await fs.open(zipPath, 'w');
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    const stream = output.createWriteStream();

    stream.on('close', () => resolve(zipName));
    archive.on('error', err => reject(err));

    archive.pipe(stream);
    filePaths.forEach(fp => {
      const nameInZip = path.basename(fp);
      archive.file(fp, { name: nameInZip });
    });
    archive.finalize();
  });
}

module.exports = {
  processFiles,
  createZip,
};