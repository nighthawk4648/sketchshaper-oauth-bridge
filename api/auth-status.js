// api/auth-status.js - Enhanced endpoint for SketchUp extension to poll authentication status
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = process.env.VERCEL ? '/tmp/auth_sessions' : './tmp/auth_sessions';
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
    
    // Test read permissions
    fs.readdirSync(SESSIONS_DIR);
    return true;
  } catch (error) {
    console.error('Failed to check sessions directory:', error);
    return false;
  }
}

// Safe file operations
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error('Failed to read file:', filePath, error);
    return null;
  }
}

function safeUnlinkFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error('Failed to delete file:', filePath, error);
    return false;
  }
}

function safeStatFile(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
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
      const stats = safeStatFile(filePath);
      
      if (!stats) {
        // File doesn't exist or can't be accessed, try to remove
        safeUnlinkFile(filePath);
        cleanedCount++;
        continue;
      }
      
      const fileAge = now - stats.mtime.getTime();
      
      // Clean up files older than session timeout
      if (fileAge > SESSION_TIMEOUT) {
        if (safeUnlinkFile(filePath)) {
          cleanedCount++;
          console.log('Cleaned up expired session file:', file);
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
  console.log('=== Auth Status Handler Started ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query parameters:', req.query);
  console.log('Environment:', process.env.VERCEL ? 'Vercel' : 'Local');

  try {
    // Set CORS headers (matching callback.js)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      console.error('Invalid method:', req.method);
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
            alternativePattern: /^[a-zA-Z0-9_-]+$/.test(state),
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    // Check if sessions directory exists
    if (!checkSessionsDirectory()) {
      console.error('Sessions directory not accessible');
      return res.status(500).json({
        status: 'error',
        error: 'Server configuration error - session storage not accessible'
      });
    }

    // Clean up expired sessions periodically (but don't fail if it errors)
    try {
      cleanupExpiredSessions();
    } catch (cleanupError) {
      console.error('Cleanup failed but continuing:', cleanupError);
    }

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
    const fileContent = safeReadFile(sessionFile);
    if (!fileContent) {
      console.error('Failed to read session file:', sessionFile);
      
      // Try to remove corrupted session file
      safeUnlinkFile(sessionFile);
      
      return res.status(500).json({
        status: 'error',
        error: 'Failed to read session data'
      });
    }

    let sessionData;
    try {
      sessionData = JSON.parse(fileContent);
    } catch (parseError) {
      console.error('Failed to parse session file:', parseError);
      
      // Try to remove corrupted session file
      safeUnlinkFile(sessionFile);
      
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
      safeUnlinkFile(sessionFile);
      
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
      console.log('Session completed, preparing response...');
      
      // Include authentication data
      if (sessionData.access_token) {
        response.access_token = sessionData.access_token;
        response.refresh_token = sessionData.refresh_token;
        response.expires_in = sessionData.expires_in;
        response.token_type = sessionData.token_type;
        console.log('Returning access token to client');
      } else if (sessionData.code) {
        // Fallback case where only code is available
        response.code = sessionData.code;
        response.fallback_reason = sessionData.fallback_reason;
        console.log('Returning authorization code for client-side exchange');
      }
      
      response.state = state;
      
      // Clean up the session after successful retrieval
      if (safeUnlinkFile(sessionFile)) {
        console.log('Session file cleaned up after successful retrieval');
      }
      
    } else if (sessionData.status === 'error') {
      response.error = sessionData.error;
      console.log('Returning error status:', sessionData.error);
      
      // Clean up error sessions too
      if (safeUnlinkFile(sessionFile)) {
        console.log('Error session file cleaned up');
      }
    }

    console.log('Auth status checked for state:', state, 'Status:', sessionData.status);
    return res.status(200).json(response);

  } catch (error) {
    console.error('=== Auth Status Handler Error ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}