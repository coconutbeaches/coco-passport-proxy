# Passport Guest Entry API - Implementation Summary

## Overview

A simplified API endpoint (`/add-passport-guests`) has been added to enable easy insertion of passport guest records into the Supabase `incoming_guests` table.

## Key Features

### 1. Simplified Input Format
- Accepts stay_id + array of guest objects
- Only requires basic passport fields
- No complex OCR or image processing

### 2. Character Normalization
Automatically normalizes international characters for database compatibility:
- `ø` → `o` (Danish/Norwegian)
- `ö`, `ü` → `o`, `u` (German)
- `è`, `é` → `e` (French)
- `ñ`, `ń` → `n` (Spanish/Polish)
- `å` → `a` (Scandinavian)
- `ß` → `ss` (German)
- `ž`, `š`, `č` → `z`, `s`, `c` (Slavic)

### 3. Database Constraint Safety
The endpoint follows strict rules to avoid constraint violations:
- Sets `booking_id = NULL` (avoids booking_id/check_in_date unique constraint)
- Sets `phone_e164 = NULL` (avoids stay_id/phone unique constraint)
- Sets `source = 'tokeet_import'` (bypasses reconciliation trigger)
- Sets `row_type = 'guest'` (marks as passport entry, not booking)

### 4. Trigger Management
- Automatically disables `trg_enforce_stayid_shortform` before insertion
- Re-enables trigger after all insertions complete
- Ensures stay_id format validation doesn't interfere

## API Endpoint

### POST `/add-passport-guests`

**URL:** `https://coco-passport-proxy.vercel.app/add-passport-guests`

**Request Body:**
```json
{
  "stay_id": "A6_CHRISTEN",
  "guests": [
    {
      "first_name": "John",
      "middle_name": "",
      "last_name": "Smith",
      "gender": "M",
      "passport_number": "123456789",
      "nationality_alpha3": "USA",
      "issuing_country_alpha3": "USA",
      "birthday": "1990-01-15",
      "passport_issue_date": "2020-01-01",
      "passport_expiry_date": "2030-01-01"
    }
  ]
}
```

**Response (Success):**
```json
{
  "ok": true,
  "inserted": 1,
  "stay_id": "A6_CHRISTEN",
  "guests": [
    {
      "id": 123,
      "first_name": "John",
      "last_name": "Smith",
      "passport_number": "123456789"
    }
  ]
}
```

**Response (Partial Success with Errors):**
```json
{
  "ok": true,
  "inserted": 1,
  "stay_id": "A6_CHRISTEN",
  "guests": [...],
  "partial_success": true,
  "errors": [
    {
      "index": 1,
      "error": "Duplicate passport or unique constraint violation",
      "detail": "Key (passport_number)=(987654321) already exists.",
      "guest": {...}
    }
  ]
}
```

## Field Mapping

### Required Fields
- `stay_id` (string) - The stay identifier (e.g., "A6_CHRISTEN")
- `guests[].first_name` (string) - Guest's first name

### Optional Fields
- `guests[].middle_name` (string)
- `guests[].last_name` (string)
- `guests[].gender` (string) - "M" or "F"
- `guests[].passport_number` (string)
- `guests[].nationality_alpha3` (string) - 3-letter country code
- `guests[].issuing_country_alpha3` (string) - 3-letter country code
- `guests[].birthday` (date) - Format: YYYY-MM-DD
- `guests[].passport_issue_date` (date) - Format: YYYY-MM-DD
- `guests[].passport_expiry_date` (date) - Format: YYYY-MM-DD

### Auto-Set Fields (Cannot be overridden)
- `booking_id` - Always `NULL`
- `phone_e164` - Always `NULL`
- `source` - Always `'tokeet_import'`
- `row_type` - Always `'guest'`

## Database Schema

The endpoint inserts into the `incoming_guests` table with this structure:

```sql
INSERT INTO incoming_guests (
    stay_id,
    booking_id,        -- NULL
    source,            -- 'tokeet_import'
    row_type,          -- 'guest'
    phone_e164,        -- NULL
    first_name,
    middle_name,
    last_name,
    gender,
    passport_number,
    nationality_alpha3,
    issuing_country_alpha3,
    birthday,
    passport_issue_date,
    passport_expiry_date
) VALUES (...)
```

## Usage Examples

