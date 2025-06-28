// api/auth-status.js
import fetch from 'node-fetch';
import Redis from 'ioredis';

let redis;
let redisError = null;

try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log('Attempting Redis connection to:', redisUrl.replace(/\/\/.*@/, '//***:***@'));

  redis = new Redis(redisUrl, {
    connectTimeout: 10000,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
  });

  redis.on('connect', () => {
    console.log('Redis connected successfully');
    redisError = null;
  });

  redis.on('error', (error) => {
    console.error('Redis error:', error.message);
    redisError = error.message;
  });

  redis.on('close', () => {
    console.log('Redis connection closed');
  });
} catch (error) {
  console.error('Redis initialization failed:', error.message);
  redisError = error.message;
  redis = null;
}

export default async function handler(req, res) {
  try {
    await internalHandler(req, res);
  } catch (e) {
    console.error('=== TOP-LEVEL FUNCTION CRASH ===');
    console.error(e.stack || e.message);
    return res.status(500).json({ error: 'Top-level crash: ' + e.message });
  }
}

async function internalHandler(req, res) {
  console.log('=== AUTH STATUS HANDLER START ===');
  console.log('Method:', req.method);
  console.log('Query:', req.query);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { state } = req.query;
  if (!state) return res.status(400).json({ error: 'Missing state parameter' });

  let session = null;
  let storageMethod = 'none';
  let redisTestResult = null;

  if (redis) {
    try {
      await redis.ping();
      redisTestResult = 'success';
      const redisData = await redis.get(`auth:${state}`);
      if (redisData) {
        try {
          session = JSON.parse(redisData);
          storageMethod = 'redis';
        } catch (e) {
          console.error('Failed to parse Redis data:', e.message);
        }
      }
    } catch (err) {
      console.error('Redis error:', err.message);
    }
  }

  if (!session) {
    if (!global.authSessions) global.authSessions = new Map();
    session = global.authSessions.get(state);
    if (session) storageMethod = 'global';
  }

  if (!session) {
    return res.status(404).json({
      status: 'pending',
      message: 'Session not found',
      debug: { redisAvailable: !!redis, redisError, redisTestResult }
    });
  }

  const tenMinutesAgo = Date.now() - 600000;
  if (session.timestamp < tenMinutesAgo) {
    if (redis && storageMethod === 'redis') {
      try { await redis.del(`auth:${state}`); } catch (e) { console.error(e.message); }
    }
    if (global.authSessions) global.authSessions.delete(state);
    return res.status(404).json({ status: 'expired', message: 'Session expired' });
  }

  if (session.status === 'completed' && session.code && !session.access_token) {
    if (!process.env.PATREON_CLIENT_ID || !process.env.PATREON_CLIENT_SECRET || !process.env.PATREON_REDIRECT_URI) {
      session.status = 'error';
      session.error = 'Server misconfigured';
    } else {
      try {
        const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: session.code,
            client_id: process.env.PATREON_CLIENT_ID,
            client_secret: process.env.PATREON_CLIENT_SECRET,
            redirect_uri: process.env.PATREON_REDIRECT_URI
          })
        });

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          Object.assign(session, {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            updated_at: Date.now()
          });
        } else {
          session.status = 'error';
          session.error = 'Token exchange failed';
        }
      } catch (e) {
        console.error('Token exchange error:', e.message);
        session.status = 'error';
        session.error = 'Exception during token exchange';
      }

      if (redis && storageMethod === 'redis') {
        try { await redis.setex(`auth:${state}`, 600, JSON.stringify(session)); } catch (e) { console.error(e.message); }
      }
      if (global.authSessions) global.authSessions.set(state, session);
    }
  }

  const response = {
    status: session.status,
    timestamp: session.timestamp,
    storageMethod,
    debug: { redisAvailable: !!redis, redisError, redisTestResult }
  };

  if (session.status === 'completed' && session.access_token) {
    Object.assign(response, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type || 'Bearer',
      state
    });

    if (redis && storageMethod === 'redis') {
      try { await redis.del(`auth:${state}`); } catch (e) { console.error(e.message); }
    }
    if (global.authSessions) global.authSessions.delete(state);
  } else if (session.status === 'error') {
    response.error = session.error;
    if (redis && storageMethod === 'redis') {
      try { await redis.del(`auth:${state}`); } catch (e) { console.error(e.message); }
    }
    if (global.authSessions) global.authSessions.delete(state);
  } else if (session.status === 'completed' && session.code) {
    response.code = session.code;
  }

  return res.status(200).json(response);
}
