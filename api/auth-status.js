// api/auth-status.js - Fixed version with robust error handling
import fs from 'fs';
import path from 'path';

// Use the same session directory as callback.js
const SESSIONS_DIR = '/tmp/auth_sessions';

// Patreon OAuth configuration
const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID;
const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
const PATREON_REDIRECT_URI = process.env.PATREON_REDIRECT_URI;

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log('=== AUTH STATUS REQUEST START ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query:', req.query);
  console.log('Timestamp:', new Date().toISOString());

  try {
    // Enable CORS first
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS request');
      return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
      console.log('Invalid method:', req.method);
      return res.status(405).json({ 
        error: 'Method not allowed',
        method: req.method,
        timestamp: Date.now()
      });
    }

    const { state, code } = req.query;
    
    console.log('=== AUTH STATUS CHECK ===');
    console.log('State parameter:', state);
    console.log('Code parameter:', code ? `Present (${code.length} chars)` : 'Missing');
    
    // Validate state parameter first
    if (!state) {
      console.log('Missing state parameter');
      return res.status(400).json({ 
        error: 'State parameter required',
        timestamp: Date.now()
      });
    }

    // Enhanced state validation
    if (typeof state !== 'string' || state.length < 8 || !/^[a-f0-9_]+$/.test(state)) {
      console.log('Invalid state parameter format:', state);
      return res.status(400).json({ 
        error: 'Invalid state parameter format',
        state: state,
        timestamp: Date.now()
      });
    }

    // If we have a code parameter, exchange it for tokens immediately
    if (code) {
      console.log('Authorization code provided, exchanging for tokens...');
      
      try {
        const tokenData = await exchangeCodeForTokens(code);
        
        if (tokenData && tokenData.access_token) {
          console.log('Token exchange successful');
          return res.status(200).json({
            status: 'completed',
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            state: state,
            timestamp: Date.now()
          });
        } else {
          console.log('Token exchange failed - no access_token received');
          return res.status(400).json({
            status: 'error',
            error: 'Failed to exchange authorization code for tokens',
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error('Token exchange error:', error);
        return res.status(400).json({
          status: 'error',
          error: 'Token exchange failed: ' + error.message,
          timestamp: Date.now()
        });
      }
    }

    // Check sessions directory with better error handling
    console.log('Sessions directory:', SESSIONS_DIR);
    
    let dirExists = false;
    let dirError = null;
    
    try {
      dirExists = fs.existsSync(SESSIONS_DIR);
      console.log('Directory exists:', dirExists);
    } catch (error) {
      dirError = error;
      console.error('Error checking directory existence:', error);
    }

    // If directory doesn't exist or we can't access it
    if (!dirExists || dirError) {
      console.log('Sessions directory not accessible');
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication session pending - waiting for authorization code',
        timestamp: Date.now(),
        state: state,
        debug: dirError ? `Directory error: ${dirError.message}` : 'Sessions directory not found'
      });
    }

    // List files for debugging
    let allFiles = [];
    try {
      allFiles = fs.readdirSync(SESSIONS_DIR);
      console.log('All session files:', allFiles);
      console.log('Looking for file:', `${state}.json`);
    } catch (dirError) {
      console.error('Error reading sessions directory:', dirError);
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication session pending',
        timestamp: Date.now(),
        state: state,
        debug: `Directory read error: ${dirError.message}`
      });
    }

    // Check if specific session file exists
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    console.log('Looking for session file:', sessionFile);

    let fileExists = false;
    try {
      fileExists = fs.existsSync(sessionFile);
    } catch (error) {
      console.error('Error checking session file:', error);
      return res.status(500).json({
        status: 'error',
        error: 'File system error',
        timestamp: Date.now()
      });
    }

    if (!fileExists) {
      console.log('Session file not found, returning pending status');
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication session pending - waiting for authorization code',
        timestamp: Date.now(),
        state: state,
        debug: 'Session file not found'
      });
    }

    // Read and parse session file with robust error handling
    let sessionData;
    try {
      const sessionContent = fs.readFileSync(sessionFile, 'utf8');
      sessionData = JSON.parse(sessionContent);
      console.log('Session data loaded:', {
        status: sessionData.status,
        hasAccessToken: !!sessionData.access_token,
        hasCode: !!sessionData.code,
        timestamp: sessionData.timestamp
      });
    } catch (readError) {
      console.error('Error reading/parsing session file:', readError);
      
      // Try to clean up corrupted file
      try {
        fs.unlinkSync(sessionFile);
        console.log('Cleaned up corrupted session file');
      } catch (cleanupError) {
        console.error('Error cleaning up corrupted file:', cleanupError);
      }
      
      return res.status(500).json({
        status: 'error',
        error: 'Failed to read authentication session',
        timestamp: Date.now()
      });
    }

    // Validate session data structure
    if (!sessionData || typeof sessionData !== 'object') {
      console.error('Invalid session data structure');
      try {
        fs.unlinkSync(sessionFile);
      } catch (e) { /* ignore cleanup errors */ }
      
      return res.status(500).json({
        status: 'error',
        error: 'Invalid session data',
        timestamp: Date.now()
      });
    }

    // Check session age (expire after 10 minutes)
    const maxAge = 10 * 60 * 1000; // 10 minutes
    const sessionAge = Date.now() - (sessionData.timestamp || 0);
    
    if (sessionAge > maxAge) {
      console.log('Session expired, cleaning up');
      try {
        fs.unlinkSync(sessionFile);
      } catch (cleanupError) {
        console.error('Error cleaning up expired session:', cleanupError);
      }
      
      return res.status(400).json({
        status: 'expired',
        error: 'Authentication session expired',
        timestamp: Date.now()
      });
    }

    // Handle different session statuses
    if (sessionData.status === 'error') {
      console.log('Session contains error:', sessionData.error);
      
      // Clean up error session
      try {
        fs.unlinkSync(sessionFile);
      } catch (cleanupError) {
        console.error('Error cleaning up error session:', cleanupError);
      }
      
      return res.status(400).json({
        status: 'error',
        error: sessionData.error || 'Authentication error',
        timestamp: Date.now()
      });
    }

    if (sessionData.status === 'completed') {
      // If we already have tokens, return them
      if (sessionData.access_token) {
        console.log('Session has tokens, returning them');
        
        // Clean up session file after successful retrieval
        try {
          fs.unlinkSync(sessionFile);
          console.log('Session file cleaned up successfully');
        } catch (cleanupError) {
          console.error('Error cleaning up session:', cleanupError);
        }
        
        return res.status(200).json({
          status: 'completed',
          access_token: sessionData.access_token,
          refresh_token: sessionData.refresh_token,
          expires_in: sessionData.expires_in,
          token_type: sessionData.token_type,
          state: state,
          timestamp: Date.now()
        });
      }
      
      // If we have a code but no tokens, exchange it now
      if (sessionData.code) {
        console.log('Session has code, exchanging for tokens...');
        
        try {
          const tokenData = await exchangeCodeForTokens(sessionData.code);
          
          if (tokenData && tokenData.access_token) {
            console.log('Token exchange successful');
            
            // Clean up session file
            try {
              fs.unlinkSync(sessionFile);
              console.log('Session file cleaned up after token exchange');
            } catch (cleanupError) {
              console.error('Error cleaning up session after token exchange:', cleanupError);
            }
            
            return res.status(200).json({
              status: 'completed',
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_in: tokenData.expires_in,
              token_type: tokenData.token_type,
              state: state,
              timestamp: Date.now()
            });
          } else {
            console.log('Token exchange failed - no access_token received');
            return res.status(400).json({
              status: 'error',
              error: 'Failed to exchange authorization code for tokens',
              timestamp: Date.now()
            });
          }
        } catch (error) {
          console.error('Token exchange error:', error);
          return res.status(400).json({
            status: 'error',
            error: 'Token exchange failed: ' + error.message,
            timestamp: Date.now()
          });
        }
      }
    }

    // If we get here, session is in an unexpected state
    console.log('Session in unexpected state:', sessionData);
    return res.status(200).json({ 
      status: 'pending',
      message: 'Authentication session in unexpected state',
      timestamp: Date.now(),
      state: state,
      debug: `Unexpected session state: ${sessionData.status}`
    });

  } catch (error) {
    console.error('=== AUTH STATUS ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Processing time:', Date.now() - startTime, 'ms');
    
    // Return a safe error response
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      message: 'An unexpected error occurred while checking authentication status',
      timestamp: Date.now(),
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Function to exchange authorization code for tokens with better error handling
async function exchangeCodeForTokens(code) {
  try {
    console.log('=== TOKEN EXCHANGE START ===');
    
    // Validate environment variables
    if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET || !PATREON_REDIRECT_URI) {
      const missing = [];
      if (!PATREON_CLIENT_ID) missing.push('PATREON_CLIENT_ID');
      if (!PATREON_CLIENT_SECRET) missing.push('PATREON_CLIENT_SECRET');
      if (!PATREON_REDIRECT_URI) missing.push('PATREON_REDIRECT_URI');
      
      console.error('Missing environment variables:', missing);
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
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
    console.log('Request details:');
    console.log('- URL:', tokenUrl);
    console.log('- Client ID:', PATREON_CLIENT_ID ? `${PATREON_CLIENT_ID.substring(0, 8)}...` : 'Missing');
    console.log('- Client Secret:', PATREON_CLIENT_SECRET ? 'Set' : 'Missing');
    console.log('- Redirect URI:', PATREON_REDIRECT_URI);
    console.log('- Code length:', code ? code.length : 'Missing');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SketchShaper-Extension/1.0',
          'Accept': 'application/json'
        },
        body: params.toString(),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log('Token exchange response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange failed:', response.status, errorText);
        
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            errorMessage += `: ${errorData.error}`;
            if (errorData.error_description) {
              errorMessage += ` - ${errorData.error_description}`;
            }
          }
        } catch (parseError) {
          errorMessage += `: ${errorText.substring(0, 200)}`;
        }
        
        throw new Error(errorMessage);
      }

      const tokenData = await response.json();
      console.log('Token exchange successful - received keys:', Object.keys(tokenData));
      
      // Validate response has required fields
      if (!tokenData.access_token) {
        console.error('Token response missing access_token:', tokenData);
        throw new Error('Token response missing access_token');
      }
      
      return tokenData;
      
    } finally {
      clearTimeout(timeoutId);
    }
    
  } catch (error) {
    console.error('=== TOKEN EXCHANGE ERROR ===');
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      code: error.code
    });
    
    if (error.name === 'AbortError') {
      throw new Error('Token exchange request timed out');
    }
    
    throw error;
  }
}
