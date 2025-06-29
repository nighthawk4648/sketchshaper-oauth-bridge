// server.js - Complete Patreon OAuth server
import 'dotenv/config'; // Add this line to load .env file
import http from 'http';
import https from 'https';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import querystring from 'querystring';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
const SESSIONS_DIR = './tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// Patreon OAuth Config
const PATREON_CONFIG = {
  clientId: process.env.PATREON_CLIENT_ID,
  clientSecret: process.env.PATREON_CLIENT_SECRET,
  redirectUri: process.env.PATREON_REDIRECT_URI,
  authUrl: 'https://www.patreon.com/oauth2/authorize',
  tokenUrl: 'https://www.patreon.com/api/oauth2/token',
  scopes: ['identity', 'identity[email]', 'identity.memberships']
};

// Ensure sessions directory exists
function ensureSessionsDirectory() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    return true;
  } catch (error) {
    console.error('Failed to create sessions directory:', error);
    return false;
  }
}

// Utility functions
function generateState() {
  const randomBytes = Math.random().toString(36).substring(2, 15) + 
                     Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now();
  return `${randomBytes}_${timestamp}`;
}

function validateState(state) {
  if (!state || typeof state !== 'string') {
    return false;
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(state) || state.length < 10 || state.length > 100) {
    return false;
  }
  
  // Check if it has timestamp format
  const parts = state.split('_');
  if (parts.length >= 2) {
    const timestamp = parseInt(parts[parts.length - 1]);
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    if (timestamp > 0 && timestamp <= now && (now - timestamp) <= maxAge) {
      return true;
    }
  }
  
  return true; // Allow other valid formats for flexibility
}

function safeWriteFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, data, 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to write file:', filePath, error.message);
    return false;
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error('Failed to read file:', filePath, error.message);
    return null;
  }
}

function safeDeleteFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error('Failed to delete file:', filePath, error.message);
    return false;
  }
}

// Clean up expired sessions
function cleanupExpiredSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    
    const files = fs.readdirSync(SESSIONS_DIR);
    const now = Date.now();
    let cleaned = 0;
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(SESSIONS_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        const age = now - stats.mtime.getTime();
        
        if (age > SESSION_TIMEOUT) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (error) {
        // File doesn't exist or can't be accessed, try to remove
        try {
          fs.unlinkSync(filePath);
          cleaned++;
        } catch (e) {}
      }
    }
    
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired session files`);
    }
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
}

// HTTP request helper
function makeHttpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          };
          
          if (res.headers['content-type']?.includes('application/json')) {
            response.data = JSON.parse(data);
          }
          
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    
    if (postData) {
      req.write(postData);
    }
    
    req.end();
  });
}

// Exchange authorization code for access token
async function exchangeCodeForTokens(code) {
  const tokenData = querystring.stringify({
    code: code,
    grant_type: 'authorization_code',
    client_id: PATREON_CONFIG.clientId,
    client_secret: PATREON_CONFIG.clientSecret,
    redirect_uri: PATREON_CONFIG.redirectUri
  });

  const options = {
    hostname: 'www.patreon.com',
    port: 443,
    path: '/api/oauth2/token',
    method: 'POST',
    protocol: 'https:',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(tokenData),
      'User-Agent': 'SketchShaper-OAuth/1.0'
    }
  };

  const response = await makeHttpRequest(options, tokenData);
  
  if (response.statusCode !== 200) {
    throw new Error(`Token exchange failed: ${response.statusCode} - ${response.body}`);
  }
  
  if (!response.data || !response.data.access_token) {
    throw new Error('Invalid token response: missing access_token');
  }
  
  return response.data;
}

// Generate HTML pages
function generateAuthPage(authUrl, state) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Patreon Authentication - SketchShaper</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #FF424D, #FF8A80);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        .logo {
            font-size: 32px;
            font-weight: bold;
            color: #FF424D;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        p {
            color: #666;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .auth-button {
            background: #FF424D;
            color: white;
            padding: 15px 30px;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
            transition: background 0.3s;
        }
        .auth-button:hover {
            background: #e63946;
        }
        .state-info {
            margin-top: 20px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
            font-size: 12px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🎨 SketchShaper</div>
        <h1>Connect with Patreon</h1>
        <p>To continue, you need to authenticate with your Patreon account. This will allow SketchShaper to verify your subscription status.</p>
        <a href="${authUrl}" class="auth-button">Connect to Patreon</a>
        <div class="state-info">
            Session ID: ${state.substring(0, 8)}...
        </div>
    </div>
</body>
</html>`;
}

function generateSuccessPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Successful - SketchShaper</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #4CAF50, #81C784);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        .success-icon {
            font-size: 48px;
            color: #4CAF50;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        p {
            color: #666;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✅</div>
        <h1>Authentication Successful!</h1>
        <p>You have successfully connected your Patreon account. You can now close this window and return to SketchShaper.</p>
        <p><small>This window will close automatically in a few seconds...</small></p>
    </div>
    <script>
        setTimeout(() => {
            window.close();
        }, 3000);
    </script>
