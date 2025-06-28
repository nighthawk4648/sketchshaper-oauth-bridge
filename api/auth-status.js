// api/auth-status.js - Check authentication status
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
    
    console.log('Checking auth status for state:', state);
    
    // Initialize global authSessions if it doesn't exist
    if (!global.authSessions) {
      global.authSessions = new Map();
    }
    
    const session = global.authSessions.get(state);
    
    if (!session) {
      console.log('No session found for state:', state);
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }
    
    // Clean up old sessions (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (session.timestamp < tenMinutesAgo) {
      console.log('Session expired for state:', state);
      global.authSessions.delete(state);
      return res.status(200).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }
    
    console.log('Session found for state:', state, 'Status:', session.status);
    
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
      response.token_type = session.token_type || 'Bearer';
      response.scope = session.scope;
      
      console.log('Returning completed auth tokens for state:', state);
      console.log('Access token length:', session.access_token ? session.access_token.length : 'undefined');
      
      // Clean up the session after successful retrieval
      global.authSessions.delete(state);
      
    } else if (session.status === 'error') {
      response.error = session.error || 'Unknown authentication error';
      console.log('Returning auth error for state:', state, 'Error:', response.error);
      
      // Clean up error sessions too
      global.authSessions.delete(state);
    }
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      message: error.message 
    });
  }
}
