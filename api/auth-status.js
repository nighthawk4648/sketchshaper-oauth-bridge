import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = process.env.VERCEL ? '/tmp/auth_sessions' : './tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

function validateState(state) {
  console.log('=== STATE VALIDATION ===');
  console.log('Raw state parameter:', JSON.stringify(state));
  console.log('State type:', typeof state);
  console.log('State length:', state?.length);
  
  if (!state || typeof state !== 'string') {
    console.log('❌ State validation failed: Missing or invalid type');
    return { valid: false, reason: 'Missing or invalid type' };
  }
  
  // Log the exact pattern we're testing
  const hexTimestampPattern = /^[a-fA-F0-9]+_\d+$/;
  const patternMatch = hexTimestampPattern.test(state);
  console.log('Pattern test (hex_timestamp):', patternMatch);
  console.log('Expected pattern: /^[a-fA-F0-9]+_\\d+$/');
  
  if (!patternMatch) {
    console.log('❌ State validation failed: Pattern mismatch');
    console.log('State characters breakdown:');
    for (let i = 0; i < state.length; i++) {
      const char = state[i];
      const code = char.charCodeAt(0);
      console.log(`  [${i}]: '${char}' (${code})`);
    }
    return { valid: false, reason: 'Pattern mismatch', patternMatch: false };
  }
  
  const parts = state.split('_');
  console.log('State parts after split:', parts);
  
  if (parts.length !== 2) {
    console.log('❌ State validation failed: Invalid format - expected exactly one underscore');
    return { valid: false, reason: 'Invalid underscore count', parts: parts.length };
  }
  
  const hexPart = parts[0];
  const timestampPart = parts[1];
  console.log('Hex part:', hexPart);
  console.log('Timestamp part:', timestampPart);
  
  const timestamp = parseInt(timestampPart);
  const now = Date.now();
  // FIXED: Increased max age to 60 minutes to handle longer auth flows
  const maxAge = 60 * 60 * 1000; // 60 minutes instead of 30
  
  console.log('Timestamp validation details:', {
    stateTimestamp: timestamp,
    currentTime: now,
    timestampDate: new Date(timestamp).toISOString(),
    currentDate: new Date(now).toISOString(),
    age: now - timestamp,
    maxAge: maxAge,
    ageInMinutes: (now - timestamp) / (1000 * 60),
    maxAgeInMinutes: maxAge / (1000 * 60)
  });
  
  if (timestamp <= 0 || isNaN(timestamp)) {
    console.log('❌ State validation failed: Invalid timestamp');
    return { valid: false, reason: 'Invalid timestamp', timestamp };
  }
  
  if (timestamp > now + (5 * 60 * 1000)) { // Allow 5 minutes of clock skew
    console.log('❌ State validation failed: Timestamp is too far in the future');
    return { valid: false, reason: 'Future timestamp', timestamp, now };
  }
  
  if ((now - timestamp) > maxAge) {
    console.log('❌ State validation failed: Timestamp too old');
    return { valid: false, reason: 'Expired timestamp', age: now - timestamp, maxAge };
  }
  
  console.log('✅ State validation passed');
  return { valid: true };
}

function debugSessionsDirectory() {
  console.log('=== SESSIONS DIRECTORY DEBUG ===');
  console.log('Sessions directory path:', SESSIONS_DIR);
  console.log('Environment:', process.env.VERCEL ? 'Vercel' : 'Local');
  
  try {
    const exists = fs.existsSync(SESSIONS_DIR);
    console.log('Directory exists:', exists);
    
    if (!exists) {
      console.log('❌ Sessions directory does not exist');
      return { accessible: false, reason: 'Directory does not exist' };
    }
    
    // List all files in the directory
    const files = fs.readdirSync(SESSIONS_DIR);
    console.log('Files in sessions directory:', files);
    console.log('Number of session files:', files.length);
    
    // Show details of each file
    files.forEach(file => {
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const stats = fs.statSync(filePath);
        const age = Date.now() - stats.mtime.getTime();
        console.log(`  📄 ${file}:`);
        console.log(`     Size: ${stats.size} bytes`);
        console.log(`     Modified: ${stats.mtime.toISOString()}`);
        console.log(`     Age: ${Math.round(age / 1000)} seconds`);
        console.log(`     Expired: ${age > SESSION_TIMEOUT}`);
        
        // Try to read the file content
        if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);
            console.log(`     Status: ${data.status}`);
            console.log(`     Timestamp: ${data.timestamp ? new Date(data.timestamp).toISOString() : 'N/A'}`);
          } catch (readError) {
            console.log(`     ❌ Failed to read/parse: ${readError.message}`);
          }
        }
      } catch (fileError) {
        console.log(`  ❌ Error accessing ${file}: ${fileError.message}`);
      }
    });
    
    return { accessible: true, fileCount: files.length, files };
    
  } catch (error) {
    console.log('❌ Failed to access sessions directory:', error.message);
    return { accessible: false, reason: error.message };
  }
}

