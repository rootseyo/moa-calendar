-- Direct Messages (쪽지함) between users & Calendar Task Board cards

CREATE TABLE IF NOT EXISTS direct_messages (
  id text PRIMARY KEY,
  sender_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  read_at timestamptz,
  sender_deleted_at timestamptz,
  recipient_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient
  ON direct_messages (recipient_id, created_at DESC)
  WHERE recipient_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_messages_sender
  ON direct_messages (sender_id, created_at DESC)
  WHERE sender_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
  ON direct_messages (recipient_id)
  WHERE read_at IS NULL AND recipient_deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_board_cards (
  id text PRIMARY KEY,
  calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'sage',
  assignee_id text REFERENCES users(id) ON DELETE SET NULL,
  due_date text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_board_cards_calendar_order
  ON task_board_cards (calendar_id, status, sort_order, created_at);
