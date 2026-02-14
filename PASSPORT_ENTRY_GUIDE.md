# Passport Data Entry - Supabase Only

**Task:** Extract passport data from images and insert as guest rows into Supabase.

## Input Required
- Passport images (2+)
- stay_id for the booking (e.g., "A6_CHRISTEN")

## Automated Workflow

When you provide passport images + stay_id, the system will automatically:

1. Extract all passport fields with character normalization
2. Disable `trg_enforce_stayid_shortform` trigger
3. Insert one guest row per passport with:
   - `stay_id` = provided value
   - `booking_id` = NULL
   - `phone_e164` = NULL
   - `source` = 'tokeet_import'
   - `row_type` = 'guest'
4. Re-enable trigger
5. Verify and report results

## Critical Rules

- **NEVER update the existing booking row** with passport data
- **ALWAYS create separate guest rows** for each passport
- Set `booking_id=NULL` to avoid unique constraint violations
- Set `phone_e164=NULL` to avoid stay_id/phone constraint

## Character Normalization

Replace: ž→z, š→s, ū→u, č→c, è/é→e, à→a, ñ/ń→n, ö→o, ø→o, ß→ss

## API Endpoint

### POST `/add-passport-guests`

Simple endpoint to add passport guest records to an existing stay.

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

**Success Response:**
```json
{
  "ok": true,
  "inserted": 2,
  "stay_id": "A6_CHRISTEN",
  "guests": [...]
}
```

## Database Insert Strategy

**For each passport:**
```sql
-- 1. Disable stay_id auto-generation trigger
ALTER TABLE incoming_guests DISABLE TRIGGER trg_enforce_stayid_shortform;

-- 2. Insert guest row
INSERT INTO incoming_guests (
    stay_id, booking_id, source, row_type,
    phone_e164,
    first_name, middle_name, last_name, gender,
    passport_number, nationality_alpha3, issuing_country_alpha3,
    birthday, passport_issue_date, passport_expiry_date
) VALUES (
    '[STAY_ID]',              -- Use provided stay_id
    NULL,                      -- Always NULL to avoid unique constraint
    'tokeet_import',           -- Bypass reconciliation trigger
    'guest',                   -- Always 'guest' for passport entries
    NULL,                      -- Always NULL to avoid phone unique constraint
    '[FIRST_NAME]',            -- From passport
    '[MIDDLE_NAME]',           -- From passport
    '[LAST_NAME]',             -- From passport
    '[GENDER]',                -- From passport
    '[PASSPORT_NUMBER]',       -- From passport
    '[NATIONALITY_ALPHA3]',    -- From passport
    '[ISSUING_COUNTRY_ALPHA3]',-- From passport
    '[BIRTHDAY]',              -- From passport
    '[PASSPORT_ISSUE_DATE]',   -- From passport
    '[PASSPORT_EXPIRY_DATE]'   -- From passport
);

-- 3. Re-enable trigger
ALTER TABLE incoming_guests ENABLE TRIGGER trg_enforce_stayid_shortform;
```

**Key constraints to avoid:**
- `booking_id=NULL` prevents `(booking_id, check_in_date)` unique constraint
- `phone_e164=NULL` prevents `(stay_id, phone_e164)` unique constraint
- `source='tokeet_import'` bypasses `trg_reconcile_tokeet_booking` trigger

## Troubleshooting

**If phantom duplicate passport errors occur:**

1. Temporarily disable ALL BEFORE INSERT triggers:
```sql
ALTER TABLE incoming_guests DISABLE TRIGGER trg_reconcile_tokeet_booking;
ALTER TABLE incoming_guests DISABLE TRIGGER trg_autofill_incoming_guest_whatsapp_group;
ALTER TABLE incoming_guests DISABLE TRIGGER normalize_stay_id_uppercase;
ALTER TABLE incoming_guests DISABLE TRIGGER trg_generate_manual_booking_id;
```

2. Insert guest rows
3. Re-enable triggers
4. If problem persists, run: `REINDEX TABLE incoming_guests;`

**Dropped triggers:**
- ✂️ `t20_merge_passport_fields` - Was automatically updating booking rows with passport data, conflicting with "one guest row per passport" model

## Verification

After insertion, verify with:
```sql
SELECT first_name, middle_name, last_name, gender, passport_number, row_type 
FROM incoming_guests 
WHERE stay_id = '[STAY_ID]' 
ORDER BY row_type, last_name, first_name
```

Report:
- Database rows inserted (count)
- Final guest count vs expected adults count
- stay_id verification
