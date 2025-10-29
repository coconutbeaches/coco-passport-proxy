# MotherBrain OCR & Guest Intake Integration

## Overview

The `/motherbrain/guest-intake` endpoint processes passport photos via Google Vision OCR and sends structured guest data to the MotherBrainGPT API for guest management and check-in processing.

## Architecture

```
┌─────────────────┐       ┌──────────────────────┐       ┌─────────────────────┐
│  Client/CocoGPT │ ────> │ /motherbrain/        │ ────> │ MotherBrainGPT API  │
│  (multipart)    │       │  guest-intake        │       │ (upsert_guest_from_ │
│                 │       │  (Google Vision OCR) │       │  checkin)           │
└─────────────────┘       └──────────────────────┘       └─────────────────────┘
```

## Endpoint Specification

### POST `/motherbrain/guest-intake`

**Content-Type:** `multipart/form-data`

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `images` | File[] | Yes | One or more passport photo files (JPG, PNG) |
| `_stay_id` | String | No | Stay identifier (e.g., "A5_Crowley") |
| `_phone` | String | No | Guest phone number (E.164 format recommended) |
| `_nickname` | String | No | Guest nickname or preferred name |
| `_display_name` | String | No | Full display name for guest |
| `_notes` | String | No | Additional notes or context |

**Response (Success):**

```json
{
  "ok": true,
  "stay_id": "A5_Crowley",
  "inserted": 3,
  "message": "Guests parsed and sent to MotherBrainGPT",
  "guests": [
    {
      "first_name": "John",
      "middle_name": "",
      "last_name": "Smith",
      "gender": "M",
      "nationality_alpha3": "USA",
      "issuing_country_alpha3": "USA",
      "birthday": "1985-06-15",
      "passport_number": "123456789",
      "passport_issue_date": "2020-01-01",
      "passport_expiry_date": "2030-01-01"
    }
  ],
  "motherbrain_response": {
    "success": true,
    "guests_upserted": 3
  }
}
```

**Response (Error):**

```json
{
  "ok": false,
  "error": "No valid passport data extracted from images",
  "errors": [
    {
      "index": 0,
      "error": "Could not extract name from passport",
      "ocr_text_preview": "..."
    }
  ]
}
```

## OCR Processing

The endpoint uses Google Vision API's Document Text Detection to extract structured data from passport VIZ (Visual Inspection Zone) fields:

### Extracted Fields

- **Name:** Surname, Given Names (split into first/middle/last)
- **Document Number:** Passport number
- **Nationality:** 3-letter country code (ISO 3166-1 alpha-3)
- **Date of Birth:** Converted to YYYY-MM-DD format
- **Gender:** M/F/X
- **Issue Date:** Passport issuance date
- **Expiry Date:** Passport expiration date

### Supported Passport Languages

- English (PRIMARY, SURNAME, GIVEN NAMES)
- Dutch (NAAM, VOORNAMEN)
- Spanish (APELLIDOS, NOMBRES)
- French (NOM, PRÉNOMS)

## Environment Configuration

Add these variables to your `.env` or Vercel environment:

```bash
# MotherBrain API Configuration
MOTHERBRAIN_API_KEY=your_api_key_here
MOTHERBRAIN_API_URL=https://supabase-mcp-fly.fly.dev/api/tools/upsert_guest_from_checkin

# Google Vision API (already configured for other endpoints)
GOOGLE_APPLICATION_CREDENTIALS='{"type":"service_account",...}'
```

## Usage Examples

### Example 1: cURL with Single Passport

```bash
curl -X POST http://localhost:3000/motherbrain/guest-intake \
  -F "images=@/path/to/passport.jpg" \
  -F "_stay_id=A5_Crowley" \
  -F "_phone=+66981234567" \
  -F "_nickname=Tyler" \
  -F "_notes=First time guest"
```

### Example 2: Multiple Passports (Family)

```bash
curl -X POST http://localhost:3000/motherbrain/guest-intake \
  -F "images=@/path/to/passport1.jpg" \
  -F "images=@/path/to/passport2.jpg" \
  -F "images=@/path/to/passport3.jpg" \
  -F "_stay_id=B7_Smith" \
  -F "_phone=+1234567890"
```

### Example 3: JavaScript Fetch API

```javascript
const formData = new FormData();
formData.append('images', passportFile1);
formData.append('images', passportFile2);
formData.append('_stay_id', 'A4_Johnson');
formData.append('_phone', '+66812345678');

const response = await fetch('https://coco-passport-proxy.vercel.app/motherbrain/guest-intake', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result);
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `No images provided` | Request missing file uploads | Add at least one passport image |
| `No text detected in image` | Image quality too low or not a passport | Use higher quality images |
| `Could not extract name from passport` | OCR failed to parse VIZ fields | Verify passport is visible and in focus |
| `MotherBrainGPT API key not configured` | Missing `MOTHERBRAIN_API_KEY` env var | Set environment variable |
| `Failed to send data to MotherBrainGPT` | API call failed | Check API URL and network connectivity |

## Testing

Use the provided test script:

```bash
# Local testing
./test-motherbrain-intake.sh http://localhost:3000

# Production testing
./test-motherbrain-intake.sh https://coco-passport-proxy.vercel.app
```

Or run tests with Jest:

```bash
npm test -- motherbrain
```

## Integration with CocoGPT

The endpoint is designed for seamless integration with CocoGPT's check-in workflow:

1. Guest checks in via WhatsApp/web interface
2. CocoGPT collects passport photos
3. Photos are sent to `/motherbrain/guest-intake` with metadata
4. OCR extracts structured passport data
5. Data is automatically synced to MotherBrainGPT
6. Guest records are created/updated in the system

## Security Considerations

- **API Key Protection:** Never expose `MOTHERBRAIN_API_KEY` in client-side code
- **Rate Limiting:** Consider implementing rate limits for production use
- **File Size Limits:** Images are processed in-memory; large uploads may cause timeouts
- **CORS:** The endpoint respects existing CORS configuration in `index.js`

## Performance Notes

- **OCR Processing Time:** ~1-3 seconds per passport image
- **Batch Processing:** Multiple passports are processed sequentially
- **Memory Usage:** Images are held in memory during processing
- **Recommended Limit:** 5-10 passports per request maximum

## Troubleshooting

### OCR Not Extracting Data

1. Verify image quality (minimum 1280x720 recommended)
2. Ensure passport VIZ is fully visible
3. Check for glare or shadows on the document
4. Try re-uploading with better lighting

### API Connection Issues

```bash
# Test MotherBrain API connectivity
curl -X POST https://supabase-mcp-fly.fly.dev/api/tools/upsert_guest_from_checkin \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"guests": []}'
```

### Debugging Locally

```bash
# Enable debug logging
DEBUG=* node index.js

# Check OCR output directly
curl -X POST http://localhost:3000/passport-ocr \
  -F "images=@/path/to/passport.jpg"
```

## Related Endpoints

- `POST /passport-ocr` - OCR-only endpoint (returns TSV format)
- `POST /coco-gpt-batch-passport` - MRZ-based batch processing
- `POST /coco-gpt-batch-tsv` - TSV-based guest insertion

## Future Enhancements

- [ ] Add MRZ (Machine Readable Zone) parsing fallback
- [ ] Implement async processing for large batches
- [ ] Add webhook support for completion notifications
- [ ] Support additional document types (IDs, driver's licenses)
- [ ] Add confidence scoring and manual review flagging
