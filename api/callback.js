// api/callback.js - Redis version (recommended for production)
import Redis from 'ioredis';

// Initialize Redis client
let redis;
try {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  console.log('Redis client initialized');
} catch (error) {
  console.error('Redis initialization failed:', error);
}

export default async function handler(req, res) {
  // Enable CORS for your domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, state, error, error_description } = req.query;

    console.log('=== CALLBACK RECEIVED ===');
    console.log('Code present:', !!code);
    console.log('State:', state);
    console.log('Error:', error);
    console.log('Redis available:', !!redis);

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      
      // Store error in Redis if available
      if (state && redis) {
        const errorSession = {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now()
        };
        
        try {
          await redis.setex(`auth:${state}`, 600, JSON.stringify(errorSession)); // 10 minutes
          console.log('Error session stored in Redis for state:', state);
        } catch (redisError) {
          console.error('Redis error storing error session:', redisError);
        }
      }

      return res.status(400).send(getErrorHTML(error_description || error));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      return res.status(400).send(getErrorHTML('Missing required authentication parameters'));
    }

    // Store the authorization code
    const session = {
      status: 'completed',
      code: code,
      timestamp: Date.now(),
      nodeId: process.env.VERCEL_REGION || 'unknown'
    };

    // Try Redis first, fallback to global storage
    let stored = false;
    
    if (redis) {
      try {
        await redis.setex(`auth:${state}`, 600, JSON.stringify(session)); // 10 minutes TTL
        console.log('Session stored in Redis for state:', state);
        stored = true;
        
        // Verify storage
        const verification = await redis.get(`auth:${state}`);
        if (!verification) {
          console.error('Redis verification failed - session not retrievable');
          stored = false;
        } else {
          console.log('Redis verification successful');
        }
      } catch (redisError) {
        console.error('Redis storage error:', redisError);
        stored = false;
      }
    }

    // Fallback to global storage if Redis failed
    if (!stored) {
      console.log('Falling back to global storage');
      if (!global.authSessions) {
        global.authSessions = new Map();
      }
      global.authSessions.set(state, session);
      console.log('Session stored in global storage');
    }

    console.log('=== SESSION STORED ===');
    console.log('State:', state);
    console.log('Storage method:', stored ? 'Redis' : 'Global');
    console.log('Session:', session);

    // Return success page
    return res.status(200).send(getSuccessHTML({
      state: state,
      timestamp: new Date(session.timestamp).toISOString(),
      nodeId: session.nodeId,
      storageMethod: stored ? 'Redis' : 'Global'
    }));

  } catch (error) {
    console.error('Callback handler error:', error);
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
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .error { color: #e53e3e; }
      </style>
    </head>
    <body>
      <h1 class="error">Authentication Failed</h1>
      <p>${message}</p>
      <p>You can close this window and try again.</p>
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
          Node: ${debugInfo.nodeId}
        </div>
        ` : ''}
      </div>
    </body>
    </html>
  `;
}
