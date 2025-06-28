// api/callback.js - Handles Patreon OAuth callback and exchanges code for tokens

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

  async function exchangeCodeForTokens(code) {
    const tokenUrl = 'https://www.patreon.com/api/oauth2/token';
    
    const params = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: 'GhVd_dyhxHNkxgmYCAAjuP-9ohELe-aVI-BaxjeuQ3Shpo1NBEBrveQ9OHiKLDEe',
      client_secret: 'NiL8Ip6NzIeAcsIjZ-hk_61VRt9ONo0JVBvxZsJi2tQ-OUedCuRHKCJTgyoOFFJj',
      redirect_uri: 'https://api2.sketchshaper.com/callback'
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SketchShaper-Pro/1.0'
        },
        body: params.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange failed:', response.status, errorText);
        throw new Error(`Token exchange failed: ${response.status}`);
      }

      const tokenData = await response.json();
      console.log('Token exchange successful');
      return tokenData;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw error;
    }
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

    // Exchange authorization code for access tokens
    try {
      console.log('Exchanging authorization code for tokens...');
      const tokenData = await exchangeCodeForTokens(code);
      
      // Store the complete token data for the SketchUp extension to retrieve
      global.authSessions.set(state, {
        status: 'completed',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type,
        scope: tokenData.scope,
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

    } catch (tokenError) {
      console.error('Token exchange error:', tokenError);
      
      // Store error in session
      global.authSessions.set(state, {
        status: 'error',
        error: 'Failed to exchange authorization code for access token',
        timestamp: Date.now()
      });

      return res.status(500).send(`
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
          <h1 class="error">Authentication Error</h1>
          <p>Failed to complete authentication process.</p>
          <p>You can close this window and try again.</p>
        </body>
        </html>
      `);
    }

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
