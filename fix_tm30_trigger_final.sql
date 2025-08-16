-- First, let's properly inspect what net.http_post returns
DO $$
DECLARE
  resp net.http_response;
BEGIN
  -- Call the function and get the response
  resp := net.http_post(
    url := 'https://wcplwmvbhreevxvsdmog.functions.supabase.co/export-tm30',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjcGx3bXZiaHJlZXZ4dnNkbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Njk2NzkwMiwiZXhwIjoyMDYyNTQzOTAyfQ.TbNbE4v5NDN3mslU2eMt9q7dgv3_rnbvv3RIaMIn71I',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('test', true)
  );
  
  RAISE NOTICE 'Status: %', resp.status;
  RAISE NOTICE 'Headers: %', resp.headers;
  RAISE NOTICE 'Body: %', resp.body;
END $$;

-- Now create the correct trigger function
CREATE OR REPLACE FUNCTION trigger_tm30_export()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  resp net.http_response;
  response_body jsonb;
  export_status text;
BEGIN
  -- Call the Edge Function
  resp := net.http_post(
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
  
  -- Parse the response body
  BEGIN
    response_body := resp.body::jsonb;
  EXCEPTION WHEN OTHERS THEN
    -- If response is not valid JSON, create an error object
    response_body := jsonb_build_object(
      'success', false,
      'error', 'Invalid response format',
      'raw_response', resp.body::text
    );
  END;
  
  -- Determine status based on status code and response content
  IF resp.status = 200 AND response_body->>'success' = 'true' THEN
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
      'status_code', resp.status,
      'response_body', response_body,
      'response_headers', resp.headers
    ),
    now()
  ) ON CONFLICT (export_date) 
  DO UPDATE SET 
    status = EXCLUDED.status,
    response = EXCLUDED.response,
    created_at = EXCLUDED.created_at;
  
  -- Raise notice for monitoring
  RAISE NOTICE 'TM30 Export completed: status=%, code=%', 
    export_status, resp.status;
  
  -- If export failed, raise a warning with details
  IF export_status != 'success' THEN
    RAISE WARNING 'TM30 Export failed: status=%, error=%', 
      resp.status,
      COALESCE(response_body->>'error', response_body->>'message', 'Unknown error');
  END IF;
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

-- Now test the function
SELECT trigger_tm30_export();

-- View the results
SELECT 
  export_date,
  status,
  response->>'status_code' as http_status,
  response->'response_body'->>'success' as success,
  response->'response_body'->>'message' as message,
  response->'response_body'->>'records' as records_count,
  response->'response_body'->>'filename' as filename,
  response->'response_body'->>'error' as error,
  created_at
FROM tm30_export_logs 
ORDER BY created_at DESC 
LIMIT 1;
