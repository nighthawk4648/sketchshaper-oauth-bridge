// api/auth-status.js - Enhanced endpoint for SketchUp extension to poll authentication status
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = '/tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes (match callback.js)

// Enhanced state validation matching callback.js
function validateState(state) {
  console.log('Validating state parameter:', state);
  
  if (!state || typeof state !== 'string') {
    console.log('State validation failed: Missing or invalid type');
    return false;
  }
  
  // More flexible regex pattern - allow alphanumeric and common separators
  if (!/^[a-fA-F0-9]+_\d+$/.test(state)) {
    console.log('State validation failed: Pattern mismatch. Expected format: [hex]_[timestamp]');
    console.log('Actual state format:', state);
    return false;
  }
  
  const parts = state.split('_');
  if (parts.length !== 2) {
    console.log('State validation failed: Invalid format - expected exactly one underscore');
    return false;
  }
  
  const timestamp = parseInt(parts[1]);
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  console.log('Timestamp validation:', {
    stateTimestamp: timestamp,
    currentTime: now,
    age: now - timestamp,
    maxAge: maxAge,
    isValid: timestamp > 0 && timestamp <= now && (now - timestamp) <= maxAge
  });
  
  if (timestamp <= 0) {
    console.log('State validation failed: Invalid timestamp (not positive)');
    return false;
  }
  
  if (timestamp > now) {
    console.log('State validation failed: Timestamp is in the future');
    return false;
  }
  
  if ((now - timestamp) > maxAge) {
    console.log('State validation failed: Timestamp too old');
    return false;
  }
  
  console.log('State validation passed');
  return true;
}

// Alternative validation function for debugging (matching callback.js)
function validateStateAlternative(state) {
  console.log('Alternative state validation for:', state);
  
  if (!state || typeof state !== 'string') {
    return false;
  }
  
  // More lenient validation - just check if it's not empty and contains reasonable characters
  if (state.length < 10 || state.length > 100) {
    console.log('State length validation failed:', state.length);
    return false;
  }
  
  // Allow any alphanumeric state with common separators
  if (!/^[a-zA-Z0-9_-]+$/.test(state)) {
    console.log('State character validation failed');
    return false;
  }
  
  console.log('Alternative state validation passed');
  return true;
}

// Check if sessions directory exists and is accessible
function checkSessionsDirectory() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      console.log('Sessions directory does not exist:', SESSIONS_DIR);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to check sessions directory:', error);
    return false;
  }
}

// Clean up expired session files
function cleanupExpiredSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      return;
    }

    const files = fs.readdirSync(SESSIONS_DIR);
    const now = Date.now();
    let cleanedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(SESSIONS_DIR, file);
      
      try {
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtime.getTime();
        
        // Clean up files older than session timeout
        if (fileAge > SESSION_TIMEOUT) {
          fs.unlinkSync(filePath);
          cleanedCount++;
          console.log('Cleaned up expired session file:', file);
        }
      } catch (fileError) {
        console.error('Error processing session file:', file, fileError);
        // Try to remove corrupted files
        try {
          fs.unlinkSync(filePath);
          cleanedCount++;
        } catch (unlinkError) {
          console.error('Failed to remove corrupted file:', file, unlinkError);
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired session files`);
    }
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
}

export default async function handler(req, res) {
  console.log('Auth status handler started:', req.method, req.url);
  console.log('Query parameters:', req.query);

  try {
    // Set CORS headers (matching callback.js)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { state } = req.query;

    if (!state) {
      console.error('Missing state parameter');
      return res.status(400).json({ 
        status: 'error',
        error: 'State parameter required' 
      });
    }

    // Validate state parameter using the same logic as callback.js
    let isStateValid = validateState(state);
    
    // If primary validation fails, try alternative validation
    if (!isStateValid) {
      console.log('Primary state validation failed, trying alternative validation...');
      isStateValid = validateStateAlternative(state);
      
      if (!isStateValid) {
        console.error('Both state validations failed');
        return res.status(400).json({
          status: 'error',
          error: 'Invalid authentication state',
          debug: {
            state: state,
            stateLength: state.length,
            statePattern: /^[a-fA-F0-9]+_\d+$/.test(state),
            alternativePattern: /^[a-zA-Z0-9_-]+$/.test(state)
          }
        });
      }
    }

    // Check if sessions directory exists
    if (!checkSessionsDirectory()) {
      console.error('Sessions directory not accessible');
      return res.status(500).json({
        status: 'error',
        error: 'Server configuration error'
      });
    }

    // Clean up expired sessions periodically
    cleanupExpiredSessions();

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);

    // Check if session file exists
    if (!fs.existsSync(sessionFile)) {
      console.log('Session file not found:', sessionFile);
      return res.status(404).json({ 
        status: 'pending',
        message: 'Authentication session not found or still pending' 
      });
    }

    // Read and parse session data
    let sessionData;
    try {
      const fileContent = fs.readFileSync(sessionFile, 'utf8');
      sessionData = JSON.parse(fileContent);
    } catch (readError) {
      console.error('Failed to read/parse session file:', readError);
      
      // Try to remove corrupted session file
      try {
        fs.unlinkSync(sessionFile);
      } catch (unlinkError) {
        console.error('Failed to remove corrupted session file:', unlinkError);
      }
      
      return res.status(500).json({
        status: 'error',
        error: 'Corrupted session data'
      });
    }

    // Check session age
    const now = Date.now();
    const sessionAge = now - (sessionData.timestamp || 0);
    
    if (sessionAge > SESSION_TIMEOUT) {
      console.log('Session expired, age:', sessionAge);
      
      // Clean up expired session
      try {
        fs.unlinkSync(sessionFile);
      } catch (unlinkError) {
        console.error('Failed to remove expired session file:', unlinkError);
      }
      
      return res.status(404).json({ 
        status: 'expired',
        message: 'Authentication session expired' 
      });
    }

    // Prepare response based on session status
    const response = {
      status: sessionData.status,
      timestamp: sessionData.timestamp
    };

    if (sessionData.status === 'completed') {
      // Include authentication data
      if (sessionData.access_token) {
        response.access_token = sessionData.access_token;
        response.refresh_token = sessionData.refresh_token;
        response.expires_in = sessionData.expires_in;
        response.token_type = sessionData.token_type;
      } else if (sessionData.code) {
        // Fallback case where only code is available
        response.code = sessionData.code;
        response.fallback_reason = sessionData.fallback_reason;
      }
      
      response.state = state;
      
      // Clean up the session after successful retrieval
      try {
        fs.unlinkSync(sessionFile);
        console.log('Session file cleaned up after successful retrieval');
      } catch (unlinkError) {
        console.error('Failed to clean up session file:', unlinkError);
      }
      
    } else if (sessionData.status === 'error') {
      response.error = sessionData.error;
      
      // Clean up error sessions too
      try {
        fs.unlinkSync(sessionFile);
        console.log('Error session file cleaned up');
      } catch (unlinkError) {
        console.error('Failed to clean up error session file:', unlinkError);
      }
    }

    console.log('Auth status checked for state:', state, 'Status:', sessionData.status);
    return res.status(200).json(response);

  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      message: error.message
    });
  }
}
