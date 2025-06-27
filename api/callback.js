// Initialize sessions if not exists
global.authSessions = global.authSessions || new Map();

export default async function handler(req, res) {
  try {
    // Set CORS headers
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
      
      return res.redirect(302, `${process.env.BASE_URL}/auth-error?error=${encodeURIComponent(error)}`);
    }

    // Validate parameters
    if (!code || !state) {
      console.error('Missing parameters');
      return res.redirect(302, `${process.env.BASE_URL}/auth-error?error=invalid_request`);
    }

    // Store the session
    global.authSessions.set(state, {
      status: 'completed',
      code: code,
      timestamp: Date.now()
    });

    return res.redirect(302, `${process.env.BASE_URL}/auth-success`);

  } catch (error) {
    console.error('Callback error:', error);
    return res.redirect(302, `${process.env.BASE_URL}/auth-error?error=server_error`);
  }
}
