# CocoGPT Passport Processing Instructions (Updated)

## Overview
The passport proxy API now supports **streamlined MRZ-based processing**. You can send just the MRZ string and let the API extract names automatically, making the workflow much simpler and more reliable.

## Simplified Workflow

### 1. **Send MRZ Data (Recommended)**
For most passports, you only need to send the MRZ string exactly as scanned:

```json
{
  "stay_id": "B7_Kislinger",
  "passports": [
    {
      "mrz_full": "P<DEUKISLINGER<<STEFAN<<<<<<<<<<<<<<<<<<<<<\n1234567890DEU9001011M2501017<<<<<<<<<<<<<<<6",
      "passport_number": "123456789",
      "nationality_alpha3": "DEU",
      "gender": "M",
      "birthday": "1990-01-01",
      "ocr_confidence": 0.95
    }
  ]
}
```

**Key Points:**
- ✅ **Use single \n between MRZ lines** (not \r\n or space) to avoid cross-platform issues
- ✅ **first_name/last_name are optional** - extracted from MRZ automatically
- ✅ **photo_urls are optional** - local file paths are filtered out safely

### 2. **Fallback for Missing MRZ**
If MRZ parsing fails or isn't available, include explicit names:

```json
{
  "stay_id": "B7_Kislinger", 
  "passports": [
    {
      "first_name": "Stefan",
      "last_name": "Kislinger",
      "passport_number": "123456789",
      "nationality_alpha3": "DEU"
    }
  ]
}
```

## API Response

The API now returns **ready-to-use Google Sheets data**:

```json
{
  "success": true,
  "summary": { "total": 1, "inserted": 1, "errors": 0 },
  "results": [...],
  "sheets_format": {
    "description": "Tab-delimited format ready for Google Sheets",
    "data": "First Name\tMiddle Name\tLast Name\tGender *\tPassport No. *\tNationality *\tBirth Date (DD/MM/YYYY)\tCheck-out Date (DD/MM/YYYY)\tPhone No.\nStefan\t\tKislinger\tM\t123456789\tDEU\t01/01/1990\t\t"
  }
}
```

## What Changed

### ✅ **Simplified for CocoGPT:**
- Send MRZ exactly as scanned (with newlines)
- Names are extracted automatically from MRZ
- No need to upload photos (local paths filtered out)
- Get formatted Google Sheets data in response

### ✅ **More Reliable:**
- MRZ parsing ensures accurate name extraction
- Consistent name formatting for immigration forms
- Better error handling and validation

### ✅ **Same Endpoint:**
- Still use `POST /coco-gpt-batch-passport`
- Same response format, enhanced with sheets data
- Backward compatible with existing payloads

## Error Handling

The API now provides clearer error messages:
- If MRZ is invalid: "Invalid MRZ: [specific error]"
- If no names found: "first_name is required (either directly provided or extractable from MRZ)"
- If stay_id missing: Auto-generates fallback stay_id

## Best Practices

1. **Always send MRZ with preserved newlines** when available
2. **Include passport_number, nationality, gender, birthday** for completeness  
3. **Don't worry about photo_urls** - local paths are safely filtered out
4. **Use the returned sheets_format.data** for immigration forms
5. **Check results array** for any processing errors per passport

This streamlined workflow makes passport processing much more reliable and reduces the complexity for CocoGPT while ensuring accurate immigration form generation.
