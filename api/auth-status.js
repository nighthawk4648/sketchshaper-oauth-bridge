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

  try {
    // Run cleanup of expired sessions
    await cleanupExpiredSessions();
    
    // Retrieve auth data
    const authData = await getAuthData(state);

    if (!authData) {
      return res.status(404).json({
        status: 'pending',
        message: 'Authentication not completed yet'
      });
    }

    // Check if data is expired (handled by getAuthData now)
    // Return the auth data
    return res.status(200).json(authData);

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Internal server error'
    });
  }
}

// Helper functions for auth data storage in /tmp/auth_sessions
async function getAuthData(state) {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    const sessionFile = path.join('/tmp/auth_sessions', `${state}.json`);
    const data = await fs.readFile(sessionFile, 'utf8');
    const sessionData = JSON.parse(data);
    
    // Check if session has expired
    if (Date.now() > sessionData.expiresAt) {
      await deleteAuthData(state);
      return null;
    }
    
    return sessionData;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - session not found
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
    const sessionFile = path.join('/tmp/auth_sessions', `${state}.json`);
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
    const files = await fs.readdir(sessionsDir);
    const now = Date.now();
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(sessionsDir, file);
        const data = await fs.readFile(filePath, 'utf8');
        const sessionData = JSON.parse(data);
        
        if (now > sessionData.expiresAt) {
          await fs.unlink(filePath);
          console.log(`Cleaned up expired session: ${file}`);
        }
      } catch (error) {
        // If we can't read/parse the file, delete it
        try {
          await fs.unlink(path.join(sessionsDir, file));
          console.log(`Cleaned up corrupted session file: ${file}`);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error during session cleanup:', error);
    }
  }
}