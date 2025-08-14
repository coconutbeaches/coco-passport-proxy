const request = require('supertest');
const fs = require('fs');
const path = require('path');

// Mock fetch to avoid real external calls
global.fetch = jest.fn();

// Import the handler after setting up mocks
const handler = require('../index.js');

// Create a simple Express-like wrapper for testing
const createApp = () => {
  const app = (req, res) => {
    return handler(req, res);
  };
  return app;
};

describe('Tokeet CSV Processing', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();
    
    // Set environment variables for testing
    process.env.SKIP_UPLOADS = '1';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.TOKEET_FEED_URL = 'http://test-feed-url.com';
  });

  test('should process CSV feed and create database records with all mapped columns', async () => {
    // Read the test fixture CSV
    const csvPath = path.join(__dirname, 'fixtures', 'tokeet_full.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    
    // Mock the feed fetch to return our CSV content
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(csvContent),
        json: null
      })
      // Mock the Supabase RPC call to succeed
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify([
          { id: 'test-id-1', stay_id: 'test_stay_1', first_name: 'John' },
          { id: 'test-id-2', stay_id: 'test_stay_2', first_name: 'Jane' },
          { id: 'test-id-3', stay_id: 'test_stay_3', first_name: 'Robert' }
        ]))
      });

    const app = createApp();
    
    const response = await request(app)
      .post('/tokeet-upsert')
      .send({ feed_url: 'http://test-feed-url.com' })
      .expect(200);

    // Verify the response structure
    expect(response.body).toMatchObject({
      ok: true,
      via: 'rpc',
      inserted: 3
    });
    expect(response.body.rows).toHaveLength(3);

    // Verify that fetch was called correctly
    expect(global.fetch).toHaveBeenCalledTimes(2);
    
    // First call should be to fetch the CSV feed
    expect(global.fetch).toHaveBeenNthCalledWith(1, 'http://test-feed-url.com', {});
    
    // Second call should be to Supabase RPC with processed data
    const supabaseCall = global.fetch.mock.calls[1];
    expect(supabaseCall[0]).toBe('https://test.supabase.co/rest/v1/rpc/insert_incoming_guests');
    expect(supabaseCall[1].method).toBe('POST');
    expect(supabaseCall[1].headers).toEqual({
      apikey: 'test-service-key',
      Authorization: 'Bearer test-service-key',
      'Content-Type': 'application/json',
      'Accept-Profile': 'public',
      'Content-Profile': 'public'
    });

    // Parse the request body to verify all mapped columns are present
    const requestBody = JSON.parse(supabaseCall[1].body);
    expect(requestBody).toHaveProperty('rows');
    expect(requestBody.rows).toHaveLength(3);

    // Test first record - John Michael Smith - verify all key mapped fields are present
    const johnRecord = requestBody.rows[0];
    expect(johnRecord).toMatchObject({
      // Core identity fields
      first_name: 'John',
      last_name: 'Smith',
      middle_name: 'Michael',
      
      // Contact information
      email: 'john.smith@example.com',
      secondary_emails: ['john.alt@example.com', 'j.smith@company.com'],
      phone_e164: '+1234567890',
      secondary_phones: ['555-123-4567', '555-987-6543'],
      guest_address: '123 Main St, Test City, TC 12345',
      
      // Booking information
      booking_status: 'Booked',
      booking_channel: 'booking.com',
      rental_unit: 'A4 · 1 Bedroom / 1 Bath at Coconut Beach Bungalows (A4)',
      rental_units: ['A4'],
      check_in_date: '2024-12-01',
      check_out_date: '2024-12-07',
      nights: 6,
      date_received: '2024-11-01',
      checkin_time: '15:00',
      checkout_time: '12:00',
      booking_id: 'test-booking-001',
      inquiry_id: 'test-inquiry-001',
      external_reservation_id: 'test-booking-001',
      adults: 2,
      children: 1,
      currency: 'USD',
      total_cost: 1200.50,
      base_rate: 1000.00,
      tax: 120.50,
      booking_formula: '1200.50',
      guest_id: 'guest-001',
      
      // System fields
      source: 'tokeet_feed',
      status: 'pending_review',
      row_type: 'booking',
      photo_urls: []
    });
    
    // Verify stay_id was generated (the exact format depends on the complex normalizeStayIdFreeform function)
    expect(johnRecord.stay_id).toBeDefined();
    expect(typeof johnRecord.stay_id).toBe('string');
    expect(johnRecord.stay_id.length).toBeGreaterThan(0);
    
    // Verify raw_json contains the original CSV data
    expect(johnRecord.raw_json).toBeInstanceOf(Array);
    expect(johnRecord.raw_json[0]).toBe('John Michael Smith'); // First CSV field

    // Verify all records have the required new columns that were added in migration
    requestBody.rows.forEach(record => {
      expect(record).toHaveProperty('source', 'tokeet_feed');
      expect(record).toHaveProperty('status', 'pending_review');
      expect(record).toHaveProperty('row_type', 'booking');
      expect(record).toHaveProperty('photo_urls', []);
      expect(record).toHaveProperty('raw_json');
      expect(record).toHaveProperty('stay_id');
      expect(record).toHaveProperty('external_reservation_id');
      expect(record).toHaveProperty('rental_units');
      
      // Verify all the new columns from the migration exist (even if null)
      expect(record).toHaveProperty('gender');
      expect(record).toHaveProperty('birthday');
      expect(record).toHaveProperty('passport_number');
      expect(record).toHaveProperty('nationality_alpha3');
      expect(record).toHaveProperty('issuing_country_alpha3');
      expect(record).toHaveProperty('passport_issue_date');
      expect(record).toHaveProperty('passport_expiry_date');
      expect(record).toHaveProperty('mrz_full');
      expect(record).toHaveProperty('mrz_hash');
      expect(record).toHaveProperty('ocr_confidence');
      expect(record).toHaveProperty('whatsapp_chat_id');
      expect(record).toHaveProperty('whatsapp_group_id');
      expect(record).toHaveProperty('source_batch_id');
      expect(record).toHaveProperty('notes');
      expect(record).toHaveProperty('guest_index');
      expect(record).toHaveProperty('nickname');
    });
  });

  test('should handle CSV processing with SKIP_UPLOADS=1 environment variable', async () => {
    // Ensure SKIP_UPLOADS is set
    expect(process.env.SKIP_UPLOADS).toBe('1');
    
    const csvContent = `"Name","Email","Rental","Arrive","Depart"\n"Test User","test@example.com","A3","2024-12-01","2024-12-05"`;
    
    // Mock successful feed fetch and database insert
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(csvContent),
        json: null
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify([{ id: 'test-id', stay_id: 'A3_User' }]))
      });

    const app = createApp();
    
    const response = await request(app)
      .post('/tokeet-upsert')
      .send({ feed_url: 'http://test-feed-url.com' })
      .expect(200);

    expect(response.body.ok).toBe(true);
    
    // Verify no storage upload calls were made (only feed fetch + DB insert)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('should verify SKIP_UPLOADS environment variable prevents storage calls', async () => {
    // Ensure SKIP_UPLOADS is properly set and respected
    expect(process.env.SKIP_UPLOADS).toBe('1');
    
    // Simple CSV with minimal data
    const csvContent = `"Name","Email","Rental"\n"Test User","test@example.com","A3"`;
    
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200, 
        text: () => Promise.resolve(csvContent),
        json: null
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify([{ id: 'test-id', stay_id: 'test_stay' }]))
      });

    const app = createApp();
    
    const response = await request(app)
      .post('/tokeet-upsert') 
      .send({ feed_url: 'http://test-feed-url.com' })
      .expect(200);

    expect(response.body.ok).toBe(true);
    
    // Verify only 2 calls made (CSV fetch + DB insert), no storage uploads
    expect(global.fetch).toHaveBeenCalledTimes(2);
    
    // Verify the database call contains processed data
    const supabaseCall = global.fetch.mock.calls[1];
    const requestBody = JSON.parse(supabaseCall[1].body);
    expect(requestBody.rows).toHaveLength(1);
    expect(requestBody.rows[0].first_name).toBe('Test');
    expect(requestBody.rows[0].last_name).toBe('User');
  });
});
