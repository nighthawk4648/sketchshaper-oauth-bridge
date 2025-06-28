// api/callback.js - Fixed version with better error handling and logging

// Initialize global storage for auth sessions (in production, use Redis or database)
if (!global.authSessions) {
  global.authSessions = new Map();
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

    console.log('=== CALLBACK RECEIVED ===');
    console.log('Code present:', !!code);
    console.log('State:', state);
    console.log('Error:', error);
    console.log('Current sessions:', Array.from(global.authSessions.keys()));

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      
      // Store error in session
      if (state) {
        const errorSession = {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now()
        };
        global.authSessions.set(state, errorSession);
        console.log('Error session stored for state:', state);
      }

      return res.status(400).send(getErrorHTML(error_description || error));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      return res.status(400).send(getErrorHTML('Missing required authentication parameters'));
    }

    // Store the authorization code for the SketchUp extension to retrieve
    const session = {
      status: 'completed',
      code: code,
      timestamp: Date.now()
    };

    global.authSessions.set(state, session);
    console.log('=== SESSION STORED ===');
    console.log('State:', state);
    console.log('Session:', session);
    console.log('Total sessions now:', global.authSessions.size);
    console.log('All session keys:', Array.from(global.authSessions.keys()));

    // Return success page
    return res.status(200).send(getSuccessHTML());

  } catch (error) {
    console.error('Callback handler error:', error);
    return res.status(500).send(getErrorHTML('An unexpected error occurred. Please try again.'));
  }
}

function getErrorHTML(message) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Error</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .error { color: #e53e3e; }
      </style>
    </head>
    <body>
      <h1 class="error">Authentication Failed</h1>
      <p>${message}</p>
      <p>You can close this window and try again.</p>
    </body>
    </html>
  `;
}

function getSuccessHTML() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Successful</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center; 
          padding: 50px;
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
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="checkmark">✓</div>
        <h1 class="success">Authentication Successful!</h1>
        <p>You have successfully authenticated with Patreon.</p>
        <p><strong>You can now close this window and return to SketchUp.</strong></p>
        <p style="font-size: 14px; color: #718096; margin-top: 30px;">
          Your SketchShaper Pro extension will automatically detect the successful authentication.
        </p>
      </div>
    </body>
    </html>
  `;
}
