/**
 * Tests for CocoGPT batch passport processing integration
 * Tests the B7_Kislinger scenario with 3 passports where 1 already exists
 */

const request = require('supertest');

// Mock the main handler for testing
const handler = require('../index.js');

// Mock database for testing
let mockDb;
let mockPool;

// Mock fetch for internal HTTP calls
global.fetch = jest.fn();

beforeAll(() => {
  // Mock environment variables
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.SKIP_UPLOADS = '1';
});

beforeEach(() => {
  jest.clearAllMocks();
  
  // Mock PostgreSQL connection
  mockDb = {
    query: jest.fn(),
    connect: jest.fn(),
    release: jest.fn()
  };
  
  mockPool = {
    connect: jest.fn().mockResolvedValue(mockDb)
  };
  
  // Mock successful merge-passport responses
  global.fetch.mockImplementation((url, options) => {
    if (url.includes('/merge-passport')) {
      const body = JSON.parse(options.body);
      
      // Simulate Stefan already exists (merged)
      if (body.first_name === 'Stefan') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, action: 'merged' })
        });
      }
      
      // Simulate new guests (inserted)
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
  });
});

// Helper to create test server
function createTestApp() {
  return (req, res) => handler(req, res);
}

describe('CocoGPT Batch Passport Processing', () => {
  
  test('should process B7_Kislinger scenario correctly', async () => {
    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          first_name: 'Stefan',
          last_name: 'Kislinger',
          passport_number: 'P123456789',
          nationality_alpha3: 'DEU',
          issuing_country_alpha3: 'DEU',
          birthday: '1985-03-15',
          gender: 'M',
          mrz_full: 'P<DEUKISLINGER<<STEFAN<<<<<<<<<<<<<<<<<<<<<<',
          ocr_confidence: 0.95,
          photo_urls: ['https://example.com/stefan_passport.jpg']
        },
        {
          first_name: 'Maria',
          last_name: 'Kislinger',
          passport_number: 'P987654321',
          nationality_alpha3: 'DEU',
          issuing_country_alpha3: 'DEU',
          birthday: '1987-07-22',
          gender: 'F',
          mrz_full: 'P<DEUKISLINGER<<MARIA<<<<<<<<<<<<<<<<<<<<<<',
          ocr_confidence: 0.92,
          photo_urls: ['https://example.com/maria_passport.jpg']
        },
        {
          first_name: 'Hans',
          last_name: 'Kislinger',
          passport_number: 'P456789123',
          nationality_alpha3: 'DEU',
          issuing_country_alpha3: 'DEU',
          birthday: '2010-12-05',
          gender: 'M',
          mrz_full: 'P<DEUKISLINGER<<HANS<<<<<<<<<<<<<<<<<<<<<<<',
          ocr_confidence: 0.88,
          photo_urls: ['https://example.com/hans_passport.jpg']
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      stay_id: 'B7_Kislinger',
      summary: {
        total: 3,
        merged: 1,
        inserted: 2,
        errors: 0
      },
      results: [
        {
          index: 0,
          status: 'success',
          action: 'merged',
          first_name: 'Stefan',
          passport_number: 'P123456789'
        },
        {
          index: 1,
          status: 'success',
          action: 'inserted',
          first_name: 'Maria',
          passport_number: 'P987654321'
        },
        {
          index: 2,
          status: 'success',
          action: 'inserted',
          first_name: 'Hans',
          passport_number: 'P456789123'
        }
      ],
      sheets_format: {
        description: 'Tab-delimited format ready for Google Sheets',
        columns: ['First Name', 'Middle Name', 'Last Name', 'Gender', 'Passport Number', 'Nationality', 'Birthday'],
        data: expect.stringContaining('First Name \tMiddle Name\tLast Name\tGender *\tPassport No. *\tNationality *\tBirth Date (DD/MM/YYYY)\tCheck-out Date (DD/MM/YYYY)\tPhone No.'),
        rows_count: 3
      }
    });

    // Verify internal merge-passport calls were made correctly
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('should validate required fields', async () => {
    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          // Missing first_name
          last_name: 'Kislinger',
          passport_number: 'P123456789'
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    expect(response.body.summary.errors).toBe(1);
    expect(response.body.results[0].status).toBe('error');
    expect(response.body.results[0].error).toBe('first_name is required');
  });

  test('should validate MRZ and OCR confidence', async () => {
    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          first_name: 'TestUser',
          last_name: 'Kislinger',
          passport_number: 'P123456789',
          nationality_alpha3: 'DEU',
          issuing_country_alpha3: 'USA', // Mismatch with MRZ
          mrz_full: 'P<DEUKISLINGER<<TESTUSER<<<<<<<<<<<<<<<<<<<<<',
          ocr_confidence: 0.65 // Low confidence
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    expect(response.body.summary.inserted).toBe(1);
    expect(response.body.summary.errors).toBe(0);
    
    // Should still process but keep the originally provided issuing_country_alpha3
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/merge-passport'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"issuing_country_alpha3":"USA"') // Should keep original value when provided
      })
    );
  });

  test('should handle invalid request format', async () => {
    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send({
        stay_id: 'B7_Kislinger'
        // Missing passports array
      })
      .expect(400);

    expect(response.body.error).toBe('stay_id and passports array are required');
    expect(response.body.expected_format).toBeDefined();
  });

  test('should handle empty passports array', async () => {
    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send({
        stay_id: 'B7_Kislinger',
        passports: []
      })
      .expect(400);

    expect(response.body.error).toBe('stay_id and passports array are required');
  });

  test('should handle merge-passport endpoint failures', async () => {
    // Mock failure for merge-passport calls
    global.fetch.mockImplementation(() => 
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error')
      })
    );

    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          first_name: 'TestUser',
          last_name: 'Kislinger',
          passport_number: 'P123456789'
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    expect(response.body.summary.errors).toBe(1);
    expect(response.body.results[0].status).toBe('error');
    expect(response.body.results[0].error).toContain('Merge failed');
  });

  test('should auto-generate MRZ hash when not provided', async () => {
    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          first_name: 'TestUser',
          last_name: 'Kislinger',
          passport_number: 'P123456789',
          nationality_alpha3: 'DEU',
          mrz_full: 'P<DEUKISLINGER<<TESTUSER<<<<<<<<<<<<<<<<<<<<<'
          // No mrz_hash provided
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    expect(response.body.summary.inserted).toBe(1);
    
    // Verify that mrz_hash was auto-generated in the call
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.mrz_hash).toBeTruthy();
    expect(requestBody.mrz_hash).toHaveLength(64); // SHA-256 hash length
  });

  test('should normalize OCR confidence from percentage to decimal', async () => {
    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          first_name: 'TestUser',
          last_name: 'Kislinger',
          passport_number: 'P123456789',
          ocr_confidence: 95 // Percentage format
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    expect(response.body.summary.inserted).toBe(1);
    
    // Verify that OCR confidence was normalized to decimal
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.ocr_confidence).toBe(0.95);
  });

  test('should handle mixed success and error scenarios', async () => {
    // Mock one successful and one failed merge-passport call
    global.fetch.mockImplementation((url, options) => {
      if (url.includes('/merge-passport')) {
        const body = JSON.parse(options.body);
        
        if (body.first_name === 'Success') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, action: 'inserted' })
          });
        } else {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Database error')
          });
        }
      }
      
      return Promise.resolve({ ok: false, status: 404 });
    });

    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          first_name: 'Success',
          last_name: 'Kislinger',
          passport_number: 'P123456789'
        },
        {
          first_name: 'Failure',
          last_name: 'Kislinger',
          passport_number: 'P987654321'
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    expect(response.body.summary).toEqual({
      total: 2,
      merged: 0,
      inserted: 1,
      errors: 1
    });

    expect(response.body.results).toHaveLength(2);
    expect(response.body.results[0].status).toBe('success');
    expect(response.body.results[1].status).toBe('error');
  });

  test('should generate Google Sheets formatted output', async () => {
    const testPayload = {
      stay_id: 'B7_Kislinger',
      passports: [
        {
          first_name: 'Stefan',
          middle_name: 'Klaus',
          last_name: 'Kislinger',
          passport_number: 'P123456789',
          nationality_alpha3: 'DEU',
          birthday: '1985-03-15',
          gender: 'M'
        },
        {
          first_name: 'Maria',
          last_name: 'Kislinger',
          passport_number: 'P987654321',
          nationality_alpha3: 'DEU',
          birthday: '1987-07-22',
          gender: 'F'
        }
      ]
    };

    const response = await request(createTestApp())
      .post('/coco-gpt-batch-passport')
      .send(testPayload)
      .expect(200);

    // Verify Google Sheets format is included
    expect(response.body.sheets_format).toBeDefined();
    expect(response.body.sheets_format.description).toBe('Tab-delimited format ready for Google Sheets');
    expect(response.body.sheets_format.rows_count).toBe(2);
    
    // Verify the tab-delimited data structure with TM30 Immigration format
    const sheetsData = response.body.sheets_format.data;
    expect(sheetsData).toContain('First Name \tMiddle Name\tLast Name\tGender *\tPassport No. *\tNationality *\tBirth Date (DD/MM/YYYY)\tCheck-out Date (DD/MM/YYYY)\tPhone No.');
    expect(sheetsData).toContain('Stefan\tKlaus\tKislinger\tM\tP123456789\tDEU\t15/03/1985\t\t');
    expect(sheetsData).toContain('Maria\t\tKislinger\tF\tP987654321\tDEU\t22/07/1987\t\t');
    
    // Verify it's properly tab-delimited (can be split by \n and \t)
    const lines = sheetsData.split('\n');
    expect(lines).toHaveLength(3); // Header + 2 data rows
    
    const headerColumns = lines[0].split('\t');
    expect(headerColumns).toEqual(['First Name ', 'Middle Name', 'Last Name', 'Gender *', 'Passport No. *', 'Nationality *', 'Birth Date (DD/MM/YYYY)', 'Check-out Date (DD/MM/YYYY)', 'Phone No.']);
    
    const stefanColumns = lines[1].split('\t');
    expect(stefanColumns).toEqual(['Stefan', 'Klaus', 'Kislinger', 'M', 'P123456789', 'DEU', '15/03/1985', '', '']);
    
    const mariaColumns = lines[2].split('\t');
    expect(mariaColumns).toEqual(['Maria', '', 'Kislinger', 'F', 'P987654321', 'DEU', '22/07/1987', '', '']);
  });
});

// Note: Helper function tests would require exposing internal functions
// The integration tests above verify that these functions work correctly
// through the main endpoint behavior
