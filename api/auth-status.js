// Improved session management with better error handling and platform compatibility

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

// Use platform-appropriate temp directory
const SESSIONS_DIR = process.env.VERCEL 
  ? '/tmp/auth_sessions' 
  : path.join(process.cwd(), '.sessions');

// Promisify fs functions for better error handling
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Session management utilities
class SessionManager {
  constructor() {
    this.ensureSessionsDir();
  }

  ensureSessionsDir() {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        console.log('Created sessions directory:', SESSIONS_DIR);
      }
    } catch (error) {
      console.error('Failed to create sessions directory:', error);
      // Continue execution - might work on read-only filesystems with in-memory fallback
    }
  }

  getSessionPath(state) {
    return path.join(SESSIONS_DIR, `${state}.json`);
  }

  async writeSession(state, data) {
    const sessionPath = this.getSessionPath(state);
    const sessionData = {
      ...data,
      timestamp: Date.now(),
      version: '1.0'
    };

    try {
      await writeFile(sessionPath, JSON.stringify(sessionData, null, 2));
      console.log('Session written successfully:', state);
      return true;
    } catch (error) {
      console.error('Failed to write session:', error);
      // Fallback: store in memory (for serverless environments)
      this.memoryStore = this.memoryStore || new Map();
      this.memoryStore.set(state, sessionData);
      console.log('Session stored in memory fallback:', state);
      return true;
    }
  }

  async readSession(state) {
    const sessionPath = this.getSessionPath(state);
    
    try {
      // Try file system first
      if (fs.existsSync(sessionPath)) {
        const data = await readFile(sessionPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to read session from file:', error);
    }

    // Fallback to memory store
    if (this.memoryStore && this.memoryStore.has(state)) {
      console.log('Retrieved session from memory:', state);
      return this.memoryStore.get(state);
    }

    return null;
  }

  async deleteSession(state) {
    const sessionPath = this.getSessionPath(state);
    
    try {
      if (fs.existsSync(sessionPath)) {
        await unlink(sessionPath);
        console.log('Session file deleted:', state);
      }
    } catch (error) {
      console.warn('Failed to delete session file:', error);
    }

    // Also remove from memory store
    if (this.memoryStore && this.memoryStore.has(state)) {
      this.memoryStore.delete(state);
      console.log('Session removed from memory:', state);
    }
  }

  isExpired(session, maxAgeMs = 10 * 60 * 1000) {
    return Date.now() - session.timestamp > maxAgeMs;
  }

  async cleanupExpiredSessions() {
    try {
      // Cleanup file system sessions
      if (fs.existsSync(SESSIONS_DIR)) {
        const files = await readdir(SESSIONS_DIR);
        const maxAge = 10 * 60 * 1000; // 10 minutes
        const cutoff = Date.now() - maxAge;
        
        for (const file of files) {
          try {
            const filePath = path.join(SESSIONS_DIR, file);
            const stats = await stat(filePath);
            
            if (stats.mtime.getTime() < cutoff) {
              await unlink(filePath);
              console.log('Cleaned expired session:', file);
            }
          } catch (error) {
            console.warn('Error cleaning session file:', file, error);
          }
        }
      }

      // Cleanup memory store
      if (this.memoryStore) {
        const cutoff = Date.now() - (10 * 60 * 1000);
        for (const [key, session] of this.memoryStore.entries()) {
          if (session.timestamp < cutoff) {
            this.memoryStore.delete(key);
            console.log('Cleaned expired memory session:', key);
          }
        }
      }
    } catch (error) {
      console.warn('Session cleanup error:', error);
    }
  }
}

// OAuth token exchange with retry logic
class OAuthTokenExchange {
  constructor(clientId, clientSecret, redirectUri) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  async exchangeCode(code, retries = 3) {
    const tokenUrl = 'https://www.patreon.com/api/oauth2/token';
    
    const params = new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri
    });

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Token exchange attempt ${attempt}/${retries}`);
        
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'SketchShaper-Extension/1.0'
          },
          body: params.toString()
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const tokenData = await response.json();
        console.log('Token exchange successful');
        return tokenData;
        
      } catch (error) {
        console.error(`Token exchange attempt ${attempt} failed:`, error);
        
        if (attempt === retries) {
          throw error;
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }
}

// Enhanced error responses
function createErrorResponse(message, details = {}) {
  return {
    status: 'error',
    error: message,
    timestamp: Date.now(),
    ...details
  };
}

function createSuccessResponse(data) {
  return {
    status: 'completed',
    timestamp: Date.now(),
    ...data
  };
}

// Export utilities for use in your API handlers
export {
  SessionManager,
  OAuthTokenExchange,
  createErrorResponse,
  createSuccessResponse,
  SESSIONS_DIR
};

// Example usage in your callback handler:
/*
import { SessionManager, OAuthTokenExchange } from './session-utils.js';

export default async function handler(req, res) {
  const sessionManager = new SessionManager();
  const tokenExchange = new OAuthTokenExchange(
    process.env.PATREON_CLIENT_ID,
    process.env.PATREON_CLIENT_SECRET,
    process.env.PATREON_REDIRECT_URI
  );

  // Handle the callback...
  const { code, state, error } = req.query;
  
  if (error) {
    await sessionManager.writeSession(state, {
      status: 'error',
      error: error
    });
    return res.status(400).send(generateErrorPage(error));
  }

  // Try server-side token exchange
  if (tokenExchange.isConfigured()) {
    try {
      const tokens = await tokenExchange.exchangeCode(code);
      await sessionManager.writeSession(state, {
        status: 'completed',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type
      });
    } catch (error) {
      // Fallback to code storage
      await sessionManager.writeSession(state, {
        status: 'completed',
        code: code
      });
    }
  }

  return res.status(200).send(generateSuccessPage());
}
*/