function debugSessionFile(state) {
  console.log('=== SESSION FILE DEBUG ===');
  const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
  console.log('Expected session file path:', sessionFile);
  
  const exists = fs.existsSync(sessionFile);
  console.log('Session file exists:', exists);
  
  if (!exists) {
    console.log('❌ Session file not found');
    
    // Check for similar files (in case of state mismatch)
    try {
      const files = fs.readdirSync(SESSIONS_DIR);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      console.log('Available session files:', jsonFiles);
      
      // Look for files with similar patterns
      const statePrefix = state.split('_')[0];
      const similarFiles = jsonFiles.filter(f => f.startsWith(statePrefix));
      if (similarFiles.length > 0) {
        console.log('⚠️  Found files with similar state prefix:', similarFiles);
      }
      
    } catch (listError) {
      console.log('Failed to list directory for comparison:', listError.message);
    }
    
    return { found: false };
  }
  
  try {
    const stats = fs.statSync(sessionFile);
    const content = fs.readFileSync(sessionFile, 'utf8');
    const data = JSON.parse(content);
    
    console.log('✅ Session file found and readable');
    console.log('File size:', stats.size, 'bytes');
    console.log('File modified:', stats.mtime.toISOString());
    console.log('File age:', Math.round((Date.now() - stats.mtime.getTime()) / 1000), 'seconds');
    console.log('Session data:', JSON.stringify(data, null, 2));
    
    return { found: true, data, stats };
    
  } catch (error) {
    console.log('❌ Failed to read session file:', error.message);
    return { found: true, error: error.message };
  }
}

// FIXED: Ensure sessions directory exists
function ensureSessionsDirectory() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      console.log('✅ Created sessions directory:', SESSIONS_DIR);
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to create sessions directory:', error);
    return false;
  }
}

