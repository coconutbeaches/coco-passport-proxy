# CocoGPT Batch Passport Processing Integration

## Overview

The `/coco-gpt-batch-passport` endpoint enables CocoGPT to efficiently process multiple passport photos for a single stay, with intelligent merging for existing guests and automatic Google Sheets formatting.

## Key Features

- **Intelligent Merging**: Existing guests (like Stefan) are updated with new passport data, while new guests are inserted as separate records
- **MRZ Validation**: Automatic parsing and validation of Machine Readable Zone data
- **OCR Quality Assessment**: Confidence score validation and normalization
- **Google Sheets Ready**: Provides tab-delimited output for instant copy-paste into spreadsheets
- **Comprehensive Error Handling**: Detailed feedback for each passport processed

## Usage Example

### Request Format

```json
POST /coco-gpt-batch-passport
Content-Type: application/json

{
  "stay_id": "B7_Kislinger",
  "passports": [
    {
      "first_name": "Stefan",
      "last_name": "Kislinger",
      "passport_number": "P123456789",
      "nationality_alpha3": "DEU",
      "issuing_country_alpha3": "DEU",
      "birthday": "1985-03-15",
      "gender": "M",
      "mrz_full": "P<DEUKISLINGER<<STEFAN<<<<<<<<<<<<<<<<<<<<<<",
      "ocr_confidence": 0.95,
      "photo_urls": ["https://example.com/stefan_passport.jpg"]
    },
    {
      "first_name": "Maria",
      "last_name": "Kislinger",
      "passport_number": "P987654321",
      "nationality_alpha3": "DEU",
      "issuing_country_alpha3": "DEU",
      "birthday": "1987-07-22",
      "gender": "F",
      "mrz_full": "P<DEUKISLINGER<<MARIA<<<<<<<<<<<<<<<<<<<<<<",
      "ocr_confidence": 0.92,
      "photo_urls": ["https://example.com/maria_passport.jpg"]
    },
    {
      "first_name": "Hans",
      "last_name": "Kislinger",
      "passport_number": "P456789123",
      "nationality_alpha3": "DEU",
      "issuing_country_alpha3": "DEU",
      "birthday": "2010-12-05",
      "gender": "M",
      "mrz_full": "P<DEUKISLINGER<<HANS<<<<<<<<<<<<<<<<<<<<<<<",
      "ocr_confidence": 0.88,
      "photo_urls": ["https://example.com/hans_passport.jpg"]
    }
  ]
}
```

### Response Format

```json
{
  "success": true,
  "stay_id": "B7_Kislinger",
  "summary": {
    "total": 3,
    "merged": 1,
    "inserted": 2,
    "errors": 0
  },
  "results": [
    {
      "index": 0,
      "status": "success",
      "action": "merged",
      "first_name": "Stefan",
      "passport_number": "P123456789"
    },
    {
      "index": 1,
      "status": "success",
      "action": "inserted",
      "first_name": "Maria",
      "passport_number": "P987654321"
    },
    {
      "index": 2,
      "status": "success",
      "action": "inserted",
      "first_name": "Hans",
      "passport_number": "P456789123"
    }
  ],
  "sheets_format": {
    "description": "Tab-delimited format ready for Google Sheets",
    "columns": ["First Name", "Middle Name", "Last Name", "Gender", "Passport Number", "Nationality", "Birthday"],
    "data": "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday\nStefan\t\tKislinger\tM\tP123456789\tDEU\t1985-03-15\nMaria\t\tKislinger\tF\tP987654321\tDEU\t1987-07-22\nHans\t\tKislinger\tM\tP456789123\tDEU\t2010-12-05",
    "rows_count": 3
  }
}
```

## Google Sheets Integration

The `sheets_format.data` field contains ready-to-use tab-delimited text that can be:

1. **Copied directly** from the API response
2. **Pasted into Google Sheets** - it will automatically format into columns
3. **Used in any spreadsheet application** that supports tab-delimited data

### Example CocoGPT UI Flow

1. **Process Images**: CocoGPT analyzes the 3 passport photos for B7_Kislinger
2. **Extract Data**: MRZ and OCR extract passport details
3. **API Call**: Send batch request to `/coco-gpt-batch-passport`
4. **Show Results**: Display summary (1 merged, 2 inserted, 0 errors)
5. **Copy Button**: Provide one-click copy of `sheets_format.data` 
6. **Paste Ready**: User can immediately paste into Google Sheets

## Field Requirements

### Required Fields
- `stay_id`: The stay identifier (e.g., "B7_Kislinger")
- `passports[].first_name`: Guest's first name (required for each passport)

### Optional but Recommended Fields
- `last_name`: Guest's last name
- `passport_number`: Passport number from OCR
- `nationality_alpha3`: 3-letter country code (e.g., "DEU", "USA")
- `birthday`: Birth date in YYYY-MM-DD format
- `gender`: "M", "F", or empty string
- `mrz_full`: Full MRZ string for validation
- `ocr_confidence`: 0-1 confidence score (or 0-100, will be normalized)
- `photo_urls`: Array of passport photo URLs

## Validation Features

- **MRZ Parsing**: Automatically extracts issuing country and validates format
- **Hash Generation**: Creates SHA-256 hash of MRZ for duplicate detection
- **OCR Assessment**: Validates confidence scores and flags low-quality scans
- **Cross-validation**: Compares MRZ data with provided fields and warns of conflicts

## Error Handling

The endpoint processes each passport individually, so partial success is possible:

```json
{
  "success": true,
  "summary": {
    "total": 3,
    "merged": 1,
    "inserted": 1,
    "errors": 1
  },
  "results": [
    { "status": "success", "action": "merged", ... },
    { "status": "success", "action": "inserted", ... },
    { 
      "status": "error", 
      "error": "first_name is required",
      "passport": { /* original data */ }
    }
  ]
}
```

## Testing the Integration

Use the provided test scenarios in `tests/coco-gpt-batch-passport.test.js` as examples of expected behavior and edge cases.

## Next Steps

1. **Deploy the updated service** with the new endpoint
2. **Update CocoGPT** to use `/coco-gpt-batch-passport` instead of individual calls
3. **Implement the copy-paste UI** for the Google Sheets functionality
4. **Test with real passport data** to validate OCR and MRZ parsing
