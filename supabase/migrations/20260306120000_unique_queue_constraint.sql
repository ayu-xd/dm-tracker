-- Add unique constraint to prevent duplicate queue entries
-- First, remove any existing duplicates (keep the earliest created_at)
DELETE FROM public.daily_queues a
USING public.daily_queues b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.contact_id = b.contact_id
  AND a.queue_date = b.queue_date
  AND a.queue_type = b.queue_type;

-- Now add the unique constraint
ALTER TABLE public.daily_queues
  ADD CONSTRAINT unique_queue_entry UNIQUE (user_id, contact_id, queue_date, queue_type);
