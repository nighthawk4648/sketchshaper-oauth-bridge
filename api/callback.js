// api/callback.js - Handles Patreon OAuth callback and exchanges code for tokens

export default async function handler(req, res) {
  // Initialize global storage for auth sessions (in production, use Redis or database)
  if (!global.authSessions) {
    global.authSessions = new Map();
  }

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
    
    const body = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: 'GhVd_dyhxHNkxgmYCAAjuP-9ohELe-aVI-BaxjeuQ3Shpo1NBEBrveQ9OHiKLDEe',
      client_secret: 'NiL8Ip6NzIeAcsIjZ-hk_61VRt9ONo0JVBvxZsJi2tQ-OUedCuRHKCJTgyoOFFJj',
      redirect_uri: 'https://api2.sketchshaper.com/callback'
    });

    try {
      // Use dynamic import for node-fetch if available, or use built-in fetch
      let fetch;
      try {
        fetch = globalThis.fetch;
      } catch (e) {
        // Fallback - try to import node-fetch
        const nodeFetch = await import('node-fetch');
        fetch = nodeFetch.default;
      }

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SketchShaper-Pro/1.0'
        },
        body: body.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange failed:', response.status, errorText);
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
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

    console.log('Callback received:', { 
      hasCode: !!code, 
      state: state, 
      hasError: !!error,
      timestamp: new Date().toISOString()
    });

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      
      // Store error in session
      if (state) {
        try {
          global.authSessions.set(state, {
            status: 'error',
            error: error_description || error,
            timestamp: Date.now()
          });
        } catch (sessionError) {
          console.error('Error storing session:', sessionError);
        }
      }

      return res.status(400).send(getErrorHtml('Authentication Failed', error_description || error));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { hasCode: !!code, hasState: !!state });
      return res.status(400).send(getErrorHtml('Invalid Request', 'Missing required authentication parameters.'));
    }

    // Exchange authorization code for access tokens
    try {
      console.log('Exchanging authorization code for tokens...');
      const tokenData = await exchangeCodeForTokens(code);
      
      // Store the complete token data for the SketchUp extension to retrieve
      try {
        global.authSessions.set(state, {
          status: 'completed',
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          token_type: tokenData.token_type || 'Bearer',
          scope: tokenData.scope,
          timestamp: Date.now()
        });

        console.log('Auth session stored for state:', state);
      } catch (sessionError) {
        console.error('Error storing session:', sessionError);
        throw new Error('Failed to store authentication session');
      }

      // Return success page
      return res.status(200).send(getSuccessHtml());

    } catch (tokenError) {
      console.error('Token exchange error:', tokenError);
      
      // Store error in session
      try {
        global.authSessions.set(state, {
          status: 'error',
          error: 'Failed to exchange authorization code for access token',
          details: tokenError.message,
          timestamp: Date.now()
        });
      } catch (sessionError) {
        console.error('Error storing error session:', sessionError);
      }

      return res.status(500).send(getErrorHtml('Authentication Error', 'Failed to complete authentication process.'));
    }

  } catch (error) {
    console.error('Callback handler error:', error);
    return res.status(500).send(getErrorHtml('Server Error', 'An unexpected error occurred. Please try again.'));
  }
}

function getErrorHtml(title, message) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center; 
          padding: 50px;
          background: #f7fafc;
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          max-width: 400px;
        }
        .error { color: #e53e3e; }
        .icon {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: #fed7d7;
          color: #e53e3e;
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
        <div class="icon">✕</div>
        <h1 class="error">${title}</h1>
        <p>${message}</p>
        <p>You can close this window and try again.</p>
      </div>
    </body>
    </html>
  `;
}

function getSuccessHtml() {
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
