import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Route modules (each default-exports an Express router). Created by Wave 1 agents:
//   pipeline.js  - capture (/jd-capture, /api/ingest), inbox list, score, apply, applied
//   resume.js / cover-letter.js / persona.js / ats-swap.js - prep + editor
//   status.js    - /api/scan-inbox (confirmation/rejection/interview), oauth handshake
//   discover.js  - /api/discover (on-demand curated remote sources)
import pipelineRoutes from './routes/pipeline.js';
import resumeRoutes from './routes/resume.js';
import coverLetterRoutes from './routes/cover-letter.js';
import personaRoutes from './routes/persona.js';
import atsSwapRoutes from './routes/ats-swap.js';
import statusRoutes from './routes/status.js';
import discoverRoutes from './routes/discover.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', 'web');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Static UI + bookmarklet
app.use(express.static(WEB_DIR));
app.get('/bookmarklet/install', (_req, res) => res.sendFile(join(WEB_DIR, 'bookmarklet', 'install.html')));
app.get('/bookmarklet/proxy', (_req, res) => res.sendFile(join(WEB_DIR, 'bookmarklet', 'proxy.html')));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(pipelineRoutes);
app.use(resumeRoutes);
app.use(coverLetterRoutes);
app.use(personaRoutes);
app.use(atsSwapRoutes);
app.use(statusRoutes);
app.use(discoverRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  process.stderr.write(`[error] ${err.stack || err.message}\n`);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  process.stdout.write(`JobBuddy on http://localhost:${PORT}\n`);
});
