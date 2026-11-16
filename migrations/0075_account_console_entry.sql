ALTER TABLE user_password_identities ADD COLUMN show_console_entry INTEGER NOT NULL DEFAULT 0
  CHECK(show_console_entry IN (0, 1));

-- Grant the shortcut to the existing account records, independent of future renames.
UPDATE user_password_identities SET show_console_entry=1
WHERE username_norm IN ('admin01', '3287390083');
