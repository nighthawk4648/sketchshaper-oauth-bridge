// api/auth-status.js - Vercel-compatible version without file system operations
export default async function handler(req, res) {
  console.log('=== AUTH STATUS REQUEST START ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query:', req.query);

  try {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS request');
      return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
      console.log('Invalid method:', req.method);
      return res.status(405).json({ 
        error: 'Method not allowed',
        method: req.method,
        timestamp: Date.now()
      });
    }

    const { state, code } = req.query;
    
    console.log('=== AUTH STATUS CHECK ===');
    console.log('State parameter:', state);
    console.log('Code parameter:', code ? 'Present' : 'Missing');
    console.log('Environment variables check:');
    console.log('- PATREON_CLIENT_ID:', process.env.PATREON_CLIENT_ID ? 'Set' : 'Missing');
    console.log('- PATREON_CLIENT_SECRET:', process.env.PATREON_CLIENT_SECRET ? 'Set' : 'Missing');
    console.log('- PATREON_REDIRECT_URI:', process.env.PATREON_REDIRECT_URI || 'Missing');
    
    if (!state) {
      console.log('Missing state parameter');
      return res.status(400).json({ 
        error: 'State parameter required',
        timestamp: Date.now()
      });
    }

    // Simplified state parameter validation
    if (typeof state !== 'string' || state.length < 8) {
      console.log('Invalid state parameter format:', state);
      return res.status(400).json({ 
        error: 'Invalid state parameter format',
        state: state,
        timestamp: Date.now()
      });
    }

    // If we have a code parameter, exchange it for tokens immediately
    if (code) {
      console.log('Authorization code provided, exchanging for tokens...');
      
      try {
        const tokenData = await exchangeCodeForTokens(code);
        
        if (tokenData && tokenData.access_token) {
          console.log('Token exchange successful');
          return res.status(200).json({
            status: 'completed',
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            state: state,
            timestamp: Date.now()
          });
        } else {
          console.log('Token exchange failed - no access_token received');
          return res.status(400).json({
            status: 'error',
            error: 'Failed to exchange authorization code for tokens',
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error('Token exchange error:', error);
        return res.status(400).json({
          status: 'error',
          error: 'Token exchange failed: ' + error.message,
          timestamp: Date.now()
        });
      }
    }

    // If no code, return pending status
    console.log('No authorization code provided, returning pending status');
    return res.status(200).json({ 
      status: 'pending',
      message: 'Authentication session pending - waiting for authorization code',
      timestamp: Date.now(),
      state: state
    });

  } catch (error) {
    console.error('=== AUTH STATUS ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      message: error.message,
      timestamp: Date.now()
    });
  }
}

// Function to exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  try {
    const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID;
    const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
    const PATREON_REDIRECT_URI = process.env.PATREON_REDIRECT_URI;

    if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET || !PATREON_REDIRECT_URI) {
      throw new Error('Missing required environment variables for token exchange');
    }

    const tokenUrl = 'https://www.patreon.com/api/oauth2/token';
    
    const params = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: PATREON_CLIENT_ID,
      client_secret: PATREON_CLIENT_SECRET,
      redirect_uri: PATREON_REDIRECT_URI
    });

    console.log('Making token exchange request to Patreon...');
    console.log('Request details:');
    console.log('- URL:', tokenUrl);
    console.log('- Client ID:', PATREON_CLIENT_ID ? 'Set' : 'Missing');
    console.log('- Client Secret:', PATREON_CLIENT_SECRET ? 'Set' : 'Missing');
    console.log('- Redirect URI:', PATREON_REDIRECT_URI);
    console.log('- Code length:', code ? code.length : 'Missing');
    
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
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    console.log('Token exchange successful - received keys:', Object.keys(tokenData));
    
    return tokenData;
  } catch (error) {
    console.error('Token exchange error details:', {
      message: error.message,
      name: error.name
    });
    throw error;
  }
}
