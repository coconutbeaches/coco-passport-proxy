# Coco Passport Proxy - Architecture

## CocoGPT Passport Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                      CocoGPT Workflow                           │
└─────────────────────────────────────────────────────────────────┘

[User] 
  │
  ├─► Uploads passport photos
  │
  └─► Provides stay_id (e.g., "A6_CHRISTEN")
       │
       ▼
[CocoGPT]
  │
  ├─► Extracts passport data (OCR)
  │   • First name, middle name, last name
  │   • Gender, birthday, nationality
  │   • Passport number, issue/expiry dates
  │
  ├─► Normalizes characters
  │   • ø → o, ü → u, é → e, etc.
  │
  └─► Calls API
       │
       ▼
[POST /add-passport-guests]
  │
  ├─► Validates input
  │
  ├─► Disables trigger: trg_enforce_stayid_shortform
  │
  ├─► Inserts guest rows
  │   • stay_id = provided value
  │   • booking_id = NULL
  │   • phone_e164 = NULL
  │   • source = 'tokeet_import'
  │   • row_type = 'guest'
  │
  ├─► Re-enables trigger
  │
  └─► Returns results
       │
       ▼
[CocoGPT]
  │
  ├─► Verifies insertion
  │
  └─► Reports to user
       │
       ▼
[User]
  └─► Sees confirmation
      "✅ Inserted 2 guests for A6_CHRISTEN"
```

## Database Schema

```
incoming_guests table
┌──────────────┬──────────────┬────────────────┬──────────────┐
│ stay_id      │ booking_id   │ source         │ row_type     │
├──────────────┼──────────────┼────────────────┼──────────────┤
│ A6_CHRISTEN  │ BK12345      │ tokeet_feed    │ booking      │  ← Original booking
│ A6_CHRISTEN  │ NULL         │ tokeet_import  │ guest        │  ← Passport entry 1
│ A6_CHRISTEN  │ NULL         │ tokeet_import  │ guest        │  ← Passport entry 2
└──────────────┴──────────────┴────────────────┴──────────────┘
```

## API Endpoints

```
┌─────────────────────────────────────────────────────────────────┐
│                     API Endpoints                               │
└─────────────────────────────────────────────────────────────────┘

Primary Workflow:
  POST /add-passport-guests       → Add passport guest rows
                                    (Used by CocoGPT)

Legacy/Alternative Workflows:
  POST /tokeet-upsert             → Process Tokeet booking feeds
  POST /coco-gpt-batch-passport   → Batch passport processing (legacy)
  POST /coco-gpt-batch-tsv        → TSV batch import (legacy)
  POST /passport-ocr              → OCR passport images
  POST /motherbrain/guest-intake  → MotherBrain integration

Utility Endpoints:
  GET  /resolve?stay_id=QUERY     → Parse stay ID components
  GET  /export?stay_id=ID         → Export guest data
  GET  /status?stay_id=ID         → Check passport status
  POST /ocr                       → Google Vision OCR
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Data Flow                                  │
└─────────────────────────────────────────────────────────────────┘

Passport Image
     │
     ▼
[OCR Processing]
     │
     ├─► Extract text
     ├─► Parse MRZ (Machine Readable Zone)
     ├─► Extract structured fields
     │
     ▼
[Character Normalization]
     │
     ├─► ø → o (Scandinavian)
     ├─► ü → u (German)
     ├─► é → e (French)
     ├─► ñ → n (Spanish)
     │
     ▼
[Validation]
     │
     ├─► Required fields present?
     ├─► Valid date formats?
     ├─► Valid country codes?
     │
     ▼
[Database Insert]
     │
     ├─► Disable triggers
     ├─► INSERT guest row
     ├─► Re-enable triggers
     │
     ▼
[Verification]
     │
     └─► Query inserted row
         └─► Confirm success
```

## Character Normalization Rules

```
┌─────────────────────────────────────────────────────────────────┐
│              Character Normalization                            │
└─────────────────────────────────────────────────────────────────┘

International → ASCII

Scandinavian:
  ø → o    (Danish/Norwegian)
  å → a    (Swedish/Norwegian)
  ö → o    (Swedish)

German:
  ü → u
  ö → o
  ß → ss

