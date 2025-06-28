import fs from 'fs';
import path from 'path';

// Use a temporary directory for session storage
const SESSIONS_DIR = '/tmp/auth_sessions';

// Ensure the sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  console.log('Created sessions directory:', SESSIONS_DIR);
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
    
    console.log('=== AUTH STATUS CHECK ===');
    console.log('State parameter:', state);
    console.log('Sessions directory:', SESSIONS_DIR);
    console.log('Directory exists:', fs.existsSync(SESSIONS_DIR));
    
    if (!state) {
      return res.status(400).json({ error: 'State parameter required' });
    }

    // List all files in sessions directory for debugging
    try {
      const files = fs.readdirSync(SESSIONS_DIR);
      console.log('Files in sessions directory:', files);
    } catch (dirError) {
      console.error('Error reading sessions directory:', dirError);
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    console.log('Looking for session file:', sessionFile);
    
    // Check if session file exists
    if (!fs.existsSync(sessionFile)) {
      console.log('Session file not found');
      
      // Return more detailed response for debugging
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending',
        debug: {
          sessionFile,
          dirExists: fs.existsSync(SESSIONS_DIR),
          availableFiles: fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR) : []
        }
      });
    }

    // Read session data
    console.log('Reading session file...');
    const sessionData = fs.readFileSync(sessionFile, 'utf8');
    const session = JSON.parse(sessionData);
    
    console.log('Session data:', { 
      status: session.status, 
      hasCode: !!session.code,
      hasTokens: !!session.access_token,
      timestamp: new Date(session.timestamp).toISOString()
    });

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
          console.log('Token exchange failed - no access_token received');
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
      console.log('Cleaning up session file after successful completion');
      fs.unlinkSync(sessionFile);
      
    } else if (session.status === 'error') {
      response.error = session.error;
      console.log('Returning error status:', session.error);
      // Clean up error sessions too
      fs.unlinkSync(sessionFile);
    }

    console.log('Returning response:', { 
      status: response.status, 
      hasTokens: !!response.access_token,
      hasCode: !!response.code 
    });
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('Auth status check error:', error);
    console.error('Stack trace:', error.stack);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error: ' + error.message
    });
  }
}

// Function to exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  try {
    if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET || !PATREON_REDIRECT_URI) {
      throw new Error('Missing required environment variables for token exchange');
    }

    const tokenUrl = 'https://www.patreon.com/api/oauth2/token';
    
    const params = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: PATREON_CLIENT_ID,
      client_secret: PATREON_CLIENT_SECRET,
      redirect_uri: PATREON_REDIRECT_URI
    });

    console.log('Making token exchange request to Patreon...');
    console.log('Client ID:', PATREON_CLIENT_ID ? 'Set' : 'Missing');
    console.log('Client Secret:', PATREON_CLIENT_SECRET ? 'Set' : 'Missing');
    console.log('Redirect URI:', PATREON_REDIRECT_URI);
    
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
    console.log('Token exchange successful - received keys:', Object.keys(tokenData));
    
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
      console.log('Sessions directory does not exist, skipping cleanup');
      return;
    }
    
    const files = fs.readdirSync(SESSIONS_DIR);
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    
    console.log(`Cleanup: Found ${files.length} session files`);
    
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
        console.error(`Error cleaning file ${file}:`, error);
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
