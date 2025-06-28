// api/auth-status.js - Fixed version with better logging and error handling
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
    
    console.log('=== AUTH STATUS CHECK ===');
    console.log('Requested state:', state);
    console.log('Available sessions:', global.authSessions ? Array.from(global.authSessions.keys()) : 'No global.authSessions');
    console.log('Total sessions:', global.authSessions ? global.authSessions.size : 0);
    
    if (!state) {
      console.log('ERROR: No state parameter provided');
      return res.status(400).json({ error: 'State parameter required' });
    }

    // Initialize global storage if it doesn't exist
    if (!global.authSessions) {
      console.log('WARNING: global.authSessions not found, initializing...');
      global.authSessions = new Map();
    }

    // Get session from storage
    const session = global.authSessions.get(state);
    
    console.log('Session lookup result:', session ? 'FOUND' : 'NOT FOUND');
    if (session) {
      console.log('Session details:', {
        status: session.status,
        hasCode: !!session.code,
        hasAccessToken: !!session.access_token,
        timestamp: new Date(session.timestamp).toISOString()
      });
    }
    
    if (!session) {
      console.log('Session not found - returning pending status');
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending',
        debug: {
          requestedState: state,
          availableStates: Array.from(global.authSessions.keys()),
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if session is expired (10 minutes instead of 5)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (session.timestamp < tenMinutesAgo) {
      console.log('Session expired, deleting...');
      global.authSessions.delete(state);
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    // If we have a code but haven't exchanged it for tokens yet
    if (session.status === 'completed' && session.code && !session.access_token) {
      console.log('Found authorization code, exchanging for tokens...');
      
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

        console.log('Token exchange response status:', tokenResponse.status);

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          
          console.log('Token exchange successful, updating session...');
          
          // Update session with tokens
          session.access_token = tokenData.access_token;
          session.refresh_token = tokenData.refresh_token;
          session.expires_in = tokenData.expires_in;
          session.token_type = tokenData.token_type;
          
          // Save updated session
          global.authSessions.set(state, session);
          
          console.log('Session updated with tokens');
        } else {
          const errorText = await tokenResponse.text();
          console.error('Token exchange failed:', tokenResponse.status, errorText);
          
          session.status = 'error';
          session.error = `Failed to exchange authorization code: ${tokenResponse.status}`;
          global.authSessions.set(state, session);
        }
      } catch (error) {
        console.error('Token exchange error:', error);
        session.status = 'error';
        session.error = 'Token exchange failed: ' + error.message;
        global.authSessions.set(state, session);
      }
    }

    // Prepare response
    const response = {
      status: session.status,
      timestamp: session.timestamp
    };

    if (session.status === 'completed' && session.access_token) {
      console.log('Returning completed session with tokens');
      response.access_token = session.access_token;
      response.refresh_token = session.refresh_token;
      response.expires_in = session.expires_in;
      response.token_type = session.token_type || 'Bearer';
      response.state = state;
      
      // Clean up the session after successful retrieval
      global.authSessions.delete(state);
      console.log('Session cleaned up after successful retrieval');
    } else if (session.status === 'error') {
      console.log('Returning error session');
      response.error = session.error;
      // Clean up error sessions too
      global.authSessions.delete(state);
    } else if (session.status === 'completed' && session.code) {
      console.log('Returning session with code (no tokens yet)');
      response.code = session.code;
    }

    console.log('Final response status:', response.status);
    return res.status(200).json(response);

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error: ' + error.message
    });
  }
}
