# CocoGPT Passport Workflow

## Simple Workflow

**You provide:**
1. Passport images (photos)
2. stay_id (e.g., "A6_CHRISTEN")

**CocoGPT automatically:**
1. Extracts passport data from images
2. Normalizes international characters
3. Inserts guest rows into `incoming_guests` table
4. Reports success

## Example Conversation

```
You: "Here are 2 passports for A6_CHRISTEN"
[Upload passport images]

CocoGPT: 
✅ Extracted passport data from 2 images
✅ Inserted 2 guest rows for stay_id: A6_CHRISTEN

Guests added:
1. John Smith - Passport: 123456789
2. Jane Smith - Passport: 987654321
```

## What CocoGPT Does Behind the Scenes

### 1. Image Processing
- Receives passport photos
- Extracts text using OCR
- Parses passport fields (name, number, nationality, dates)
- Normalizes character encoding (ø→o, ü→u, etc.)

### 2. API Call
CocoGPT calls:
```
POST https://coco-passport-proxy.vercel.app/add-passport-guests
```

With payload:
```json
{
  "stay_id": "A6_CHRISTEN",
  "guests": [
    {
      "first_name": "John",
      "last_name": "Smith",
      "gender": "M",
      "passport_number": "123456789",
      "nationality_alpha3": "USA",
      "birthday": "1990-01-15",
      ...
    }
  ]
}
```

### 3. Database Insertion
The API automatically:
- Creates separate guest rows (row_type='guest')
- Sets booking_id=NULL, phone_e164=NULL
- Sets source='tokeet_import'
- Normalizes international characters
- Handles database constraints

### 4. Verification
CocoGPT verifies insertion by querying:
```sql
SELECT first_name, last_name, passport_number, row_type 
FROM incoming_guests 
WHERE stay_id = 'A6_CHRISTEN' 
ORDER BY row_type, last_name
```

## Input Requirements

### Minimum Input
- **Passport images**: 1 or more photos
- **stay_id**: The booking identifier (e.g., "A6_CHRISTEN")

### CocoGPT Extracts
- First name, middle name, last name
- Gender (M/F)
- Passport number
- Nationality (3-letter code)
- Birthday (DD/MM/YYYY)
- Issue/expiry dates
- Issuing country

## Character Normalization

CocoGPT automatically normalizes international characters:

| Original | Normalized | Example |
|----------|------------|---------|
| ø | o | Søren → Soren |
| å | a | Åsa → Asa |
| ö, ü | o, u | Müller → Muller |
| è, é | e | René → Rene |
| ñ, ń | n | José → Jose |
| ß | ss | Groß → Gross |
| ž, š, č | z, s, c | Novák → Novak |

## Database Schema

Each passport creates a new row:

```sql
stay_id: 'A6_CHRISTEN'
booking_id: NULL              -- Always NULL
source: 'tokeet_import'       -- Always tokeet_import
row_type: 'guest'             -- Always guest
phone_e164: NULL              -- Always NULL
first_name: 'John'
middle_name: ''
last_name: 'Smith'
gender: 'M'
passport_number: '123456789'
nationality_alpha3: 'USA'
birthday: '1990-01-15'
...
```

## Expected Result

After processing, the `incoming_guests` table will have:
- **1 booking row** (row_type='booking') - the original reservation
- **N guest rows** (row_type='guest') - one per passport

Example query result:
```
stay_id      | row_type | first_name | last_name | passport_number
-------------|----------|------------|-----------|----------------
A6_CHRISTEN  | booking  | John       | Smith     | NULL
A6_CHRISTEN  | guest    | John       | Smith     | 123456789
A6_CHRISTEN  | guest    | Jane       | Smith     | 987654321
```

## Error Handling

### CocoGPT Handles
- ✅ OCR failures - Re-attempts or asks for clearer image
- ✅ Duplicate passports - Reports which passport already exists
- ✅ Partial failures - Reports success count and errors
- ✅ Invalid stay_id - Asks for correction

### Common Errors
**Duplicate passport:**
```
⚠️  Error: Guest 2 (Jane Smith) already exists with passport 987654321
✅  Successfully added 1 of 2 guests
```

**Invalid stay_id:**
```
❌ Error: stay_id 'A6-CHRISTEN' is invalid
Please use format: A6_CHRISTEN
```

## Best Practices

### ✅ Do This
- Provide clear, well-lit passport photos
- Use correct stay_id format (e.g., "A6_SMITH", "BEACHHOUSE_JONES")
- Upload all passports for a stay at once
- Verify guest count matches expected number

### ❌ Avoid This
- Blurry or dark photos
- Partial passport images
- Wrong stay_id format
- Re-uploading same passports (creates duplicates)

## Troubleshooting

### "Phantom duplicate errors"
If you get duplicate errors but no actual duplicates exist:
1. CocoGPT will automatically disable triggers
2. Retry insertion
3. Re-enable triggers
4. If persists, run: `REINDEX TABLE incoming_guests`

### "Guest count mismatch"
If guest count doesn't match booking:
```sql
-- Check all rows for the stay
SELECT row_type, first_name, last_name, passport_number
FROM incoming_guests 
WHERE stay_id = 'A6_CHRISTEN'
ORDER BY row_type, last_name;
```

Expected: 1 booking row + N guest rows

## API Endpoint Reference

**Endpoint:** `/add-passport-guests`  
**Method:** POST  
**URL:** `https://coco-passport-proxy.vercel.app/add-passport-guests`

**Request:**
```json
{
  "stay_id": "A6_CHRISTEN",
  "guests": [{
    "first_name": "John",
    "last_name": "Smith",
    "passport_number": "123456789",
    ...
  }]
}
```

**Response:**
```json
{
  "ok": true,
  "inserted": 2,
  "stay_id": "A6_CHRISTEN",
  "guests": [...]
}
```

## Related Documentation

- **PASSPORT_ENTRY_GUIDE.md** - Complete technical guide
- **PASSPORT_API_SUMMARY.md** - Full API documentation
- **QUICKSTART_PASSPORT.md** - Quick reference
- **examples/add-passport-guests-example.js** - Code examples

## Summary

**Your input:** Passport photos + stay_id  
**CocoGPT's job:** Extract data → Insert guest rows  
**Your result:** Guest records in database  

That's it! 🎉