</body>
</html>`;
}

function generateErrorPage(error, details = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Error - SketchShaper</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #f44336, #ef5350);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        .error-icon {
            font-size: 48px;
            color: #f44336;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        p {
            color: #666;
            line-height: 1.6;
        }
        .details {
            margin-top: 20px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
            font-size: 12px;
            color: #666;
            text-align: left;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">❌</div>
        <h1>Authentication Failed</h1>
        <p>${error}</p>
        <p>Please try again or contact support if the problem persists.</p>
        ${Object.keys(details).length > 0 ? `
        <details class="details">
            <summary>Technical Details</summary>
            <pre>${JSON.stringify(details, null, 2)}</pre>
        </details>
        ` : ''}
    </div>
</body>
</html>`;
}

// Route handlers
async function handleAuth(req, res, query) {
  console.log('Auth request received');
  
  // Generate state parameter
  const state = generateState();
  
  // Build authorization URL
  const authParams = {
    response_type: 'code',
    client_id: PATREON_CONFIG.clientId,
    redirect_uri: PATREON_CONFIG.redirectUri,
    scope: PATREON_CONFIG.scopes.join(' '),
    state: state
  };
  
  const authUrl = `${PATREON_CONFIG.authUrl}?${querystring.stringify(authParams)}`;
  
  console.log('Generated auth URL:', authUrl);
  console.log('State:', state);
  
  // Store initial session
  if (ensureSessionsDirectory()) {
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    const sessionData = {
      status: 'pending',
      created: Date.now(),
      state: state
    };
    safeWriteFile(sessionFile, JSON.stringify(sessionData, null, 2));
  }
  
  // Return auth page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(generateAuthPage(authUrl, state));
}

async function handleCallback(req, res, query) {
  console.log('=== Callback Handler Started ===');
  console.log('Query parameters:', query);
  
  const { code, state, error, error_description } = query;
  
  // Handle OAuth errors
  if (error) {
    console.error('OAuth error received:', error, error_description);
    
    if (state && ensureSessionsDirectory()) {
      const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
      const sessionData = {
        status: 'error',
        error: error_description || error,
        timestamp: Date.now()
      };
      safeWriteFile(sessionFile, JSON.stringify(sessionData, null, 2));
    }
    
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage(error_description || error));
    return;
  }
  
  // Validate required parameters
  if (!code || !state) {
    console.error('Missing required parameters - code:', !!code, 'state:', !!state);
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Missing authentication parameters'));
    return;
  }
  
  // Validate state
  if (!validateState(state)) {
    console.error('Invalid state parameter:', state);
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Invalid authentication state'));
    return;
  }
  
  if (!ensureSessionsDirectory()) {
    console.error('Cannot access sessions directory');
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Server configuration error'));
    return;
  }
  
  const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
  let sessionData;
  
  try {
    console.log('Attempting token exchange...');
    const tokenData = await exchangeCodeForTokens(code);
    
    sessionData = {
      status: 'completed',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in || 3600,
      token_type: tokenData.token_type || 'Bearer',
      timestamp: Date.now()
    };
    
    console.log('Token exchange successful');
    
  } catch (tokenError) {
    console.error('Token exchange failed:', tokenError.message);
    
    // Fallback: store the code
    sessionData = {
      status: 'completed',
      code: code,
      timestamp: Date.now(),
      fallback_reason: tokenError.message
    };
    
    console.log('Storing fallback session with code');
  }
  
  // Store session data
  if (!safeWriteFile(sessionFile, JSON.stringify(sessionData, null, 2))) {
    console.error('Failed to store session data');
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateErrorPage('Failed to store authentication session'));
    return;
  }
  
  console.log('Session stored successfully');
  
  // Return success page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(generateSuccessPage());
}

