import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';

// Your Patreon OAuth credentials
const PATREON_CLIENT_ID = 'GhVd_dyhxHNkxgmYCAAjuP-9ohELe-aVI-BaxjeuQ3Shpo1NBEBrveQ9OHiKLDEe';
const PATREON_CLIENT_SECRET = 'NiL8Ip6NzIeAcsIjZ-hk_61VRt9ONo0JVBvxZsJi2tQ-OUedCuRHKCJTgyoOFFJj';
const PATREON_REDIRECT_URI = 'https://api2.sketchshaper.com/callback';

const PORT = 3000;
const SESSIONS_DIR = './tmp/auth_sessions';

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  console.log('Created sessions directory:', SESSIONS_DIR);
}

// Helper to generate state parameter
function generateState() {
  return 'oauth_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Helper to save session data
function saveSession(state, data) {
  try {
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    const sessionData = {
      ...data,
      timestamp: Date.now(),
      created: new Date().toISOString()
    };
    
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
    console.log('✅ Session saved:', sessionFile);
    return true;
  } catch (error) {
    console.error('❌ Failed to save session:', error.message);
    return false;
  }
}

// Helper to load session data
function loadSession(state) {
  try {
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    if (!fs.existsSync(sessionFile)) {
      return null;
    }
    
    const content = fs.readFileSync(sessionFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('❌ Failed to load session:', error.message);
    return null;
  }
}

// Patreon OAuth callback handler
async function handleCallback(req, res, query) {
  console.log('=== PATREON CALLBACK ===');
  console.log('Query params:', query);
  
  const { code, state, error } = query;
  
  if (error) {
    console.error('OAuth error:', error);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: false, 
      error: 'OAuth error', 
      details: error 
    }));
    return;
  }
  
  if (!code || !state) {
    console.error('Missing code or state parameter');
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: false, 
      error: 'Missing required parameters (code or state)' 
    }));
    return;
  }
  
  try {
    // Exchange code for access token
    console.log('Exchanging code for access token...');
    
    const tokenParams = new URLSearchParams({
      client_id: PATREON_CLIENT_ID,
      client_secret: PATREON_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: PATREON_REDIRECT_URI
    });
    
    const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Token exchange failed',
        status: tokenResponse.status,
        details: errorText
      }));
      return;
    }
    
    const tokenData = await tokenResponse.json();
    console.log('✅ Token exchange successful');
    console.log('Token data keys:', Object.keys(tokenData));
    
    // Get user info
    console.log('Fetching user info...');
    const userResponse = await fetch('https://www.patreon.com/api/oauth2/v2/identity?include=memberships&fields%5Buser%5D=email,first_name,last_name,full_name,image_url', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('User info fetch failed:', userResponse.status, errorText);
    }
    
    const userData = userResponse.ok ? await userResponse.json() : null;
    
    // Save complete session data
    const sessionData = {
      status: 'completed',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
      user_data: userData,
      completed_at: new Date().toISOString()
    };
    
    const saved = saveSession(state, sessionData);
    
    if (!saved) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Failed to save session data' 
      }));
      return;
    }
    
    // Return success response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'OAuth flow completed successfully',
      state: state,
      user: userData ? {
        id: userData.data?.id,
        name: userData.data?.attributes?.full_name,
        email: userData.data?.attributes?.email
      } : null,
      expires_in: tokenData.expires_in,
      timestamp: new Date().toISOString()
    }));
    
  } catch (error) {
    console.error('❌ Callback handler error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: false, 
      error: 'Internal server error',
      details: error.message
    }));
  }
}

