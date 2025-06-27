// api/callback.js - Handles Patreon OAuth callback
// Using global object to share state between functions (not ideal for production)
if (!global.authSessions) {
  global.authSessions = new Map();
}

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

    console.log('Callback received:', { code: !!code, state, error });

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      
      // Store error in session
      if (state) {
        global.authSessions.set(state, {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now()
        });
      }

      return res.status(400).send(`
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
          <p>${error_description || error}</p>
          <p>You can close this window and try again.</p>
        </body>
        </html>
      `);
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      return res.status(400).send(`
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
          <h1 class="error">Invalid Request</h1>
          <p>Missing required authentication parameters.</p>
          <p>You can close this window and try again.</p>
        </body>
        </html>
      `);
    }

    // Store the authorization code for the SketchUp extension to retrieve
    global.authSessions.set(state, {
      status: 'completed',
      code: code,
      timestamp: Date.now()
    });

    console.log('Auth session stored for state:', state);

    // Return success page
    return res.status(200).send(`
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
          .logo {
            margin-bottom: 20px;
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
    `);

  } catch (error) {
    console.error('Callback handler error:', error);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Server Error</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #e53e3e; }
        </style>
      </head>
      <body>
        <h1 class="error">Server Error</h1>
        <p>An unexpected error occurred. Please try again.</p>
        <p>You can close this window and try again.</p>
      </body>
      </html>
    `);
  }
}
