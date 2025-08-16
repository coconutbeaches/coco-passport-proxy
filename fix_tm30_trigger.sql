-- Fix the trigger function to properly handle net.http_post response
CREATE OR REPLACE FUNCTION trigger_tm30_export()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response_record record;
  response_body jsonb;
  export_status text;
BEGIN
  -- Call the Edge Function directly with your project URL
  -- net.http_post returns a record with multiple fields
  SELECT * INTO response_record
  FROM net.http_post(
    url := 'https://wcplwmvbhreevxvsdmog.functions.supabase.co/export-tm30',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjcGx3bXZiaHJlZXZ4dnNkbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Njk2NzkwMiwiZXhwIjoyMDYyNTQzOTAyfQ.TbNbE4v5NDN3mslU2eMt9q7dgv3_rnbvv3RIaMIn71I',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'trigger', 'scheduled',
      'timestamp', now()
    )
  );
  
  -- Try to parse the response body as JSON
  BEGIN
    response_body := response_record.response::jsonb;
  EXCEPTION WHEN OTHERS THEN
    -- If response is not valid JSON, create an error object
    response_body := jsonb_build_object(
      'success', false,
      'error', 'Invalid response format',
      'raw_response', response_record.response::text
    );
  END;
  
  -- Determine status
  IF response_record.status_code = 200 AND response_body->>'success' = 'true' THEN
    export_status := 'success';
  ELSE
    export_status := 'failed';
  END IF;
  
  -- Log the result
  INSERT INTO public.tm30_export_logs (
    export_date,
    status,
    response,
    created_at
  ) VALUES (
    CURRENT_DATE,
    export_status,
    jsonb_build_object(
      'status_code', response_record.status_code,
      'response_body', response_body,
      'response_id', response_record.id
    ),
    now()
  ) ON CONFLICT (export_date) 
  DO UPDATE SET 
    status = EXCLUDED.status,
    response = EXCLUDED.response,
    created_at = EXCLUDED.created_at;
  
  -- Raise notice for monitoring
  RAISE NOTICE 'TM30 Export completed with status: %, code: %', export_status, response_record.status_code;
  
  -- If export failed, raise a warning
  IF export_status = 'failed' THEN
    RAISE WARNING 'TM30 Export failed: status_code=%, error=%', 
      response_record.status_code, 
      COALESCE(response_body->>'error', 'Unknown error');
  END IF;
END;
$$;

-- Create the log table if it doesn't exist
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

-- Test the function
SELECT trigger_tm30_export();

-- Check the results
SELECT * FROM tm30_export_logs 
ORDER BY created_at DESC 
LIMIT 1;
