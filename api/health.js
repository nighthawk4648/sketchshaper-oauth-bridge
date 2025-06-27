export default async function handler(req, res) {
  const { method } = req;
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const healthData = {
    status: 'ok',
    service: 'SketchShaper Pro OAuth Bridge',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    endpoints: {
      callback: '/callback',
      health: '/health'
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    }
  };
  
  return res.status(200).json(healthData);
}
