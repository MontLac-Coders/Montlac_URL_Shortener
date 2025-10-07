import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

// Create a new PostgreSQL pool to connect to the database.
// This reads the DATABASE_URL environment variable automatically.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// This function runs on startup to ensure our database tables are ready.
const setupDatabase = async () => {
  const createUrlsTableQuery = `
    CREATE TABLE IF NOT EXISTS urls (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      long_url TEXT NOT NULL,
      clicks BIGINT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  
  // This query adds the 'clicks' column if it doesn't exist, for backward compatibility.
  const addClicksColumnQuery = `
    ALTER TABLE urls ADD COLUMN IF NOT EXISTS clicks BIGINT DEFAULT 0;
  `;

  const createClicksTableQuery = `
    CREATE TABLE IF NOT EXISTS clicks (
      id SERIAL PRIMARY KEY,
      url_id INTEGER REFERENCES urls(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT
    )
  `;

  try {
    await pool.query(createUrlsTableQuery);
    await pool.query(addClicksColumnQuery);
    await pool.query(createClicksTableQuery);
    console.log('Database tables are set up and ready.');
  } catch (err) {
    console.error('Fatal error setting up database tables:', err);
    // If the database can't be set up, the app can't run.
    process.exit(1);
  }
};

// Run the database setup when the application starts.
setupDatabase();

// --- MIDDLEWARE SETUP ---
// Serve static files (like index.html and stats.html) from the 'public' directory.
app.use(express.static('public'));
// Parse JSON request bodies.
app.use(bodyParser.json());
// Parse URL-encoded request bodies.
app.use(bodyParser.urlencoded({ extended: true }));
// Trust the proxy to get the real IP address for analytics.
app.set('trust proxy', true);


// --- API ROUTES ---

// Route to create a new shortened URL.
app.post('/shorten', async (req, res, next) => {
  const { url, slug } = req.body;

  // Validation for user input.
  if (!url || !slug) {
    const error = new Error('URL and custom slug are both required.');
    error.statusCode = 400;
    return next(error);
  }
  try {
    new URL(url);
  } catch (_) {
    const error = new Error('Please provide a valid URL (e.g., include https://).');
    error.statusCode = 400;
    return next(error);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    const error = new Error('Custom slug can only contain letters, numbers, hyphens (-), and underscores (_).');
    error.statusCode = 400;
    return next(error);
  }

  try {
    const insertQuery = 'INSERT INTO urls (slug, long_url) VALUES ($1, $2)';
    await pool.query(insertQuery, [slug, url]);
    
    const shortUrl = `${req.protocol}://${req.get('host')}/${slug}`;
    res.status(201).json({ shortUrl });

  } catch (err) {
    // Handle the case where the slug is already taken.
    if (err.code === '23505') {
      err.message = 'This custom slug is already in use. Please choose another.';
      err.statusCode = 409; // 409 Conflict
    }
    next(err); // Pass all other errors to the central handler.
  }
});

// The main redirect route. This also handles analytics logging.
app.get('/:slug', async (req, res, next) => {
  const { slug } = req.params;
  
  try {
    const selectQuery = 'SELECT id, long_url FROM urls WHERE slug = $1';
    const result = await pool.query(selectQuery, [slug]);

    if (result.rows.length > 0) {
      const urlData = result.rows[0];
      
      // 1. Redirect the user immediately for the best user experience.
      res.redirect(urlData.long_url);

      // 2. In the background, log the analytics data.
      const ip = req.ip;
      const userAgent = req.headers['user-agent'];

      const insertClickQuery = `INSERT INTO clicks (url_id, ip_address, user_agent) VALUES ($1, $2, $3)`;
      const updateClickCountQuery = 'UPDATE urls SET clicks = clicks + 1 WHERE id = $1';

      // Run both logging queries. We don't wait for them to finish.
      // If they fail, it won't affect the user, but we log the error.
      Promise.all([
        pool.query(insertClickQuery, [urlData.id, ip, userAgent]),
        pool.query(updateClickCountQuery, [urlData.id])
      ]).catch(err => {
        console.error(`Failed to log analytics for slug: ${slug}`, err);
      });

    } else {
      const error = new Error('Short URL not found.');
      error.statusCode = 404;
      return next(error);
    }
  } catch (err) {
    next(err);
  }
});

// API endpoint to fetch statistics for a given slug.
app.get('/stats/:slug', async (req, res, next) => {
  const { slug } = req.params;

  try {
    // Get summary info (total clicks, original URL)
    const urlInfoQuery = 'SELECT id, long_url, clicks, created_at FROM urls WHERE slug = $1';
    const urlResult = await pool.query(urlInfoQuery, [slug]);

    if (urlResult.rows.length === 0) {
      const error = new Error('Stats for this slug not found.');
      error.statusCode = 404;
      return next(error);
    }
    const urlInfo = urlResult.rows[0];

    // Get the 20 most recent clicks for the detail view
    const recentClicksQuery = `
      SELECT created_at, user_agent 
      FROM clicks 
      WHERE url_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `;
    const recentClicksResult = await pool.query(recentClicksQuery, [urlInfo.id]);

    // Send all the data as a single JSON response
    res.json({
      urlInfo: urlInfo,
      recentClicks: recentClicksResult.rows
    });

  } catch (err) {
    next(err);
  }
});


// --- ERROR HANDLING MIDDLEWARE ---

// Catch-all for 404 Not Found requests. Must be after all other routes.
app.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Centralized error handler. Must be the last 'app.use()' in the file.
const errorHandler = (err, req, res, next) => {
  console.error(err); // Log the full error to the console for debugging.

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'An unexpected internal server error occurred.'
  });
};
app.use(errorHandler);


// --- SERVER START ---
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});