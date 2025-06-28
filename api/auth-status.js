// api/auth-status.js - Simple version using global state with proper initialization
import fs from 'fs';
import path from 'path';

// Use a temporary directory for session storage
const SESSIONS_DIR = '/tmp/auth_sessions';

// Ensure the sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { state } = req.query;
    
    if (!state) {
      return res.status(400).json({ error: 'State parameter required' });
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);

    // Check if session file exists
    if (!fs.existsSync(sessionFile)) {
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }

    // Read session data
    const sessionData = fs.readFileSync(sessionFile, 'utf8');
    const session = JSON.parse(sessionData);

    // Check if session has expired (5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    if (session.timestamp < fiveMinutesAgo) {
      fs.unlinkSync(sessionFile); // Delete expired session
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    // Prepare response
    const response = {
      status: session.status,
      timestamp: session.timestamp
    };

    if (session.status === 'completed') {
      // Include tokens if server handled the exchange
      if (session.access_token) {
        response.access_token = session.access_token;
        response.refresh_token = session.refresh_token;
        response.expires_in = session.expires_in;
        response.token_type = session.token_type;
      } else {
        // Include auth code for client-side exchange
        response.code = session.code;
      }
      response.state = state;
      
      // Clean up the session after successful retrieval
      fs.unlinkSync(sessionFile);
      
    } else if (session.status === 'error') {
      response.error = session.error;
      // Clean up error sessions too
      fs.unlinkSync(sessionFile);
    }

    console.log('Auth status checked for state:', state, 'Status:', session.status);
    return res.status(200).json(response);

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error' 
    });
  }
}

// Cleanup function to remove old session files (run periodically)
function cleanupOldSessions() {
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    files.forEach(file => {
      const filePath = path.join(SESSIONS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime.getTime() < fiveMinutesAgo) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Run cleanup on each request (simple approach)
cleanupOldSessions();
