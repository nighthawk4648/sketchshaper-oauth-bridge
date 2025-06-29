// api/auth-status.js - Updated Authentication Status Endpoint
import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = process.env.VERCEL ? '/tmp/auth_sessions' : './tmp/auth_sessions';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

function validateState(state) {
  if (!state || typeof state !== 'string') return false;
  if (!/^[a-fA-F0-9]+_\d+$/.test(state)) return false;

  const parts = state.split('_');
  if (parts.length !== 2) return false;

  const timestamp = parseInt(parts[1]);
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  return timestamp > 0 && timestamp <= now && (now - timestamp) <= maxAge;
}

function validateStateAlternative(state) {
  return typeof state === 'string' &&
    state.length >= 10 &&
    state.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(state);
}

function checkSessionsDirectory() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return false;
    fs.readdirSync(SESSIONS_DIR);
    return true;
  } catch {
    return false;
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function safeUnlinkFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeStatFile(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function cleanupExpiredSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    const files = fs.readdirSync(SESSIONS_DIR);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(SESSIONS_DIR, file);
      const stats = safeStatFile(filePath);
      const age = stats ? (now - stats.mtime.getTime()) : SESSION_TIMEOUT + 1;

      if (age > SESSION_TIMEOUT) {
        safeUnlinkFile(filePath);
      }
    }
  } catch {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', error: 'Method not allowed' });
  }

  const { state } = req.query;

  if (!state) {
    return res.status(400).json({
      status: 'error',
      error: 'State parameter required. Example: /api/auth-status?state=abc123_1720000000000',
    });
  }

  let isStateValid = validateState(state) || validateStateAlternative(state);
  if (!isStateValid) {
    return res.status(400).json({
      status: 'error',
      error: 'Invalid authentication state format',
    });
  }

  if (!checkSessionsDirectory()) {
    return res.status(500).json({
      status: 'error',
      error: 'Server session storage not accessible',
    });
  }

  cleanupExpiredSessions();

  const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
  if (!fs.existsSync(sessionFile)) {
    return res.status(404).json({
      status: 'pending',
      message: 'Authentication session not found or still pending',
    });
  }

  const fileContent = safeReadFile(sessionFile);
  if (!fileContent) {
    safeUnlinkFile(sessionFile);
    return res.status(500).json({
      status: 'error',
      error: 'Failed to read session data',
    });
  }

  let sessionData;
  try {
    sessionData = JSON.parse(fileContent);
  } catch {
    safeUnlinkFile(sessionFile);
    return res.status(500).json({
      status: 'error',
      error: 'Corrupted session data',
    });
  }

  const now = Date.now();
  const sessionAge = now - (sessionData.timestamp || 0);
  if (sessionAge > SESSION_TIMEOUT) {
    safeUnlinkFile(sessionFile);
    return res.status(404).json({
      status: 'expired',
      message: 'Authentication session expired',
    });
  }

  const response = {
    status: sessionData.status,
    timestamp: sessionData.timestamp,
    state,
  };

  if (sessionData.status === 'completed') {
    Object.assign(response, {
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
      expires_in: sessionData.expires_in,
      token_type: sessionData.token_type,
    });

    safeUnlinkFile(sessionFile);
  } else if (sessionData.status === 'error') {
    response.error = sessionData.error;
    safeUnlinkFile(sessionFile);
  }

  return res.status(200).json(response);
}
