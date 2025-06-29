export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const sessionsDir = '/tmp/auth_sessions';
    let cleanedCount = 0;
    let totalCount = 0;
    
    try {
      const files = await fs.readdir(sessionsDir);
      const now = Date.now();
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        totalCount++;
        
        try {
          const filePath = path.join(sessionsDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const sessionData = JSON.parse(data);
          
          if (now > sessionData.expiresAt) {
            await fs.unlink(filePath);
            cleanedCount++;
          }
        } catch (error) {
          // If we can't read/parse the file, delete it
          try {
            await fs.unlink(path.join(sessionsDir, file));
            cleanedCount++;
          } catch (unlinkError) {
            // Ignore cleanup errors
          }
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Directory doesn't exist yet
        totalCount = 0;
      } else {
        throw error;
      }
    }
    
    return res.status(200).json({
      status: 'success',
      message: 'Cleanup completed',
      totalSessions: totalCount,
      cleanedSessions: cleanedCount,
      activeSessions: totalCount - cleanedCount
    });
    
  } catch (error) {
    console.error('Cleanup error:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Cleanup failed',
      message: error.message
    });
  }
}