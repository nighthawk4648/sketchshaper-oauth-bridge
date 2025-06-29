// api/refresh.js - Refresh access token
const cors = require('cors');
const PatreonClient = require('../lib/patreonClient');

// CORS configuration
const corsOptions = {
  origin: ['https://api2.sketchshaper.com', 'http://localhost:3000', 'https://localhost:3000'],
  credentials: true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = async (req, res) => {
  try {
    // Apply CORS
    await new Promise((resolve, reject) => {
      cors(corsOptions)(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    await new Promise(resolve => {
      req.on('end', resolve);
    });

    let requestData;
    try {
      requestData = JSON.parse(body);
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Invalid JSON in request body',
        timestamp: new Date().toISOString()
      });
    }

    const { refresh_token } = requestData;

    if (!refresh_token) {
      return res.status(400).json({ 
        error: 'Missing refresh token',
        timestamp: new Date().toISOString()
      });
    }

    try {
      // Refresh the token
      const patreonClient = new PatreonClient();
      const tokenData = await patreonClient.refreshToken(refresh_token);
      
      // Return new token data
      res.json({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type,
        timestamp: new Date().toISOString()
      });

    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError);
      res.status(400).json({ 
        error: 'Token refresh failed',
        details: refreshError.message,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ 
      error: 'Token refresh failed',
      timestamp: new Date().toISOString()
    });
  }
};