-- First, let's see what net.http_post actually returns
DO $$
DECLARE
  response_record record;
BEGIN
  SELECT * INTO response_record
  FROM net.http_post(
    url := 'https://wcplwmvbhreevxvsdmog.functions.supabase.co/export-tm30',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjcGx3bXZiaHJlZXZ4dnNkbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Njk2NzkwMiwiZXhwIjoyMDYyNTQzOTAyfQ.TbNbE4v5NDN3mslU2eMt9q7dgv3_rnbvv3RIaMIn71I',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('test', true)
  );
  
  RAISE NOTICE 'Response ID: %', response_record.id;
  RAISE NOTICE 'Status Code: %', response_record.status_code;
  RAISE NOTICE 'Response Headers: %', response_record.response_headers;
  RAISE NOTICE 'Contents: %', response_record.contents;
  RAISE NOTICE 'Timed Out: %', response_record.timed_out;
  RAISE NOTICE 'Error Msg: %', response_record.error_msg;
END $$;

-- Now create the correct trigger function based on actual field names
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
  -- Call the Edge Function
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
  
  -- Parse the response body (contents field contains the response body)
  BEGIN
    response_body := response_record.contents::jsonb;
  EXCEPTION WHEN OTHERS THEN
    -- If response is not valid JSON, create an error object
    response_body := jsonb_build_object(
      'success', false,
      'error', COALESCE(response_record.error_msg, 'Invalid response format'),
      'raw_response', response_record.contents::text,
      'timed_out', response_record.timed_out
    );
  END;
  
  -- Determine status based on status code and response content
  IF response_record.status_code = 200 AND response_body->>'success' = 'true' THEN
    export_status := 'success';
  ELSIF response_record.timed_out THEN
    export_status := 'timeout';
  ELSIF response_record.error_msg IS NOT NULL THEN
    export_status := 'error';
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
      'response_headers', response_record.response_headers,
      'request_id', response_record.id,
      'timed_out', response_record.timed_out,
      'error_msg', response_record.error_msg
    ),
    now()
  ) ON CONFLICT (export_date) 
  DO UPDATE SET 
    status = EXCLUDED.status,
    response = EXCLUDED.response,
    created_at = EXCLUDED.created_at;
  
  -- Raise notice for monitoring
  RAISE NOTICE 'TM30 Export completed: status=%, code=%, id=%', 
    export_status, response_record.status_code, response_record.id;
  
  -- If export failed, raise a warning with details
  IF export_status != 'success' THEN
    RAISE WARNING 'TM30 Export failed: status=%, code=%, error=%', 
      export_status,
      response_record.status_code, 
      COALESCE(response_record.error_msg, response_body->>'error', 'Unknown error');
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

-- Now test the function
SELECT trigger_tm30_export();

-- View the results
SELECT 
  export_date,
  status,
  response->>'request_id' as request_id,
  response->'response_body'->>'message' as message,
  response->'response_body'->>'records' as records_count,
  response->'response_body'->>'filename' as filename,
  created_at
FROM tm30_export_logs 
ORDER BY created_at DESC 
LIMIT 1;
