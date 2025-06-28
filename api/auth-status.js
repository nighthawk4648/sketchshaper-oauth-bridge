// api/auth-status.js - Enhanced Debug Version
import fetch from 'node-fetch';
import Redis from 'ioredis';

// Initialize Redis client with better error handling
let redis;
let redisError = null;

try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log('Attempting Redis connection to:', redisUrl.replace(/\/\/.*@/, '//***:***@')); // Hide credentials in logs
  
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
  console.log('=== AUTH STATUS HANDLER START ===');
  console.log('Method:', req.method);
  console.log('Query:', req.query);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - returning 200');
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    console.log('Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { state } = req.query;
    
    console.log('=== ENVIRONMENT CHECK ===');
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('VERCEL_REGION:', process.env.VERCEL_REGION);
    console.log('REDIS_URL present:', !!process.env.REDIS_URL);
    console.log('PATREON_CLIENT_ID present:', !!process.env.PATREON_CLIENT_ID);
    console.log('PATREON_CLIENT_SECRET present:', !!process.env.PATREON_CLIENT_SECRET);
    console.log('PATREON_REDIRECT_URI present:', !!process.env.PATREON_REDIRECT_URI);
    
    console.log('=== AUTH STATUS CHECK ===');
    console.log('Requested state:', state);
    console.log('Redis available:', !!redis);
    console.log('Redis error:', redisError);
    
    if (!state) {
      console.log('ERROR: No state parameter provided');
      return res.status(400).json({ 
        error: 'State parameter required',
        debug: {
          timestamp: new Date().toISOString(),
          region: process.env.VERCEL_REGION
        }
      });
    }

    let session = null;
    let storageMethod = 'none';
    let redisTestResult = null;

    // Test Redis connection first
    if (redis) {
      try {
        console.log('Testing Redis connection...');
        await redis.ping();
        console.log('Redis ping successful');
        redisTestResult = 'success';
      } catch (pingError) {
        console.error('Redis ping failed:', pingError.message);
        redisTestResult = pingError.message;
      }
    }

    // Try Redis first
    if (redis && redisTestResult === 'success') {
      try {
        console.log('Attempting to retrieve from Redis...');
        const redisData = await redis.get(`auth:${state}`);
        if (redisData) {
          session = JSON.parse(redisData);
          storageMethod = 'redis';
          console.log('Session found in Redis');
        } else {
          console.log('Session not found in Redis');
        }
      } catch (redisError) {
        console.error('Redis retrieval error:', redisError.message);
        console.log('Falling back to global storage due to Redis error');
      }
    } else {
      console.log('Skipping Redis due to connection issues');
    }

    // Fallback to global storage
    if (!session) {
      console.log('Checking global storage...');
      if (!global.authSessions) {
        console.log('WARNING: global.authSessions not found, initializing...');
        global.authSessions = new Map();
      }

      session = global.authSessions.get(state);
      if (session) {
        storageMethod = 'global';
        console.log('Session found in global storage');
      } else {
        console.log('Session not found in global storage either');
      }
    }

    console.log('=== SESSION LOOKUP RESULT ===');
    console.log('Session found:', !!session);
    console.log('Storage method:', storageMethod);
    console.log('Redis test result:', redisTestResult);
    
    if (session) {
      console.log('Session details:', {
        status: session.status,
        hasCode: !!session.code,
        hasAccessToken: !!session.access_token,
        timestamp: new Date(session.timestamp).toISOString(),
        age: Date.now() - session.timestamp
      });
    }
    
    if (!session) {
      console.log('Session not found - returning pending status');
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending',
        debug: {
          requestedState: state,
          storageMethod: storageMethod,
          redisAvailable: !!redis,
          redisError: redisError,
          redisTestResult: redisTestResult,
          globalSessionsSize: global.authSessions ? global.authSessions.size : 0,
          timestamp: new Date().toISOString(),
          region: process.env.VERCEL_REGION
        }
      });
    }

    // Check if session is expired (10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (session.timestamp < tenMinutesAgo) {
      console.log('Session expired, deleting...');
      
      // Delete from both storage methods
      if (redis && redisTestResult === 'success') {
        try {
          await redis.del(`auth:${state}`);
          console.log('Expired session deleted from Redis');
        } catch (error) {
          console.error('Redis deletion error:', error.message);
        }
      }
      if (global.authSessions) {
        global.authSessions.delete(state);
        console.log('Expired session deleted from global storage');
      }
      
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired',
        debug: {
          sessionAge: Date.now() - session.timestamp,
          timestamp: new Date().toISOString()
        }
      });
    }

    // If we have a code but haven't exchanged it for tokens yet
    if (session.status === 'completed' && session.code && !session.access_token) {
      console.log('Found authorization code, exchanging for tokens...');
      
      // Validate required environment variables
      if (!process.env.PATREON_CLIENT_ID || !process.env.PATREON_CLIENT_SECRET || !process.env.PATREON_REDIRECT_URI) {
        console.error('Missing required Patreon environment variables');
        session.status = 'error';
        session.error = 'Server configuration error - missing Patreon credentials';
      } else {
        try {
          console.log('Making token exchange request to Patreon...');
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
            console.log('Token data keys:', Object.keys(tokenData));
            
            // Update session with tokens
            session.access_token = tokenData.access_token;
            session.refresh_token = tokenData.refresh_token;
            session.expires_in = tokenData.expires_in;
            session.token_type = tokenData.token_type;
            session.updated_at = Date.now();
            
            // Save updated session to both storage methods
            if (redis && redisTestResult === 'success' && storageMethod === 'redis') {
              try {
                await redis.setex(`auth:${state}`, 600, JSON.stringify(session));
                console.log('Session updated in Redis');
              } catch (error) {
                console.error('Redis update error:', error.message);
              }
            }
            if (global.authSessions) {
              global.authSessions.set(state, session);
              console.log('Session updated in global storage');
            }
            
            console.log('Session updated with tokens successfully');
          } else {
            const errorText = await tokenResponse.text();
            console.error('Token exchange failed:', tokenResponse.status, errorText);
            
            session.status = 'error';
            session.error = `Failed to exchange authorization code: ${tokenResponse.status} - ${errorText}`;
            
            // Update error status in storage
            if (redis && redisTestResult === 'success' && storageMethod === 'redis') {
              try {
                await redis.setex(`auth:${state}`, 600, JSON.stringify(session));
              } catch (error) {
                console.error('Redis error update failed:', error.message);
              }
            }
            if (global.authSessions) {
              global.authSessions.set(state, session);
            }
          }
        } catch (error) {
          console.error('Token exchange error:', error.message);
          console.error('Error stack:', error.stack);
          session.status = 'error';
          session.error = 'Token exchange failed: ' + error.message;
          
          // Update error status in storage
          if (redis && redisTestResult === 'success' && storageMethod === 'redis') {
            try {
              await redis.setex(`auth:${state}`, 600, JSON.stringify(session));
            } catch (redisError) {
              console.error('Redis error update failed:', redisError.message);
            }
          }
          if (global.authSessions) {
            global.authSessions.set(state, session);
          }
        }
      }
    }

    // Prepare response
    const response = {
      status: session.status,
      timestamp: session.timestamp,
      storageMethod: storageMethod,
      debug: {
        redisAvailable: !!redis,
        redisError: redisError,
        redisTestResult: redisTestResult,
        region: process.env.VERCEL_REGION,
        sessionAge: Date.now() - session.timestamp
      }
    };

    if (session.status === 'completed' && session.access_token) {
      console.log('Returning completed session with tokens');
      response.access_token = session.access_token;
      response.refresh_token = session.refresh_token;
      response.expires_in = session.expires_in;
      response.token_type = session.token_type || 'Bearer';
      response.state = state;
      
      // Clean up the session after successful retrieval
      if (redis && redisTestResult === 'success' && storageMethod === 'redis') {
        try {
          await redis.del(`auth:${state}`);
          console.log('Successful session cleaned up from Redis');
        } catch (error) {
          console.error('Redis cleanup error:', error.message);
        }
      }
      if (global.authSessions) {
        global.authSessions.delete(state);
        console.log('Successful session cleaned up from global storage');
      }
    } else if (session.status === 'error') {
      console.log('Returning error session');
      response.error = session.error;
      
      // Clean up error sessions too
      if (redis && redisTestResult === 'success' && storageMethod === 'redis') {
        try {
          await redis.del(`auth:${state}`);
          console.log('Error session cleaned up from Redis');
        } catch (error) {
          console.error('Redis cleanup error:', error.message);
        }
      }
      if (global.authSessions) {
        global.authSessions.delete(state);
        console.log('Error session cleaned up from global storage');
      }
    } else if (session.status === 'completed' && session.code) {
      console.log('Returning session with code (no tokens yet)');
      response.code = session.code;
    }

    console.log('=== RESPONSE SUMMARY ===');
    console.log('Final response status:', response.status);
    console.log('Response keys:', Object.keys(response));
    console.log('=== AUTH STATUS HANDLER END ===');
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('=== CRITICAL ERROR IN AUTH STATUS HANDLER ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error: ' + error.message,
      debug: {
        errorName: error.name,
        timestamp: new Date().toISOString(),
        region: process.env.VERCEL_REGION,
        redisAvailable: !!redis,
        redisError: redisError
      }
    });
  }
}
