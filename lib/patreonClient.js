// lib/patreonClient.js - Patreon API client
const fetch = require('node-fetch');

class PatreonClient {
  constructor() {
    this.clientId = process.env.PATREON_CLIENT_ID;
    this.clientSecret = process.env.PATREON_CLIENT_SECRET;
    this.redirectUri = process.env.PATREON_REDIRECT_URI;
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Missing required Patreon OAuth credentials');
    }
  }

  buildAuthUrl(state) {
    const authUrl = new URL('https://www.patreon.com/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('redirect_uri', this.redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'identity identity.memberships');
    
    return authUrl.toString();
  }

  async exchangeCodeForToken(code) {
    try {
      const response = await fetch('https://www.patreon.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SketchShaper-Server/1.0'
        },
        body: new URLSearchParams({
          code: code,
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange failed:', response.status, errorText);
        throw new Error(`Token exchange failed: ${response.status}`);
      }

      const tokenData = await response.json();
      console.log('Token exchange successful');
      return tokenData;
    } catch (error) {
      console.error('Token exchange error:', error);
      throw error;
    }
  }

  async refreshToken(refreshToken) {
    try {
      const response = await fetch('https://www.patreon.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SketchShaper-Server/1.0'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token refresh failed:', response.status, errorText);
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const tokenData = await response.json();
      console.log('Token refresh successful');
      return tokenData;
    } catch (error) {
      console.error('Token refresh error:', error);
      throw error;
    }
  }
}

module.exports = PatreonClient;