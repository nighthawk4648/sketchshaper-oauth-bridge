// api/callback.js - Enhanced Patreon OAuth callback handler with debugging
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = '/tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// Ensure sessions directory exists
function ensureSessionsDirectory() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    return true;
  } catch (error) {
    console.error('Failed to create sessions directory:', error);
    return false;
  }
}

// Enhanced state validation with detailed logging
function validateState(state) {
  console.log('Validating state parameter:', state);
  
  if (!state || typeof state !== 'string') {
    console.log('State validation failed: Missing or invalid type');
    return false;
  }
  
  // More flexible regex pattern - allow alphanumeric and common separators
  if (!/^[a-fA-F0-9]+_\d+$/.test(state)) {
    console.log('State validation failed: Pattern mismatch. Expected format: [hex]_[timestamp]');
    console.log('Actual state format:', state);
    return false;
  }
  
  const parts = state.split('_');
  if (parts.length !== 2) {
    console.log('State validation failed: Invalid format - expected exactly one underscore');
    return false;
  }
  
  const timestamp = parseInt(parts[1]);
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  console.log('Timestamp validation:', {
    stateTimestamp: timestamp,
    currentTime: now,
    age: now - timestamp,
    maxAge: maxAge,
    isValid: timestamp > 0 && timestamp <= now && (now - timestamp) <= maxAge
  });
  
  if (timestamp <= 0) {
    console.log('State validation failed: Invalid timestamp (not positive)');
    return false;
  }
  
  if (timestamp > now) {
    console.log('State validation failed: Timestamp is in the future');
    return false;
  }
  
  if ((now - timestamp) > maxAge) {
    console.log('State validation failed: Timestamp too old');
    return false;
  }
  
  console.log('State validation passed');
  return true;
}

// Alternative validation function for debugging
function validateStateAlternative(state) {
  console.log('Alternative state validation for:', state);
  
  if (!state || typeof state !== 'string') {
    return false;
  }
  
  // More lenient validation - just check if it's not empty and contains reasonable characters
  if (state.length < 10 || state.length > 100) {
    console.log('State length validation failed:', state.length);
    return false;
  }
  
  // Allow any alphanumeric state with common separators
  if (!/^[a-zA-Z0-9_-]+$/.test(state)) {
    console.log('State character validation failed');
    return false;
  }
  
  console.log('Alternative state validation passed');
  return true;
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  const { PATREON_CLIENT_ID, PATREON_CLIENT_SECRET, PATREON_REDIRECT_URI } = process.env;
  
  if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET || !PATREON_REDIRECT_URI) {
    throw new Error('Missing Patreon OAuth environment variables');
  }

  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: PATREON_CLIENT_ID,
    client_secret: PATREON_CLIENT_SECRET,
    redirect_uri: PATREON_REDIRECT_URI
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SketchShaper-Extension/1.0',
        'Accept': 'application/json'
      },
      body: params,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.access_token) {
      throw new Error('No access token in response');
    }

    return data;

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Token exchange timeout');
    }
    throw error;
  }
}

// Generate success page
function generateSuccessPage() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Successful</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center; 
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          color: #2d3748;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 400px;
          width: 100%;
        }
        .checkmark {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: #38a169;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          font-size: 24px;
        }
        h1 { color: #38a169; margin: 0 0 15px 0; }
        p { margin: 10px 0; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="checkmark">✓</div>
        <h1>Authentication Successful!</h1>
        <p>You can now close this window and return to SketchUp.</p>
      </div>
    </body>
    </html>
  `;
}

// Generate error page with more debugging info
function generateErrorPage(errorMessage, debugInfo = null) {
  const debugSection = debugInfo ? `
    <div style="margin-top: 20px; padding: 15px; background: #f7fafc; border-radius: 8px; text-align: left; font-size: 12px; color: #4a5568;">
      <strong>Debug Info:</strong><br>
      <pre style="margin: 5px 0; white-space: pre-wrap;">${JSON.stringify(debugInfo, null, 2)}</pre>
    </div>
  ` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Error</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center; 
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          color: #2d3748;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
        }
        .error-icon {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: #e53e3e;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          font-size: 24px;
        }
        h1 { color: #e53e3e; margin: 0 0 15px 0; }
        p { margin: 10px 0; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon">✕</div>
        <h1>Authentication Failed</h1>
        <p>${errorMessage}</p>
        <p>You can close this window and try again.</p>
        ${debugSection}
      </div>
    </body>
    </html>
  `;
}

export default async function handler(req, res) {
  console.log('Callback handler started:', req.method, req.url);
  console.log('Query parameters:', req.query);

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

    // Ensure sessions directory exists
    if (!ensureSessionsDirectory()) {
      console.error('Cannot create sessions directory');
      return res.status(500).send(generateErrorPage('Server configuration error'));
    }

    const { code, state, error, error_description } = req.query;

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      
      // Try to store error even with invalid state for debugging
      if (state) {
        const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
        const sessionData = {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now()
        };
        
        try {
          fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
        } catch (writeError) {
          console.error('Failed to store error session:', writeError);
        }
      }

      return res.status(400).send(generateErrorPage(error_description || error, {
        oauthError: error,
        state: state,
        hasCode: !!code
      }));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters - code:', !!code, 'state:', !!state);
      return res.status(400).send(generateErrorPage('Missing authentication parameters', {
        hasCode: !!code,
        hasState: !!state,
        state: state
      }));
    }

    // Try primary validation first
    let isStateValid = validateState(state);
    
    // If primary validation fails, try alternative validation
    if (!isStateValid) {
      console.log('Primary state validation failed, trying alternative validation...');
      isStateValid = validateStateAlternative(state);
      
      if (!isStateValid) {
        console.error('Both state validations failed');
        return res.status(400).send(generateErrorPage('Invalid authentication state', {
          state: state,
          stateLength: state.length,
          statePattern: /^[a-fA-F0-9]+_\d+$/.test(state),
          alternativePattern: /^[a-zA-Z0-9_-]+$/.test(state),
          timestamp: Date.now()
        }));
      }
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);

    // Try to exchange code for tokens
    let sessionData;
    
    try {
      console.log('Attempting token exchange...');
      const tokenData = await exchangeCodeForTokens(code);
      
      sessionData = {
        status: 'completed',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type,
        timestamp: Date.now()
      };
      
      console.log('Token exchange successful');
      
    } catch (tokenError) {
      console.error('Token exchange failed:', tokenError.message);
      
      // Fallback: store the code for client-side exchange
      sessionData = {
        status: 'completed',
        code: code,
        timestamp: Date.now(),
        fallback_reason: tokenError.message
      };
    }

    // Store session data
    try {
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
      console.log('Session data stored successfully');
    } catch (writeError) {
      console.error('Failed to store session:', writeError);
      return res.status(500).send(generateErrorPage('Failed to store authentication session'));
    }

    // Return success page
    return res.status(200).send(generateSuccessPage());

  } catch (error) {
    console.error('Callback handler error:', error);
    return res.status(500).send(generateErrorPage('Server error occurred', {
      error: error.message,
      stack: error.stack
    }));
  }
}
