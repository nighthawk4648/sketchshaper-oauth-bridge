import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';

// Import your handlers
import callbackHandler from './api/callback.js';
import authStatusHandler from './api/auth-status.js';

const PORT = 3000;

// Simple request/response adapter
function createMockVercelObjects(req, res) {
  const parsedUrl = url.parse(req.url, true);
  
  const mockReq = {
    method: req.method,
    url: req.url,
    query: parsedUrl.query,
    headers: req.headers
  };

  const mockRes = {
    statusCode: 200,
    headers: {},
    
    status(code) {
      this.statusCode = code;
      return this;
    },
    
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    
    json(data) {
      this.setHeader('Content-Type', 'application/json');
      const jsonData = JSON.stringify(data, null, 2);
      res.writeHead(this.statusCode, this.headers);
      res.end(jsonData);
      return this;
    },
    
    send(data) {
      res.writeHead(this.statusCode, this.headers);
      res.end(data);
      return this;
    },
    
    end() {
      res.writeHead(this.statusCode, this.headers);
      res.end();
      return this;
    }
  };

  return { mockReq, mockRes };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  console.log(`${new Date().toISOString()} - ${req.method} ${pathname}`);
  console.log('Query:', parsedUrl.query);

  try {
    const { mockReq, mockRes } = createMockVercelObjects(req, res);

    // Route requests
    if (pathname === '/callback' || pathname === '/api/callback') {
      await callbackHandler(mockReq, mockRes);
    } else if (pathname === '/auth-status' || pathname === '/api/auth-status') {
      await authStatusHandler(mockReq, mockRes);
    } else if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: 'local-simple'
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found\n\nAvailable endpoints:\n/callback\n/auth-status\n/health');
    }
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Internal server error', 
      message: error.message 
    }));
  }
});

server.listen(PORT, () => {
  console.log('🚀 Simple test server running on http://localhost:' + PORT);
  console.log('📍 Test endpoints:');
  console.log('  http://localhost:' + PORT + '/health');
  console.log('  http://localhost:' + PORT + '/auth-status?state=test123_' + Date.now());
  console.log('  http://localhost:' + PORT + '/callback?code=test&state=test123_' + Date.now());
});

server.on('error', (error) => {
  console.error('Server error:', error);
});