-- Update the trigger function to use your actual Supabase URL
CREATE OR REPLACE FUNCTION trigger_tm30_export()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response jsonb;
  result text;
BEGIN
  -- Call the Edge Function directly with your project URL
  SELECT content::jsonb INTO response
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
  ) ON CONFLICT (export_date) 
  DO UPDATE SET 
    status = EXCLUDED.status,
    response = EXCLUDED.response,
    created_at = EXCLUDED.created_at;
  
  -- Raise notice for monitoring
  RAISE NOTICE 'TM30 Export Result: %', response;
  
  -- If export failed, raise an exception to trigger alerts
  IF response->>'success' != 'true' THEN
    RAISE WARNING 'TM30 Export failed: %', response->>'error';
  END IF;
END;
$$;

-- Test the function manually (optional)
-- SELECT trigger_tm30_export();
