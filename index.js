import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg'; // Import the pg library
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

// Create a new PostgreSQL pool.
// Render provides the DATABASE_URL environment variable automatically.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Render requires SSL for external connections
  ssl: {
    rejectUnauthorized: false
  }
});

// Function to create the table if it doesn't exist on startup
const createTable = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS urls (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      long_url TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  try {
    await pool.query(createTableQuery);
    console.log('Table "urls" is ready.');
  } catch (err) {
    console.error('Error creating table:', err);
  }
};

// Run the table creation on app start
createTable();


app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/shorten', async (req, res) => {
  const { url, slug } = req.body;

  if (!url || !slug) {
    return res.status(400).json({ error: 'URL and slug are required' });
  }

  try {
    // PostgreSQL uses $1, $2 for parameterized queries
    const insertQuery = 'INSERT INTO urls (slug, long_url) VALUES ($1, $2)';
    await pool.query(insertQuery, [slug, url]);
    
    const shortUrl = `${req.protocol}://${req.get('host')}/${slug}`;
    res.status(201).json({ shortUrl });

  } catch (err) {
    // Check for unique constraint violation (PostgreSQL error code)
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Custom slug is already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  const selectQuery = 'SELECT long_url FROM urls WHERE slug = $1';
  
  try {
    const result = await pool.query(selectQuery, [slug]);

    if (result.rows.length > 0) {
      res.redirect(result.rows[0].long_url);
    } else {
      res.status(404).send('URL not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});