// server.js - Main Express server for Patreon OAuth
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: ['https://api2.sketchshaper.com', 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

// Configuration
const PATREON_CONFIG = {
  clientId: process.env.PATREON_CLIENT_ID,
  clientSecret: process.env.PATREON_CLIENT_SECRET,
  redirectUri: process.env.PATREON_REDIRECT_URI || 'https://api2.sketchshaper.com/callback',
  baseUrl: process.env.BASE_URL || 'https://api2.sketchshaper.com'
};

// Session storage directory
const SESSIONS_DIR = process.env.SESSIONS_DIR || '/tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// Ensure sessions directory exists
async function ensureSessionsDir() {
  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    console.log(`Sessions directory ready: ${SESSIONS_DIR}`);
  } catch (error) {
    console.error('Failed to create sessions directory:', error);
  }
}

// Generate secure state parameter
function generateState() {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const timestamp = Date.now();
  return `${randomBytes}_${timestamp}`;
}

// Save session data
async function saveSession(state, data) {
  try {
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    const sessionData = {
      ...data,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TIMEOUT
    };
    await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
    console.log(`Session saved: ${state}`);
  } catch (error) {
    console.error('Failed to save session:', error);
  }
}

// Load session data
async function loadSession(state) {
  try {
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    const data = await fs.readFile(sessionFile, 'utf8');
    const session = JSON.parse(data);
    
    // Check if session expired
    if (Date.now() > session.expiresAt) {
      await deleteSession(state);
      return null;
    }
    
    return session;
  } catch (error) {
    console.log(`Session not found or invalid: ${state}`);
    return null;
  }
}

// Update session data
async function updateSession(state, updates) {
  try {
    const session = await loadSession(state);
    if (!session) return false;
    
    const updatedSession = { ...session, ...updates };
    await saveSession(state, updatedSession);
    return true;
  } catch (error) {
    console.error('Failed to update session:', error);
    return false;
  }
}

// Delete session
async function deleteSession(state) {
  try {
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    await fs.unlink(sessionFile);
    console.log(`Session deleted: ${state}`);
  } catch (error) {
    // File might not exist, which is fine
  }
}

