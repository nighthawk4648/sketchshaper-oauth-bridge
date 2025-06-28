

import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = process.env.VERCEL ? '/tmp/auth_sessions' : './tmp/auth_sessions';

// Debug function to test session file creation
function debugSessionCreation(state) {
  console.log('=== SESSION CREATION DEBUG ===');
  console.log('State parameter:', state);
  console.log('Sessions directory:', SESSIONS_DIR);
  console.log('Expected file path:', path.join(SESSIONS_DIR, `${state}.json`));
  
  // Check if directory exists
  try {
    const dirExists = fs.existsSync(SESSIONS_DIR);
    console.log('Directory exists:', dirExists);
    
    if (!dirExists) {
      console.log('Creating sessions directory...');
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      console.log('Directory created successfully');
    }
    
    // Test write permissions
    const testFile = path.join(SESSIONS_DIR, 'test-write.json');
    try {
      fs.writeFileSync(testFile, '{"test": true}');
      console.log('Write test successful');
      
      // Clean up test file
      fs.unlinkSync(testFile);
      console.log('Test file cleaned up');
    } catch (writeError) {
      console.error('Write test failed:', writeError.message);
      return { success: false, error: `Write permission error: ${writeError.message}` };
    }
    
    return { success: true };
    
  } catch (error) {
    console.error('Directory check failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Function to create a session file
function createSessionFile(state, sessionData) {
  console.log('=== CREATING SESSION FILE ===');
  console.log('State:', state);
  console.log('Session data:', JSON.stringify(sessionData, null, 2));
  
  try {
    // Ensure directory exists
    if (!fs.existsSync(SESSIONS_DIR)) {
      console.log('Creating sessions directory...');
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    
    const sessionFile = path.join(SESSIONS_DIR, `${state}.json`);
    console.log('Writing to file:', sessionFile);
    
    // Add timestamp if not present
    if (!sessionData.timestamp) {
      sessionData.timestamp = Date.now();
    }
    
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
    console.log('✅ Session file created successfully');
    
    // Verify the file was created
    const exists = fs.existsSync(sessionFile);
    console.log('File exists after creation:', exists);
    
    if (exists) {
      const content = fs.readFileSync(sessionFile, 'utf8');
      console.log('File content verification:', content);
    }
    
    return { success: true, filePath: sessionFile };
    
  } catch (error) {
    console.error('❌ Failed to create session file:', error.message);
    console.error('Error stack:', error.stack);
    return { success: false, error: error.message };
  }
}

// Test function you can call manually
function testSessionCreation() {
  const testState = 'test123_1751132434554';
  const testData = {
    status: 'completed',
    access_token: 'test-token',
    timestamp: Date.now()
  };
  
  console.log('=== MANUAL SESSION CREATION TEST ===');
  
  // Test directory creation
  const dirTest = debugSessionCreation(testState);
  if (!dirTest.success) {
    console.error('Directory test failed:', dirTest.error);
    return;
  }
  
  // Test file creation
  const createTest = createSessionFile(testState, testData);
  if (!createTest.success) {
    console.error('File creation test failed:', createTest.error);
    return;
  }
  
  console.log('✅ Manual test completed successfully');
  
  // Now test reading it back
  try {
    const sessionFile = path.join(SESSIONS_DIR, `${testState}.json`);
    const content = fs.readFileSync(sessionFile, 'utf8');
    const data = JSON.parse(content);
    console.log('✅ File read back successfully:', data);
    
    // Clean up test file
    fs.unlinkSync(sessionFile);
    console.log('✅ Test file cleaned up');
    
  } catch (readError) {
    console.error('❌ Failed to read back test file:', readError.message);
  }
}

// Export the test function
export { testSessionCreation, createSessionFile, debugSessionCreation };

// If you want to run this as a standalone test endpoint:
// Create: api/test-session-creation.js
export default async function handler(req, res) {
  console.log('=== SESSION CREATION TEST ENDPOINT ===');
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const testState = req.query.state || 'test123_1751132434554';
    const testData = {
      status: 'completed',
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      timestamp: Date.now()
    };
    
    console.log('Testing session creation for state:', testState);
    
    // Test directory
    const dirTest = debugSessionCreation(testState);
    if (!dirTest.success) {
      return res.status(500).json({
        success: false,
        error: 'Directory test failed',
        details: dirTest.error
      });
    }
    
    // Test file creation
    const createTest = createSessionFile(testState, testData);
    if (!createTest.success) {
      return res.status(500).json({
        success: false,
        error: 'File creation failed',
        details: createTest.error
      });
    }
    
    // Test reading the file back
    const sessionFile = path.join(SESSIONS_DIR, `${testState}.json`);
    let readBack = null;
    try {
      const content = fs.readFileSync(sessionFile, 'utf8');
      readBack = JSON.parse(content);
      
      // Clean up test file (optional - comment out if you want to inspect)
      fs.unlinkSync(sessionFile);
      
    } catch (readError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to read back session file',
        details: readError.message
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Session creation test completed successfully',
      testState: testState,
      filePath: createTest.filePath,
      dataWritten: testData,
      dataReadBack: readBack,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Test endpoint error:', error);
    return res.status(500).json({
      success: false,
      error: 'Test endpoint error',
      details: error.message
    });
  }
}