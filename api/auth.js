// api/auth.js - Start OAuth flow
const cors = require('cors');
const SessionManager = require('../lib/sessionManager');
const PatreonClient = require('../lib/patreonClient');

// CORS configuration
const corsOptions = {
  origin: ['https://api2.sketchshaper.com', 'http://localhost:3000', 'https://localhost:3000'],
  credentials: true,
  methods: ['GET', 'OPTIONS'],
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

    // Only allow GET requests
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Generate state and create session
    const state = SessionManager.generateState();
    
    // Save initial session
    await SessionManager.saveSession(state, {
      status: 'pending',
      userAgent: req.headers['user-agent'],
      ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress
    });

    // Create Patreon client and build auth URL
    const patreonClient = new PatreonClient();
    const authUrl = patreonClient.buildAuthUrl(state);

    console.log(`Starting OAuth flow for state: ${state}`);
    
    // Redirect to Patreon
    res.writeHead(302, { Location: authUrl });
    res.end();
    
  } catch (error) {
    console.error('Auth initiation error:', error);
    res.status(500).json({ 
      error: 'Failed to start authentication',
      timestamp: new Date().toISOString()
    });
  }
};