French:
  è → e
  é → e
  à → a

Spanish/Portuguese:
  ñ → n
  ń → n

Slavic:
  ž → z
  š → s
  č → c
  ū → u
```

## Database Constraints

```
┌─────────────────────────────────────────────────────────────────┐
│                Database Constraints                             │
└─────────────────────────────────────────────────────────────────┘

Unique Constraints:
  1. (booking_id, check_in_date)     ← Avoided by booking_id=NULL
  2. (stay_id, phone_e164)           ← Avoided by phone_e164=NULL
  3. (passport_number)               ← Enforced (duplicate passports fail)

Triggers (Managed):
  • trg_enforce_stayid_shortform     ← Disabled during insert
  • trg_reconcile_tokeet_booking     ← Bypassed via source='tokeet_import'
  • trg_autofill_incoming_guest_whatsapp_group
  • normalize_stay_id_uppercase
  • trg_generate_manual_booking_id

Dropped Triggers:
  ✂️ t20_merge_passport_fields       ← Conflicted with separate guest rows
```

## Technology Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                   Technology Stack                              │
└─────────────────────────────────────────────────────────────────┘

Backend:
  • Node.js 18+
  • Express (via http module)
  • PostgreSQL (pg driver)

Database:
  • Supabase (PostgreSQL)
  • Connection pooling
  • Trigger management

Deployment:
  • Vercel (serverless functions)
  • Environment variables
  • CORS configuration

OCR Processing:
  • Google Cloud Vision API
  • MRZ parsing
  • Text extraction
```

## Error Handling

```
┌─────────────────────────────────────────────────────────────────┐
│                   Error Handling                                │
└─────────────────────────────────────────────────────────────────┘

Validation Errors (400):
  • Missing stay_id
  • Missing guests array
  • Empty guests array
  • Missing required fields

Database Errors (500):
  • Connection failures
  • Constraint violations (23505)
  • Trigger failures
  • Transaction rollbacks

Partial Success (200 + errors):
  • Some guests inserted
  • Some failed (duplicate passports)
  • Returns both successful and failed records

Recovery Mechanisms:
  • Automatic trigger disable/enable
  • Transaction rollback on failure
  • Detailed error messages
  • Partial success reporting
```

## Security

```
┌─────────────────────────────────────────────────────────────────┐
│                      Security                                   │
└─────────────────────────────────────────────────────────────────┘

CORS:
  • Restricted to specific origins
  • coconutbeaches.com
  • coco-passport-proxy.vercel.app
  • localhost (development)

Database:
  • SSL/TLS connections
  • Service role key (server-side only)
  • Connection string in environment variables

Input Validation:
  • Type checking
  • Required field validation
  • SQL injection prevention (parameterized queries)
  • Character normalization (sanitization)

Environment:
  • Secrets in environment variables
  • No hardcoded credentials
  • Vercel-managed secrets
```

## Performance

```
┌─────────────────────────────────────────────────────────────────┐
│                    Performance                                  │
└─────────────────────────────────────────────────────────────────┘

Database:
  • Connection pooling
  • Batch inserts
  • Indexed constraints
  • Transaction optimization

API:
  • Serverless (auto-scaling)
  • Stateless design
  • Minimal dependencies
  • Fast character normalization

OCR:
  • Cloud-based processing
  • Parallel image processing
  • Cached results (when applicable)
```

## Monitoring

```
┌─────────────────────────────────────────────────────────────────┐
│                     Monitoring                                  │
└─────────────────────────────────────────────────────────────────┘

Logging:
  • Console logs for errors
  • Structured error messages
  • Request/response tracking

Verification:
  • Database query verification
  • Guest count validation
  • Constraint violation detection

Troubleshooting:
  • REINDEX for phantom duplicates
  • Trigger status checking
  • Database connection testing
```

## Related Documentation

- **COCOGPT_PASSPORT_WORKFLOW.md** - CocoGPT user workflow
- **PASSPORT_ENTRY_GUIDE.md** - Technical implementation guide
- **PASSPORT_API_SUMMARY.md** - Complete API documentation
- **QUICKSTART_PASSPORT.md** - Quick reference
- **README.md** - Project overview
