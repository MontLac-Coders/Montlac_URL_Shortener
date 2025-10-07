import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

// Create a new PostgreSQL pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
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
    process.exit(1); // Exit if we can't connect to the DB
  }
};
createTable();

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- API ROUTES ---

app.post('/shorten', async (req, res, next) => {
  const { url, slug } = req.body;

  // --- Improved Validation ---
  if (!url || !slug) {
    const error = new Error('URL and custom slug are both required.');
    error.statusCode = 400;
    return next(error);
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (_) {
    const error = new Error('Please provide a valid URL (e.g., include https://).');
    error.statusCode = 400;
    return next(error);
  }

  // Validate slug format (e.g., no spaces or special characters)
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    const error = new Error('Custom slug can only contain letters, numbers, hyphens (-), and underscores (_).');
    error.statusCode = 400;
    return next(error);
  }
  // --- End Validation ---

  try {
    const insertQuery = 'INSERT INTO urls (slug, long_url) VALUES ($1, $2)';
    await pool.query(insertQuery, [slug, url]);
    
    const shortUrl = `${req.protocol}://${req.get('host')}/${slug}`;
    res.status(201).json({ shortUrl });

  } catch (err) {
    if (err.code === '23505') {
      err.message = 'This custom slug is already in use. Please choose another.';
      err.statusCode = 409; // 409 Conflict is more specific
    }
    next(err); // Pass all other errors to the central handler
  }
});

app.get('/:slug', async (req, res, next) => {
  const { slug } = req.params;
  const selectQuery = 'SELECT long_url FROM urls WHERE slug = $1';
  
  try {
    const result = await pool.query(selectQuery, [slug]);

    if (result.rows.length > 0) {
      return res.redirect(result.rows[0].long_url);
    } else {
      const error = new Error('Short URL not found.');
      error.statusCode = 404;
      return next(error);
    }
  } catch (err) {
    next(err);
  }
});


// --- ERROR HANDLING MIDDLEWARE ---

// Handler for 404 Not Found requests (must be after all routes)
app.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Centralized Error Handling Middleware (must be the last app.use() call)
const errorHandler = (err, req, res, next) => {
  console.error(err); // Log the full error for debugging

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    status: 'error',
    // Send the specific message from our validation or a generic one
    message: err.message || 'An unexpected internal server error occurred.'
  });
};

app.use(errorHandler);


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});