if (typeof global.authSessions === 'undefined') {
  global.authSessions = new Map();
}

export default async function handler(req, res) {
  console.log('=== AUTH STATUS REQUEST ===');
  console.log('Method:', req.method);
  console.log('Query:', req.query);
  console.log('Headers:', req.headers);
  console.log('Current sessions:', Array.from(global.authSessions.keys()));

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
  
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    console.log('Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { state } = req.query;
    console.log('Looking for state:', state);
    
    if (!state) {
      console.log('No state parameter provided');
      return res.status(400).json({ error: 'State parameter required' });
    }

    const session = global.authSessions.get(state);
    console.log('Session found:', !!session);
    
    if (!session) {
      console.log('No session found for state:', state);
      console.log('Available sessions:', Array.from(global.authSessions.entries()));
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending',
        debug: {
          state: state,
          availableSessions: Array.from(global.authSessions.keys())
        }
      });
    }

    console.log('Session data:', JSON.stringify(session, null, 2));

    // Clean up old sessions (older than 10 minutes for debugging)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (session.timestamp < tenMinutesAgo) {
      console.log('Session expired, cleaning up');
      global.authSessions.delete(state);
      return res.status(200).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    if (session.status === 'completed' && session.code) {
      console.log('Session completed, checking for tokens...');
      
      // If we have a code but no tokens, exchange the code for tokens
      if (!session.access_token) {
        console.log('No access token found, exchanging code for tokens...');
        
        try {
          const tokenParams = new URLSearchParams({
            code: session.code,
            grant_type: 'authorization_code',
            client_id: 'GhVd_dyhxHNkxgmYCAAjuP-9ohELe-aVI-BaxjeuQ3Shpo1NBEBrveQ9OHiKLDEe',
            client_secret: 'NiL8Ip6NzIeAcsIjZ-hk_61VRt9ONo0JVBvxZsJi2tQ-OUedCuRHKCJTgyoOFFJj',
            redirect_uri: 'https://api2.sketchshaper.com/callback'
          });

          console.log('Token exchange params:', tokenParams.toString());

          const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'SketchShaper-Pro/1.0'
            },
            body: tokenParams
          });

          console.log('Token response status:', tokenResponse.status);
          
          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            console.log('Token exchange successful:', Object.keys(tokenData));
            
            // Store tokens in session
            session.access_token = tokenData.access_token;
            session.refresh_token = tokenData.refresh_token;
            session.expires_in = tokenData.expires_in;
            session.token_type = tokenData.token_type;
            session.scope = tokenData.scope;
            
            // Update the session
            global.authSessions.set(state, session);
            console.log('Session updated with tokens');
            
          } else {
            const errorData = await tokenResponse.text();
            console.error('Token exchange failed:', tokenResponse.status, errorData);
            
            // Mark session as error
            session.status = 'error';
            session.error = `Failed to exchange authorization code: ${tokenResponse.status} - ${errorData}`;
            global.authSessions.set(state, session);
          }
        } catch (error) {
          console.error('Token exchange error:', error);
          session.status = 'error';
          session.error = 'Token exchange failed: ' + error.message;
          global.authSessions.set(state, session);
        }
      }

      // Return the session data
      if (session.access_token && session.status !== 'error') {
        console.log('Returning successful auth data');
        
        const response = {
          status: 'completed',
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          token_type: session.token_type || 'Bearer',
          scope: session.scope,
          state: state
        };

        // Clean up the session after successful retrieval
        global.authSessions.delete(state);
        console.log('Session cleaned up after successful auth');
        
        return res.status(200).json(response);
      }
      
    } else if (session.status === 'error') {
      console.log('Session has error status:', session.error);
      const response = {
        status: 'error',
        error: session.error
      };
      // Clean up error sessions
      global.authSessions.delete(state);
      return res.status(200).json(response);
    }

    // Still pending or other status
    console.log('Session still pending, status:', session.status);
    return res.status(200).json({ 
      status: session.status || 'pending',
      message: 'Authentication still in progress',
      debug: {
        sessionStatus: session.status,
        hasCode: !!session.code,
        hasToken: !!session.access_token,
        timestamp: session.timestamp
      }
    });

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error: ' + error.message 
    });
  }
}
