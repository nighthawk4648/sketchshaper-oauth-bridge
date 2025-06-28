// api/auth-status.js - Updated to exchange code for tokens
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // Enable CORS
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

    // Get session from your storage (Redis/Database/File)
    const session = await getSession(state); // Implement this based on your storage
    
    if (!session) {
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }

    // Check if session is expired (5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    if (session.timestamp < fiveMinutesAgo) {
      await deleteSession(state); // Implement this
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    // If we have a code but haven't exchanged it for tokens yet
    if (session.status === 'completed' && session.code && !session.access_token) {
      console.log('Exchanging code for tokens...');
      
      try {
        // Exchange authorization code for access token
        const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: session.code,
            client_id: process.env.PATREON_CLIENT_ID,
            client_secret: process.env.PATREON_CLIENT_SECRET,
            redirect_uri: process.env.PATREON_REDIRECT_URI,
          }),
        });

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          
          // Update session with tokens
          session.access_token = tokenData.access_token;
          session.refresh_token = tokenData.refresh_token;
          session.expires_in = tokenData.expires_in;
          session.token_type = tokenData.token_type;
          
          // Save updated session
          await saveSession(state, session); // Implement this
          
          console.log('Token exchange successful');
        } else {
          const errorText = await tokenResponse.text();
          console.error('Token exchange failed:', errorText);
          
          session.status = 'error';
          session.error = 'Failed to exchange authorization code for access token';
          await saveSession(state, session);
        }
      } catch (error) {
        console.error('Token exchange error:', error);
        session.status = 'error';
        session.error = 'Token exchange failed';
        await saveSession(state, session);
      }
    }

    // Return the session data
    const response = {
      status: session.status,
      timestamp: session.timestamp
    };

    if (session.status === 'completed' && session.access_token) {
      response.access_token = session.access_token;
      response.refresh_token = session.refresh_token;
      response.expires_in = session.expires_in;
      response.token_type = session.token_type || 'Bearer';
      response.state = state;
      
      // Clean up the session after successful retrieval
      await deleteSession(state);
    } else if (session.status === 'error') {
      response.error = session.error;
      // Clean up error sessions too
      await deleteSession(state);
    }

    console.log('Auth status checked for state:', state, 'Status:', session.status);
    return res.status(200).json(response);

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error' 
    });
  }
}

// Implement these functions based on your storage solution:

async function getSession(state) {
  // For Redis:
  // const sessionData = await redis.get(`auth_session:${state}`);
  // return sessionData ? JSON.parse(sessionData) : null;
  
  // For Database:
  // const result = await pool.query('SELECT * FROM auth_sessions WHERE state = $1', [state]);
  // return result.rows[0] || null;
  
  // For global (temporary):
  return global.authSessions?.get(state) || null;
}

async function saveSession(state, session) {
  // For Redis:
  // await redis.setex(`auth_session:${state}`, 300, JSON.stringify(session));
  
  // For Database:
  // await pool.query('UPDATE auth_sessions SET status = $1, access_token = $2, refresh_token = $3, expires_in = $4 WHERE state = $5',
  //   [session.status, session.access_token, session.refresh_token, session.expires_in, state]);
  
  // For global (temporary):
  if (!global.authSessions) global.authSessions = new Map();
  global.authSessions.set(state, session);
}

async function deleteSession(state) {
  // For Redis:
  // await redis.del(`auth_session:${state}`);
  
  // For Database:
  // await pool.query('DELETE FROM auth_sessions WHERE state = $1', [state]);
  
  // For global (temporary):
  global.authSessions?.delete(state);
}
