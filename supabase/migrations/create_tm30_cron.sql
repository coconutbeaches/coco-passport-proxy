-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage on cron schema to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create storage bucket for TM30 exports if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('tm30-exports', 'tm30-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Create a function to trigger the Edge Function
CREATE OR REPLACE FUNCTION trigger_tm30_export()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response jsonb;
BEGIN
  -- Call the Edge Function using net.http_post
  SELECT content::jsonb INTO response
  FROM net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/export-tm30',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'trigger', 'scheduled',
      'timestamp', now()
    )
  );
  
  -- Log the result
  INSERT INTO public.tm30_export_logs (
    export_date,
    status,
    response,
    created_at
  ) VALUES (
    CURRENT_DATE,
    CASE 
      WHEN response->>'success' = 'true' THEN 'success'
      ELSE 'failed'
    END,
    response,
    now()
  );
  
  -- Raise notice for monitoring
  RAISE NOTICE 'TM30 Export Result: %', response;
END;
$$;

-- Create log table for export history
CREATE TABLE IF NOT EXISTS public.tm30_export_logs (
  id BIGSERIAL PRIMARY KEY,
  export_date DATE NOT NULL,
  status TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_export_date UNIQUE (export_date)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_tm30_export_logs_date 
ON public.tm30_export_logs(export_date DESC);

-- Schedule the export to run daily at 6 AM Bangkok time (11 PM UTC)
SELECT cron.schedule(
  'tm30-daily-export',          -- Job name
  '0 23 * * *',                 -- Cron expression: 11 PM UTC daily
  'SELECT trigger_tm30_export();' -- SQL to execute
);

-- Alternative: If you want to run it at a specific Bangkok time regardless of DST
-- This runs at 6 AM Bangkok time (UTC+7)
-- SELECT cron.schedule(
--   'tm30-daily-export',
--   '0 23 * * *',  -- Adjust based on your server timezone
--   $$
--   SELECT trigger_tm30_export() 
--   WHERE EXTRACT(HOUR FROM (now() AT TIME ZONE 'Asia/Bangkok')) = 6;
--   $$
-- );

-- View scheduled jobs
SELECT * FROM cron.job;

-- To unschedule (if needed):
-- SELECT cron.unschedule('tm30-daily-export');
