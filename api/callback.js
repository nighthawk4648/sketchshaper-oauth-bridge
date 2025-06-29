// api/callback.js - OAuth callback handler
const cors = require('cors');
const SessionManager = require('../lib/sessionManager');
const PatreonClient = require('../lib/patreonClient');

// CORS configuration
const corsOptions = {
  origin: ['https://api2.sketchshaper.com', 'http://localhost:3000', 'https://localhost:3000'],
  credentials: true,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = async (req, res) => {
  try {
    // Apply CORS
    await new Promise((resolve, reject) => {
      cors(corsOptions)(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Only allow GET requests
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse query parameters - Use req.query for Vercel
    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;

    console.log(`OAuth callback received - State: ${state}, Code: ${code ? 'present' : 'missing'}, Error: ${error}`);
    console.log('Full query:', req.query);

    if (error) {
      console.error('OAuth error:', error);
      if (state) {
        await SessionManager.updateSession(state, {
          status: 'error',
          error: error,
          completedAt: Date.now()
        });
      }
      return res.status(200).send(getCallbackHtml('error', `Authentication failed: ${error}`));
    }

    if (!code || !state) {
      console.error('Missing code or state in callback');
      console.error('Code:', code);
      console.error('State:', state);
      console.error('All query params:', req.query);
      
      if (state) {
        await SessionManager.updateSession(state, {
          status: 'error',
          error: 'Missing authorization code',
          completedAt: Date.now()
        });
      }
      return res.status(200).send(getCallbackHtml('error', 'Invalid callback parameters'));
    }

    try {
      // Exchange code for tokens
      const patreonClient = new PatreonClient();
      const tokenData = await patreonClient.exchangeCodeForToken(code);
      
      if (!tokenData) {
        throw new Error('Token exchange returned null');
      }
      
      // Update session with token data
      await SessionManager.updateSession(state, {
        status: 'completed',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type,
        completedAt: Date.now()
      });

      console.log(`Authentication completed for state: ${state}`);
      res.status(200).send(getCallbackHtml('success', 'Authentication successful! You can close this window.'));

    } catch (tokenError) {
      console.error('Token exchange failed:', tokenError);
      await SessionManager.updateSession(state, {
        status: 'error',
        error: 'Token exchange failed',
        completedAt: Date.now()
      });
      res.status(200).send(getCallbackHtml('error', 'Failed to exchange authorization code'));
    }

  } catch (error) {
    console.error('Callback processing error:', error);
    res.status(200).send(getCallbackHtml('error', 'Authentication processing failed'));
  }
};

// Generate callback HTML
function getCallbackHtml(status, message) {
  const isSuccess = status === 'success';
  const bgColor = isSuccess ? '#f0f9ff' : '#fef2f2';
  const textColor = isSuccess ? '#1e40af' : '#dc2626';
  const icon = isSuccess ? '✅' : '❌';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>SketchShaper Authentication</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: ${bgColor};
          margin: 0;
          padding: 40px 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .container {
          background: white;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          text-align: center;
          max-width: 500px;
          width: 100%;
        }
        .icon {
          font-size: 48px;
          margin-bottom: 20px;
        }
        h1 {
          color: ${textColor};
          margin: 0 0 15px 0;
          font-size: 24px;
        }
        p {
          color: #6b7280;
          margin: 0 0 30px 0;
          font-size: 16px;
          line-height: 1.5;
        }
        .btn {
          background: ${textColor};
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .btn:hover {
          opacity: 0.9;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${icon}</div>
        <h1>${isSuccess ? 'Authentication Successful!' : 'Authentication Failed'}</h1>
        <p>${message}</p>
        <button class="btn" onclick="window.close()">Close Window</button>
      </div>
      <script>
        // Auto-close after 5 seconds
        setTimeout(() => {
          window.close();
        }, 5000);
        
        // Post message to parent window if in popup
        if (window.opener) {
          window.opener.postMessage({
            type: 'patreon-auth-callback',
            status: '${status}',
            message: '${message}'
          }, '*');
        }
      </script>
    </body>
    </html>
  `;
}