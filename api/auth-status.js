// api/auth-status.js - Improved with comprehensive error handling and debugging
import fs from 'fs';
import path from 'path';

// Use a more reliable directory for session storage
const SESSIONS_DIR = path.join(process.cwd(), 'tmp', 'auth_sessions');

// Patreon OAuth configuration
const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID;
const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
const PATREON_REDIRECT_URI = process.env.PATREON_REDIRECT_URI;

// Helper function to safely check if directory exists
function safeDirExists(dirPath) {
  try {
    return fs.existsSync(dirPath);
  } catch (error) {
    console.error('Error checking directory existence:', error);
    return false;
  }
}

// Helper function to safely create directory
function safeCreateDir(dirPath) {
  try {
    if (!safeDirExists(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log('Created sessions directory:', dirPath);
      return true;
    }
    return true;
  } catch (error) {
    console.error('Failed to create sessions directory:', error);
    return false;
  }
}

// Helper function to safely read file
function safeReadFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  } catch (error) {
    console.error('Error reading file:', filePath, error);
    return null;
  }
}

// Helper function to safely write file
function safeWriteFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing file:', filePath, error);
    return false;
  }
}

// Helper function to safely delete file
function safeDeleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('Deleted file:', filePath);
      return true;
    }
    return true;
  } catch (error) {
    console.error('Error deleting file:', filePath, error);
    return false;
  }
}

// Helper function to list directory contents safely
function safeListDir(dirPath) {
  try {
    if (safeDirExists(dirPath)) {
      return fs.readdirSync(dirPath);
    }
    return [];
  } catch (error) {
    console.error('Error listing directory:', dirPath, error);
    return [];
  }
}

// Test file system permissions
function testFileSystemAccess() {
  console.log('=== FILE SYSTEM ACCESS TEST ===');
  
  try {
    // Test /tmp access
    console.log('Testing /tmp access...');
    const tmpTestFile = '/tmp/test_write.txt';
    fs.writeFileSync(tmpTestFile, 'test');
    fs.unlinkSync(tmpTestFile);
    console.log('/tmp write test: SUCCESS');
  } catch (error) {
    console.error('/tmp write test FAILED:', error.message);
  }
  
  try {
    // Test current working directory access
    console.log('Testing current directory access...');
    const cwdTestFile = path.join(process.cwd(), 'test_write.txt');
    fs.writeFileSync(cwdTestFile, 'test');
    fs.unlinkSync(cwdTestFile);
    console.log('CWD write test: SUCCESS');
  } catch (error) {
    console.error('CWD write test FAILED:', error.message);
  }
  
  console.log('Process CWD:', process.cwd());
  console.log('Process user ID:', process.getuid ? process.getuid() : 'N/A');
  console.log('Process groups:', process.getgroups ? process.getgroups() : 'N/A');
  console.log('================================');
}

