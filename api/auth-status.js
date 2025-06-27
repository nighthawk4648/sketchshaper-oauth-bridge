// api/auth-status.js
if (typeof global.authSessions === 'undefined') {
  global.authSessions = new Map();
}

export default async function handler(req, res) {
  // Enable CORS
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
    return res.status(400).json({ error: 'State parameter required' });
  }

  const session = global.authSessions.get(state);
  
  if (!session) {
    return res.status(200).json({ 
      status: 'pending',
      message: 'Authentication session not found'
    });
  }

  // Clean up old sessions
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  if (session.timestamp < tenMinutesAgo) {
    global.authSessions.delete(state);
    return res.status(200).json({ 
      status: 'expired',
      message: 'Authentication session expired' 
    });
  }

  if (session.status === 'completed' && session.code) {
    // Exchange code for tokens if not already done
    if (!session.access_token) {
      try {
        const tokenParams = new URLSearchParams({
          code: session.code,
          grant_type: 'authorization_code',
          client_id: process.env.PATREON_CLIENT_ID,
          client_secret: process.env.PATREON_CLIENT_SECRET,
          redirect_uri: process.env.PATREON_REDIRECT_URI
        });

        const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: tokenParams
        });

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          session.access_token = tokenData.access_token;
          session.refresh_token = tokenData.refresh_token;
          session.expires_in = tokenData.expires_in;
          session.token_type = tokenData.token_type;
          session.scope = tokenData.scope;
        } else {
          const errorData = await tokenResponse.text();
          session.status = 'error';
          session.error = `Token exchange failed: ${tokenResponse.status}`;
        }
      } catch (error) {
        session.status = 'error';
        session.error = 'Token exchange error: ' + error.message;
      }
    }

    // Return the session data
    if (session.access_token && session.status !== 'error') {
      const response = {
        status: 'completed',
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
        scope: session.scope
      };

      // Clean up the session
      global.authSessions.delete(state);
      
      return res.status(200).json(response);
    }
  }

  // Return current status
  return res.status(200).json({
    status: session.status || 'pending',
    ...(session.error ? { error: session.error } : {})
  });
}
