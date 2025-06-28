// api/auth-status.js - Improved version with better error handling and token exchange

import fs from 'fs';
import path from 'path';

// Use a temporary directory for session storage
const SESSIONS_DIR = '/tmp/auth_sessions';

// Ensure the sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Patreon OAuth configuration
const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID;
const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
const PATREON_REDIRECT_URI = process.env.PATREON_REDIRECT_URI;

export default async function handler(req, res) {
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
    
    console.log('Auth status check for state:', state);
    
    if (!state) {
      return res.status(400).json({ error: 'State parameter required' });
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    
    // Check if session file exists
    if (!fs.existsSync(sessionFile)) {
      console.log('Session file not found:', sessionFile);
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }

    // Read session data
    const sessionData = fs.readFileSync(sessionFile, 'utf8');
    const session = JSON.parse(sessionData);
    
    console.log('Session found:', { status: session.status, hasCode: !!session.code });

    // Check if session has expired (10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (session.timestamp < tenMinutesAgo) {
      console.log('Session expired, cleaning up');
      fs.unlinkSync(sessionFile);
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    // If session is completed but we haven't exchanged the code yet, do it now
    if (session.status === 'completed' && session.code && !session.access_token) {
      console.log('Exchanging authorization code for tokens...');
      
      try {
        const tokenData = await exchangeCodeForTokens(session.code);
        
        if (tokenData && tokenData.access_token) {
          // Update session with tokens
          session.access_token = tokenData.access_token;
          session.refresh_token = tokenData.refresh_token;
          session.expires_in = tokenData.expires_in;
          session.token_type = tokenData.token_type;
          session.timestamp = Date.now(); // Update timestamp
          
          // Save updated session
          fs.writeFileSync(sessionFile, JSON.stringify(session));
          console.log('Tokens exchanged and saved successfully');
        } else {
          console.log('Token exchange failed');
          session.status = 'error';
          session.error = 'Failed to exchange authorization code for tokens';
          fs.writeFileSync(sessionFile, JSON.stringify(session));
        }
      } catch (error) {
        console.error('Token exchange error:', error);
        session.status = 'error';
        session.error = 'Token exchange failed: ' + error.message;
        fs.writeFileSync(sessionFile, JSON.stringify(session));
      }
    }

    // Prepare response
    const response = {
      status: session.status,
      timestamp: session.timestamp
    };

    if (session.status === 'completed') {
      // Include tokens if available
      if (session.access_token) {
        response.access_token = session.access_token;
        response.refresh_token = session.refresh_token;
        response.expires_in = session.expires_in;
        response.token_type = session.token_type;
        console.log('Returning tokens to client');
      } else {
        // Fallback: include auth code for client-side exchange
        response.code = session.code;
        console.log('Returning auth code to client');
      }
      response.state = state;
      
      // Clean up the session after successful retrieval
      fs.unlinkSync(sessionFile);
      
    } else if (session.status === 'error') {
      response.error = session.error;
      // Clean up error sessions too
      fs.unlinkSync(sessionFile);
    }

    console.log('Returning response:', { status: response.status, hasTokens: !!response.access_token });
    return res.status(200).json(response);

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error' 
    });
  }
}

// Function to exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  try {
    const tokenUrl = 'https://www.patreon.com/api/oauth2/token';
    
    const params = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: PATREON_CLIENT_ID,
      client_secret: PATREON_CLIENT_SECRET,
      redirect_uri: PATREON_REDIRECT_URI
    });

    console.log('Making token exchange request to Patreon...');
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SketchShaper-Extension/1.0'
      },
      body: params.toString()
    });

    console.log('Token exchange response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed:', response.status, errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    console.log('Token exchange successful');
    
    return tokenData;
  } catch (error) {
    console.error('Token exchange error:', error);
    throw error;
  }
}

// Cleanup function to remove old session files
function cleanupOldSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      return;
    }
    
    const files = fs.readdirSync(SESSIONS_DIR);
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    
    let cleanedCount = 0;
    files.forEach(file => {
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < tenMinutesAgo) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      } catch (error) {
        // Ignore individual file errors
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old session files`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Run cleanup on each request
cleanupOldSessions();
