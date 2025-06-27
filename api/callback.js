// api/callback.js - Vercel serverless function for SketchShaper Pro OAuth
export default async function handler(req, res) {
  const { method, query, headers } = req;
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only handle GET requests (OAuth callback)
  if (method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, state, error_description } = query;
  
  // Log callback details for debugging
  console.log('OAuth callback received:', {
    code: code ? code.substring(0, 10) + '...' : null,
    error,
    error_description,
    state,
    userAgent: headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Handle OAuth error
  if (error) {
    console.error('OAuth error:', error, error_description);
    return redirectToLocal(res, { 
      error: error_description || error, 
      status: 'error',
      state 
    });
  }
  
  // Handle successful authorization
  if (code) {
    console.log('Authorization successful - redirecting to local server');
    return redirectToLocal(res, { 
      code, 
      status: 'success', 
      state,
      timestamp: Date.now()
    });
  }
  
  // No code or error - invalid callback
  console.warn('Invalid callback - missing authorization code');
  return redirectToLocal(res, { 
    error: 'Invalid callback - no authorization code received',
    status: 'error',
    state
  });
}

function redirectToLocal(res, params) {
  // Configuration - can be moved to environment variables
  const LOCAL_PORT = process.env.LOCAL_CALLBACK_PORT || 9090;
  const LOCAL_HOST = process.env.LOCAL_CALLBACK_HOST || 'localhost';
  const LOCAL_CALLBACK_URL = `http://${LOCAL_HOST}:${LOCAL_PORT}/callback`;
  
  // Build query string
  const queryString = new URLSearchParams(params).toString();
  const redirectUrl = `${LOCAL_CALLBACK_URL}?${queryString}`;
  
  console.log('Redirecting to local server:', {
    url: redirectUrl,
    params,
    timestamp: new Date().toISOString()
  });
  
  try {
    // Set headers for redirect
    res.writeHead(302, {
      'Location': redirectUrl,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Callback-Status': params.status || 'unknown'
    });
    
    res.end();
  } catch (error) {
    console.error('Redirect error:', error);
    
    // Fallback response if redirect fails
    res.status(500).json({
      error: 'Redirect failed',
      details: error.message,
      intended_redirect: redirectUrl
    });
  }
}
