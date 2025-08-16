#!/usr/bin/env node

const request = require('supertest');
const handler = require('./index.js');

// Mock fetch for testing
const mockFetch = (url, options) => {
  if (url.includes('/merge-passport')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, action: 'inserted' })
    });
  }
  
  return Promise.resolve({
    ok: false,
    status: 404,
    text: () => Promise.resolve('Not found')
  });
};

// Mock implementation counter
let mockCallCount = 0;
global.fetch = (...args) => {
  mockCallCount++;
  return mockFetch(...args);
};

// Helper to create test server
function createTestApp() {
  return (req, res) => handler(req, res);
}

async function testMRZPayload() {
  console.log('Testing MRZ-only payload...\n');
  
  const testPayload = {
    "stay_id": "New_House_Tadmor",
    "passports": [
      { "mrz_full": "P<ISRTADMOR<ELIYA<<JONATHAN<<<<<<<<<<<<<<<<<<<<<<\n37439136<4ISR7004144M33052340<2775226<8<<<38" },
      { "mrz_full": "P<ISRTADMOR<ELIYA<<YOTAM<<<<<<<<<<<<<<<<<<<<<<<<<\n35625032<8ISR1110034M27036220<0968231<9<<<<40" },
      { "mrz_full": "P<ISRTADMOR<ELIYA<<AYA<<<<<<<<<<<<<<<<<<<<<<<<<<\n35620862<2ISR1110034F27030622<0968230<6<<<<00" },
      { "mrz_full": "P<ISRTADMOR<ELIYA<<AVIAD<<<<<<<<<<<<<<<<<<<<<<<<<\n39040277<8ISR6809054M32101780<2399535<0<<<<86" }
    ]
  };

  try {
    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    console.log('✅ Request successful!');
    console.log('\n📊 Summary:', response.body.summary);
    console.log('\n👥 Processed passports:');
    
    response.body.results.forEach((result, index) => {
      const passport = testPayload.passports[index];
      console.log(`  ${index + 1}. ${result.first_name} (${result.status}) - MRZ: ${passport.mrz_full.substring(0, 20)}...`);
    });

    console.log('\n📋 Google Sheets format ready:');
    console.log('Rows generated:', response.body.sheets_format.rows_count);
    
    // Show first few lines of the sheets format
    const lines = response.body.sheets_format.data.split('\n').slice(0, 3);
    lines.forEach(line => console.log('  ' + line));
    if (response.body.sheets_format.rows_count > 2) {
      console.log('  ... (and more rows)');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.body);
    }
  }
}

// Run the test
testMRZPayload();