### Example 1: Basic Usage
```javascript
const response = await fetch('https://coco-passport-proxy.vercel.app/add-passport-guests', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    stay_id: "A6_CHRISTEN",
    guests: [{
      first_name: "John",
      last_name: "Smith",
      gender: "M",
      passport_number: "123456789",
      nationality_alpha3: "USA",
      birthday: "1990-01-15"
    }]
  })
});

const result = await response.json();
console.log(`Inserted ${result.inserted} guests`);
```

### Example 2: International Characters
```javascript
// Characters will be automatically normalized
await fetch('https://coco-passport-proxy.vercel.app/add-passport-guests', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    stay_id: "A4_HANSEN",
    guests: [{
      first_name: "Søren",      // Will become "Soren"
      last_name: "Müller",      // Will become "Muller"
      gender: "M",
      passport_number: "DK123456",
      nationality_alpha3: "DNK"
    }]
  })
});
```

### Example 3: Multiple Guests
```javascript
await fetch('https://coco-passport-proxy.vercel.app/add-passport-guests', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    stay_id: "BEACHHOUSE_JOHNSON",
    guests: [
      {
        first_name: "Michael",
        last_name: "Johnson",
        gender: "M",
        passport_number: "US1234567",
        nationality_alpha3: "USA",
        birthday: "1985-05-20"
      },
      {
        first_name: "Sarah",
        last_name: "Johnson",
        gender: "F",
        passport_number: "US7654321",
        nationality_alpha3: "USA",
        birthday: "1987-08-15"
      }
    ]
  })
});
```

## Error Handling

### Common Errors

**400 - Missing stay_id:**
```json
{
  "ok": false,
  "error": "stay_id (string) is required"
}
```

**400 - Missing guests:**
```json
{
  "ok": false,
  "error": "guests (array) is required and must not be empty"
}
```

**Unique Constraint Violation:**
```json
{
  "ok": true,
  "inserted": 1,
  "partial_success": true,
  "errors": [{
    "index": 1,
    "error": "Duplicate passport or unique constraint violation",
    "detail": "Key (passport_number)=(123456789) already exists."
  }]
}
```

## Files Modified/Created

1. **index.js** - Added `/add-passport-guests` endpoint (line ~2133)
2. **PASSPORT_ENTRY_GUIDE.md** - Updated comprehensive guide
3. **PASSPORT_API_SUMMARY.md** - This file
4. **examples/add-passport-guests-example.js** - Usage examples
5. **README.md** - Updated API documentation

## Testing

Run the example file:
```bash
node examples/add-passport-guests-example.js
```

Or test with cURL:
```bash
curl -X POST https://coco-passport-proxy.vercel.app/add-passport-guests \
  -H "Content-Type: application/json" \
  -d '{
    "stay_id": "TEST_SMITH",
    "guests": [{
      "first_name": "Test",
      "last_name": "User",
      "passport_number": "TEST123"
    }]
  }'
```

## Important Notes

### ⚠️ Critical Rules
1. **Never update booking rows** - Always create new guest rows
2. **Always set booking_id=NULL** - Prevents constraint violations
3. **Always set phone_e164=NULL** - Prevents stay_id/phone constraint
4. **Use source='tokeet_import'** - Bypasses reconciliation triggers

### Dropped Functionality
- `t20_merge_passport_fields` trigger was removed - it conflicted with the "one guest row per passport" model

### Database Constraints
The endpoint is designed to work around these constraints:
- `UNIQUE (booking_id, check_in_date)` - Avoided by booking_id=NULL
- `UNIQUE (stay_id, phone_e164)` - Avoided by phone_e164=NULL
- `UNIQUE (passport_number)` - Duplicate passports will error

## Troubleshooting

If you encounter phantom duplicate errors:

1. Disable all BEFORE INSERT triggers:
```sql
ALTER TABLE incoming_guests DISABLE TRIGGER trg_reconcile_tokeet_booking;
ALTER TABLE incoming_guests DISABLE TRIGGER trg_autofill_incoming_guest_whatsapp_group;
ALTER TABLE incoming_guests DISABLE TRIGGER normalize_stay_id_uppercase;
ALTER TABLE incoming_guests DISABLE TRIGGER trg_generate_manual_booking_id;
```

2. Re-enable after insertions
3. Run `REINDEX TABLE incoming_guests;` if problems persist

## Verification

After insertion, verify the data:

```sql
SELECT first_name, middle_name, last_name, gender, passport_number, row_type 
FROM incoming_guests 
WHERE stay_id = 'A6_CHRISTEN' 
ORDER BY row_type, last_name, first_name;
```

Expected result:
- One row with `row_type='booking'` (the original booking)
- Multiple rows with `row_type='guest'` (the passport entries)
