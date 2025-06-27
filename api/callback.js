// api/callback.js - Enhanced Vercel serverless function for SketchShaper Pro OAuth
export default async function handler(req, res) {
  const { method, query, headers } = req;
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Handle preflight requests
  if (method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only handle GET requests (OAuth callback)
  if (method !== 'GET') {
    console.error('Invalid method:', method);
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowed_methods: ['GET', 'OPTIONS']
    });
  }

  const { code, error, state, error_description } = query;
  
  // Enhanced logging for debugging
  console.log('OAuth callback received:', {
    code: code ? `${code.substring(0, 8)}...` : null,
    error,
    error_description,
    state: state ? `${state.substring(0, 8)}...` : null,
    userAgent: headers['user-agent'],
    timestamp: new Date().toISOString(),
    ip: headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown'
  });
  
  // Validate required parameters
  if (!state) {
    console.warn('Missing state parameter - possible security issue');
    return redirectToLocal(res, { 
      error: 'Missing state parameter',
      status: 'error'
    });
  }
  
  // Handle OAuth error from Patreon
  if (error) {
    console.error('OAuth error from Patreon:', {
      error,
      error_description,
      state
    });
    
    return redirectToLocal(res, { 
      error: error_description || error, 
      status: 'error',
      state 
    });
  }
  
  // Handle successful authorization
  if (code) {
    console.log('Authorization successful:', {
      codeLength: code.length,
      state: state ? `${state.substring(0, 8)}...` : null
    });
    
    return redirectToLocal(res, { 
      code, 
      status: 'success', 
      state,
      timestamp: Date.now()
    });
  }
  
  // No code or error - invalid callback
  console.warn('Invalid callback - missing authorization code:', {
    query,
    hasCode: !!code,
    hasError: !!error
  });
  
  return redirectToLocal(res, { 
    error: 'Invalid callback - no authorization code received',
    status: 'error',
    state
  });
}

function redirectToLocal(res, params) {
  // Configuration with fallbacks
  const LOCAL_PORT = process.env.LOCAL_CALLBACK_PORT || 9090;
  const LOCAL_HOST = process.env.LOCAL_CALLBACK_HOST || 'localhost';
  const LOCAL_CALLBACK_PATH = process.env.LOCAL_CALLBACK_PATH || '/callback';
  
  // Build the local callback URL
  const LOCAL_CALLBACK_URL = `http://${LOCAL_HOST}:${LOCAL_PORT}${LOCAL_CALLBACK_PATH}`;
  
  // Clean and validate parameters
  const cleanParams = {};
  Object.keys(params).forEach(key => {
    if (params[key] !== null && params[key] !== undefined) {
      cleanParams[key] = String(params[key]);
    }
  });
  
  // Build query string
  const queryString = new URLSearchParams(cleanParams).toString();
  const redirectUrl = `${LOCAL_CALLBACK_URL}?${queryString}`;
  
  console.log('Redirecting to local server:', {
    url: redirectUrl.replace(/code=[^&]+/, 'code=***'), // Hide sensitive code in logs
    params: {
      ...cleanParams,
      code: cleanParams.code ? '***' : undefined // Hide sensitive code in logs
    },
    timestamp: new Date().toISOString()
  });
  
  try {
    // Attempt redirect with comprehensive headers
    res.writeHead(302, {
      'Location': redirectUrl,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Callback-Status': params.status || 'unknown',
      'X-Redirect-Target': 'local-server',
      'X-Timestamp': new Date().toISOString()
    });
    
    res.end();
    
  } catch (redirectError) {
    console.error('Redirect failed:', {
      error: redirectError.message,
      stack: redirectError.stack,
      intended_redirect: redirectUrl.replace(/code=[^&]+/, 'code=***')
    });
    
    // Fallback: Return HTML page with auto-redirect and manual link
    const fallbackHtml = createFallbackPage(redirectUrl, cleanParams);
    
    res.status(200).setHeader('Content-Type', 'text/html').send(fallbackHtml);
  }
}

function createFallbackPage(redirectUrl, params) {
  const isError = params.status === 'error';
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SketchShaper Pro - OAuth ${isError ? 'Error' : 'Success'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .status {
            font-size: 48px;
            margin-bottom: 20px;
        }
        .success { color: #4CAF50; }
        .error { color: #f44336; }
        .message {
            font-size: 18px;
            margin-bottom: 30px;
            color: #333;
        }
        .redirect-info {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            font-size: 14px;
        }
        .manual-link {
            display: inline-block;
            background: #2196F3;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            margin-top: 15px;
        }
        .manual-link:hover {
            background: #1976D2;
        }
        .countdown {
            font-weight: bold;
            color: #2196F3;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="status ${isError ? 'error' : 'success'}">
            ${isError ? '❌' : '✅'}
        </div>
        
        <h1>SketchShaper Pro OAuth</h1>
        
        <div class="message">
            ${isError 
                ? `Error: ${params.error || 'Unknown error occurred'}`
                : 'Authorization successful! Redirecting to SketchShaper Pro...'
            }
        </div>
        
        ${!isError ? `
        <div class="redirect-info">
            <p>Redirecting automatically in <span class="countdown" id="countdown">3</span> seconds...</p>
            <p>If you're not redirected automatically, click the button below:</p>
            <a href="${redirectUrl}" class="manual-link">Continue to SketchShaper Pro</a>
        </div>
        
        <script>
            let count = 3;
            const countdownEl = document.getElementById('countdown');
            
            const timer = setInterval(() => {
                count--;
                countdownEl.textContent = count;
                
                if (count <= 0) {
                    clearInterval(timer);
                    window.location.href = '${redirectUrl}';
                }
            }, 1000);
            
            // Also try immediate redirect (in case user has popup blockers)
            setTimeout(() => {
                window.location.href = '${redirectUrl}';
            }, 100);
        </script>
        ` : `
        <div class="redirect-info">
            <p>Please return to SketchShaper Pro and try again.</p>
            <a href="#" onclick="window.close()" class="manual-link">Close Window</a>
        </div>
        `}
    </div>
</body>
</html>`;
}
