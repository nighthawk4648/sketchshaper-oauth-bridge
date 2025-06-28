// api/callback.js - Improved Patreon OAuth callback handler

import fs from 'fs';
import path from 'path';

// Use a temporary directory for session storage
const SESSIONS_DIR = '/tmp/auth_sessions';

// Ensure the sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export default function handler(req, res) {
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

    console.log('Callback received:', { 
      code: !!code, 
      state, 
      error,
      timestamp: new Date().toISOString()
    });

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
          fs.writeFileSync(sessionFile, JSON.stringify(sessionData));
          console.log('Error session stored for state:', state);
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

    // Store the authorization code in a session file
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    const sessionData = {
      status: 'completed',
      code: code,
      timestamp: Date.now()
    };

    try {
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData));
      console.log('Auth session stored successfully for state:', state);
    } catch (writeError) {
      console.error('Failed to store auth session:', writeError);
      return res.status(500).send(generateErrorPage('Failed to store authentication session'));
    }

    // Return success page
    return res.status(200).send(generateSuccessPage());

  } catch (error) {
    console.error('Callback handler error:', error);
    return res.status(500).send(generateErrorPage('An unexpected error occurred. Please try again.'));
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
        // Auto-close after 10 seconds (optional)
        setTimeout(() => {
          if (window.confirm('Close this window automatically?')) {
            window.close();
          }
        }, 10000);
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
