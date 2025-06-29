export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { state } = req.query;
  
  if (!state) {
    return res.status(400).json({
      status: 'error',
      error: 'Missing state parameter'
    });
  }
  
  // Add validation for state parameter format
  if (typeof state !== 'string' || state.length < 1) {
    return res.status(400).json({
      status: 'error',
      error: 'Invalid state parameter format'
    });
  }
  
  try {
    // Ensure auth sessions directory exists
    await ensureAuthDirectory();
    
    // Run cleanup of expired sessions
    await cleanupExpiredSessions();
    
    // Retrieve auth data
    const authData = await getAuthData(state);
    
    if (!authData) {
      return res.status(404).json({
        status: 'pending',
        message: 'Authentication not completed yet or session expired'
      });
    }
    
    // Return the auth data
    return res.status(200).json(authData);
    
  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Helper function to ensure auth directory exists
async function ensureAuthDirectory() {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    const authDir = '/tmp/auth_sessions';
    await fs.mkdir(authDir, { recursive: true });
  } catch (error) {
    console.error('Error creating auth directory:', error);
    throw error;
  }
}

// Helper functions for auth data storage in /tmp/auth_sessions
async function getAuthData(state) {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    // Sanitize the state parameter to prevent path traversal
    const sanitizedState = state.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitizedState !== state) {
      console.warn('State parameter contained invalid characters:', state);
      return null;
    }
    
    const sessionFile = path.join('/tmp/auth_sessions', `${sanitizedState}.json`);
    
    // Check if file exists first
    try {
      await fs.access(sessionFile);
    } catch (accessError) {
      if (accessError.code === 'ENOENT') {
        console.log(`Session file not found: ${sessionFile}`);
        return null;
      }
      throw accessError;
    }
    
    const data = await fs.readFile(sessionFile, 'utf8');
    const sessionData = JSON.parse(data);
    
    // Validate session data structure
    if (!sessionData.expiresAt || typeof sessionData.expiresAt !== 'number') {
      console.warn('Invalid session data structure:', sessionData);
      await deleteAuthData(state);
      return null;
    }
    
    // Check if session has expired
    if (Date.now() > sessionData.expiresAt) {
      console.log(`Session expired for state: ${state}`);
      await deleteAuthData(state);
      return null;
    }
    
    console.log(`Found valid session for state: ${state}`);
    return sessionData;
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`Session file not found for state: ${state}`);
      return null;
    }
    console.error('Error reading auth data:', error);
    throw error;
  }
}

async function deleteAuthData(state) {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    const sanitizedState = state.replace(/[^a-zA-Z0-9_-]/g, '');
    const sessionFile = path.join('/tmp/auth_sessions', `${sanitizedState}.json`);
    await fs.unlink(sessionFile);
    console.log(`Deleted auth session: ${sessionFile}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error deleting auth data:', error);
    }
    // Ignore ENOENT - file already doesn't exist
  }
}

// Helper function to cleanup expired sessions
async function cleanupExpiredSessions() {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    const sessionsDir = '/tmp/auth_sessions';
    
    // Check if directory exists
    try {
      await fs.access(sessionsDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('Auth sessions directory does not exist yet');
        return;
      }
      throw error;
    }
    
    const files = await fs.readdir(sessionsDir);
    const now = Date.now();
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(sessionsDir, file);
        const data = await fs.readFile(filePath, 'utf8');
        const sessionData = JSON.parse(data);
        
        if (sessionData.expiresAt && now > sessionData.expiresAt) {
          await fs.unlink(filePath);
          console.log(`Cleaned up expired session: ${file}`);
        }
      } catch (error) {
        // If we can't read/parse the file, delete it
        try {
          await fs.unlink(path.join(sessionsDir, file));
          console.log(`Cleaned up corrupted session file: ${file}`);
        } catch (unlinkError) {
          console.error('Error cleaning up corrupted file:', unlinkError);
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error during session cleanup:', error);
    }
  }
}

// Helper function to store auth data (you'll need this in your auth initiation)
export async function storeAuthData(state, authData, expirationMinutes = 10) {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    await ensureAuthDirectory();
    
    const sanitizedState = state.replace(/[^a-zA-Z0-9_-]/g, '');
    const sessionFile = path.join('/tmp/auth_sessions', `${sanitizedState}.json`);
    
    const sessionData = {
      ...authData,
      expiresAt: Date.now() + (expirationMinutes * 60 * 1000),
      createdAt: Date.now()
    };
    
    await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
    console.log(`Stored auth session: ${sessionFile}`);
    
    return sessionData;
  } catch (error) {
    console.error('Error storing auth data:', error);
    throw error;
  }
}
