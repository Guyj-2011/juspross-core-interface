CREATE TABLE public.spotify_command_receipts (
  session_hash text NOT NULL,
  request_id text NOT NULL,
  command_hash text NOT NULL,
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_hash, request_id)
);
GRANT ALL ON public.spotify_command_receipts TO service_role;
ALTER TABLE public.spotify_command_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Server only command receipts" ON public.spotify_command_receipts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX spotify_command_receipts_created_at_idx ON public.spotify_command_receipts(created_at);
COMMENT ON TABLE public.spotify_command_receipts IS 'Server-only at-most-once Spotify command claims and safe results. No credentials, cookies or user transcription stored.';