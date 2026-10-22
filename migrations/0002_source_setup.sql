-- One-time plugin setup codes live on the source until they are exchanged.
-- The plaintext code and source token are not stored.

alter table sources
  add column setup_code_hash text,
  add column setup_code_expires_at timestamptz,
  add column setup_code_used_at timestamptz;

create unique index sources_setup_code_hash_uidx
  on sources (setup_code_hash)
  where setup_code_hash is not null;