export default async function handler(req, res) {
  console.log('=== AUTH STATUS REQUEST START ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query:', req.query);
  console.log('Headers:', Object.keys(req.headers));

  try {
    // Run file system test first
    testFileSystemAccess();
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS request');
      return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
      console.log('Invalid method:', req.method);
      return res.status(405).json({ 
        error: 'Method not allowed',
        method: req.method,
        timestamp: Date.now()
      });
    }

    const { state } = req.query;
    
    console.log('=== AUTH STATUS CHECK ===');
    console.log('State parameter:', state);
    console.log('Sessions directory:', SESSIONS_DIR);
    console.log('Node.js version:', process.version);
    console.log('Platform:', process.platform);
    console.log('Environment variables check:');
    console.log('- PATREON_CLIENT_ID:', PATREON_CLIENT_ID ? 'Set' : 'Missing');
    console.log('- PATREON_CLIENT_SECRET:', PATREON_CLIENT_SECRET ? 'Set' : 'Missing');
    console.log('- PATREON_REDIRECT_URI:', PATREON_REDIRECT_URI || 'Missing');
    
    if (!state) {
      console.log('Missing state parameter');
      return res.status(400).json({ 
        error: 'State parameter required',
        timestamp: Date.now()
      });
    }

    // Simplified state parameter validation
    if (typeof state !== 'string' || state.length < 8) {
      console.log('Invalid state parameter format:', state);
      return res.status(400).json({ 
        error: 'Invalid state parameter format',
        state: state,
        timestamp: Date.now()
      });
    }

    console.log('=== DIRECTORY DEBUG ===');
    console.log('Process CWD:', process.cwd());
    console.log('Sessions dir path:', SESSIONS_DIR);
    console.log('Directory exists before creation:', safeDirExists(SESSIONS_DIR));
    
    // Ensure sessions directory exists
    console.log('Creating sessions directory...');
    const dirCreated = safeCreateDir(SESSIONS_DIR);
    console.log('Directory creation result:', dirCreated);
    console.log('Directory exists after creation:', safeDirExists(SESSIONS_DIR));
    
    if (!dirCreated) {
      console.error('Failed to create or access sessions directory');
      return res.status(500).json({ 
        error: 'Server storage error - cannot access sessions directory',
        timestamp: Date.now(),
        debug: {
          sessionsDir: SESSIONS_DIR,
          cwd: process.cwd(),
          dirExists: safeDirExists(SESSIONS_DIR)
        }
      });
    }

    // Try to test write permissions to the sessions directory
    try {
      const testFile = path.join(SESSIONS_DIR, 'write_test.txt');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log('Sessions directory write test: SUCCESS');
    } catch (writeError) {
      console.error('Sessions directory write test FAILED:', writeError.message);
      return res.status(500).json({ 
        error: 'Cannot write to sessions directory',
        timestamp: Date.now(),
        debug: {
          writeError: writeError.message,
          sessionsDir: SESSIONS_DIR
        }
      });
    }
    console.log('=======================');
    
    // List all files in sessions directory for debugging
    const files = safeListDir(SESSIONS_DIR);
    console.log('Files in sessions directory:', files);

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    console.log('Looking for session file:', sessionFile);
    
    // Check if session file exists
    if (!fs.existsSync(sessionFile)) {
      console.log('Session file not found');
      
      // Clean up old sessions while we're here
      cleanupOldSessions();
      
      // Return more detailed response for debugging
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending',
        timestamp: Date.now(),
        debug: {
          state: state,
          sessionFile: sessionFile,
          dirExists: safeDirExists(SESSIONS_DIR),
          availableFiles: files,
          searchPattern: `${state}.json`
        }
      });
    }

    // Read session data
    console.log('Reading session file...');
    const session = safeReadFile(sessionFile);
    
    if (!session) {
      console.error('Failed to read or parse session file');
      return res.status(500).json({ 
        error: 'Failed to read session data',
        timestamp: Date.now()
      });
    }
    
    console.log('Session data loaded:', { 
      status: session.status, 
      hasCode: !!session.code,
      hasTokens: !!session.access_token,
      timestamp: session.timestamp ? new Date(session.timestamp).toISOString() : 'unknown'
    });

    // Check if session has expired (10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (session.timestamp && session.timestamp < tenMinutesAgo) {
      console.log('Session expired, cleaning up');
      safeDeleteFile(sessionFile);
      return res.status(200).json({ 
        status: 'expired',
        message: 'Authentication session expired',
        timestamp: Date.now()
      });
    }

    // If session is completed but we haven't exchanged the code yet, do it now
    if (session.status === 'completed' && session.code && !session.access_token) {
      console.log('Exchanging authorization code for tokens...');
      
      try {
        const tokenData = await exchangeCodeForTokens(session.code);
        
        if (tokenData && tokenData.access_token) {
          // Update session with tokens
          session.access_token = tokenData.access_token;
          session.refresh_token = tokenData.refresh_token;
          session.expires_in = tokenData.expires_in;
          session.token_type = tokenData.token_type;
          session.timestamp = Date.now(); // Update timestamp
          
          // Save updated session
          const saveSuccess = safeWriteFile(sessionFile, session);
          if (saveSuccess) {
            console.log('Tokens exchanged and saved successfully');
          } else {
            console.error('Failed to save updated session with tokens');
          }
        } else {
          console.log('Token exchange failed - no access_token received');
          session.status = 'error';
          session.error = 'Failed to exchange authorization code for tokens';
          safeWriteFile(sessionFile, session);
        }
      } catch (error) {
        console.error('Token exchange error:', error);
        session.status = 'error';
        session.error = 'Token exchange failed: ' + error.message;
        safeWriteFile(sessionFile, session);
      }
    }

    // Prepare response
    const response = {
      status: session.status,
      timestamp: session.timestamp || Date.now()
    };

    if (session.status === 'completed') {
      // Include tokens if available
      if (session.access_token) {
        response.access_token = session.access_token;
        response.refresh_token = session.refresh_token;
        response.expires_in = session.expires_in;
        response.token_type = session.token_type;
        console.log('Returning tokens to client');
      } else {
        // Fallback: include auth code for client-side exchange
        response.code = session.code;
        console.log('Returning auth code to client');
      }
      response.state = state;
      
      // Clean up the session after successful retrieval
      console.log('Cleaning up session file after successful completion');
      safeDeleteFile(sessionFile);
      
    } else if (session.status === 'error') {
      response.error = session.error;
      console.log('Returning error status:', session.error);
      // Clean up error sessions too
      safeDeleteFile(sessionFile);
    }

    console.log('Returning response:', { 
      status: response.status, 
      hasTokens: !!response.access_token,
      hasCode: !!response.code 
    });
    
    console.log('=== AUTH STATUS REQUEST END ===');
    return res.status(200).json(response);

  } catch (error) {
    console.error('=== AUTH STATUS ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('========================');
    
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      message: error.message,
      timestamp: Date.now(),
      debug: {
        errorName: error.name,
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd(),
        sessionsDir: SESSIONS_DIR
      }
    });
  }
}

