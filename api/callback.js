// api/callback.js - Patreon OAuth callback handler
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = process.env.VERCEL ? '/tmp/auth_sessions' : './tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// Ensure sessions directory exists
function ensureSessionsDirectory() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      console.log('Created sessions directory:', SESSIONS_DIR);
    }
    
    // Test write permissions
    const testFile = path.join(SESSIONS_DIR, 'test.json');
    fs.writeFileSync(testFile, '{"test": true}');
    fs.unlinkSync(testFile);
    
    return true;
  } catch (error) {
    console.error('Failed to create/access sessions directory:', error);
    return false;
  }
}

// Validate state parameter
function validateState(state) {
  console.log('Validating state parameter:', state);
  
  if (!state || typeof state !== 'string') {
    console.log('State validation failed: Missing or invalid type');
    return false;
  }
  
  // Check for hex_timestamp pattern
  if (!/^[a-fA-F0-9]+_\d+$/.test(state)) {
    console.log('State validation failed: Pattern mismatch. Expected format: [hex]_[timestamp]');
    return false;
  }
  
  const parts = state.split('_');
  if (parts.length !== 2) {
    console.log('State validation failed: Invalid format');
    return false;
  }
  
  const timestamp = parseInt(parts[1]);
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  if (timestamp <= 0 || timestamp > now || (now - timestamp) > maxAge) {
    console.log('State validation failed: Invalid or expired timestamp');
    return false;
  }
  
  console.log('State validation passed');
  return true;
}

// Alternative validation for non-standard state formats
function validateStateAlternative(state) {
  console.log('Alternative state validation for:', state);
  
  if (!state || typeof state !== 'string') {
    return false;
  }
  
  if (state.length < 10 || state.length > 100) {
    console.log('State length validation failed:', state.length);
    return false;
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(state)) {
    console.log('State character validation failed');
    return false;
  }
  
  console.log('Alternative state validation passed');
  return true;
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID; "GhVd_dyhxHNkxgmYCAAjuP-9ohELe-aVI-BaxjeuQ3Shpo1NBEBrveQ9OHiKLDEe"
  const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;"NiL8Ip6NzIeAcsIjZ-hk_61VRt9ONo0JVBvxZsJi2tQ-OUedCuRHKCJTgyoOFFJj"
  const PATREON_REDIRECT_URI = process.env.PATREON_REDIRECT_URI || "https://api2.sketchshaper.com/callback";
  
  if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET) {
    throw new Error('Missing Patreon OAuth configuration');
  }

  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: PATREON_CLIENT_ID,
    client_secret: PATREON_CLIENT_SECRET,
    redirect_uri: PATREON_REDIRECT_URI
  });

  try {
    console.log('Making token exchange request to Patreon...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

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

    console.log('Token exchange response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed:', response.status, errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('Token exchange successful');
    
    if (!data.access_token) {
      throw new Error('No access token in response');
    }

    return data;

  } catch (error) {
    console.error('Token exchange error:', error);
    if (error.name === 'AbortError') {
      throw new Error('Token exchange timeout');
    }
    throw error;
  }
}

// Safe file operations
function safeWriteFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, data);
    return true;
  } catch (error) {
    console.error('Failed to write file:', filePath, error);
    return false;
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
        <p>The extension should automatically detect the successful authentication.</p>
      </div>
    </body>
    </html>
  `;
}

// Generate error page
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
  console.log('=== Callback Handler Started ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query parameters:', req.query);

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      console.error('Invalid method:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, state, error, error_description } = req.query;

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error received:', error, error_description);
      
      if (ensureSessionsDirectory() && state) {
        const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
        const sessionData = {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now()
        };
        
        safeWriteFile(sessionFile, JSON.stringify(sessionData, null, 2));
      }

      return res.status(400).send(generateErrorPage(error_description || error));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters - code:', !!code, 'state:', !!state);
      return res.status(400).send(generateErrorPage('Missing authentication parameters'));
    }

    // Validate state parameter
    let isStateValid = validateState(state);
    
    if (!isStateValid) {
      console.log('Primary state validation failed, trying alternative validation...');
      isStateValid = validateStateAlternative(state);
      
      if (!isStateValid) {
        console.error('Both state validations failed for state:', state);
        return res.status(400).send(generateErrorPage('Invalid authentication state'));
      }
    }

    // Ensure sessions directory exists
    if (!ensureSessionsDirectory()) {
      console.error('Cannot create/access sessions directory');
      return res.status(500).send(generateErrorPage('Server configuration error'));
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
        expires_in: tokenData.expires_in || 3600,
        token_type: tokenData.token_type || 'Bearer',
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
      
      console.log('Storing fallback session data with code');
    }

    // Store session data
    const sessionDataString = JSON.stringify(sessionData, null, 2);
    if (!safeWriteFile(sessionFile, sessionDataString)) {
      console.error('Failed to store session data');
      return res.status(500).send(generateErrorPage('Failed to store authentication session'));
    }

    console.log('Session data stored successfully');

    // Return success page
    return res.status(200).send(generateSuccessPage());

  } catch (error) {
    console.error('=== Callback Handler Error ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).send(generateErrorPage('Server error occurred'));
  }
}