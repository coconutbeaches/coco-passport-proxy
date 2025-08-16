# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview

Coco Passport Proxy is a Node.js serverless API service for processing passport data and Tokeet booking feeds for the Coconut Beach Bungalows reservation system. It runs on Vercel as a single-handler application with intelligent field mapping, type coercion, and database integration.

## Common Development Commands

```bash
# Setup and installation
npm install                    # Install dependencies

# Local development  
node index.js                  # Run locally (requires env vars)
npm start                      # Same as above if start script exists

# Testing
npm test                       # Run Jest test suite
npm test -- --coverage        # Run tests with coverage report
SKIP_UPLOADS=1 npm test        # Run tests without storage calls (recommended)

# Deployment
vercel --prod                  # Deploy to production
vercel env pull .env.local     # Pull environment variables locally
```

### Useful cURL Examples

```bash
# Process Tokeet feed
curl -X POST https://coco-passport-proxy.vercel.app/tokeet-upsert \
  -H "Content-Type: application/json" \
  -d '{"feed_url": "https://app.tokeet.com/export/reservations/csv?token=YOUR_TOKEN"}'

# Check passport upload status
curl "https://coco-passport-proxy.vercel.app/status?stay_id=A4_Smith"

# Resolve stay ID components
curl "https://coco-passport-proxy.vercel.app/resolve?stay_id=A4%20John%20Smith"
```

## High-Level Architecture & Code Structure

The application follows a serverless single-handler pattern with modular internal organization:

### Core Components

- **`index.js`** - Main Vercel handler with all HTTP routing and endpoint logic
- **`lib/tokeetFieldMap.js`** - Centralized CSV-to-database field mapping configuration
- **`tests/`** - Jest test suite with fixture data and comprehensive coverage

### Request Flow

```
HTTP Request → index.js router → Field mapping & coercion → Database operation → Response
                ↓
            Helper functions:
            - parseCSVRowToDBObject()
            - normalizeStayIdFreeform()
            - parseMRZ()
            - coerceValue()
```

### Key Internal Modules

1. **Router & CORS Handler**: URL parsing, method dispatch, preflight handling
2. **CSV/JSON Processing**: Tokeet feed parsing with automatic format detection
3. **Field Mapping Engine**: `CSV_TO_DB_MAPPING` configuration with type coercion
4. **Stay ID Generation**: Room code extraction and guest name normalization
5. **MRZ Processing**: Machine Readable Zone parsing for passports
6. **Database Abstractions**: Supabase RPC preferred, REST fallback, direct PostgreSQL

## Key Endpoints & Purposes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/` | Health check |
| `POST` | `/tokeet-upsert` | Fetch and process Tokeet booking feed (CSV/JSON) |
| `POST` | `/insert` | Bulk insert guest records with upsert logic |
| `POST` | `/passport` | Merge passport data into existing records |
| `POST` | `/merge-passport` | Enhanced passport merge with extended validation |
| `POST` | `/coco-gpt-batch-passport` | Batch passport processing for CocoGPT integration |
| `POST` | `/upload` | Upload passport images to Supabase Storage |
| `POST` | `/upload-url` | Server-side image fetch and upload |
| `GET` | `/resolve` | Parse stay ID components (rooms + guest name) |
| `GET` | `/export` | Export guest data as tab-delimited format |
| `GET` | `/status` | Check passport upload status for stay |

## Field Mappings & Data Transformations

### CSV-to-Database Mapping

All field mappings are centralized in `lib/tokeetFieldMap.js` using the `CSV_TO_DB_MAPPING` configuration:

- **Guest Info**: `Name` → `first_name`, `middle_name`, `last_name` (auto-split)
- **Contact**: `Email`, `Telephone` → `email`, `phone_e164`
- **Booking**: `Rental`, `Arrive`, `Depart` → `rental_unit`, `check_in_date`, `check_out_date`
- **Arrays**: `Guest Secondary Emails` → `secondary_emails` (comma-separated or JSON)

### Type Coercion Rules

The `coerceValue()` function handles automatic type conversion:

- **Integers**: `nights`, `adults`, `children`
- **Numeric**: `total_cost`, `base_rate`, `tax`, `ocr_confidence`
- **Dates**: ISO format conversion for all date fields
- **Arrays**: Comma-separated strings or JSON arrays
- **Null Handling**: Empty strings and 'null'/'undefined' → `null`

