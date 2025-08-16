-- Create the trigger function using the simpler approach
CREATE OR REPLACE FUNCTION trigger_tm30_export()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id text;
  response_body jsonb;
  export_status text;
BEGIN
  -- Call the Edge Function and get the request ID
  SELECT net.http_post(
    url := 'https://wcplwmvbhreevxvsdmog.functions.supabase.co/export-tm30',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjcGx3bXZiaHJlZXZ4dnNkbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Njk2NzkwMiwiZXhwIjoyMDYyNTQzOTAyfQ.TbNbE4v5NDN3mslU2eMt9q7dgv3_rnbvv3RIaMIn71I',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'trigger', 'scheduled',
      'timestamp', now()
    )
  ) INTO request_id;
  
  -- The function is async, so we just log that it was triggered
  -- The actual result will be processed by the Edge Function
  export_status := 'triggered';
  
  -- For now, just create a simple success response
  -- The Edge Function itself handles the actual export and storage
  response_body := jsonb_build_object(
    'request_id', request_id,
    'status', 'triggered',
    'message', 'TM30 export has been triggered',
    'timestamp', now()
  );
  
  -- Log the trigger
  INSERT INTO public.tm30_export_logs (
    export_date,
    status,
    response,
    created_at
  ) VALUES (
    CURRENT_DATE,
    export_status,
    response_body,
    now()
  ) ON CONFLICT (export_date) 
  DO UPDATE SET 
    status = EXCLUDED.status,
    response = EXCLUDED.response,
    created_at = EXCLUDED.created_at;
  
  -- Raise notice for monitoring
  RAISE NOTICE 'TM30 Export triggered with request ID: %', request_id;
END;
$$;

-- Create or update the log table
CREATE TABLE IF NOT EXISTS public.tm30_export_logs (
  id BIGSERIAL PRIMARY KEY,
  export_date DATE NOT NULL,
  status TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_export_date'
  ) THEN
    ALTER TABLE public.tm30_export_logs 
    ADD CONSTRAINT unique_export_date UNIQUE (export_date);
  END IF;
END $$;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_tm30_export_logs_date 
ON public.tm30_export_logs(export_date DESC);

-- Create storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('tm30-exports', 'tm30-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Test the function
SELECT trigger_tm30_export();

-- View the log
SELECT * FROM tm30_export_logs 
ORDER BY created_at DESC 
LIMIT 1;

-- Check if the cron job is set up
SELECT * FROM cron.job WHERE jobname = 'tm30-daily-export';