// Function to exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  try {
    if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET || !PATREON_REDIRECT_URI) {
      throw new Error('Missing required environment variables for token exchange');
    }

    const tokenUrl = 'https://www.patreon.com/api/oauth2/token';
    
    const params = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: PATREON_CLIENT_ID,
      client_secret: PATREON_CLIENT_SECRET,
      redirect_uri: PATREON_REDIRECT_URI
    });

    console.log('Making token exchange request to Patreon...');
    console.log('Request details:');
    console.log('- URL:', tokenUrl);
    console.log('- Client ID:', PATREON_CLIENT_ID ? 'Set' : 'Missing');
    console.log('- Client Secret:', PATREON_CLIENT_SECRET ? 'Set' : 'Missing');
    console.log('- Redirect URI:', PATREON_REDIRECT_URI);
    console.log('- Code length:', code ? code.length : 'Missing');
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SketchShaper-Extension/1.0'
      },
      body: params.toString()
    });

    console.log('Token exchange response status:', response.status);
    console.log('Token exchange response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed:', response.status, errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    console.log('Token exchange successful - received keys:', Object.keys(tokenData));
    
    return tokenData;
  } catch (error) {
    console.error('Token exchange error details:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    throw error;
  }
}

// Cleanup function to remove old session files
function cleanupOldSessions() {
  try {
    if (!safeDirExists(SESSIONS_DIR)) {
      console.log('Sessions directory does not exist, skipping cleanup');
      return;
    }
    
    const files = safeListDir(SESSIONS_DIR);
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    
    console.log(`Cleanup: Found ${files.length} session files`);
    
    let cleanedCount = 0;
    files.forEach(file => {
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < tenMinutesAgo) {
          safeDeleteFile(filePath);
          cleanedCount++;
        }
      } catch (error) {
        console.error(`Error cleaning file ${file}:`, error);
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old session files`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Run cleanup on each request (but safely)
try {
  cleanupOldSessions();
} catch (error) {
  console.warn('Cleanup failed during initialization:', error);
}
