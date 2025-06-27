// api/callback.js - Enhanced OAuth handler with debug logging
export default async function handler(req, res) {
  const { method, query, headers } = req;
  
  // Security headers
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // CORS headers for API access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle OAuth callback from Patreon
  if (method === 'GET') {
    return handleOAuthCallback(req, res);
  }
  
  // Handle token exchange from desktop app
  if (method === 'POST') {
    return handleTokenExchange(req, res);
  }
  
  return res.status(405).json({ 
    error: 'Method not allowed',
    allowed_methods: ['GET', 'POST', 'OPTIONS']
  });
}

async function handleOAuthCallback(req, res) {
  const { code, error, state, error_description } = req.query;
  
  // Enhanced logging with more details
  console.log('=== OAuth Callback Debug Info ===');
  console.log('Full query params:', req.query);
  console.log('Code present:', !!code);
  console.log('Code length:', code ? code.length : 0);
  console.log('State present:', !!state);
  console.log('Environment check:', {
    CLIENT_ID_set: !!process.env.PATREON_CLIENT_ID,
    CLIENT_SECRET_set: !!process.env.PATREON_CLIENT_SECRET,
    REDIRECT_URI_set: !!process.env.PATREON_REDIRECT_URI,
    REDIRECT_URI_value: process.env.PATREON_REDIRECT_URI
  });
  
  // Log callback details
  console.log('OAuth callback received:', {
    code: code ? `${code.substring(0, 8)}...` : null,
    error,
    error_description,
    state: state ? `${state.substring(0, 8)}...` : null,
    timestamp: new Date().toISOString(),
    userAgent: req.headers['user-agent'],
    ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown'
  });
  
  // Handle OAuth errors from Patreon
  if (error) {
    console.error('OAuth error from Patreon:', { error, error_description, state });
    return res.status(200).send(createCallbackPage({
      status: 'error',
      error: error_description || error,
      state,
      debug: { step: 'oauth_error', details: { error, error_description } }
    }));
  }
  
  // Validate authorization code
  if (!code) {
    console.warn('No authorization code received');
    return res.status(200).send(createCallbackPage({
      status: 'error',
      error: 'No authorization code received from Patreon',
      state,
      debug: { step: 'missing_code', query: req.query }
    }));
  }
  
  // Validate state parameter
  if (!state) {
    console.warn('Missing state parameter');
    return res.status(200).send(createCallbackPage({
      status: 'error',
      error: 'Missing state parameter - possible security issue',
      state,
      debug: { step: 'missing_state', query: req.query }
    }));
  }
  
  try {
    console.log('Starting token exchange...');
    
    // Exchange authorization code for access token
    const tokenData = await exchangeCodeForToken(code);
    
    console.log('Token exchange result:', {
      success: !tokenData.error,
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      error: tokenData.error
    });
    
    if (tokenData.error) {
      console.error('Token exchange failed:', tokenData);
      return res.status(200).send(createCallbackPage({
        status: 'error',
        error: `Token exchange failed: ${tokenData.error}`,
        state,
        debug: { 
          step: 'token_exchange_failed', 
          details: tokenData,
          patreonResponse: tokenData.patreonResponse 
        }
      }));
    }
    
    // Store token temporarily with state as key (you might want to use Redis or similar)
    // For now, we'll pass it directly to the success page
    console.log('Token exchange successful');
    
    return res.status(200).send(createCallbackPage({
      status: 'success',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      state,
      userData: tokenData.user_data
    }));
    
  } catch (error) {
    console.error('Token exchange error (caught):', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    return res.status(200).send(createCallbackPage({
      status: 'error',
      error: `Failed to exchange authorization code: ${error.message}`,
      state,
      debug: { 
        step: 'token_exchange_exception', 
        error: {
          message: error.message,
          name: error.name
        }
      }
    }));
  }
}

async function exchangeCodeForToken(code) {
  const CLIENT_ID = process.env.PATREON_CLIENT_ID;
  const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
  const REDIRECT_URI = process.env.PATREON_REDIRECT_URI || 'https://api2.sketchshaper.com/callback';
  
  console.log('Token exchange attempt:', {
    CLIENT_ID: CLIENT_ID ? `${CLIENT_ID.substring(0, 8)}...` : 'MISSING',
    CLIENT_SECRET: CLIENT_SECRET ? 'SET' : 'MISSING',
    REDIRECT_URI,
    code_length: code ? code.length : 0
  });
  
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const error = `Missing Patreon OAuth credentials: CLIENT_ID=${!!CLIENT_ID}, CLIENT_SECRET=${!!CLIENT_SECRET}`;
    console.error(error);
    throw new Error(error);
  }
  
  const requestBody = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI
  });
  
  console.log('Request to Patreon token endpoint:', {
    url: 'https://www.patreon.com/api/oauth2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SketchShaper Pro/1.0'
    },
    body: requestBody.toString().replace(CLIENT_SECRET, '[REDACTED]')
  });
  
  try {
    const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SketchShaper Pro/1.0'
      },
      body: requestBody
    });
    
    console.log('Patreon response status:', tokenResponse.status, tokenResponse.statusText);
    console.log('Patreon response headers:', Object.fromEntries(tokenResponse.headers.entries()));
    
    let tokenData;
    const responseText = await tokenResponse.text();
    
    console.log('Raw Patreon response:', responseText);
    
    try {
      tokenData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Patreon response as JSON:', parseError);
      return { 
        error: 'Invalid JSON response from Patreon',
        patreonResponse: responseText.substring(0, 500)
      };
    }
    
    if (!tokenResponse.ok) {
      console.error('Patreon token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        data: tokenData
      });
      
      return { 
        error: tokenData.error_description || tokenData.error || `HTTP ${tokenResponse.status}: ${tokenResponse.statusText}`,
        patreonResponse: tokenData
      };
    }
    
    console.log('Token exchange successful, token data keys:', Object.keys(tokenData));
    
    // Optionally fetch user data
    if (tokenData.access_token) {
      try {
        console.log('Fetching user data...');
        const userResponse = await fetch('https://www.patreon.com/api/oauth2/v2/identity?include=memberships&fields%5Buser%5D=email,first_name,full_name,image_url,last_name,social_connections,thumb_url,url,vanity', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'User-Agent': 'SketchShaper Pro/1.0'
          }
        });
        
        console.log('User data response status:', userResponse.status);
        
        if (userResponse.ok) {
          const userData = await userResponse.json();
          console.log('User data fetched successfully');
          tokenData.user_data = userData;
        } else {
          console.warn('Failed to fetch user data:', userResponse.status, userResponse.statusText);
        }
      } catch (userError) {
        console.warn('Failed to fetch user data:', userError.message);
      }
    }
    
    return tokenData;
    
  } catch (error) {
    console.error('Token exchange request failed:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return { error: `Network error during token exchange: ${error.message}` };
  }
}

