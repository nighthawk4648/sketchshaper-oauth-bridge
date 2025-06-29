// api/callback.js - Patreon OAuth callback handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;

  console.log('Callback received:', { code: code?.substring(0, 10) + '...', state, error });

  // Handle OAuth error
  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).json({
      status: 'error',
      error: error === 'access_denied' ? 'Access denied by user' : 'OAuth error occurred'
    });
  }

  // Validate required parameters
  if (!code || !state) {
    console.error('Missing required parameters:', { code: !!code, state: !!state });
    return res.status(400).json({
      status: 'error',
      error: 'Missing authorization code or state parameter'
    });
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SketchShaper-Extension/1.0'
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PATREON_CLIENT_SECRET,
        redirect_uri: process.env.PATREON_REDIRECT_URI || 'https://api2.sketchshaper.com/callback'
      }).toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      return res.status(400).json({
        status: 'error',
        error: 'Failed to exchange authorization code for access token'
      });
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful');

    // Store the authentication data temporarily (you might want to use Redis or a database)
    // For now, we'll use Vercel's KV store or in-memory storage
    const authData = {
      status: 'completed',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type || 'Bearer',
      state: state,
      timestamp: Date.now()
    };

    // Store auth data with state as key (expires in 5 minutes)
    await storeAuthData(state, authData);

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
            max-width: 500px;
            width: 100%;
          }
          .success-icon {
            font-size: 48px;
            color: #48bb78;
            margin-bottom: 20px;
          }
          h1 {
            color: #2d3748;
            margin-bottom: 15px;
          }
          p {
            color: #718096;
            line-height: 1.6;
            margin-bottom: 20px;
          }
          .close-btn {
            background: #FF424D;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 12px 24px;
            font-size: 16px;
            cursor: pointer;
            font-weight: 500;
          }
          .close-btn:hover {
            background: #e53e3e;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Authentication Successful!</h1>
          <p>You have successfully authenticated with Patreon. You can now close this window and return to SketchUp.</p>
          <button class="close-btn" onclick="window.close()">Close Window</button>
        </div>
        <script>
          // Auto-close after 3 seconds
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Callback processing error:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Internal server error during authentication'
    });
  }
}
