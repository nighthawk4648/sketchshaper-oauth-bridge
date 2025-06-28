// api/callback.js - Handle Patreon OAuth callback
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { code, state, error } = req.query;
  
  console.log('Callback received:', { code: !!code, state, error });
  
  if (error) {
    console.error('OAuth error:', error);
    
    // Store error in session
    if (!global.authSessions) {
      global.authSessions = new Map();
    }
    
    if (state) {
      global.authSessions.set(state, {
        status: 'error',
        error: error,
        timestamp: Date.now()
      });
    }
    
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Error</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #e53e3e; background: #fed7d7; padding: 20px; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>Authentication Error</h2>
          <p>${error}</p>
          <p>You can close this window and try again.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  if (!code || !state) {
    console.error('Missing code or state parameter');
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Error</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #e53e3e; background: #fed7d7; padding: 20px; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>Authentication Error</h2>
          <p>Missing required parameters. Please try again.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PATREON_CLIENT_SECRET,
        redirect_uri: process.env.PATREON_REDIRECT_URI
      })
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful:', {
      access_token: !!tokenData.access_token,
      refresh_token: !!tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      scope: tokenData.scope
    });
    
    // Initialize global authSessions if it doesn't exist
    if (!global.authSessions) {
      global.authSessions = new Map();
    }
    
    // Store the authentication data
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
          }
          .success-icon {
            width: 60px;
            height: 60px;
            background: #48bb78;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            color: white;
            font-size: 24px;
          }
          h1 {
            color: #2d3748;
            margin-bottom: 10px;
          }
          p {
            color: #718096;
            margin-bottom: 30px;
            line-height: 1.5;
          }
          .note {
            background: #f7fafc;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #48bb78;
            color: #4a5568;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✓</div>
          <h1>Authentication Successful!</h1>
          <p>You have successfully authenticated with Patreon.</p>
          <div class="note">
            <strong>You can now close this window and return to SketchUp.</strong><br>
            Your SketchShaper Pro extension will automatically detect the successful authentication.
          </div>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Callback processing error:', error);
    
    // Store error in session
    if (!global.authSessions) {
      global.authSessions = new Map();
    }
    
    global.authSessions.set(state, {
      status: 'error',
      error: 'Failed to process authentication',
      timestamp: Date.now()
    });
    
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Error</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #e53e3e; background: #fed7d7; padding: 20px; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>Authentication Error</h2>
          <p>Failed to process authentication. Please try again.</p>
          <p>Error: ${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
}
