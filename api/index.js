// api/index.js - Main API handler for Vercel
const cors = require('cors');

// CORS configuration
const corsOptions = {
  origin: ['https://api2.sketchshaper.com', 'http://localhost:3000', 'https://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Apply CORS middleware
function applyCors(req, res) {
  return new Promise((resolve, reject) => {
    cors(corsOptions)(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Main handler
module.exports = async (req, res) => {
  try {
    // Apply CORS
    await applyCors(req, res);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Route to appropriate handler based on URL
    const { url } = req;
    
    if (url === '/health' || url === '/api/health') {
      return handleHealth(req, res);
    }
    
    // For other routes, return 404
    return res.status(404).json({
      error: 'Endpoint not found',
      path: url,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
};

function handleHealth(req, res) {
  return res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    version: '1.0.0'
  });
}