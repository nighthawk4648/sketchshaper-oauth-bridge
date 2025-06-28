// api/callback.js - Improved Patreon OAuth callback handler with robust error handling

import fs from 'fs';
import path from 'path';

// Use a temporary directory for session storage
const SESSIONS_DIR = '/tmp/auth_sessions';

// Patreon OAuth configuration for server-side token exchange
const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID;
const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
const PATREON_REDIRECT_URI = process.env.PATREON_REDIRECT_URI;

// Ensure the sessions directory exists with better error handling
function ensureSessionsDirectory() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      console.log('Created sessions directory:', SESSIONS_DIR);
      
      // Set proper permissions if possible
      try {
        fs.chmodSync(SESSIONS_DIR, 0o755);
      } catch (chmodError) {
        console.warn('Could not set directory permissions:', chmodError.message);
      }
    }
    
    // Test write access
    const testFile = path.join(SESSIONS_DIR, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    
    console.log('Sessions directory is writable');
    return true;
    
  } catch (error) {
    console.error('Failed to ensure sessions directory:', error);
    return false;
  }
}

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log('=== CALLBACK HANDLER START ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Timestamp:', new Date().toISOString());

  try {
    // Enable CORS for your domain
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      console.log('Invalid method:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, state, error, error_description } = req.query;

    console.log('=== CALLBACK RECEIVED ===');
    console.log('Parameters:', { 
      hasCode: !!code, 
      codeLength: code ? code.length : 0,
      state: state ? `${state.substring(0, 16)}...` : 'missing',
      error,
      error_description,
      timestamp: new Date().toISOString()
    });

    // Ensure sessions directory exists
    if (!ensureSessionsDirectory()) {
      console.error('Cannot create/access sessions directory');
      return res.status(500).send(generateErrorPage('Server configuration error - cannot store session data'));
    }

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      
      // Store error in session file if state is provided
      if (state && typeof state === 'string' && state.length > 0) {
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

    // Validate state parameter format
    if (typeof state !== 'string' || state.length < 8 || !/^[a-f0-9_]+$/.test(state)) {
      console.error('Invalid state parameter format:', state);
      return res.status(400).send(generateErrorPage('Invalid authentication state parameter'));
    }

    // Validate code parameter
    if (typeof code !== 'string' || code.length < 10) {
      console.error('Invalid code parameter format');
      return res.status(400).send(generateErrorPage('Invalid authorization code'));
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
          throw new Error('No access token received from Patreon');
        }
      } catch (tokenError) {
        console.error('Server-side token exchange failed:', tokenError);
        // Fall back to storing the code for client-side exchange
        sessionData = {
          status: 'completed',
          code: code,
          timestamp: Date.now(),
          fallback_reason: tokenError.message
        };
        console.log('Falling back to client-side token exchange');
      }
    } else {
      console.log('Missing environment variables for server-side token exchange');
      console.log('Available env vars:', {
        PATREON_CLIENT_ID: !!PATREON_CLIENT_ID,
        PATREON_CLIENT_SECRET: !!PATREON_CLIENT_SECRET,
        PATREON_REDIRECT_URI: !!PATREON_REDIRECT_URI
      });
      
      sessionData = {
        status: 'completed',
        code: code,
        timestamp: Date.now(),
        fallback_reason: 'Missing server environment variables'
      };
    }

    // Store the session data with robust error handling
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    
    try {
      console.log('Storing session data:', sessionFile);
      console.log('Session data keys:', Object.keys(sessionData));
      
      // Write session data atomically
      const tempFile = sessionFile + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(sessionData, null, 2));
      fs.renameSync(tempFile, sessionFile);
      
      console.log('Session data written successfully');
      
      // Verify the file was written and can be read
      if (fs.existsSync(sessionFile)) {
        try {
          const verifyData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
          console.log('Session file verified - status:', verifyData.status);
          
          if (verifyData.access_token) {
            console.log('Session contains access token');
          } else if (verifyData.code) {
            console.log('Session contains authorization code');
          }
        } catch (verifyError) {
          console.error('Session file verification failed:', verifyError);
          throw new Error('Session file corrupted after write');
        }
      } else {
        console.error('Session file was not created!');
        throw new Error('Session file was not created');
      }
      
      // List all files for debugging
      try {
        const allFiles = fs.readdirSync(SESSIONS_DIR);
        console.log('All session files after write:', allFiles);
      } catch (listError) {
        console.warn('Could not list session files:', listError.message);
      }
      
    } catch (writeError) {
      console.error('Failed to store auth session:', writeError);
      console.error('Write error details:', {
        message: writeError.message,
        code: writeError.code,
        errno: writeError.errno,
        path: writeError.path
      });
      
      return res.status(500).send(generateErrorPage('Failed to store authentication session. Please try again.'));
    }

    // Return success page
    console.log('Callback processing completed successfully in', Date.now() - startTime, 'ms');
    return res.status(200).send(generateSuccessPage());

  } catch (error) {
    console.error('=== CALLBACK HANDLER ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Processing time:', Date.now() - startTime, 'ms');
    
    return res.status(500).send(generateErrorPage('An unexpected error occurred during authentication. Please try again.'));
  }
}

// Function to exchange authorization code for tokens with enhanced error handling
async function exchangeCodeForTokens(code) {
  try {
    console.log('=== TOKEN EXCHANGE START ===');
    
    const tokenUrl = 'https://www.patreon.com/api/oauth2/token';
    
    const params = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: PATREON_CLIENT_ID,
      client_secret: PATREON_CLIENT_SECRET,
      redirect_uri: PATREON_REDIRECT_URI
    });

    console.log('Making token exchange request...');
    console.log('Client ID:', PATREON_CLIENT_ID ? `${PATREON_CLIENT_ID.substring(0, 8)}...` : 'Missing');
    console.log('Redirect URI:', PATREON_REDIRECT_URI);
    console.log('Code length:', code.length);
    
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
      
      // Validate the response
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
