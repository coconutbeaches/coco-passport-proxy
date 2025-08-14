# Database Migration: Add Missing Columns to incoming_guests

## Overview
This migration adds any missing columns to the `incoming_guests` table based on the field mapping analysis and code requirements. The migration is **idempotent** - it's safe to run multiple times and will only add columns that don't already exist.

## Files Created
1. `add_missing_columns_migration.sql` - The actual migration SQL script
2. `run_migration.js` - Node.js script to help execute the migration
3. `MIGRATION_INSTRUCTIONS.md` - This instruction file

## How to Run the Migration

### Option 1: Supabase SQL Editor (Recommended)
1. Open your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create a new query or open the SQL editor
4. Copy the entire contents of `add_missing_columns_migration.sql`
5. Paste and execute the migration
6. You should see a success message: "Migration completed successfully"

### Option 2: Command Line (if you have environment variables set up)
```bash
# If you have DATABASE_URL environment variable
node run_migration.js
```

## What This Migration Does

### Adds Core Identity Fields
- `stay_id` (text) - Unique identifier for the stay
- `first_name` (text) - Guest's first name  
- `middle_name` (text) - Guest's middle name
- `last_name` (text) - Guest's last name
- `gender` (text) - Guest's gender
- `birthday` (date) - Guest's birth date

### Adds Passport/Document Fields
- `passport_number` (text) - Passport number
- `nationality_alpha3` (text) - ISO 3166-1 alpha-3 country code
- `issuing_country_alpha3` (text) - Passport issuing country code
- `passport_issue_date` (date) - Passport issue date
- `passport_expiry_date` (date) - Passport expiration date
- `mrz_full` (text) - Full machine readable zone data
- `mrz_hash` (text) - Hash of MRZ for verification
- `ocr_confidence` (numeric) - OCR confidence score

### Adds Contact Information
- `email` (text) - Primary email address
- `secondary_emails` (text[]) - Additional email addresses
- `phone_e164` (text) - Phone number in E.164 format
- `secondary_phones` (text[]) - Additional phone numbers
- `guest_address` (text) - Guest address
- `whatsapp_chat_id` (text) - WhatsApp chat identifier
- `whatsapp_group_id` (text) - WhatsApp group identifier

### Adds Booking Information
- `external_reservation_id` (text) - External booking system ID
- `booking_status` (text) - Status of the booking
- `booking_channel` (text) - Booking source/channel
- `rental_unit` (text) - Primary rental unit
- `rental_units` (text[]) - All rental units for this booking
- `check_in_date` (date) - Check-in date
- `check_out_date` (date) - Check-out date
- `nights` (integer) - Number of nights
- `date_received` (date) - Date booking was received
- `checkin_time` (time) - Check-in time
- `checkout_time` (time) - Check-out time
- `booking_id` (text) - Booking ID
- `inquiry_id` (text) - Inquiry ID
- `adults` (integer) - Number of adults
- `children` (integer) - Number of children
- `currency` (char(3)) - Currency code
- `total_cost` (numeric) - Total booking cost
- `base_rate` (numeric) - Base rate
- `tax` (numeric) - Tax amount
- `booking_formula` (text) - Pricing formula
- `guest_id` (text) - Guest ID

### Adds System Fields
- `photo_urls` (text[]) - Array of photo URLs
- `source` (text) - Data source identifier
- `source_batch_id` (text) - Batch import identifier
- `status` (text) - Processing status
- `notes` (text) - Additional notes
- `raw_json` (jsonb) - Original raw data
- `row_type` (text) - Row type classifier
- `guest_index` (integer) - Guest index for multi-guest bookings
- `nickname` (text) - Guest nickname
- `created_at` (timestamp with time zone) - Creation timestamp
- `updated_at` (timestamp with time zone) - Last update timestamp
- `id` (uuid) - Primary key (if not exists)

### Creates Indexes
- `idx_incoming_guests_stay_id` - For fast stay_id lookups
- `idx_incoming_guests_first_name_lower` - For case-insensitive name searches
- `idx_incoming_guests_created_at` - For chronological ordering

## Important Notes

1. **All columns are nullable by default** - Following the requirement that nullable ≠ required
2. **No NOT NULL constraints** are added unless certain of data requirements
3. **Idempotent migration** - Safe to run multiple times
4. **Preserves existing data** - Only adds new columns, doesn't modify existing ones
5. **Appropriate data types** - Uses proper PostgreSQL/Supabase data types
6. **Indexed for performance** - Adds helpful indexes for common queries

## Verification

After running the migration, you can verify it worked by checking:

```sql
-- Check that the table has all expected columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'incoming_guests' 
ORDER BY column_name;

-- Check that indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'incoming_guests';
```

## Next Steps

After the migration is complete:

1. **Test the existing endpoints** to ensure they still work
2. **Update any client applications** that might need to handle the new fields
3. **Consider updating the export view** if it needs to include additional fields
4. **Update ETL processes** to populate the new columns as data becomes available

The application should continue to work normally as all new columns are nullable and the existing code will simply ignore fields it doesn't recognize.