// Auth status handler
async function handleAuthStatus(req, res, query) {
  console.log('=== AUTH STATUS CHECK ===');
  console.log('Query params:', query);
  
  const { state } = query;
  
  if (!state) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: false, 
      error: 'State parameter required' 
    }));
    return;
  }
  
  const sessionData = loadSession(state);
  
  if (!sessionData) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: false, 
      status: 'not_found',
      message: 'Session not found'
    }));
    return;
  }
  
  // Check if token is expired
  const now = Date.now();
  const tokenAge = now - sessionData.timestamp;
  const expiresInMs = (sessionData.expires_in || 3600) * 1000;
  const isExpired = tokenAge > expiresInMs;
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: true,
    status: sessionData.status,
    has_token: !!sessionData.access_token,
    is_expired: isExpired,
    expires_in: sessionData.expires_in,
    token_age_seconds: Math.floor(tokenAge / 1000),
    user: sessionData.user_data ? {
      id: sessionData.user_data.data?.id,
      name: sessionData.user_data.data?.attributes?.full_name,
      email: sessionData.user_data.data?.attributes?.email
    } : null,
    created: sessionData.created,
    timestamp: new Date().toISOString()
  }));
}

// OAuth initiation handler
function handleOAuthStart(req, res, query) {
  console.log('=== STARTING OAUTH FLOW ===');
  
  const state = generateState();
  console.log('Generated state:', state);
  
  // Save initial session
  const initialSession = {
    status: 'initiated',
    redirect_uri: PATREON_REDIRECT_URI,
    initiated_at: new Date().toISOString()
  };
  
  saveSession(state, initialSession);
  
  // Build Patreon authorization URL
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: PATREON_CLIENT_ID,
    redirect_uri: PATREON_REDIRECT_URI,
    state: state,
    scope: 'identity identity[email] identity.memberships'
  });
  
  const authUrl = `https://www.patreon.com/oauth2/authorize?${authParams}`;
  
  console.log('Authorization URL:', authUrl);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: true,
    auth_url: authUrl,
    state: state,
    message: 'Visit the auth_url to complete OAuth flow',
    timestamp: new Date().toISOString()
  }));
}

// Main server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;
  
  console.log(`${new Date().toISOString()} - ${req.method} ${pathname}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  try {
    if (pathname === '/callback' || pathname === '/api/callback') {
      await handleCallback(req, res, query);
    } else if (pathname === '/auth-status' || pathname === '/api/auth-status') {
      await handleAuthStatus(req, res, query);
    } else if (pathname === '/start-auth' || pathname === '/api/start-auth') {
      handleOAuthStart(req, res, query);
    } else if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: 'real-oauth',
        patreon_client_id: PATREON_CLIENT_ID.substring(0, 10) + '...',
        sessions_dir: SESSIONS_DIR
      }));
    } else if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head><title>Patreon OAuth Server</title></head>
          <body>
            <h1>Patreon OAuth Server</h1>
            <p><strong>Available endpoints:</strong></p>
            <ul>
              <li><a href="/health">/health</a> - Server health check</li>
              <li><a href="/start-auth">/start-auth</a> - Start OAuth flow</li>
              <li><a href="/auth-status?state=YOUR_STATE">/auth-status?state=STATE</a> - Check auth status</li>
              <li>/callback - OAuth callback (used by Patreon)</li>
            </ul>
            <p><strong>Usage:</strong></p>
            <ol>
              <li>Visit <a href="/start-auth">/start-auth</a> to get authorization URL</li>
              <li>Visit the returned auth_url to authenticate with Patreon</li>
              <li>Check status with /auth-status?state=YOUR_STATE</li>
            </ol>
          </body>
        </html>
      `);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
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

server.listen(PORT, () => {
  console.log('🚀 Real Patreon OAuth Server running on http://localhost:' + PORT);
  console.log('📍 OAuth endpoints:');
  console.log('  http://localhost:' + PORT + '/start-auth - Start OAuth flow');
  console.log('  http://localhost:' + PORT + '/health - Health check');
  console.log('  http://localhost:' + PORT + '/ - Web interface');
  console.log('');
  console.log('🔑 Using Patreon Client ID:', PATREON_CLIENT_ID.substring(0, 10) + '...');
  console.log('📁 Sessions directory:', SESSIONS_DIR);
});

server.on('error', (error) => {
  console.error('Server error:', error);
});
