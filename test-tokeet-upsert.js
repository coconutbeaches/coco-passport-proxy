#!/usr/bin/env node

const handler = require('./index.js');
const fs = require('fs');
const path = require('path');

// Mock request and response objects
function createMockRequest(method, pathname, body = {}) {
  const url = `https://localhost${pathname}`;
  const req = {
    method,
    url: pathname,
    on: () => {},
    headers: {}
  };

  // Add body parsing support for POST requests
  if (method === 'POST') {
    const bodyStr = JSON.stringify(body);
    let chunks = [Buffer.from(bodyStr)];
    let ended = false;
    
    req.on = (event, callback) => {
      if (event === 'data') {
        chunks.forEach(chunk => callback(chunk));
      } else if (event === 'end') {
        callback();
      } else if (event === 'error') {
        // callback will be called if there's an error
      }
    };
  }

  return req;
}

function createMockResponse() {
  let statusCode = 200;
  let headers = {};
  let body = '';

  const res = {
    statusCode,
    setHeader: (name, value) => {
      headers[name] = value;
    },
    end: (data) => {
      body = data || '';
      console.log('Response Status:', res.statusCode);
      console.log('Response Headers:', headers);
      console.log('Response Body:', body);
    },
    write: (chunk) => {
      body += chunk;
    }
  };

  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (value) => { statusCode = value; }
  });

  return res;
}

async function testTokeetUpsert() {
  console.log('🚀 Testing tokeet-upsert functionality...');
  
  // Check if we need environment variables
  console.log('Environment check:');
  console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? 'set' : 'NOT SET');
  console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET');
  console.log('- TOKEET_FEED_URL:', process.env.TOKEET_FEED_URL || 'NOT SET');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('\n❌ Missing required environment variables.');
    console.log('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    console.log('\nFor testing, you can also use the sample CSV file with:');
    console.log('node test-tokeet-upsert.js --use-sample');
    process.exit(1);
  }

  try {
    // Create mock request for tokeet-upsert endpoint
    const req = createMockRequest('POST', '/tokeet-upsert', {
      feed_url: process.env.TOKEET_FEED_URL || 'https://example.com/tokeet-feed'
    });
    
    const res = createMockResponse();

    // Call the handler
    await handler(req, res);

  } catch (error) {
    console.error('❌ Error during tokeet-upsert test:', error.message);
    console.error(error.stack);
  }
}

async function testWithSampleData() {
  console.log('🚀 Testing with sample CSV data...');
  
  // Override fetch to use local CSV file instead of remote feed
  const originalFetch = global.fetch;
  
  global.fetch = function(url, options) {
    if (url.includes('tokeet-feed') || url === process.env.TOKEET_FEED_URL) {
      // Return sample CSV content
      const csvPath = path.join(__dirname, 'tokeet_sample_tomorrow.csv');
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(csvContent),
        json: null
      });
    }
    // For Supabase calls, return success
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify([
        { id: 1, stay_id: 'A4_DePrest', first_name: 'Xavier' },
        { id: 2, stay_id: 'A5_DePrest', first_name: 'Xavier' },
        { id: 3, stay_id: 'A3_Aling', first_name: 'barry' },
        { id: 4, stay_id: 'B7_Kislinger', first_name: 'stefan' }
      ]))
    });
  };

  // Set mock environment variables
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.TOKEET_FEED_URL = 'https://test-feed.com';

  try {
    const req = createMockRequest('POST', '/tokeet-upsert', {
      feed_url: process.env.TOKEET_FEED_URL
    });
    
    const res = createMockResponse();

    await handler(req, res);

  } catch (error) {
    console.error('❌ Error during sample data test:', error.message);
    console.error(error.stack);
  }

  // Restore original fetch
  global.fetch = originalFetch;
}

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--use-sample')) {
  testWithSampleData();
} else {
  testTokeetUpsert();
}
