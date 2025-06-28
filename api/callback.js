// api/callback.js
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
  console.log('=== CALLBACK HANDLER START ===');
  console.log('Method:', req.method);
  console.log('Query:', req.query);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - returning 200');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    console.log('Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;

  const missingVars = [];
  if (!process.env.PATREON_CLIENT_ID) missingVars.push('PATREON_CLIENT_ID');
  if (!process.env.PATREON_CLIENT_SECRET) missingVars.push('PATREON_CLIENT_SECRET');
  if (!process.env.PATREON_REDIRECT_URI) missingVars.push('PATREON_REDIRECT_URI');

  if (missingVars.length > 0) {
    console.error('Missing required Patreon environment variables:', missingVars);
    return res.status(500).json({
      error: 'Server misconfigured - missing environment variables',
      missing: missingVars
    });
  }

  if (error) {
    console.error('OAuth error received:', error, error_description);
    return res.status(400).send(getErrorHTML(error_description || error));
  }

  if (!code || typeof code !== 'string' || code.length < 10 || !state || typeof state !== 'string' || state.length < 10) {
    return res.status(400).send(getErrorHTML('Invalid or missing code/state parameters'));
  }

  const session = {
    status: 'completed',
    code,
    timestamp: Date.now(),
    nodeId: process.env.VERCEL_REGION || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown'
  };

  let stored = false;
  let storageMethod = 'none';
  let redisTestResult = null;

  if (redis) {
    try {
      await redis.ping();
      redisTestResult = 'success';
      await redis.setex(`auth:${state}`, 600, JSON.stringify(session));
      const verify = await redis.get(`auth:${state}`);
      if (verify) {
        stored = true;
        storageMethod = 'redis';
      } else {
        console.warn('Redis verification failed after setex');
      }
    } catch (err) {
      console.error('Redis error during session storage:', err.message);
    }
  } else {
    console.warn('Redis not initialized or connection failed');
  }

  if (!stored) {
    console.log('Falling back to global storage');
    if (!global.authSessions) global.authSessions = new Map();
    global.authSessions.set(state, session);
    if (global.authSessions.get(state)) {
      stored = true;
      storageMethod = 'global';
    }
  }

  if (!stored) {
    return res.status(500).send(getErrorHTML(`Failed to store session. Redis available: ${!!redis}, Redis test: ${redisTestResult}, Redis error: ${redisError}`));
  }

  return res.status(200).send(getSuccessHTML({
    state,
    timestamp: new Date(session.timestamp).toISOString(),
    nodeId: session.nodeId,
    storageMethod,
    redisAvailable: !!redis,
    redisTestResult
  }));
}

function getErrorHTML(message) {
  return `<!DOCTYPE html><html><head><title>Authentication Error</title></head><body><h1>Error</h1><p>${message}</p></body></html>`;
}

function getSuccessHTML(debugInfo = {}) {
  return `<!DOCTYPE html><html><head><title>Success</title></head><body><h1>Success</h1><pre>${JSON.stringify(debugInfo, null, 2)}</pre></body></html>`;
}
