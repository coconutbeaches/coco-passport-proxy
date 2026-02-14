# Quick Start: Add Passport Guests

## TL;DR

```bash
curl -X POST https://coco-passport-proxy.vercel.app/add-passport-guests \
  -H "Content-Type: application/json" \
  -d '{
    "stay_id": "A6_CHRISTEN",
    "guests": [
      {
        "first_name": "John",
        "last_name": "Smith",
        "gender": "M",
        "passport_number": "123456789",
        "nationality_alpha3": "USA",
        "birthday": "1990-01-15"
      }
    ]
  }'
```

## What It Does

✅ Creates separate guest rows for each passport  
✅ Normalizes international characters (ø→o, ü→u, etc.)  
✅ Handles database constraints automatically  
✅ Never updates the booking row  

## Minimal Example

```json
{
  "stay_id": "A6_CHRISTEN",
  "guests": [
    {
      "first_name": "John",
      "last_name": "Smith",
      "passport_number": "123456789"
    }
  ]
}
```

## Full Example

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

## Response

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

## Required Fields

- `stay_id` - The stay identifier
- `guests[].first_name` - At least one guest with a first name

## Character Normalization

| Input | Output | Example |
|-------|--------|---------|
| ø | o | Søren → Soren |
| ö, ü | o, u | Müller → Muller |
| è, é | e | François → Francois |
| å | a | Åsa → Asa |
| ñ, ń | n | José → Jose |
| ß | ss | Groß → Gross |

## Important Notes

🔴 **Always creates NEW guest rows** - never updates booking rows  
🔴 **Sets booking_id=NULL** - prevents constraint violations  
🔴 **Sets phone_e164=NULL** - prevents stay_id/phone constraint  
🔴 **Sets source='tokeet_import'** - bypasses reconciliation  

## More Info

- Full docs: `PASSPORT_API_SUMMARY.md`
- Examples: `examples/add-passport-guests-example.js`
- Guide: `PASSPORT_ENTRY_GUIDE.md`
