# Tokeet CSV Processing Unit Tests

This directory contains comprehensive unit tests for the Tokeet CSV processing functionality as specified in Step 6 of the project requirements.

## Test Implementation Overview

### Step 6 Requirements Fulfilled

✅ **1. Store a fixture CSV file in `tests/fixtures/tokeet_full.csv`**
   - Created comprehensive test fixture with 3 guest records
   - Covers all CSV fields mapped in `tokeet_csv_to_db_mapping.csv`
   - Includes complex scenarios (multiple emails/phones, different rental types)

✅ **2. Write tests that spin up the handler locally, post CSV, and assert database records**
   - Tests use supertest to simulate HTTP requests to the handler
   - Mock Supabase API calls to avoid real database connections
   - Assert that all mapped columns exist in the database payload

✅ **3. Make tests run with `SKIP_UPLOADS=1` to avoid storage calls**
   - Environment variable set in test setup
   - Verified that only 2 fetch calls are made (CSV fetch + DB insert)
   - No storage/upload calls are triggered during tests

## Test Files

### `tests/fixtures/tokeet_full.csv`
Comprehensive test fixture containing:
- **John Michael Smith**: Full record with all fields populated, including secondary emails/phones
- **Jane Elizabeth Doe**: Record with some empty fields to test null handling
- **Robert A Wilson**: Record with "Double House" rental type and different booking channel

### `tests/tokeet-csv-processing.test.js`
Main test suite with 3 test cases:

1. **Primary Test**: `should process CSV feed and create database records with all mapped columns`
   - Loads the full test fixture CSV
   - Mocks external API calls (feed fetch + Supabase RPC)
   - Verifies all CSV-to-DB mappings work correctly
   - **Asserts presence of ALL new columns** added in the migration:
     - Core identity: `first_name`, `last_name`, `middle_name`, `stay_id`
     - Contact info: `email`, `secondary_emails`, `phone_e164`, `secondary_phones`, `guest_address`
     - Booking data: `booking_status`, `booking_channel`, `rental_unit`, `rental_units`, `check_in_date`, etc.
     - **New migration columns**: `gender`, `birthday`, `passport_number`, `nationality_alpha3`, `issuing_country_alpha3`, `passport_issue_date`, `passport_expiry_date`, `mrz_full`, `mrz_hash`, `ocr_confidence`, `whatsapp_chat_id`, `whatsapp_group_id`, `source_batch_id`, `notes`, `guest_index`, `nickname`

2. **SKIP_UPLOADS Test**: `should handle CSV processing with SKIP_UPLOADS=1 environment variable`
   - Verifies the environment variable is respected
   - Confirms only essential API calls are made (no storage uploads)

3. **Storage Prevention Test**: `should verify SKIP_UPLOADS environment variable prevents storage calls`
   - Additional verification that storage calls are completely avoided
   - Tests with minimal CSV data to ensure basic functionality

## Key Assertions

### Database Record Validation
Each test verifies that processed CSV records contain:

- **All original CSV fields** properly mapped to database columns
- **Generated fields** like `stay_id` (from rental + guest name)
- **System fields** with correct defaults (`source`, `status`, `row_type`)
- **All new migration columns** (even if null for CSV imports)
- **Raw CSV data** preserved in `raw_json` field

### API Call Verification  
Tests ensure:
- Correct number of API calls (2: feed fetch + database insert)
- Proper request headers and authentication
- Correct Supabase RPC endpoint usage (`/rest/v1/rpc/insert_incoming_guests`)

## Running the Tests

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run with coverage
npm test -- --coverage
```

## Test Configuration

### `jest.config.js`
- Node.js environment
- Coverage reporting enabled
- Test file patterns configured

### `tests/setup.js`
- Global test setup and teardown
- Environment variable management
- Console output suppression for cleaner test runs

## Integration with Main Handler

The tests work by:
1. Importing the main `index.js` handler
2. Wrapping it in a simple Express-like interface for supertest
3. Mocking all external dependencies (fetch, Supabase, etc.)
4. Testing the `/tokeet-upsert` endpoint with real CSV data
5. Verifying the complete data transformation pipeline

This approach tests the actual handler code paths while avoiding external dependencies, making the tests fast, reliable, and independent of network connectivity or database availability.