### Derived Fields

- **`stay_id`**: Generated from `rental_unit` + `last_name` using `normalizeStayIdFreeform()`
- **`rental_units`**: Array extracted from room codes in `rental_unit` text
- **`external_reservation_id`**: Mapped from `booking_id` or `inquiry_id`
- **System fields**: `source`, `status`, `row_type` set to default values

## Database Integration Patterns

### Primary Flow: Supabase RPC
```javascript
// Preferred method - uses insert_incoming_guests RPC function
POST /rest/v1/rpc/insert_incoming_guests
Headers: { Prefer: 'return=representation' }
```

### Fallback: REST Table Insert
```javascript
// Fallback when RPC fails - direct table operation
POST /rest/v1/incoming_guests
Headers: { Prefer: 'resolution=merge-duplicates' }
```

### Direct PostgreSQL (Passport Merge)
```javascript
// For /passport and /merge-passport endpoints
const { Pool } = require('pg');
// Uses CONNECTION_STRING with transaction-based upsert logic
```

### Required Environment Variables

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Tokeet Integration  
TOKEET_FEED_URL=https://tokeet-csv-feed-url

# Optional
PASSPORT_PROXY_BASE_URL=https://coco-passport-proxy.vercel.app
DATABASE_URL=postgresql://user:pass@host:port/db
SKIP_UPLOADS=1  # For testing - bypasses file uploads
```

## Testing Approach & Setup

### Test Framework
- **Jest** with Node.js environment
- **Supertest** for HTTP endpoint testing  
- **Fetch mocking** to avoid external API calls

### Key Test Files
- `tests/tokeet-csv-processing.test.js` - Main CSV processing tests
- `tests/fixtures/tokeet_full.csv` - Comprehensive test data
- `tests/setup.js` - Global test configuration

### Running Tests
```bash
npm test                    # Run all tests
npm test -- --coverage     # With coverage report
SKIP_UPLOADS=1 npm test     # Skip storage calls (recommended)
```

The test suite validates:
- Complete CSV-to-database field mapping
- Type coercion for all data types
- Stay ID generation logic
- Database payload structure
- All new migration columns presence

## Deployment Configuration

### Vercel Setup
```json
// vercel.json
{
  "version": 2,
  "builds": [{ "src": "index.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "/index.js" }]
}
```

### Runtime Requirements
- **Node.js 18+** (native fetch support)
- **Vercel Functions** deployment target
- Environment variables configured in Vercel dashboard

### Safety Features
- **URL validation**: `validateAndGetBaseUrl()` prevents TestFlight build drift
- **CORS handling**: Automatic preflight response for cross-origin requests
- **Error wrapping**: Structured error responses with appropriate HTTP codes

## Room Code System

The application recognizes these room types for stay ID generation:

**Single Rooms**: A3, A4, A5, A6, A7, A8, A9, B6, B7, B8, B9  
**Multi-word Rooms**: Double House, Jungle House, Beach House, New House

Stay IDs follow the pattern: `{ROOM}_{LastName}` (e.g., `A4_Smith`, `DoubleHouse_Johnson`)

## MRZ Processing Features

The service includes sophisticated passport MRZ (Machine Readable Zone) processing:

- **Format Detection**: TD1 (ID cards) and TD3 (passports)
- **Data Extraction**: Name parsing, country codes, gender, birthdate
- **Hash Generation**: SHA-256 for duplicate detection
- **Validation**: OCR confidence scoring and quality assessment

## Useful Code Snippets

### Manual Stay ID Resolution
```javascript
const result = normalizeStayIdFreeform("A4 John Smith Family");
// result.stay_id = "A4_JohnSmithFamily"
// result.rooms = ["A4"]
// result.last_name_canonical = "JohnSmithFamily"
```

### Date Template Resolution in URLs
```javascript
// Feed URLs support dynamic dates
const url = "https://tokeet.com/export.csv?start={start:%Y-%m-%d}&end={end:%Y-%m-%d}";
// Resolves to tomorrow's date in UTC
```

### Testing with Storage Bypass
```javascript
// Set environment variable to skip upload operations during tests
process.env.SKIP_UPLOADS = '1';
```
