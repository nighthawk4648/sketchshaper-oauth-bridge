// api/auth-status.js
const cors = require('cors');
const SessionManager = require('../lib/sessionManager');

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

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { state } = req.query;

    if (!state) {
      return res.status(400).json({ 
        status: 'error', 
        error: 'Missing state parameter' 
      });
    }

    const session = await SessionManager.loadSession(state);
    
    if (!session) {
      return res.status(404).json({ 
        status: 'error', 
        error: 'Session not found or expired' 
      });
    }

    // Return session status
    const response = {
      status: session.status,
      timestamp: new Date().toISOString()
    };

    // Include token data if completed
    if (session.status === 'completed' && session.access_token) {
      response.access_token = session.access_token;
      response.refresh_token = session.refresh_token;
      response.expires_in = session.expires_in;
      response.token_type = session.token_type;
    }

    // Include error if failed
    if (session.status === 'error') {
      response.error = session.error;
    }

    res.json(response);

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ 
      status: 'error', 
      error: 'Failed to check authentication status' 
    });
  }
};