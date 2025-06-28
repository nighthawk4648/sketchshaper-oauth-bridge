// api/callback.js - Improved Patreon OAuth callback handler with better session management

import fs from 'fs';
import path from 'path';

// Use a temporary directory for session storage
const SESSIONS_DIR = '/tmp/auth_sessions';

// Ensure the sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    console.log('Created sessions directory:', SESSIONS_DIR);
    
    // Set proper permissions (readable/writable by owner)
    fs.chmodSync(SESSIONS_DIR, 0o755);
  } catch (error) {
    console.error('Failed to create sessions directory:', error);
  }
}

// Patreon OAuth configuration for server-side token exchange
const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID;
const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
const PATREON_REDIRECT_URI = process.env.PATREON_REDIRECT_URI;

export default async function handler(req, res) {
  // Enable CORS for your domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, state, error, error_description } = req.query;

    console.log('=== CALLBACK RECEIVED ===');
    console.log('Parameters:', { 
      hasCode: !!code, 
      state, 
      error,
      timestamp: new Date().toISOString()
    });
    console.log('Sessions directory:', SESSIONS_DIR);
    console.log('Directory exists:', fs.existsSync(SESSIONS_DIR));

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      
      // Store error in session file if state is provided
      if (state) {
        const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
        const sessionData = {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now()
        };
        
        try {
          console.log('Storing error session:', sessionFile);
          fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
          console.log('Error session stored successfully');
          
          // Verify the file was written
          if (fs.existsSync(sessionFile)) {
            console.log('Error session file verified to exist');
          } else {
            console.error('Error session file was not created!');
          }
        } catch (writeError) {
          console.error('Failed to store error session:', writeError);
        }
      }

      return res.status(400).send(generateErrorPage(error_description || error));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      return res.status(400).send(generateErrorPage('Missing required authentication parameters'));
    }

    // Try to exchange code for tokens on the server side
    let sessionData;
    
    if (PATREON_CLIENT_ID && PATREON_CLIENT_SECRET && PATREON_REDIRECT_URI) {
      console.log('Attempting server-side token exchange...');
      try {
        const tokenData = await exchangeCodeForTokens(code);
        
        if (tokenData && tokenData.access_token) {
          // Store session with tokens
          sessionData = {
            status: 'completed',
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            timestamp: Date.now()
          };
          console.log('Server-side token exchange successful');
        } else {
          throw new Error('No access token received');
        }
      } catch (tokenError) {
        console.error('Server-side token exchange failed:', tokenError);
        // Fall back to storing the code for client-side exchange
        sessionData = {
          status: 'completed',
          code: code,
          timestamp: Date.now()
        };
        console.log('Falling back to client-side token exchange');
      }
    } else {
      console.log('Missing environment variables, storing code for client-side exchange');
      sessionData = {
        status: 'completed',
        code: code,
        timestamp: Date.now()
      };
    }

    // Store the session data
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    
    try {
      console.log('Storing session data:', sessionFile);
      console.log('Session data keys:', Object.keys(sessionData));
      
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
      console.log('Session data written successfully');
      
      // Verify the file was written and can be read
      if (fs.existsSync(sessionFile)) {
        const verifyData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        console.log('Session file verified - status:', verifyData.status);
      } else {
        console.error('Session file was not created!');
        return res.status(500).send(generateErrorPage('Failed to store authentication session'));
      }
      
      // List all files for debugging
      const allFiles = fs.readdirSync(SESSIONS_DIR);
      console.log('All session files after write:', allFiles);
      
    } catch (writeError) {
      console.error('Failed to store auth session:', writeError);
      return res.status(500).send(generateErrorPage('Failed to store authentication session'));
    }

    // Return success page
    return res.status(200).send(generateSuccessPage());

  } catch (error) {
    console.error('Callback handler error:', error);
    console.error('Stack trace:', error.stack);
    return res.status(500).send(generateErrorPage('An unexpected error occurred. Please try again.'));
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

    console.log('Making token exchange request...');
    console.log('Client ID:', PATREON_CLIENT_ID ? 'Set' : 'Missing');
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
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const tokenData = await response.json();
    console.log('Token exchange successful - received keys:', Object.keys(tokenData));
    
    return tokenData;
  } catch (error) {
    console.error('Token exchange error:', error);
    throw error;
  }
}

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
        .success { color: #38a169; }
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
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        h1 {
          margin: 0 0 15px 0;
          font-size: 24px;
        }
        p {
          margin: 10px 0;
          line-height: 1.5;
        }
        .close-instruction {
          font-weight: 600;
          color: #38a169;
          font-size: 18px;
          margin: 20px 0;
        }
        .info {
          font-size: 14px;
          color: #718096;
          margin-top: 30px;
          padding: 15px;
          background: #f7fafc;
          border-radius: 8px;
          border-left: 4px solid #38a169;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="checkmark">✓</div>
        <h1 class="success">Authentication Successful!</h1>
        <p>You have successfully authenticated with Patreon.</p>
        <p class="close-instruction">You can now close this window and return to SketchUp.</p>
        <div class="info">
          Your SketchShaper Pro extension will automatically detect the successful authentication and load your premium features.
        </div>
      </div>
      
      <script>
        // Auto-close after 15 seconds (optional)
        setTimeout(() => {
          if (window.confirm('Close this window automatically?')) {
            window.close();
          }
        }, 15000);
      </script>
    </body>
    </html>
  `;
}

function generateErrorPage(errorMessage) {
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
          max-width: 400px;
          width: 100%;
        }
        .error { color: #e53e3e; }
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
        h1 {
          margin: 0 0 15px 0;
          font-size: 24px;
        }
        p {
          margin: 10px 0;
          line-height: 1.5;
        }
        .retry-btn {
          margin-top: 20px;
          padding: 12px 24px;
          background: #4299e1;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          text-decoration: none;
          display: inline-block;
        }
        .retry-btn:hover {
          background: #3182ce;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon">✕</div>
        <h1 class="error">Authentication Failed</h1>
        <p>${errorMessage}</p>
        <p>You can close this window and try again in SketchUp.</p>
        <button class="retry-btn" onclick="window.close()">Close Window</button>
      </div>
    </body>
    </html>
  `;
}
