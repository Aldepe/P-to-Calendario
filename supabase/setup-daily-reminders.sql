create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'daily-email-reminders';

select cron.schedule(
  'daily-email-reminders',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://dhndbjrfbtroakuqhtan.supabase.co/functions/v1/email-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobmRianJmYnRyb2FrdXFodGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTg4OTcsImV4cCI6MjA5Njg5NDg5N30.FkjDpYLUaFp6bIqzy5ap03ItRTHRxST7V09lSVVa_rM',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobmRianJmYnRyb2FrdXFodGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTg4OTcsImV4cCI6MjA5Njg5NDg5N30.FkjDpYLUaFp6bIqzy5ap03ItRTHRxST7V09lSVVa_rM'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
