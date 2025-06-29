// lib/sessionManager.js - Vercel-compatible session management
const crypto = require('crypto');

// In-memory session store (since Vercel is stateless)
// For production, you'd want to use Redis, MongoDB, or similar
let sessions = new Map();

const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

class SessionManager {
  static generateState() {
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();
    return `${randomBytes}_${timestamp}`;
  }

  static async saveSession(state, data) {
    try {
      const sessionData = {
        ...data,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TIMEOUT
      };
      
      sessions.set(state, sessionData);
      console.log(`Session saved: ${state}`);
      
      // Clean up expired sessions periodically
      this.cleanupExpiredSessions();
      
      return true;
    } catch (error) {
      console.error('Failed to save session:', error);
      return false;
    }
  }

  static async loadSession(state) {
    try {
      const session = sessions.get(state);
      
      if (!session) {
        console.log(`Session not found: ${state}`);
        return null;
      }
      
      // Check if session expired
      if (Date.now() > session.expiresAt) {
        sessions.delete(state);
        console.log(`Session expired and deleted: ${state}`);
        return null;
      }
      
      return session;
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  }

  static async updateSession(state, updates) {
    try {
      const session = await this.loadSession(state);
      if (!session) return false;
      
      const updatedSession = { ...session, ...updates };
      sessions.set(state, updatedSession);
      console.log(`Session updated: ${state}`);
      return true;
    } catch (error) {
      console.error('Failed to update session:', error);
      return false;
    }
  }

  static async deleteSession(state) {
    try {
      const deleted = sessions.delete(state);
      if (deleted) {
        console.log(`Session deleted: ${state}`);
      }
      return deleted;
    } catch (error) {
      console.error('Failed to delete session:', error);
      return false;
    }
  }

  static cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [state, session] of sessions.entries()) {
      if (now > session.expiresAt) {
        sessions.delete(state);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired sessions`);
    }
  }

  static getSessionCount() {
    return sessions.size;
  }
}

module.exports = SessionManager;