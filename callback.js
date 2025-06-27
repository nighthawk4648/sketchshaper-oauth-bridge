export default async function handler(req, res) {
  const { method, query } = req;
  
  // Only handle GET requests (OAuth callback)
  if (method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, state } = query;
  
  // Handle OAuth error
  if (error) {
    console.log('OAuth error:', error);
    return redirectToLocal(res, { error, status: 'error' });
  }
  
  // Handle successful authorization
  if (code) {
    console.log('Authorization code received:', code.substring(0, 10) + '...');
    return redirectToLocal(res, { code, status: 'success', state });
  }
  
  // No code or error - invalid callback
  return redirectToLocal(res, { 
    error: 'Invalid callback - no authorization code received',
    status: 'error'
  });
}

function redirectToLocal(res, params) {
  // Default local server port (matches Ruby code)
  const LOCAL_PORT = 9090;
  const LOCAL_CALLBACK_URL = `http://localhost:${LOCAL_PORT}/callback`;
  
  // Build query string
  const queryString = new URLSearchParams(params).toString();
  const redirectUrl = `${LOCAL_CALLBACK_URL}?${queryString}`;
  
  console.log('Redirecting to local server:', redirectUrl);
  
  // Set headers for redirect
  res.writeHead(302, {
    'Location': redirectUrl,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  
  res.end();
}