-- Migration to add missing columns to incoming_guests table
-- Run this in Supabase SQL Editor

-- Add columns if they don't exist
-- Note: Using IF NOT EXISTS to make this migration idempotent

-- Core identity fields
DO $$
BEGIN
    -- Add stay_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'stay_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN stay_id text;
    END IF;

    -- Add first_name column if it doesn't exist  
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'first_name') THEN
        ALTER TABLE incoming_guests ADD COLUMN first_name text;
    END IF;

    -- Add middle_name column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'middle_name') THEN
        ALTER TABLE incoming_guests ADD COLUMN middle_name text;
    END IF;

    -- Add last_name column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'last_name') THEN
        ALTER TABLE incoming_guests ADD COLUMN last_name text;
    END IF;

    -- Add gender column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'gender') THEN
        ALTER TABLE incoming_guests ADD COLUMN gender text;
    END IF;

    -- Add birthday column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'birthday') THEN
        ALTER TABLE incoming_guests ADD COLUMN birthday date;
    END IF;

    -- Add passport_number column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'passport_number') THEN
        ALTER TABLE incoming_guests ADD COLUMN passport_number text;
    END IF;

    -- Add nationality_alpha3 column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'nationality_alpha3') THEN
        ALTER TABLE incoming_guests ADD COLUMN nationality_alpha3 text;
    END IF;

    -- Add issuing_country_alpha3 column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'issuing_country_alpha3') THEN
        ALTER TABLE incoming_guests ADD COLUMN issuing_country_alpha3 text;
    END IF;

    -- Add passport_issue_date column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'passport_issue_date') THEN
        ALTER TABLE incoming_guests ADD COLUMN passport_issue_date date;
    END IF;

    -- Add passport_expiry_date column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'passport_expiry_date') THEN
        ALTER TABLE incoming_guests ADD COLUMN passport_expiry_date date;
    END IF;

    -- Add photo_urls column if it doesn't exist (array of text)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'photo_urls') THEN
        ALTER TABLE incoming_guests ADD COLUMN photo_urls text[];
    END IF;

    -- Add source column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'source') THEN
        ALTER TABLE incoming_guests ADD COLUMN source text;
    END IF;

    -- Add source_batch_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'source_batch_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN source_batch_id text;
    END IF;

    -- Add external_reservation_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'external_reservation_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN external_reservation_id text;
    END IF;

    -- Add booking-related fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'email') THEN
        ALTER TABLE incoming_guests ADD COLUMN email text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'secondary_emails') THEN
        ALTER TABLE incoming_guests ADD COLUMN secondary_emails text[];
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'phone_e164') THEN
        ALTER TABLE incoming_guests ADD COLUMN phone_e164 text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'secondary_phones') THEN
        ALTER TABLE incoming_guests ADD COLUMN secondary_phones text[];
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'guest_address') THEN
        ALTER TABLE incoming_guests ADD COLUMN guest_address text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'booking_status') THEN
        ALTER TABLE incoming_guests ADD COLUMN booking_status text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'booking_channel') THEN
        ALTER TABLE incoming_guests ADD COLUMN booking_channel text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'rental_unit') THEN
        ALTER TABLE incoming_guests ADD COLUMN rental_unit text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'rental_units') THEN
        ALTER TABLE incoming_guests ADD COLUMN rental_units text[];
    END IF;

    -- Date and time fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'check_in_date') THEN
        ALTER TABLE incoming_guests ADD COLUMN check_in_date date;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'check_out_date') THEN
        ALTER TABLE incoming_guests ADD COLUMN check_out_date date;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'nights') THEN
        ALTER TABLE incoming_guests ADD COLUMN nights integer;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'date_received') THEN
        ALTER TABLE incoming_guests ADD COLUMN date_received date;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'checkin_time') THEN
        ALTER TABLE incoming_guests ADD COLUMN checkin_time time without time zone;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'checkout_time') THEN
        ALTER TABLE incoming_guests ADD COLUMN checkout_time time without time zone;
    END IF;

    -- Booking details
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'booking_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN booking_id text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'inquiry_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN inquiry_id text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'adults') THEN
        ALTER TABLE incoming_guests ADD COLUMN adults integer;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'children') THEN
        ALTER TABLE incoming_guests ADD COLUMN children integer;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'currency') THEN
        ALTER TABLE incoming_guests ADD COLUMN currency character(3);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'total_cost') THEN
        ALTER TABLE incoming_guests ADD COLUMN total_cost numeric;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'base_rate') THEN
        ALTER TABLE incoming_guests ADD COLUMN base_rate numeric;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'tax') THEN
        ALTER TABLE incoming_guests ADD COLUMN tax numeric;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'booking_formula') THEN
        ALTER TABLE incoming_guests ADD COLUMN booking_formula text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'guest_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN guest_id text;
    END IF;

    -- Document verification fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'mrz_full') THEN
        ALTER TABLE incoming_guests ADD COLUMN mrz_full text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'mrz_hash') THEN
        ALTER TABLE incoming_guests ADD COLUMN mrz_hash text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'ocr_confidence') THEN
        ALTER TABLE incoming_guests ADD COLUMN ocr_confidence numeric;
    END IF;

    -- Communication fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'whatsapp_chat_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN whatsapp_chat_id text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'whatsapp_group_id') THEN
        ALTER TABLE incoming_guests ADD COLUMN whatsapp_group_id text;
    END IF;

    -- System fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'status') THEN
        ALTER TABLE incoming_guests ADD COLUMN status text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'notes') THEN
        ALTER TABLE incoming_guests ADD COLUMN notes text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'raw_json') THEN
        ALTER TABLE incoming_guests ADD COLUMN raw_json jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'row_type') THEN
        ALTER TABLE incoming_guests ADD COLUMN row_type text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'guest_index') THEN
        ALTER TABLE incoming_guests ADD COLUMN guest_index integer;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'nickname') THEN
        ALTER TABLE incoming_guests ADD COLUMN nickname text;
    END IF;

    -- Add created_at and updated_at if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'created_at') THEN
        ALTER TABLE incoming_guests ADD COLUMN created_at timestamp with time zone DEFAULT NOW();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'updated_at') THEN
        ALTER TABLE incoming_guests ADD COLUMN updated_at timestamp with time zone DEFAULT NOW();
    END IF;

    -- Add primary key column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'incoming_guests' AND column_name = 'id') THEN
        ALTER TABLE incoming_guests ADD COLUMN id uuid DEFAULT gen_random_uuid() PRIMARY KEY;
    END IF;

