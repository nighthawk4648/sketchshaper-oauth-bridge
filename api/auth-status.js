import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

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
    await mkdir(SESSIONS_DIR, { recursive: true });
  }
}

// Enhanced token exchange with retries
async function exchangeCodeForTokens(code, retries = 3) {
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: process.env.PATREON_CLIENT_ID,
    client_secret: process.env.PATREON_CLIENT_SECRET,
    redirect_uri: process.env.PATREON_REDIRECT_URI
  });

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch('https://www.patreon.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SketchShaper-Extension/1.0'
        },
        body: params,
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.access_token) {
        throw new Error('Missing access token in response');
      }

      return data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

export default async function handler(req, res) {
  try {
    await ensureSessionsDir();

    // Handle CORS and OPTIONS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { state, code } = req.query;

    // Validate state
    if (!state || !/^[a-f0-9_]+$/.test(state)) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);

    // Handle direct code exchange
    if (code) {
      try {
        const tokens = await exchangeCodeForTokens(code);
        await writeFile(sessionFile, JSON.stringify({
          status: 'completed',
          ...tokens,
          timestamp: Date.now()
        }));

        return res.json({
          status: 'completed',
          ...tokens,
          state
        });
      } catch (err) {
        return res.status(400).json({ 
          status: 'error',
          error: err.message
        });
      }
    }

    // Check existing session
    try {
      const data = JSON.parse(await readFile(sessionFile));
      
      // Check session age
      if (Date.now() - data.timestamp > SESSION_TIMEOUT) {
        await unlink(sessionFile);
        return res.status(400).json({ 
          status: 'expired',
          error: 'Session expired' 
        });
      }

      // Return current status
      return res.json({
        status: data.status,
        ...(data.access_token ? {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          token_type: data.token_type
        } : {}),
        state
      });

    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.json({ 
          status: 'pending',
          state
        });
      }
      throw err;
    }

  } catch (err) {
    console.error('Auth status error:', err);
    return res.status(500).json({ 
      status: 'error',
      error: 'Internal server error'
    });
  }
}
