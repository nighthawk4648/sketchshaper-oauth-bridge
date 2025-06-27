// api/auth-status.js - Fixed version with proper token exchange
if (typeof global.authSessions === 'undefined') {
  global.authSessions = new Map();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { state } = req.query;
    if (!state) {
      return res.status(400).json({ error: 'State parameter required' });
    }

    const session = global.authSessions.get(state);
    if (!session) {
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }

    // Clean up old sessions (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    if (session.timestamp < fiveMinutesAgo) {
      global.authSessions.delete(state);
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    if (session.status === 'completed' && session.code) {
      // If we have a code but no tokens, exchange the code for tokens
      if (!session.access_token) {
        console.log('Exchanging code for tokens...');
        
        try {
          const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              code: session.code,
              grant_type: 'authorization_code',
              client_id: 'GhVd_dyhxHNkxgmYCAAjuP-9ohELe-aVI-BaxjeuQ3Shpo1NBEBrveQ9OHiKLDEe',
              client_secret: 'NiL8Ip6NzIeAcsIjZ-hk_61VRt9ONo0JVBvxZsJi2tQ-OUedCuRHKCJTgyoOFFJj',
              redirect_uri: 'https://api2.sketchshaper.com/callback'
            })
          });

          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            
            // Store tokens in session
            session.access_token = tokenData.access_token;
            session.refresh_token = tokenData.refresh_token;
            session.expires_in = tokenData.expires_in;
            session.token_type = tokenData.token_type;
            
            // Update the session
            global.authSessions.set(state, session);
            
            console.log('Token exchange successful');
          } else {
            const errorData = await tokenResponse.text();
            console.error('Token exchange failed:', errorData);
            
            // Mark session as error
            session.status = 'error';
            session.error = 'Failed to exchange authorization code for tokens';
            global.authSessions.set(state, session);
          }
        } catch (error) {
          console.error('Token exchange error:', error);
          session.status = 'error';
          session.error = 'Token exchange failed: ' + error.message;
          global.authSessions.set(state, session);
        }
      }

      // Return the session data with tokens
      const response = {
        status: session.status,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
        state: state
      };

      // Clean up the session after successful retrieval
      if (session.access_token) {
        global.authSessions.delete(state);
      }

      console.log('Auth status returned:', { status: session.status, hasToken: !!session.access_token });
      return res.status(200).json(response);
      
    } else if (session.status === 'error') {
      const response = {
        status: 'error',
        error: session.error
      };
      // Clean up error sessions
      global.authSessions.delete(state);
      return res.status(200).json(response);
    }

    // Still pending
    return res.status(200).json({ 
      status: 'pending',
      message: 'Authentication still in progress' 
    });

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error' 
    });
  }
}
