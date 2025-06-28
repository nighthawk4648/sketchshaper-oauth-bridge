// api/callback.js - Enhanced Debug Version
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
  console.log('=== CALLBACK HANDLER START ===');
  console.log('Method:', req.method);
  console.log('Query:', req.query);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  // Enable CORS for your domain
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

  try {
    const { code, state, error, error_description } = req.query;

    console.log('=== CALLBACK RECEIVED ===');
    console.log('Code present:', !!code);
    console.log('Code length:', code ? code.length : 0);
    console.log('State:', state);
    console.log('Error:', error);
    console.log('Error description:', error_description);
    console.log('Redis available:', !!redis);
    console.log('Redis error:', redisError);

    // Test Redis connection
    let redisTestResult = null;
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

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error received:', error, error_description);
      
      // Store error in Redis if available
      if (state) {
        const errorSession = {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now(),
          nodeId: process.env.VERCEL_REGION || 'unknown'
        };
        
        // Try Redis first
        let errorStored = false;
        if (redis && redisTestResult === 'success') {
          try {
            await redis.setex(`auth:${state}`, 600, JSON.stringify(errorSession)); // 10 minutes
            console.log('Error session stored in Redis for state:', state);
            errorStored = true;
          } catch (redisError) {
            console.error('Redis error storing error session:', redisError.message);
          }
        }
        
        // Fallback to global storage
        if (!errorStored) {
          console.log('Storing error in global storage');
          if (!global.authSessions) {
            global.authSessions = new Map();
          }
          global.authSessions.set(state, errorSession);
          console.log('Error session stored in global storage');
        }
      }

      return res.status(400).send(getErrorHTML(error_description || error));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      return res.status(400).send(getErrorHTML('Missing required authentication parameters'));
    }

    // Validate code format (basic sanity check)
    if (typeof code !== 'string' || code.length < 10) {
      console.error('Invalid code format:', { codeType: typeof code, codeLength: code.length });
      return res.status(400).send(getErrorHTML('Invalid authorization code format'));
    }

    // Validate state format
    if (typeof state !== 'string' || state.length < 10) {
      console.error('Invalid state format:', { stateType: typeof state, stateLength: state.length });
      return res.status(400).send(getErrorHTML('Invalid state parameter format'));
    }

    console.log('=== STORING SESSION ===');
    
    // Store the authorization code
    const session = {
      status: 'completed',
      code: code,
      timestamp: Date.now(),
      nodeId: process.env.VERCEL_REGION || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown'
    };

    console.log('Session to store:', {
      status: session.status,
      hasCode: !!session.code,
      codeLength: session.code ? session.code.length : 0,
      timestamp: new Date(session.timestamp).toISOString(),
      nodeId: session.nodeId
    });

    // Try Redis first, fallback to global storage
    let stored = false;
    let storageMethod = 'none';
    
    if (redis && redisTestResult === 'success') {
      try {
        console.log('Attempting to store in Redis...');
        await redis.setex(`auth:${state}`, 600, JSON.stringify(session)); // 10 minutes TTL
        console.log('Session stored in Redis for state:', state);
        stored = true;
        storageMethod = 'redis';
        
        // Verify storage immediately
        console.log('Verifying Redis storage...');
        const verification = await redis.get(`auth:${state}`);
        if (!verification) {
          console.error('Redis verification failed - session not retrievable immediately');
          stored = false;
          storageMethod = 'none';
        } else {
          const verifiedSession = JSON.parse(verification);
          console.log('Redis verification successful:', {
            status: verifiedSession.status,
            hasCode: !!verifiedSession.code,
            timestamp: new Date(verifiedSession.timestamp).toISOString()
          });
        }
      } catch (redisError) {
        console.error('Redis storage error:', redisError.message);
        console.error('Redis error stack:', redisError.stack);
        stored = false;
        storageMethod = 'none';
      }
    } else {
      console.log('Skipping Redis storage - connection not available or failed');
    }

    // Fallback to global storage if Redis failed
    if (!stored) {
      console.log('Falling back to global storage');
      if (!global.authSessions) {
        global.authSessions = new Map();
        console.log('Initialized global.authSessions Map');
      }
      
      global.authSessions.set(state, session);
      storageMethod = 'global';
      console.log('Session stored in global storage');
      
      // Verify global storage
      const globalVerification = global.authSessions.get(state);
      if (globalVerification) {
        console.log('Global storage verification successful');
        stored = true;
      } else {
        console.error('Global storage verification failed');
      }
    }

    console.log('=== SESSION STORED ===');
    console.log('State:', state);
    console.log('Storage method:', storageMethod);
    console.log('Successfully stored:', stored);
    console.log('Redis test result:', redisTestResult);
    console.log('Global sessions count:', global.authSessions ? global.authSessions.size : 0);

    if (!stored) {
      console.error('CRITICAL: Failed to store session in any storage method');
      return res.status(500).send(getErrorHTML('Failed to store authentication session. Please try again.'));
    }

    // Return success page
    return res.status(200).send(getSuccessHTML({
      state: state,
      timestamp: new Date(session.timestamp).toISOString(),
      nodeId: session.nodeId,
      storageMethod: storageMethod,
      redisAvailable: !!redis,
      redisTestResult: redisTestResult
    }));

  } catch (error) {
    console.error('=== CRITICAL ERROR IN CALLBACK HANDLER ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    
    return res.status(500).send(getErrorHTML('An unexpected error occurred. Please try again.'));
  }
}

function getErrorHTML(message) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Error</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center; 
          padding: 50px;
          background: linear-gradient(135deg, #ff6b6b 0%, #ee5a52 100%);
          color: white;
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          color: #2d3748;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 400px;
        }
        .error { color: #e53e3e; }
        .error-icon {
          font-size: 48px;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon">❌</div>
        <h1 class="error">Authentication Failed</h1>
        <p>${message}</p>
        <p style="margin-top: 30px; font-size: 14px; color: #666;">
          You can close this window and try again from SketchUp.
        </p>
      </div>
    </body>
    </html>
  `;
}

function getSuccessHTML(debugInfo = {}) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Successful</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center; 
          padding: 50px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          color: #2d3748;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 400px;
        }
        .success { color: #38a169; }
        .checkmark {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: #38a169;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          font-size: 24px;
        }
        .debug { 
          font-size: 12px; 
          color: #666; 
          margin-top: 20px; 
          text-align: left;
          background: #f7f7f7;
          padding: 10px;
          border-radius: 4px;
          border: 1px solid #e2e8f0;
        }
        .debug strong {
          color: #2d3748;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="checkmark">✓</div>
        <h1 class="success">Authentication Successful!</h1>
        <p>You have successfully authenticated with Patreon.</p>
        <p><strong>You can now close this window and return to SketchUp.</strong></p>
        <p style="font-size: 14px; color: #718096; margin-top: 30px;">
          Your SketchShaper Pro extension will automatically detect the successful authentication.
        </p>
        ${debugInfo.state ? `
        <div class="debug">
          <strong>Debug Info:</strong><br>
          State: ${debugInfo.state}<br>
          Stored: ${debugInfo.timestamp}<br>
          Storage: ${debugInfo.storageMethod}<br>
          Node: ${debugInfo.nodeId}<br>
          Redis Available: ${debugInfo.redisAvailable ? 'Yes' : 'No'}<br>
          Redis Test: ${debugInfo.redisTestResult || 'Not tested'}
        </div>
        ` : ''}
      </div>
    </body>
    </html>
  `;
}
