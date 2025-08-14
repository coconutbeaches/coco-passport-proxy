-- SQL query to verify tomorrow's guests as specified in Step 7
-- This should be run in Supabase SQL Editor or via psql

-- Calculate tomorrow's date (this will need to be adjusted based on your timezone)
-- For now, replace 'CURRENT_DATE + 1' with the actual tomorrow date in 'YYYY-MM-DD' format

SELECT 
    email,
    phone_e164 as phone,
    rental_unit,
    first_name,
    last_name,
    booking_status,
    check_in_date,
    check_out_date,
    stay_id,
    source,
    created_at,
    -- Additional useful columns for verification
    booking_id,
    inquiry_id,
    external_reservation_id,
    adults,
    children,
    currency,
    total_cost,
    base_rate,
    tax
FROM incoming_guests 
WHERE check_in_date = CURRENT_DATE + 1  -- Replace with tomorrow's date if needed
ORDER BY created_at DESC, rental_unit;

-- Alternative query if you want to specify the exact date:
-- Replace '2024-12-XX' with tomorrow's actual date
-- SELECT email, phone_e164 as phone, rental_unit, first_name, last_name, booking_status, check_in_date, check_out_date, stay_id, source, created_at
-- FROM incoming_guests 
-- WHERE check_in_date = '2024-12-XX'
-- ORDER BY created_at DESC, rental_unit;

-- Query to check recent records if no tomorrow records found:
-- SELECT email, phone_e164 as phone, rental_unit, first_name, last_name, booking_status, check_in_date, check_out_date, stay_id, source, created_at
-- FROM incoming_guests 
-- ORDER BY created_at DESC
-- LIMIT 10;
