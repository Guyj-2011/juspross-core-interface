CREATE TABLE public.speech_gateway_state (
 id text PRIMARY KEY,
 status_code integer NOT NULL,
 message text NOT NULL,
 blocked boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.speech_gateway_state TO service_role;
ALTER TABLE public.speech_gateway_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_speech_state ON public.speech_gateway_state FOR ALL TO service_role USING (true) WITH CHECK (true);