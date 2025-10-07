import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Parse JSON
app.use(bodyParser.json());

// Serve the static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Init SQLite DB
const db = new Database('database.db');
db.prepare(`
  CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    original_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// API: shorten URL
app.post('/shorten', (req, res) => {
  const { url, slug } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Malformed URL' });
  }

  // Ensure slug is provided and valid
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Slug must be alphanumeric, dashes or underscores only' });
  }

  // Check uniqueness
  const exists = db.prepare('SELECT 1 FROM urls WHERE slug = ?').get(slug);
  if (exists) {
    return res.status(409).json({ error: 'Slug already taken, choose another one' });
  }

  // Insert
  try {
    db.prepare('INSERT INTO urls (slug, original_url) VALUES (?, ?)').run(slug, url);
    return res.json({ shortUrl: `${req.protocol}://${req.get('host')}/${slug}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Redirect handler
app.get('/:slug', (req, res) => {
  const { slug } = req.params;
  const row = db.prepare('SELECT original_url FROM urls WHERE slug = ?').get(slug);
  if (row) {
    res.redirect(row.original_url);
  } else {
    res.status(404).send('Link not found');
  }
});

// Start
app.listen(port, () => {
  console.log(`Montlac running on port ${port}`);
});
