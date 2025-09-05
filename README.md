# Coco Passport Proxy

A Node.js API service for processing passport data and Tokeet booking feeds for the Coconut Beach Bungalows reservation system.

## Features

- **Passport Processing**: OCR passport data extraction and storage with dedicated microservice
- **Tokeet Integration**: Automated CSV/JSON feed processing from Tokeet booking system
- **Multi-format Support**: Handles both CSV and JSON data formats
- **Database Integration**: Supabase integration with automatic upsert capabilities
- **File Storage**: Image upload to Supabase Storage
- **Stay ID Resolution**: Intelligent room and guest name parsing
- **PaddleOCR Service**: Cloud Run-based OCR processing of passport images
- **Proxy API**: Vercel serverless proxy for OCR service integration

## Environment Requirements

### Required Environment Variables

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Tokeet Feed Configuration
TOKEET_FEED_URL=https://your-tokeet-feed-url.com/export.csv

# Optional Configuration
PASSPORT_PROXY_BASE_URL=https://coco-passport-proxy.vercel.app  # Auto-detected if not set
DATABASE_URL=postgresql://user:pass@host:port/db                # For direct PostgreSQL operations
SKIP_UPLOADS=1                                                  # For testing - bypasses file uploads
```

### System Requirements

- Node.js 18+ (for native `fetch` support)
- npm or yarn package manager
- Internet connectivity for Supabase API calls

### Dependencies

Key dependencies are automatically installed via npm:

```json
{
  "csv-parse": "^5.x",
  "pg": "^8.x" 
}
```

## Tokeet Integration

### Supported Tokeet CSV Fields

The system supports the following Tokeet CSV fields with automatic type coercion and database mapping:

#### Guest Information
- **Name** → `first_name`, `middle_name`, `last_name` (automatically parsed)
- **Email** → `email` 
- **Guest Secondary Emails** → `secondary_emails` (array)
- **Telephone** → `phone_e164`
- **Guest Secondary Phones** → `secondary_phones` (array)
- **Guest Address** → `guest_address`

#### Booking Details
- **Booking Status** → `booking_status`
- **Rental** → `rental_unit` + `rental_units` (array, auto-extracted)
- **Arrive** → `check_in_date` (date format)
- **Depart** → `check_out_date` (date format)
- **Nights** → `nights` (integer)
- **Received** → `date_received` (date format)
- **Checkin** → `checkin_time` (time format)
- **Checkout** → `checkout_time` (time format)

#### Booking Identifiers
- **Booking ID** → `booking_id`
- **Inquiry ID** → `inquiry_id` 
- **Source** → `booking_channel`
- **Guest ID** → `guest_id`
- **Booked** → Not stored (processing logic only)

#### Financial Information
- **Adults** → `adults` (integer)
- **Children** → `children` (integer) 
- **Currency** → `currency` (3-character limit)
- **Total Cost** → `total_cost` (numeric)
- **Base Rate** → `base_rate` (numeric)
- **Tax** → `tax` (numeric)
- **Booking Formula** → `booking_formula`

#### System Fields (Auto-Generated)
- **stay_id** → Generated from rental unit + guest name
- **external_reservation_id** → Mapped from Booking ID or Inquiry ID
- **source** → Set to `'tokeet_feed'`
- **row_type** → Set to `'booking'`
- **status** → Set to `'pending_review'`
- **photo_urls** → Empty array `[]`
- **raw_json** → Original CSV row data

## API Endpoints

### `/tokeet-upsert`

Process and upsert Tokeet booking feed data.

**Method:** `POST`

**Request Body:**
```json
{
  "feed_url": "https://your-tokeet-feed-url.com/export.csv"
}
```

**Response:**
```json
{
  "ok": true,
  "via": "rpc",
  "inserted": 15,
  "rows": [...]
}
```

#### Example cURL Call

```bash
curl -X POST https://coco-passport-proxy.vercel.app/tokeet-upsert \\
  -H "Content-Type: application/json" \\
  -d '{
    "feed_url": "https://app.tokeet.com/export/reservations/csv?token=YOUR_TOKEN&start=%7Bstart:%25Y-%25m-%25d%7D&end=%7Bend:%25Y-%25m-%25d%7D"
  }'
