// api/auth-status.js - Fixed version with Redis for persistent storage
import { createClient } from 'redis';

// Initialize Redis client
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redis.on('error', (err) => console.error('Redis Client Error', err));

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

    // Connect to Redis if not already connected
    if (!redis.isOpen) {
      await redis.connect();
    }

    // Try to get the session from Redis
    const sessionKey = `auth_session:${state}`;
    const sessionData = await redis.get(sessionKey);

    if (!sessionData) {
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }

    const session = JSON.parse(sessionData);

    // Check if session has expired (5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    if (session.timestamp < fiveMinutesAgo) {
      await redis.del(sessionKey);
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    // Prepare response
    const response = {
      status: session.status,
      timestamp: session.timestamp
    };

    if (session.status === 'completed') {
      // Include tokens if server handled the exchange
      if (session.access_token) {
        response.access_token = session.access_token;
        response.refresh_token = session.refresh_token;
        response.expires_in = session.expires_in;
        response.token_type = session.token_type;
      } else {
        // Include auth code for client-side exchange
        response.code = session.code;
      }
      response.state = state;
      
      // Clean up the session after successful retrieval
      await redis.del(sessionKey);
      
    } else if (session.status === 'error') {
      response.error = session.error;
      // Clean up error sessions too
      await redis.del(sessionKey);
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