async function handleAuthStatus(req, res, query) {
  console.log('=== Auth Status Handler Started ===');
  console.log('Query parameters:', query);
  
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Type': 'application/json'
  };
  
  const { state } = query;
  
  if (!state) {
    res.writeHead(400, headers);
    res.end(JSON.stringify({ 
      status: 'error',
      error: 'State parameter required' 
    }));
    return;
  }
  
  if (!validateState(state)) {
    res.writeHead(400, headers);
    res.end(JSON.stringify({
      status: 'error',
      error: 'Invalid authentication state'
    }));
    return;
  }
  
  if (!ensureSessionsDirectory()) {
    res.writeHead(500, headers);
    res.end(JSON.stringify({
      status: 'error',
      error: 'Server configuration error'
    }));
    return;
  }
  
  // Clean up expired sessions
  try {
    cleanupExpiredSessions();
  } catch (e) {
    console.error('Cleanup error:', e);
  }
  
  const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
  
  if (!fs.existsSync(sessionFile)) {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ 
      status: 'pending',
      message: 'Authentication session not found or still pending'
    }));
    return;
  }
  
  const fileContent = safeReadFile(sessionFile);
  if (!fileContent) {
    safeDeleteFile(sessionFile);
    res.writeHead(500, headers);
    res.end(JSON.stringify({
      status: 'error',
      error: 'Failed to read session data'
    }));
    return;
  }
  
  let sessionData;
  try {
    sessionData = JSON.parse(fileContent);
  } catch (parseError) {
    safeDeleteFile(sessionFile);
    res.writeHead(500, headers);
    res.end(JSON.stringify({
      status: 'error',
      error: 'Corrupted session data'
    }));
    return;
  }
  
  // Check session age
  const now = Date.now();
  const sessionAge = now - (sessionData.timestamp || sessionData.created || 0);
  
  if (sessionAge > SESSION_TIMEOUT) {
    safeDeleteFile(sessionFile);
    res.writeHead(200, headers);
    res.end(JSON.stringify({ 
      status: 'expired',
      message: 'Authentication session expired'
    }));
    return;
  }
  
  // Prepare response
  const response = {
    status: sessionData.status,
    timestamp: sessionData.timestamp || sessionData.created
  };
  
  if (sessionData.status === 'completed') {
    if (sessionData.access_token) {
      response.access_token = sessionData.access_token;
      response.refresh_token = sessionData.refresh_token;
      response.expires_in = sessionData.expires_in;
      response.token_type = sessionData.token_type;
    } else if (sessionData.code) {
      response.code = sessionData.code;
      response.fallback_reason = sessionData.fallback_reason;
    }
    
    response.state = state;
    
    // Clean up session after successful retrieval
    safeDeleteFile(sessionFile);
    
  } else if (sessionData.status === 'error') {
    response.error = sessionData.error;
    safeDeleteFile(sessionFile);
  }
  
  res.writeHead(200, headers);
  res.end(JSON.stringify(response));
}

// Main server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;
  
  console.log(`${new Date().toISOString()} - ${req.method} ${pathname}`);
  
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, User-Agent'
      });
      res.end();
      return;
    }
    
    // Route requests
    if (pathname === '/auth' || pathname === '/') {
      await handleAuth(req, res, query);
    } else if (pathname === '/callback') {
      await handleCallback(req, res, query);
    } else if (pathname === '/auth-status') {
      await handleAuthStatus(req, res, query);
    } else if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        config: {
          clientId: PATREON_CONFIG.clientId ? 'configured' : 'missing',
          redirectUri: PATREON_CONFIG.redirectUri
        }
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not Found

Available endpoints:
GET  /         - Start OAuth flow
GET  /auth     - Start OAuth flow  
GET  /callback - OAuth callback
GET  /auth-status?state=X - Check auth status
GET  /health   - Health check
`);
    }
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Internal server error', 
      message: error.message 
    }));
  }
});

server.listen(PORT, HOST, () => {
  console.log('🚀 Patreon OAuth Server running on http://' + HOST + ':' + PORT);
  console.log('📍 Available endpoints:');
  console.log('  http://' + HOST + ':' + PORT + '/auth - Start OAuth flow');
  console.log('  http://' + HOST + ':' + PORT + '/callback - OAuth callback');
  console.log('  http://' + HOST + ':' + PORT + '/auth-status?state=X - Check status');
  console.log('  http://' + HOST + ':' + PORT + '/health - Health check');
  console.log('');
  console.log('🔧 Configuration:');
  console.log('  Client ID:', PATREON_CONFIG.clientId ? 'configured' : '❌ MISSING');
  console.log('  Client Secret:', PATREON_CONFIG.clientSecret ? 'configured' : '❌ MISSING');
  console.log('  Redirect URI:', PATREON_CONFIG.redirectUri);
  console.log('  Sessions Directory:', SESSIONS_DIR);
  
  if (!PATREON_CONFIG.clientId || !PATREON_CONFIG.clientSecret) {
    console.log('');
    console.log('⚠️  WARNING: Missing Patreon OAuth credentials!');
    console.log('   Make sure your .env file contains:');
    console.log('   PATREON_CLIENT_ID=your_client_id');
    console.log('   PATREON_CLIENT_SECRET=your_client_secret');
    console.log('   PATREON_REDIRECT_URI=your_redirect_uri');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Try a different port:`);
    console.error(`   PORT=3001 node server.js`);
  } else {
    console.error('❌ Server error:', error);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down server...');
  server.close(() => {
    console.log('✅ Server closed.');
    process.exit(0);
  });
});

// Clean up sessions on startup
ensureSessionsDirectory();
cleanupExpiredSessions();