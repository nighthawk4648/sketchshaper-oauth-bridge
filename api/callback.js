export default async function handler(req, res) {
  console.log('=== Callback Handler Started ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query parameters:', req.query);
  console.log('Environment:', process.env.VERCEL ? 'Vercel' : 'Local');

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      console.error('Invalid method:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, state, error, error_description } = req.query;

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error received:', error, error_description);
      
      // Try to ensure sessions directory exists for error storage
      if (ensureSessionsDirectory() && state) {
        const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
        const sessionData = {
          status: 'error',
          error: error_description || error,
          timestamp: Date.now()
        };
        
        safeWriteFile(sessionFile, JSON.stringify(sessionData, null, 2));
      }

      return res.status(400).send(generateErrorPage(error_description || error, {
        oauthError: error,
        state: state,
        hasCode: !!code,
        timestamp: new Date().toISOString()
      }));
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing required parameters - code:', !!code, 'state:', !!state);
      return res.status(400).send(generateErrorPage('Missing authentication parameters', {
        hasCode: !!code,
        hasState: !!state,
        state: state,
        timestamp: new Date().toISOString()
      }));
    }

    // Try primary validation first
    let isStateValid = validateState(state);
    
    // If primary validation fails, try alternative validation
    if (!isStateValid) {
      console.log('Primary state validation failed, trying alternative validation...');
      isStateValid = validateStateAlternative(state);
      
      if (!isStateValid) {
        console.error('Both state validations failed for state:', state);
        return res.status(400).send(generateErrorPage('Invalid authentication state', {
          state: state,
          stateLength: state.length,
          statePattern: /^[a-fA-F0-9]+_\d+$/.test(state),
          alternativePattern: /^[a-zA-Z0-9_-]+$/.test(state),
          timestamp: new Date().toISOString()
        }));
      }
    }

    // Ensure sessions directory exists
    if (!ensureSessionsDirectory()) {
      console.error('Cannot create/access sessions directory');
      return res.status(500).send(generateErrorPage('Server configuration error - cannot access session storage'));
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);

    // Try to exchange code for tokens
    let sessionData;
    
    try {
      console.log('Attempting token exchange for code...');
      const tokenData = await exchangeCodeForTokens(code);
      
      sessionData = {
        status: 'completed',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in || 3600,
        token_type: tokenData.token_type || 'Bearer',
        timestamp: Date.now()
      };
      
      console.log('Token exchange successful, storing session data...');
      
    } catch (tokenError) {
      console.error('Token exchange failed:', tokenError.message);
      
      // Fallback: store the code for client-side exchange
      sessionData = {
        status: 'completed',
        code: code,
        timestamp: Date.now(),
        fallback_reason: tokenError.message
      };
      
      console.log('Storing fallback session data with code...');
    }

    // Store session data
    const sessionDataString = JSON.stringify(sessionData, null, 2);
    if (!safeWriteFile(sessionFile, sessionDataString)) {
      console.error('Failed to store session data');
      return res.status(500).send(generateErrorPage('Failed to store authentication session'));
    }

    console.log('Session data stored successfully at:', sessionFile);
    console.log('Session status:', sessionData.status);
    console.log('Has access_token:', !!sessionData.access_token);
    console.log('Has code:', !!sessionData.code);

    // Return success page
    return res.status(200).send(generateSuccessPage());

  } catch (error) {
    console.error('=== Callback Handler Error ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).send(generateErrorPage('Server error occurred', {
      error: error.message,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }));
  }
}