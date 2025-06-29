export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const fs = await import('fs/promises');
  let sessionStats = { total: 0, active: 0, expired: 0 };
  
  try {
    const sessionsDir = '/tmp/auth_sessions';
    const files = await fs.readdir(sessionsDir);
    const now = Date.now();
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      sessionStats.total++;
      
      try {
        const data = await fs.readFile(`${sessionsDir}/${file}`, 'utf8');
        const sessionData = JSON.parse(data);
        
        if (now > sessionData.expiresAt) {
          sessionStats.expired++;
        } else {
          sessionStats.active++;
        }
      } catch (error) {
        sessionStats.expired++;
      }
    }
  } catch (error) {
    // Directory doesn't exist or other error
  }

  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Patreon Auth Server is running',
    storage: {
      type: 'File System',
      location: '/tmp/auth_sessions',
      sessions: sessionStats
    },
    endpoints: {
      callback: '/api/callback',
      authStatus: '/api/auth-status',
      cleanup: '/api/cleanup',
      test: '/api/test'
    }
  });
}

// Helper function to store auth data in /tmp/auth_sessions
async function storeAuthData(state, data) {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    const sessionsDir = '/tmp/auth_sessions';
    const sessionFile = path.join(sessionsDir, `${state}.json`);
    
    // Ensure directory exists
    await fs.mkdir(sessionsDir, { recursive: true });
    
    // Add expiration timestamp
    const sessionData = {
      ...data,
      expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes from now
    };
    
    // Write session data to file
    await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
    
    console.log(`Auth session stored: ${sessionFile}`);
    
    // Schedule cleanup after 5 minutes
    setTimeout(async () => {
      try {
        await fs.unlink(sessionFile);
        console.log(`Cleaned up expired session: ${sessionFile}`);
      } catch (error) {
        // File might already be deleted, ignore error
      }
    }, 5 * 60 * 1000);
    
  } catch (error) {
    console.error('Error storing auth data:', error);
    throw error;
  }
}