```

**Features:**
- **Date Template Support**: Use `{start:%Y-%m-%d}` and `{end:%Y-%m-%d}` in feed URLs for dynamic dates
- **Format Auto-Detection**: Automatically detects CSV vs JSON format
- **Type Coercion**: Converts strings to appropriate data types (integers, dates, arrays, etc.)
- **Intelligent Parsing**: 
  - Splits full names into first/middle/last components
  - Extracts room codes from rental descriptions
  - Generates unique stay IDs
  - Maps reservation IDs appropriately

### Other Endpoints

- **`GET /`** - Health check
- **`GET /resolve?stay_id=QUERY`** - Parse stay ID components
- **`POST /upload`** - Upload passport images
- **`POST /insert`** - Insert guest records
- **`POST /passport`** - Merge passport data
- **`GET /export?stay_id=ID`** - Export guest data
- **`GET /status?stay_id=ID`** - Check passport upload status

## Data Processing

### Type Coercion

The system automatically converts CSV string data to appropriate database types:

- **Integers**: `nights`, `adults`, `children`
- **Numeric**: `total_cost`, `base_rate`, `tax`, `ocr_confidence`  
- **Dates**: `check_in_date`, `check_out_date`, `date_received`, `birthday`, `passport_issue_date`, `passport_expiry_date`
- **Times**: `checkin_time`, `checkout_time`
- **Arrays**: `secondary_emails`, `secondary_phones`, `rental_units`, `photo_urls`
- **Strings**: All other fields

### Stay ID Generation

Stay IDs are automatically generated using the `normalizeStayIdFreeform()` function:

```javascript
// Example: "A4 · 1 Bedroom at CBB (A4) - Smith Family"
// Generates: "A4_Smith"

const result = normalizeStayIdFreeform("A4 John Smith");
// result.stay_id = "A4_JohnSmith"
// result.rooms = ["A4"]  
// result.last_name_canonical = "JohnSmith"
```

**Supported Room Types:**
- Single rooms: A3, A4, A5, A6, A7, A8, A9, B6, B7, B8, B9
- Multi-word rooms: Double House, Jungle House, Beach House, New House

## Architecture

### Field Mapping Configuration

All field mappings are centralized in `lib/tokeetFieldMap.js`:

```javascript
const { CSV_TO_DB_MAPPING, getSupportedFields } = require('./lib/tokeetFieldMap');

// Get all supported CSV field names
const supportedFields = getSupportedFields();
```

### Database Schema

The system expects these key database columns in the `incoming_guests` table:

**Core Identity:**
- `stay_id` (text, generated)
- `first_name` (text)
- `middle_name` (text) 
- `last_name` (text)

**Passport/Identity:**
- `gender` (character(1))
- `birthday` (date)
- `passport_number` (text)
- `nationality_alpha3` (character(3))
- `issuing_country_alpha3` (character(3))
- `passport_issue_date` (date)
- `passport_expiry_date` (date)
- `mrz_full` (text)
- `mrz_hash` (text)
- `ocr_confidence` (numeric)

**Contact:**
- `email` (text)
- `secondary_emails` (array)
- `phone_e164` (text)
- `secondary_phones` (array)
- `guest_address` (text)

**Booking:**
- `booking_status` (text)
- `booking_channel` (text)
- `rental_unit` (text)
- `rental_units` (array)
- `check_in_date` (date)
- `check_out_date` (date)
- `nights` (integer)
- `external_reservation_id` (text)
- `booking_id` (text)
- `inquiry_id` (text)

**System:**
- `source` (text)
- `status` (text)
- `row_type` (text)  
- `photo_urls` (array)
- `raw_json` (jsonb)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## Development

### Local Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Set environment variables (see above)
4. Run locally: `npm start` or `node index.js`

### Testing

Run the test suite:
```bash
npm test
```

Key test files:
- `tests/tokeet-csv-processing.test.js` - Tokeet integration tests
- `tests/fixtures/tokeet_full.csv` - Test data

### Deployment

The service is designed for Vercel deployment:

1. Set environment variables in Vercel dashboard
2. Deploy: `vercel --prod`
3. The service will be available at your Vercel URL

## Error Handling

The API returns structured error responses:

```json
{
  "ok": false,
  "error": "missing feed_url (body) or TOKEET_FEED_URL env",
  "status": 400
}
```

Common error scenarios:
- Missing environment variables
- Invalid CSV format  
- Database connection failures
- Network timeouts for feed URLs
- Type coercion failures

## Security

- Uses Supabase service role keys for database access
- CORS enabled for cross-origin requests
- Input validation and sanitization
- Safe URL parameter handling
- Environment-based configuration

## Components

### Main API Service

Vercel-hosted Node.js service handling booking feeds and guest data:

- `/tokeet-upsert`: Process Tokeet booking data
- `/insert`: Bulk insert guest records
- `/passport`: Merge passport data
- Other utility endpoints (export, status, etc.)

### OCR Microservice

Cloud Run-based FastAPI service for passport image processing:

- PaddleOCR-based text detection
- Image preprocessing and enhancement
- MRZ (Machine Readable Zone) parsing
- TSV output format for database compatibility

See [apps/ocr/README.md](apps/ocr/README.md) for details.

### OCR Proxy API

Vercel serverless proxy for OCR service integration:

- `/api/passport-ocr`: Forward passport image processing
- Multipart form data handling
- Authentication and error propagation

See [apps/proxy/README.md](apps/proxy/README.md) for details.

## License

Private project for Coconut Beach Bungalows reservation system.
