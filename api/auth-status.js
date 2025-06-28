// api/auth-status.js - Clean auth status checker
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = '/tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

function validateState(state) {
  if (!state || typeof state !== 'string') return false;
  if (!/^[a-f0-9]+_\d+$/.test(state)) return false;
  
  const timestamp = parseInt(state.split('_')[1]);
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  return timestamp > 0 && timestamp <= now && (now - timestamp) <= maxAge;
}

export default async function handler(req, res) {
  console.log('Auth status check:', req.method, req.query.state?.substring(0, 16) + '...');

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { state } = req.query;

    // Validate state parameter
    if (!validateState(state)) {
      console.log('Invalid state parameter');
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);

    // Check if session file exists
    if (!fs.existsSync(sessionFile)) {
      console.log('Session file not found, creating pending session');
      
      // Create pending session
      const pendingData = {
        status: 'pending',
        timestamp: Date.now()
      };

      try {
        fs.writeFileSync(sessionFile, JSON.stringify(pendingData, null, 2));
        return res.status(200).json({
          status: 'pending',
          state,
          timestamp: pendingData.timestamp
        });
      } catch (writeError) {
        console.error('Failed to create pending session:', writeError);
        return res.status(500).json({ error: 'Server error' });
      }
    }

    // Read existing session
    try {
      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      
      // Check if session has expired
      if (Date.now() - sessionData.timestamp > SESSION_TIMEOUT) {
        console.log('Session expired, removing file');
        try {
          fs.unlinkSync(sessionFile);
        } catch (unlinkError) {
          console.warn('Failed to remove expired session:', unlinkError);
        }
        
        return res.status(410).json({
          status: 'expired',
          error: 'Session expired',
          state
        });
      }

      // Return session status
      const response = {
        status: sessionData.status,
        state,
        timestamp: sessionData.timestamp
      };

      // Include tokens if available
      if (sessionData.status === 'completed') {
        if (sessionData.access_token) {
          Object.assign(response, {
            access_token: sessionData.access_token,
            refresh_token: sessionData.refresh_token,
            expires_in: sessionData.expires_in,
            token_type: sessionData.token_type
          });
        } else if (sessionData.code) {
          response.code = sessionData.code;
          response.fallback_reason = sessionData.fallback_reason;
        }
      } else if (sessionData.status === 'error') {
        response.error = sessionData.error || 'Unknown error';
      }

      console.log('Returning session status:', sessionData.status);
      return res.status(200).json(response);

    } catch (readError) {
      console.error('Failed to read session file:', readError);
      return res.status(500).json({ error: 'Server error' });
    }

  } catch (error) {
    console.error('Auth status handler error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
