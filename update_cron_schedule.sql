-- First, unschedule the current job
SELECT cron.unschedule('tm30-daily-export');

-- Re-schedule for 2 PM UTC (which is 9 PM Bangkok time, UTC+7)
SELECT cron.schedule(
  'tm30-daily-export',          -- Job name
  '0 14 * * *',                 -- Cron expression: 2 PM UTC daily = 9 PM Bangkok
  'SELECT trigger_tm30_export();' -- SQL to execute
);

-- Verify the change
SELECT 
  jobname,
  schedule,
  command,
  active
FROM cron.job 
WHERE jobname = 'tm30-daily-export';
