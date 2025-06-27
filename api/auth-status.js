import fetch from 'node-fetch';

// Initialize sessions if not exists
global.authSessions = global.authSessions || new Map();

export default async function handler(req, res) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { state } = req.query;

    if (!state) {
      return res.status(400).json({ 
        status: 'error',
        error: 'State parameter required' 
      });
    }

    const session = global.authSessions.get(state);
    
    if (!session) {
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication session not found'
      });
    }

    // Session expiration (10 minutes)
    const tenMinutesAgo = Date.now() - 600000;
    if (session.timestamp < tenMinutesAgo) {
      global.authSessions.delete(state);
      return res.status(200).json({ 
        status: 'expired',
        message: 'Session expired' 
      });
    }

    if (session.status === 'completed' && session.code && !session.access_token) {
      // Token exchange
      const tokenParams = new URLSearchParams();
      tokenParams.append('code', session.code);
      tokenParams.append('grant_type', 'authorization_code');
      tokenParams.append('client_id', process.env.PATREON_CLIENT_ID);
      tokenParams.append('client_secret', process.env.PATREON_CLIENT_SECRET);
      tokenParams.append('redirect_uri', process.env.PATREON_REDIRECT_URI);

      const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenParams
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();
      session.access_token = tokenData.access_token;
      session.refresh_token = tokenData.refresh_token;
      session.expires_in = tokenData.expires_in;
    }

    if (session.access_token) {
      const response = {
        status: 'completed',
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in
      };
      global.authSessions.delete(state);
      return res.status(200).json(response);
    }

    return res.status(200).json({
      status: session.status || 'pending',
      ...(session.error && { error: session.error })
    });

  } catch (error) {
    console.error('Auth status error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      details: error.message 
    });
  }
}