END $$;

-- Add helpful comments
COMMENT ON TABLE incoming_guests IS 'Guest information and passport data for incoming guests';
COMMENT ON COLUMN incoming_guests.stay_id IS 'Unique identifier for the stay (generated from rooms + last name)';
COMMENT ON COLUMN incoming_guests.photo_urls IS 'Array of URLs to passport/document photos';
COMMENT ON COLUMN incoming_guests.nationality_alpha3 IS 'ISO 3166-1 alpha-3 country code for nationality';
COMMENT ON COLUMN incoming_guests.issuing_country_alpha3 IS 'ISO 3166-1 alpha-3 country code for passport issuing country';
COMMENT ON COLUMN incoming_guests.raw_json IS 'Original data from source system (CSV, API, etc.)';
COMMENT ON COLUMN incoming_guests.source IS 'Data source identifier (e.g., tokeet_feed, coco_gpt_insert, manual)';

-- Create an index on stay_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_incoming_guests_stay_id ON incoming_guests (stay_id);
CREATE INDEX IF NOT EXISTS idx_incoming_guests_first_name_lower ON incoming_guests (lower(first_name));
CREATE INDEX IF NOT EXISTS idx_incoming_guests_created_at ON incoming_guests (created_at);

-- Print completion message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed successfully. All missing columns have been added to incoming_guests table.';
END $$;
