// index.js — URL shortener + basic UI
import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQLite setup
const db = new Database('links.db');
db.prepare('CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, url TEXT NOT NULL)').run();

// API — shorten
app.post('/shorten', (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  const code = crypto.randomBytes(4).toString('hex');
  db.prepare('INSERT INTO links (code, url) VALUES (?, ?)').run(code, url);
  res.json({ shortUrl: `${req.protocol}://${req.get('host')}/${code}` });
});

// Redirect
app.get('/:code', (req, res) => {
  const row = db.prepare('SELECT url FROM links WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).send('Not found');
  res.redirect(301, row.url);
});

// Home page (UI)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Shortener running on port ${PORT}`));
