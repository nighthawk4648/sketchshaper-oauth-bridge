if (typeof global.authSessions === 'undefined') {
  global.authSessions = new Map();
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;

  // Handle errors
  if (error) {
    console.error('OAuth error:', error, error_description);
    
    if (state) {
      global.authSessions.set(state, {
        status: 'error',
        error: error_description || error,
        timestamp: Date.now()
      });
    }
    
    return res.redirect(`https://api2.sketchshaper.com/auth-error?error=${encodeURIComponent(error)}`);
  }

  // Validate parameters
  if (!code || !state) {
    console.error('Missing required parameters');
    return res.redirect('https://api2.sketchshaper.com/auth-error?error=invalid_parameters');
  }

  // Store the authorization code
  global.authSessions.set(state, {
    status: 'completed',
    code: code,
    timestamp: Date.now()
  });

  console.log('Auth session stored for state:', state);

  // Redirect to success page
  return res.redirect('https://api2.sketchshaper.com/auth-success');
