// api/health.js - Health check endpoint
const cors = require('cors');
const SessionManager = require('../lib/sessionManager');

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

    // Check if required environment variables are present
    const requiredEnvVars = ['PATREON_CLIENT_ID', 'PATREON_CLIENT_SECRET'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      version: '1.0.0',
      platform: 'vercel',
      sessionCount: SessionManager.getSessionCount(),
      config: {
        hasClientId: !!process.env.PATREON_CLIENT_ID,
        hasClientSecret: !!process.env.PATREON_CLIENT_SECRET,
        redirectUri: process.env.PATREON_REDIRECT_URI || 'not-set',
        baseUrl: process.env.BASE_URL || 'not-set'
      }
    };

    // Add warnings if configuration is incomplete
    if (missingEnvVars.length > 0) {
      health.status = 'warning';
      health.warnings = [`Missing environment variables: ${missingEnvVars.join(', ')}`];
    }

    res.json(health);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'error', 
      error: 'Failed to perform health check',
      timestamp: new Date().toISOString()
    });
  }
};