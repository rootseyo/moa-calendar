-- Task Board: per-calendar task numbers (T-12), @mentions, and auto-registered calendar To Do events.

ALTER TABLE task_board_cards ADD COLUMN IF NOT EXISTS task_no integer;
ALTER TABLE task_board_cards ADD COLUMN IF NOT EXISTS event_id text REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE task_board_cards ADD COLUMN IF NOT EXISTS mention_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE task_board_cards t
   SET task_no = n.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY calendar_id ORDER BY created_at, id)::int AS rn
      FROM task_board_cards
  ) n
 WHERE t.id = n.id AND t.task_no IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_board_cards_calendar_no
  ON task_board_cards (calendar_id, task_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_board_cards_event
  ON task_board_cards (event_id)
  WHERE event_id IS NOT NULL;

-- Messages can carry an in-app deep link (e.g. to a Task Board card).
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS link text NOT NULL DEFAULT '';
