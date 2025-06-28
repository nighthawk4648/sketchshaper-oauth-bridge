import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

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

    // Get session from Redis
    const sessionData = await redis.get(`auth_session:${state}`);
    
    if (!sessionData) {
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }

    const session = JSON.parse(sessionData);
    
    // Check if session is expired (5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    if (session.timestamp < fiveMinutesAgo) {
      await redis.del(`auth_session:${state}`);
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
      response.code = session.code;
      response.state = state;
      // Clean up the session after successful retrieval
      await redis.del(`auth_session:${state}`);
    } else if (session.status === 'error') {
      response.error = session.error;
      // Clean up error sessions too
      await redis.del(`auth_session:${state}`);
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
