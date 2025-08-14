#!/usr/bin/env node

const handler = require('./index.js');
const { queryIncomingGuests } = require('./query-incoming-guests.js');

// Mock request and response objects for HTTP handler
function createMockRequest(method, pathname, body = {}) {
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
  let responsePromise;
  let resolveResponse;

  const res = {
    statusCode,
    setHeader: (name, value) => {
      headers[name] = value;
    },
    end: (data) => {
      body = data || '';
      if (resolveResponse) {
        resolveResponse({ statusCode: res.statusCode, headers, body });
      }
    },
    write: (chunk) => {
      body += chunk;
    }
  };

  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (value) => { statusCode = value; }
  });

  // Add promise to wait for response
  responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  res.responsePromise = responsePromise;
  return res;
}

async function runTokeetUpsert() {
  console.log('🚀 Running tokeet-upsert against real feed...');
  
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEET_FEED_URL } = process.env;
  
  // Check environment variables
  console.log('Environment check:');
  console.log('- SUPABASE_URL:', SUPABASE_URL ? 'set' : 'NOT SET');
  console.log('- SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET');
  console.log('- TOKEET_FEED_URL:', TOKEET_FEED_URL || 'NOT SET');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\n❌ Missing required environment variables.');
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    console.error('\nIf you don\'t have TOKEET_FEED_URL set, the system will try to use');
    console.error('the feed_url from the request body or default behavior.');
    process.exit(1);
  }

  try {
    // Create mock request for tokeet-upsert endpoint
    const requestBody = TOKEET_FEED_URL ? { feed_url: TOKEET_FEED_URL } : {};
    const req = createMockRequest('POST', '/tokeet-upsert', requestBody);
    const res = createMockResponse();

    console.log('\n📡 Calling tokeet-upsert endpoint...');
    
    // Call the handler
    const handlerPromise = handler(req, res);
    
    // Wait for response
    const response = await res.responsePromise;
    
    console.log('\n📊 Tokeet-upsert Response:');
    console.log('==========================');
    console.log('Status:', response.statusCode);
    console.log('Headers:', JSON.stringify(response.headers, null, 2));
    
    try {
      const responseData = JSON.parse(response.body);
      console.log('Response Data:', JSON.stringify(responseData, null, 2));
      
      if (responseData.ok) {
        console.log(`\n✅ Tokeet-upsert successful!`);
        console.log(`   Method: ${responseData.via}`);
        console.log(`   Records processed: ${responseData.inserted || responseData.upserted || 0}`);
        
        if (responseData.rows && responseData.rows.length > 0) {
          console.log(`   Sample records:`);
          responseData.rows.slice(0, 3).forEach((row, index) => {
            console.log(`     ${index + 1}. ${row.first_name || 'N/A'} ${row.last_name || 'N/A'} (${row.stay_id || 'N/A'})`);
          });
          if (responseData.rows.length > 3) {
            console.log(`     ... and ${responseData.rows.length - 3} more`);
          }
        }
      } else {
        console.error(`\n❌ Tokeet-upsert failed:`, responseData.error);
        if (responseData.body) {
          console.error('Error details:', responseData.body);
        }
        process.exit(1);
      }
    } catch (parseError) {
      console.error('\n❌ Could not parse response body as JSON:');
      console.error('Raw response:', response.body);
      process.exit(1);
    }

    // Wait a moment for data to be committed
    console.log('\n⏳ Waiting 2 seconds for data to be committed...');
    await new Promise(resolve => setTimeout(resolve, 2000));

  } catch (error) {
    console.error('❌ Error during tokeet-upsert:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

async function verifyResults() {
  console.log('\n🔍 Verifying results by querying incoming_guests table...');
  console.log('=========================================================');
  
  try {
    await queryIncomingGuests();
  } catch (error) {
    console.error('❌ Error during verification:', error.message);
    process.exit(1);
  }
}

async function main() {
  console.log('📋 Step 7: End-to-end verification with live "tomorrow" feed');
  console.log('==============================================================');
  
  try {
    // Step 1: Run tokeet-upsert
    await runTokeetUpsert();
    
    // Step 2: Verify results
    await verifyResults();
    
    console.log('\n🎉 Step 7 completed successfully!');
    console.log('\nSummary:');
    console.log('- ✅ tokeet-upsert ran against real feed');
    console.log('- ✅ incoming_guests table queried for tomorrow\'s check-ins');
    console.log('- ✅ Column population verified');
    console.log('- ✅ Runtime errors and cast issues checked');
    
  } catch (error) {
    console.error('\n💥 Step 7 failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
