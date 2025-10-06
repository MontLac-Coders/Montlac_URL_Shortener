// index.js — simple persistent shortener (Node + SQLite)
import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const app = express();
app.use(bodyParser.json());

// Initialize SQLite DB
const db = new Database('links.db');
db.prepare(`
  CREATE TABLE IF NOT EXISTS links (
    code TEXT PRIMARY KEY,
    url TEXT NOT NULL
  )
`).run();

// Create short link
app.post('/shorten', (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  const code = crypto.randomBytes(4).toString('hex');
  db.prepare('INSERT INTO links (code, url) VALUES (?, ?)').run(code, url);
  res.json({ shortUrl: `${req.protocol}://${req.get('host')}/${code}` });
});

// Redirect short link
app.get('/:code', (req, res) => {
  const row = db.prepare('SELECT url FROM links WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).send('Not found');
  res.redirect(301, row.url);
});

// Root for sanity check
app.get('/', (req, res) => res.send('URL shortener is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Shortener running on ${PORT}`));
