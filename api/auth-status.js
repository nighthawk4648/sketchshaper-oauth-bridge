import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);

// Ensure sessions directory exists
async function ensureSessionsDir() {
  try {
    await access(SESSIONS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await mkdir(SESSIONS_DIR, { recursive: true });
    } else {
      throw err;
    }
  }
}

// Validate environment variables
function validateConfig() {
  const required = [
    'PATREON_CLIENT_ID',
    'PATREON_CLIENT_SECRET',
    'PATREON_REDIRECT_URI'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Enhanced token exchange with exponential backoff
async function exchangeCodeForTokens(code, retries = MAX_RETRIES) {
  validateConfig();
  
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: process.env.PATREON_CLIENT_ID,
    client_secret: process.env.PATREON_CLIENT_SECRET,
    redirect_uri: process.env.PATREON_REDIRECT_URI
  });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('https://www.patreon.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SketchShaper-Extension/1.0',
          'Accept': 'application/json'
        },
        body: params,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.access_token) {
        throw new Error('Missing access_token in response');
      }

      // Validate token response structure
      const requiredFields = ['access_token', 'token_type'];
      const missingFields = requiredFields.filter(field => !data[field]);
      if (missingFields.length > 0) {
        throw new Error(`Invalid token response: missing ${missingFields.join(', ')}`);
      }

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in || 3600,
        token_type: data.token_type,
        scope: data.scope
      };

    } catch (err) {
      if (err.name === 'AbortError') {
        err.message = 'Request timeout';
      }
      
      if (attempt === retries - 1) {
        throw new Error(`Token exchange failed after ${retries} attempts: ${err.message}`);
      }
      
      // Exponential backoff with jitter
      const delay = RETRY_DELAY_BASE * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Clean up expired sessions
async function cleanupExpiredSessions() {
  try {
    const files = await promisify(fs.readdir)(SESSIONS_DIR);
    const now = Date.now();
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const data = JSON.parse(await readFile(filePath));
        
        if (now - data.timestamp > SESSION_TIMEOUT) {
          await unlink(filePath);
        }
      } catch (err) {
        // Skip invalid files
        continue;
      }
    }
  } catch (err) {
    // Directory might not exist or be readable
    console.warn('Session cleanup failed:', err.message);
  }
}

// Validate state parameter
function validateState(state) {
  if (!state || typeof state !== 'string') {
    return false;
  }
  
  // Check format: hex_timestamp
  if (!/^[a-f0-9]+_\d+$/.test(state)) {
    return false;
  }
  
  // Check timestamp is reasonable (not too old, not in future)
  const timestamp = parseInt(state.split('_')[1]);
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  return timestamp > 0 && 
         timestamp <= now && 
         (now - timestamp) <= maxAge;
}

export default async function handler(req, res) {
  try {
    await ensureSessionsDir();
    
    // Periodic cleanup (1% chance)
    if (Math.random() < 0.01) {
      cleanupExpiredSessions().catch(console.warn);
    }

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ 
        error: 'Method not allowed',
        allowed: ['GET', 'OPTIONS']
      });
    }

    const { state, code, error, error_description } = req.query;

    // Handle OAuth errors
    if (error) {
      return res.status(400).json({
        status: 'error',
        error: error,
        error_description: error_description || 'OAuth authorization failed',
        state
      });
    }

    // Validate state parameter
    if (!validateState(state)) {
      return res.status(400).json({ 
        error: 'Invalid or expired state parameter' 
      });
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);

    // Handle authorization code exchange
    if (code) {
      try {
        const tokens = await exchangeCodeForTokens(code);
        
        const sessionData = {
          status: 'completed',
          ...tokens,
          timestamp: Date.now(),
          ip: req.ip || req.connection?.remoteAddress,
          userAgent: req.headers['user-agent']
        };

        await writeFile(sessionFile, JSON.stringify(sessionData, null, 2));

        return res.json({
          status: 'completed',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          token_type: tokens.token_type,
          scope: tokens.scope,
          state
        });

      } catch (err) {
        // Log error but don't expose internal details
        console.error('Token exchange error:', err);
        
        const errorData = {
          status: 'error',
          error: 'Authorization failed',
          timestamp: Date.now()
        };

        await writeFile(sessionFile, JSON.stringify(errorData, null, 2));

        return res.status(400).json({
          status: 'error',
          error: 'Authorization failed',
          state
        });
      }
    }

    // Check existing session status
    try {
      const sessionData = JSON.parse(await readFile(sessionFile, 'utf8'));
      
      // Check if session has expired
      if (Date.now() - sessionData.timestamp > SESSION_TIMEOUT) {
        await unlink(sessionFile);
        return res.status(410).json({
          status: 'expired',
          error: 'Session expired',
          state
        });
      }

      // Return session status
      const response = {
        status: sessionData.status,
        state,
        timestamp: sessionData.timestamp
      };

      // Include tokens only if authorization completed successfully
      if (sessionData.status === 'completed' && sessionData.access_token) {
        Object.assign(response, {
          access_token: sessionData.access_token,
          refresh_token: sessionData.refresh_token,
          expires_in: sessionData.expires_in,
          token_type: sessionData.token_type,
          scope: sessionData.scope
        });
      } else if (sessionData.status === 'error') {
        response.error = sessionData.error || 'Unknown error';
      }

      return res.json(response);

    } catch (err) {
      if (err.code === 'ENOENT') {
        // Session file doesn't exist - create pending session
        const pendingData = {
          status: 'pending',
          timestamp: Date.now()
        };

        await writeFile(sessionFile, JSON.stringify(pendingData, null, 2));

        return res.json({
          status: 'pending',
          state,
          timestamp: pendingData.timestamp
        });
      }
      
      throw err;
    }

  } catch (err) {
    console.error('OAuth handler error:', err);
    
    return res.status(500).json({
      status: 'error',
      error: 'Internal server error'
    });
  }
}
