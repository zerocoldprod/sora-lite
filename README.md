# Sora Lite : Image‑Compress‑WebApp

A tiny, production‑ready image‑compression service (inspired by Squoosh.app) that
processes JPEGs with **mozjpeg** and PNGs with **pngquant** on the server side.

## Features

- Drag‑and‑drop / multi‑file selector (max 20 files, ≤ 100 MiB total)
- Server‑side compression  
  * JPEG – quality 75, progressive, chroma subsampling 4:2:0  
  * PNG – quality [0.6, 0.8]
- Concurrency limit of 6 files while processing
- Individual download links **or** a single ZIP archive for all files
- Automatic cleanup of temporary files after 5 minutes
- Responsive UI built with Tailwind CSS
- Basic security headers (Helmet) and request logging (Winston)

## Prerequisites

- **Node.js** ≥ 18 (LTS)
- npm (bundled with Node)

## Installation

```bash
git clone <repo‑url>
cd sora-lite
npm install
npm start