async function handleTokenExchange(req, res) {
  try {
    const { state } = req.body;
    
    if (!state) {
      return res.status(400).json({
        error: 'Missing state parameter'
      });
    }
    
    // Here you would retrieve the stored token data using the state
    // For this example, we'll return a placeholder response
    // In production, implement proper token storage (Redis, database, etc.)
    
    return res.status(501).json({
      error: 'Token retrieval not implemented',
      message: 'Implement token storage mechanism'
    });
    
  } catch (error) {
    console.error('Token retrieval error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}

function createCallbackPage({ status, error, accessToken, refreshToken, expiresIn, state, userData, debug }) {
  const isSuccess = status === 'success';
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SketchShaper Pro - OAuth ${isSuccess ? 'Success' : 'Error'}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            padding: 40px;
            max-width: 600px;
            width: 90%;
            text-align: center;
        }
        
        .icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        
        .success-icon { color: #10B981; }
        .error-icon { color: #EF4444; }
        
        h1 {
            color: #1F2937;
            margin-bottom: 16px;
            font-size: 28px;
            font-weight: 600;
        }
        
        .message {
            color: #6B7280;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        
        .status-info {
            background: #F3F4F6;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
        }
        
        .debug-info {
            background: #FEF3C7;
            border: 1px solid #F59E0B;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
        }
        
        .debug-title {
            font-weight: bold;
            color: #92400E;
            margin-bottom: 10px;
        }
        
        .debug-content {
            font-family: monospace;
            font-size: 12px;
            color: #451A03;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #E5E7EB;
        }
        
        .info-row:last-child {
            border-bottom: none;
        }
        
        .info-label {
            font-weight: 500;
            color: #374151;
        }
        
        .info-value {
            color: #6B7280;
            font-family: monospace;
            font-size: 14px;
        }
        
        .actions {
            margin-top: 30px;
        }
        
        .btn {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 500;
            margin: 0 8px;
            transition: all 0.2s;
            cursor: pointer;
            border: none;
        }
        
        .btn-primary {
            background: #3B82F6;
            color: white;
        }
        
        .btn-primary:hover {
            background: #2563EB;
        }
        
        .btn-secondary {
            background: #F3F4F6;
            color: #374151;
        }
        
        .btn-secondary:hover {
            background: #E5E7EB;
        }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid #E5E7EB;
            border-radius: 50%;
            border-top-color: #3B82F6;
            animation: spin 1s ease-in-out infinite;
            margin-right: 8px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon ${isSuccess ? 'success-icon' : 'error-icon'}">
            ${isSuccess ? '✅' : '❌'}
        </div>
        
        <h1>SketchShaper Pro</h1>
        
        <div class="message">
            ${isSuccess 
                ? 'Successfully authenticated with Patreon! Your desktop app should automatically receive your credentials.'
                : `Authentication failed: ${error}`
            }
        </div>
        
        ${debug ? `
        <div class="debug-info">
            <div class="debug-title">Debug Information</div>
            <div class="debug-content">${JSON.stringify(debug, null, 2)}</div>
        </div>
        ` : ''}
        
        ${isSuccess ? `
        <div class="status-info">
            <div class="info-row">
                <span class="info-label">Status</span>
                <span class="info-value" style="color: #10B981;">Connected</span>
            </div>
            ${userData && userData.data ? `
            <div class="info-row">
                <span class="info-label">Account</span>
                <span class="info-value">${userData.data.attributes?.full_name || 'Unknown'}</span>
            </div>
            ` : ''}
            <div class="info-row">
                <span class="info-label">Session</span>
                <span class="info-value">${state ? state.substring(0, 8) + '...' : 'Unknown'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Expires</span>
                <span class="info-value">${expiresIn ? Math.floor(expiresIn / 3600) + ' hours' : 'Unknown'}</span>
            </div>
        </div>
        
        <div id="desktop-notification" class="status-info" style="background: #EFF6FF; border: 1px solid #DBEAFE;">
            <div style="display: flex; align-items: center; justify-content: center;">
                <div class="loading"></div>
                <span>Notifying desktop application...</span>
            </div>
        </div>
        ` : ''}
        
        <div class="actions">
            ${isSuccess ? `
                <button onclick="closeWindow()" class="btn btn-primary">
                    Return to SketchShaper Pro
                </button>
            ` : `
                <button onclick="window.history.back()" class="btn btn-secondary">
                    Go Back
                </button>
                <button onclick="window.close()" class="btn btn-primary">
                    Close Window
                </button>
            `}
        </div>
    </div>
    
    ${isSuccess ? `
    <script>
        // Store credentials for desktop app to retrieve
        const credentials = {
            access_token: '${accessToken}',
            refresh_token: '${refreshToken || ''}',
            expires_in: ${expiresIn || 0},
            state: '${state}',
            timestamp: Date.now()
        };
        
        // Try to communicate with desktop app
        async function notifyDesktopApp() {
            try {
                // Option 1: Custom URL scheme (implement in your desktop app)
                const customUrl = 'sketchshaper://oauth-success?' + new URLSearchParams({
                    access_token: credentials.access_token,
                    refresh_token: credentials.refresh_token,
                    expires_in: credentials.expires_in,
                    state: credentials.state
                });
                
                // Try custom URL scheme
                window.location.href = customUrl;
                
                // Option 2: Store in sessionStorage for polling by desktop app
                if (window.sessionStorage) {
                    sessionStorage.setItem('sketchshaper_oauth_result', JSON.stringify(credentials));
                }
                
                // Option 3: PostMessage to parent window (if opened as popup)
                if (window.opener) {
                    window.opener.postMessage({
                        type: 'SKETCHSHAPER_OAUTH_SUCCESS',
                        credentials: credentials
                    }, '*');
                }
                
                setTimeout(() => {
                    document.getElementById('desktop-notification').innerHTML = 
                        '<div style="color: #10B981; text-align: center;">✓ Desktop app notified successfully</div>';
                }, 2000);
                
            } catch (error) {
                console.error('Failed to notify desktop app:', error);
                document.getElementById('desktop-notification').innerHTML = 
                    '<div style="color: #EF4444; text-align: center;">⚠ Please return to SketchShaper Pro manually</div>';
            }
        }
        
        function closeWindow() {
            try {
                window.close();
            } catch (e) {
                // If we can't close the window, just hide the content
                document.body.innerHTML = '<div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;"><h2>You can now close this window</h2><p>Return to SketchShaper Pro to continue.</p></div>';
            }
        }
        
        // Auto-notify desktop app
        notifyDesktopApp();
        
        // Auto-close after delay
        setTimeout(() => {
            closeWindow();
        }, 10000);
    </script>
    ` : ''}
</body>
</html>`;
}
