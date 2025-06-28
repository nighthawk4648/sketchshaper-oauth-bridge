// api/auth-status.js - Endpoint for SketchUp extension to poll authentication status
export default function handler(req, res) {
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

    // Check if global authSessions exists
    if (!global.authSessions) {
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
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

    // Return the session data
    const response = {
      status: session.status,
      timestamp: session.timestamp
    };

    if (session.status === 'completed') {
      // Return the token data that the SketchUp extension expects
      response.access_token = session.access_token;
      response.refresh_token = session.refresh_token;
      response.expires_in = session.expires_in;
      response.token_type = session.token_type;
      response.scope = session.scope;
      
      // Clean up the session after successful retrieval
      global.authSessions.delete(state);
      
      console.log('Auth tokens retrieved for state:', state);
    } else if (session.status === 'error') {
      response.error = session.error;
      // Clean up error sessions too
      global.authSessions.delete(state);
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