// Clean up expired sessions
async function cleanupExpiredSessions() {
  try {
    const files = await fs.readdir(SESSIONS_DIR);
    const now = Date.now();
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const sessionFile = path.join(SESSIONS_DIR, file);
      const data = await fs.readFile(sessionFile, 'utf8');
      const session = JSON.parse(data);
      
      if (now > session.expiresAt) {
        await fs.unlink(sessionFile);
        console.log(`Cleaned up expired session: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
  }
}

// Exchange authorization code for access token
async function exchangeCodeForToken(code, state) {
  try {
    const response = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SketchShaper-Server/1.0'
      },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        client_id: PATREON_CONFIG.clientId,
        client_secret: PATREON_CONFIG.clientSecret,
        redirect_uri: PATREON_CONFIG.redirectUri
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed:', response.status, errorText);
      return null;
    }

    const tokenData = await response.json();
    console.log('Token exchange successful');
    return tokenData;
  } catch (error) {
    console.error('Token exchange error:', error);
    return null;
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Start OAuth flow - NOW ACCEPTS STATE FROM EXTENSION
app.get('/auth', async (req, res) => {
  try {
    // Use state from query parameter if provided (from extension), otherwise generate new one
    const state = req.query.state || generateState();
    
    // Save initial session with the state
    await saveSession(state, {
      status: 'pending',
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      extensionInitiated: !!req.query.state // Track if extension initiated
    });

    // Build Patreon OAuth URL
    const authUrl = new URL('https://www.patreon.com/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', PATREON_CONFIG.clientId);
    authUrl.searchParams.set('redirect_uri', PATREON_CONFIG.redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'identity identity.memberships');

    console.log(`Starting OAuth flow for state: ${state} (Extension: ${!!req.query.state})`);
    res.redirect(authUrl.toString());
    
  } catch (error) {
    console.error('Auth initiation error:', error);
    res.status(500).json({ error: 'Failed to start authentication' });
  }
});

// OAuth callback handler
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  console.log(`OAuth callback received - State: ${state}, Error: ${error}`);

  if (error) {
    console.error('OAuth error:', error);
    if (state) {
      await updateSession(state, {
        status: 'error',
        error: error,
        completedAt: Date.now()
      });
    }
    return res.send(getCallbackHtml('error', `Authentication failed: ${error}`));
  }

  if (!code || !state) {
    console.error('Missing code or state in callback');
    if (state) {
      await updateSession(state, {
        status: 'error',
        error: 'Missing authorization code',
        completedAt: Date.now()
      });
    }
    return res.send(getCallbackHtml('error', 'Invalid callback parameters'));
  }

  try {
    // Exchange code for tokens
    const tokenData = await exchangeCodeForToken(code, state);
    
    if (!tokenData) {
      await updateSession(state, {
        status: 'error',
        error: 'Token exchange failed',
        completedAt: Date.now()
      });
      return res.send(getCallbackHtml('error', 'Failed to exchange authorization code'));
    }

    // Update session with token data
    await updateSession(state, {
      status: 'completed',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      completedAt: Date.now()
    });

    console.log(`Authentication completed for state: ${state}`);
    res.send(getCallbackHtml('success', 'Authentication successful! You can close this window.'));

  } catch (error) {
    console.error('Callback processing error:', error);
    await updateSession(state, {
      status: 'error',
      error: error.message,
      completedAt: Date.now()
    });
    res.send(getCallbackHtml('error', 'Authentication processing failed'));
  }
});

// Check authentication status
app.get('/auth-status', async (req, res) => {
  const { state } = req.query;

  if (!state) {
    return res.status(400).json({ 
      status: 'error', 
      error: 'Missing state parameter' 
    });
  }

  try {
    const session = await loadSession(state);
    
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
});

// Get recent sessions (for extension to find lost state)
app.get('/recent-sessions', async (req, res) => {
  try {
    const files = await fs.readdir(SESSIONS_DIR);
    const recentSessions = [];
    const cutoffTime = Date.now() - (5 * 60 * 1000); // Last 5 minutes
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const sessionFile = path.join(SESSIONS_DIR, file);
      const stat = await fs.stat(sessionFile);
      
      if (stat.mtime.getTime() > cutoffTime) {
        const data = await fs.readFile(sessionFile, 'utf8');
        const session = JSON.parse(data);
        const state = file.replace('.json', '');
        
        recentSessions.push({
          state,
          status: session.status,
          createdAt: session.createdAt,
          extensionInitiated: session.extensionInitiated
        });
      }
    }
    
    // Sort by creation time, most recent first
    recentSessions.sort((a, b) => b.createdAt - a.createdAt);
    
    res.json(recentSessions);
    
  } catch (error) {
    console.error('Error getting recent sessions:', error);
    res.status(500).json({ error: 'Failed to get recent sessions' });
  }
});

// Refresh token endpoint
app.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: 'Missing refresh token' });
  }

  try {
    const response = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SketchShaper-Server/1.0'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
        client_id: PATREON_CONFIG.clientId,
        client_secret: PATREON_CONFIG.clientSecret
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token refresh failed:', response.status, errorText);
      return res.status(response.status).json({ error: 'Token refresh failed' });
    }

    const tokenData = await response.json();
    res.json(tokenData);

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Generate callback HTML
function getCallbackHtml(status, message) {
  const isSuccess = status === 'success';
  const bgColor = isSuccess ? '#f0f9ff' : '#fef2f2';
  const textColor = isSuccess ? '#1e40af' : '#dc2626';
  const icon = isSuccess ? '✅' : '❌';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>SketchShaper Authentication</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: ${bgColor};
          margin: 0;
          padding: 40px 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .container {
          background: white;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          text-align: center;
          max-width: 500px;
          width: 100%;
        }
        .icon {
          font-size: 48px;
          margin-bottom: 20px;
        }
        h1 {
          color: ${textColor};
          margin: 0 0 15px 0;
          font-size: 24px;
        }
        p {
          color: #6b7280;
          margin: 0 0 30px 0;
          font-size: 16px;
          line-height: 1.5;
        }
        .btn {
          background: ${textColor};
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .btn:hover {
          opacity: 0.9;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${icon}</div>
        <h1>${isSuccess ? 'Authentication Successful!' : 'Authentication Failed'}</h1>
        <p>${message}</p>
        <button class="btn" onclick="window.close()">Close Window</button>
      </div>
      <script>
        // Auto-close after 5 seconds
        setTimeout(() => {
          window.close();
        }, 5000);
      </script>
    </body>
    </html>
  `;
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// Cleanup expired sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// Initialize and start server
async function startServer() {
  try {
    // Validate configuration
    if (!PATREON_CONFIG.clientId || !PATREON_CONFIG.clientSecret) {
      throw new Error('Missing required Patreon OAuth credentials');
    }

    // Ensure sessions directory exists
    await ensureSessionsDir();

    // Clean up any existing expired sessions
    await cleanupExpiredSessions();

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Patreon Auth Server running on port ${PORT}`);
      console.log(`🔗 Auth URL: ${PATREON_CONFIG.baseUrl}/auth`);
      console.log(`📝 Callback URL: ${PATREON_CONFIG.redirectUri}`);
      console.log(`📁 Sessions Directory: ${SESSIONS_DIR}`);
      console.log(`⏰ Session Timeout: ${SESSION_TIMEOUT / 1000 / 60} minutes`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
