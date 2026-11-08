CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, from_person_id INTEGER NOT NULL, from_post_id INTEGER, to_post_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'info', subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ouverte', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), answered_at TEXT, answered_by INTEGER);
CREATE INDEX IF NOT EXISTS requests_to ON requests(to_post_id, status);
CREATE INDEX IF NOT EXISTS requests_from ON requests(from_person_id);
CREATE INDEX IF NOT EXISTS requests_project ON requests(project_id);
CREATE TABLE IF NOT EXISTS request_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, person_id INTEGER, kind TEXT NOT NULL DEFAULT 'message', body TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS request_messages_req ON request_messages(request_id);
ALTER TABLE people ADD COLUMN ical_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS people_ical ON people(ical_token);
