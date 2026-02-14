# OpenAPI Migration Guide

## From v1 (TSV) to v2 (Passport Guests)

### Overview

The API has been updated with a new simplified endpoint for CocoGPT passport integration. The old TSV endpoint remains available for backward compatibility.

---

## Old Endpoint (v1): `/coco-gpt-batch-tsv`

**Format:** Tab-separated values (TSV)  
**Use case:** Bulk import from pre-formatted TSV data

### Request Example:
```json
{
  "stay_id": "A3_GUSTAFSON",
  "default_checkout": "15/02/2026",
  "guests_tsv": "Maiken\tToft\tGustafson\tF\t215054840\tDNK\t08/03/1972\t15/02/2026\nMichael\tBjornsbaek\tMuhlig\tM\t215261066\tDNK\t27/01/1969\t15/02/2026"
}
```

### Issues with TSV format:
- ❌ Requires specific tab-separated format
- ❌ Easy to make formatting errors
- ❌ Hard to read and maintain
- ❌ No clear field labels
- ❌ Limited validation

---

## New Endpoint (v2): `/add-passport-guests`

**Format:** JSON with labeled fields  
**Use case:** CocoGPT passport photo workflow

### Request Example:
```json
{
  "stay_id": "A6_CHRISTEN",
  "guests": [
    {
      "first_name": "John",
      "middle_name": "Robert",
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

### Advantages:
- ✅ Clear, labeled JSON fields
- ✅ Self-documenting format
- ✅ Easy to read and maintain
- ✅ Built-in validation
- ✅ Automatic character normalization
- ✅ Better error messages

---

## Key Differences

| Feature | v1 (/coco-gpt-batch-tsv) | v2 (/add-passport-guests) |
|---------|--------------------------|---------------------------|
| **Format** | TSV (tab-separated) | JSON (labeled fields) |
| **Required Fields** | All 8 columns | Only `first_name` |
| **Character Normalization** | Manual | Automatic |
| **Date Format** | DD/MM/YYYY | YYYY-MM-DD (ISO 8601) |
| **Error Handling** | Limited | Detailed per-guest errors |
| **Partial Success** | Not supported | Supported |
| **International Names** | Manual normalization | Auto-normalized |
| **Field Labels** | Positional (column order) | Named (JSON keys) |
| **Validation** | Minimal | Comprehensive |

---

## Migration Steps

### For CocoGPT Integration:

**Old workflow:**
```
1. Extract passport data
2. Format as TSV string with tabs
3. POST to /coco-gpt-batch-tsv
```

**New workflow:**
```
1. Extract passport data
2. Format as JSON array
3. POST to /add-passport-guests
```

### Example Conversion:

**Old TSV format:**
```
Maiken\tToft\tGustafson\tF\t215054840\tDNK\t08/03/1972\t15/02/2026
```

**New JSON format:**
```json
{
  "first_name": "Maiken",
  "middle_name": "Toft",
  "last_name": "Gustafson",
  "gender": "F",
  "passport_number": "215054840",
  "nationality_alpha3": "DNK",
  "birthday": "1972-03-08",
  "passport_expiry_date": "2026-02-15"
}
```

---

## Response Comparison

### Old TSV Response:
```json
{
  "ok": true,
  "stay_id": "A3_GUSTAFSON",
  "summary": {
    "total": 2,
    "inserted": 2,
    "merged": 0,
    "errors": 0
  },
  "results": [...]
}
```

### New Passport Response:
```json
{
  "ok": true,
  "inserted": 2,
  "stay_id": "A6_CHRISTEN",
  "guests": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "first_name": "John",
      "last_name": "Smith",
      "passport_number": "123456789"
    }
  ]
}
```

---

## Character Normalization

### Old Endpoint:
Manual normalization required before sending data.

### New Endpoint:
Automatic normalization for international characters:

| Input | Output | Example |
|-------|--------|---------|
| ø | o | Søren → Soren |
| å | a | Åsa → Asa |
| ö, ü | o, u | Müller → Muller |
| è, é | e | René → Rene |
| ñ, ń | n | José → Jose |
| ß | ss | Groß → Gross |
| ž, š, č | z, s, c | Novák → Novak |

---

## Error Handling

### Old Endpoint:
Limited error information, fails entire batch on error.

### New Endpoint:
Detailed per-guest error reporting with partial success:

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
      "guest": {
        "first_name": "Jane",
        "passport_number": "987654321"
      }
    }
  ]
}
```

---

## Backward Compatibility

The old `/coco-gpt-batch-tsv` endpoint is still available and functional.

**Migration is optional** but recommended for:
- Better error handling
- Easier debugging
- Clearer code
- Automatic character normalization

---

## OpenAPI Specification Files

- **Old:** `coco-passport-openapi.yaml` (TSV format)
- **New:** `coco-passport-openapi-v2.yaml` (Passport format) ⭐

---

## Recommendation

✅ **Use `/add-passport-guests`** for new integrations  
✅ **Migrate existing integrations** when convenient  
✅ **Keep `/coco-gpt-batch-tsv`** for backward compatibility  

---

## Quick Reference

### Minimal Request (New Endpoint):
```json
{
  "stay_id": "A6_CHRISTEN",
  "guests": [{
    "first_name": "John",
    "last_name": "Smith",
    "passport_number": "123456789"
  }]
}
```

### Full Request (New Endpoint):
```json
{
  "stay_id": "A6_CHRISTEN",
  "guests": [{
    "first_name": "John",
    "middle_name": "Robert",
    "last_name": "Smith",
    "gender": "M",
    "passport_number": "123456789",
    "nationality_alpha3": "USA",
    "issuing_country_alpha3": "USA",
    "birthday": "1990-01-15",
    "passport_issue_date": "2020-01-01",
    "passport_expiry_date": "2030-01-01"
  }]
}
```

---

## Support

For questions or issues:
- Check `COCOGPT_PASSPORT_WORKFLOW.md` for user guide
- Check `PASSPORT_API_SUMMARY.md` for API details
- Check `examples/add-passport-guests-example.js` for code samples
