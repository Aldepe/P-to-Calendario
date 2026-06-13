alter table if exists public.participants
  add column if not exists availability jsonb not null default '{}'::jsonb,
  add column if not exists availability_by_week jsonb not null default '{}'::jsonb,
  add column if not exists filled_until date not null default '1970-01-01';

update public.participants
set availability = coalesce(availability, '{}'::jsonb),
    availability_by_week = coalesce(availability_by_week, '{}'::jsonb),
    filled_until = coalesce(filled_until, '1970-01-01'::date)
where availability is null
   or availability_by_week is null
   or filled_until is null;

grant select, insert, update, delete on public.participants to anon, authenticated;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'participants'
  and column_name in ('availability', 'availability_by_week', 'filled_until')
order by column_name;
