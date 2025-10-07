import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;
const db = new Database('urls.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    long_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/shorten', (req, res) => {
  const { url, slug } = req.body;

  if (!url || !slug) {
    return res.status(400).json({ error: 'URL and slug are required' });
  }

  try {
    const stmt = db.prepare('INSERT INTO urls (slug, long_url) VALUES (?, ?)');
    stmt.run(slug, url);
    const shortUrl = `${req.protocol}://${req.get('host')}/${slug}`;
    res.json({ shortUrl });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Custom slug is already in use' });
    }
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/:slug', (req, res) => {
  const { slug } = req.params;
  const stmt = db.prepare('SELECT long_url FROM urls WHERE slug = ?');
  const result = stmt.get(slug);

  if (result) {
    res.redirect(result.long_url);
  } else {
    res.status(404).send('URL not found');
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});