// api/auth-status.js - Endpoint for SketchUp extension to poll authentication status
// Initialize global auth sessions if not exists
if (typeof global.authSessions === 'undefined') {
  global.authSessions = new Map();
}

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
    // On your Vercel server after successful auth:
const response = await fetch('http://localhost:SOME_PORT/auth-complete', {
  method: 'POST',
  body: JSON.stringify({ access_token, refresh_token, expires_in })
});

    if (session.status === 'completed') {
      response.code = session.code;
      response.state = state;
      // Clean up the session after successful retrieval
      global.authSessions.delete(state);
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
