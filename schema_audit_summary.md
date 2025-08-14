# Tokeet CSV to Supabase Schema Audit Summary

## Overview
This audit analyzes the data flow between the Tokeet CSV feed and the Supabase `incoming_guests` table to create an authoritative mapping for future ETL processes.

## Data Sources Analyzed

### 1. Tokeet CSV Feed
- **URL Pattern**: `https://datafeed.tokeet.com/v1/inquiry/.../...?booked=1&start=MM-DD-YYYY&end=MM-DD-YYYY`
- **Format**: CSV with 26 columns
- **Sample Date**: August 15, 2025 (tomorrow)
- **Records Found**: Multiple guest bookings

### 2. Supabase Database
- **Table**: `incoming_guests`
- **Total Columns**: 51 columns
- **Primary Key**: `id` (uuid, auto-generated)

## CSV Fields (26 total)
1. Name
2. Email
3. Guest Secondary Emails
4. Telephone
5. Guest Secondary Phones
6. Guest Address
7. Booking Status
8. Rental
9. Arrive
10. Depart
11. Nights
12. Received
13. Checkin
14. Checkout
15. Booking ID
16. Inquiry ID
17. Source
18. Booked
19. Adults
20. Children
21. Currency
22. Total Cost
23. Base Rate
24. Tax
25. Booking Formula
26. Guest ID

## Mapping Analysis Summary

### ✅ Direct Matches (16 fields)
Fields that map directly from CSV to DB with minimal transformation:
- Email → email
- Guest Secondary Emails → secondary_emails
- Guest Address → guest_address
- Booking Status → booking_status
- Arrive → check_in_date
- Depart → check_out_date
- Nights → nights
- Received → date_received
- Checkin → checkin_time
- Checkout → checkout_time
- Booking ID → booking_id
- Inquiry ID → inquiry_id
- Adults → adults
- Children → children
- Currency → currency
- Total Cost → total_cost
- Base Rate → base_rate
- Tax → tax
- Booking Formula → booking_formula
- Guest ID → guest_id

### 🔄 Needs Parsing/Transformation (4 fields)
- **Name** → first_name + last_name (split full name)
- **Rental** → rental_unit + rental_units (extract room codes)
- **Telephone** → phone_e164 (format to E.164)
- **Source** → booking_channel (rename)

### ⚙️ Needs Generation/Logic (3 fields)
- **stay_id**: Generated using existing `normalizeStayIdFreeform()` function
- **source_batch_id**: Generate unique batch ID for each import
- **guest_index**: Logic for multiple guests per booking

### ❌ No Mapping (1 field)
- **Booked**: Used for processing logic only, not stored

### 🆕 DB Columns Missing from CSV (25 fields)
These database columns have no equivalent in the CSV feed:
- Passport-related fields (passport_number, nationality_alpha3, etc.)
- Identity verification fields (mrz_full, mrz_hash, ocr_confidence)
- Communication fields (whatsapp_chat_id, whatsapp_group_id)
- Media fields (photo_urls)
- System fields (created_at, updated_at, status, notes)

## Key Recommendations

1. **Use existing parsing logic**: The codebase already has `normalizeStayIdFreeform()` function for generating stay_id
2. **Set default values**: For DB-only fields like `source`, `status`, `row_type`
3. **Store raw data**: Use `raw_json` field to preserve original CSV data
4. **Handle name parsing**: Implement logic to split full names into first/middle/last components
5. **Room code extraction**: Parse rental descriptions to extract room codes (A4, B7, etc.)

## Files Generated
- `tokeet_csv_to_db_mapping.csv`: Detailed field-by-field mapping table
- `tokeet_sample_tomorrow.csv`: Sample CSV data for testing
- `schema_audit_summary.md`: This summary document

## Next Steps
This mapping table should be used as the authoritative source for:
1. ETL process development
2. Data validation rules
3. Schema migration planning
4. Field transformation logic implementation