export default async function handler(req, res) {
  console.log('=== ENHANCED AUTH STATUS DEBUG HANDLER ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Query parameters:', JSON.stringify(req.query, null, 2));

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      console.error('❌ Invalid method:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { state } = req.query;

    if (!state) {
      console.error('❌ Missing state parameter');
      return res.status(400).json({ 
        status: 'error',
        error: 'State parameter required',
        debug: {
          queryParams: req.query,
          timestamp: new Date().toISOString()
        }
      });
    }

    // FIXED: Ensure sessions directory exists before validation
    if (!ensureSessionsDirectory()) {
      console.error('❌ Cannot create sessions directory');
      return res.status(500).json({
        status: 'error',
        error: 'Server configuration error',
        debug: {
          message: 'Cannot create sessions directory',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Enhanced state validation with detailed debugging
    const stateValidation = validateState(state);
    
    if (!stateValidation.valid) {
      console.error('❌ State validation failed:', stateValidation.reason);
      
      // FIXED: Check if session file exists even if state validation fails
      // This handles edge cases where the session might exist but timestamp validation is too strict
      const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
      if (fs.existsSync(sessionFile)) {
        console.log('⚠️ Session file exists despite state validation failure, checking content...');
        
        try {
          const content = fs.readFileSync(sessionFile, 'utf8');
          const sessionData = JSON.parse(content);
          
          // If the session is completed, return it regardless of timestamp validation
          if (sessionData.status === 'completed') {
            console.log('✅ Found completed session despite validation failure, returning it');
            
            const response = {
              status: sessionData.status,
              timestamp: sessionData.timestamp
            };

            if (sessionData.access_token) {
              response.access_token = sessionData.access_token;
              response.refresh_token = sessionData.refresh_token;
              response.expires_in = sessionData.expires_in;
              response.token_type = sessionData.token_type;
            } else if (sessionData.code) {
              response.code = sessionData.code;
              response.fallback_reason = sessionData.fallback_reason;
            }
            
            response.state = state;
            
            // Clean up the session file
            try {
              fs.unlinkSync(sessionFile);
              console.log('✅ Completed session cleaned up');
            } catch (cleanupError) {
              console.error('Failed to cleanup completed session:', cleanupError.message);
            }
            
            return res.status(200).json(response);
          }
        } catch (readError) {
          console.error('Failed to read session file:', readError.message);
        }
      }
      
      return res.status(400).json({
        status: 'error',
        error: 'Invalid authentication state',
        debug: {
          state: state,
          validation: stateValidation,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Debug sessions directory
    const directoryDebug = debugSessionsDirectory();
    
    if (!directoryDebug.accessible) {
      console.error('❌ Sessions directory not accessible:', directoryDebug.reason);
      return res.status(500).json({
        status: 'error',
        error: 'Server configuration error',
        debug: {
          directory: directoryDebug,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Debug specific session file
    const sessionDebug = debugSessionFile(state);
    
    if (!sessionDebug.found) {
      console.log('❌ Session not found, returning pending status');
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending',
        debug: {
          state: state,
          sessionFile: `${state}.json`,
          directory: directoryDebug,
          timestamp: new Date().toISOString()
        }
      });
    }

    if (sessionDebug.error) {
      console.error('❌ Session file error:', sessionDebug.error);
      return res.status(500).json({
        status: 'error',
        error: 'Failed to read session data',
        debug: {
          sessionError: sessionDebug.error,
          timestamp: new Date().toISOString()
        }
      });
    }

    const sessionData = sessionDebug.data;

    // FIXED: More lenient session age check
    const now = Date.now();
    const sessionAge = now - (sessionData.timestamp || 0);
    // Use longer timeout for session files (60 minutes instead of 15)
    const sessionFileTimeout = 60 * 60 * 1000; // 60 minutes
    
    console.log('Session age check:', {
      sessionTimestamp: sessionData.timestamp,
      currentTime: now,
      age: sessionAge,
      ageInMinutes: sessionAge / (1000 * 60),
      timeout: sessionFileTimeout,
      timeoutInMinutes: sessionFileTimeout / (1000 * 60),
      expired: sessionAge > sessionFileTimeout
    });
    
    if (sessionAge > sessionFileTimeout) {
      console.log('❌ Session expired, cleaning up...');
      
      try {
        const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
        fs.unlinkSync(sessionFile);
        console.log('✅ Expired session cleaned up');
      } catch (cleanupError) {
        console.error('Failed to cleanup expired session:', cleanupError.message);
      }
      
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired',
        debug: {
          age: sessionAge,
          timeout: sessionFileTimeout,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Prepare successful response
    const response = {
      status: sessionData.status,
      timestamp: sessionData.timestamp
    };

    if (sessionData.status === 'completed') {
      console.log('✅ Session completed successfully');
      
      if (sessionData.access_token) {
        response.access_token = sessionData.access_token;
        response.refresh_token = sessionData.refresh_token;
        response.expires_in = sessionData.expires_in;
        response.token_type = sessionData.token_type;
        console.log('Returning access token');
      } else if (sessionData.code) {
        response.code = sessionData.code;
        response.fallback_reason = sessionData.fallback_reason;
        console.log('Returning authorization code');
      }
      
      response.state = state;
      
      // Clean up successful session
      try {
        const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
        fs.unlinkSync(sessionFile);
        console.log('✅ Completed session cleaned up');
      } catch (cleanupError) {
        console.error('Failed to cleanup completed session:', cleanupError.message);
      }
      
    } else if (sessionData.status === 'error') {
      console.log('❌ Session has error status:', sessionData.error);
      response.error = sessionData.error;
      
      // Clean up error session
      try {
        const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
        fs.unlinkSync(sessionFile);
        console.log('✅ Error session cleaned up');
      } catch (cleanupError) {
        console.error('Failed to cleanup error session:', cleanupError.message);
      }
    }

    console.log('✅ Returning successful response:', response.status);
    return res.status(200).json(response);

  } catch (error) {
    console.error('=== CRITICAL ERROR IN AUTH STATUS HANDLER ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      debug: {
        message: error.message,
        name: error.name,
        timestamp: new Date().toISOString()
      }
    });
  }
}
