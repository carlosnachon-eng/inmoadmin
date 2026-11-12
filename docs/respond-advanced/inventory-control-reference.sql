-- PREPARED ONLY. Not executed in DEV or Production. No business tables referenced.
BEGIN;
CREATE SCHEMA respond_inventory_control;
REVOKE ALL ON SCHEMA respond_inventory_control FROM PUBLIC;
CREATE TABLE respond_inventory_control.gate (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 capability_sha256 text NOT NULL CHECK (capability_sha256 ~ '^[a-f0-9]{64}$'),
 enabled boolean NOT NULL DEFAULT false,
 generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
 expires_at timestamptz NOT NULL,
 window_start timestamptz NOT NULL DEFAULT clock_timestamp(),
 used integer NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND 10)
);
ALTER TABLE respond_inventory_control.gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON respond_inventory_control.gate FROM PUBLIC, anon, authenticated, service_role;
-- Fixed singleton and fixed SQL: cannot select people, contracts or inventory.
CREATE FUNCTION respond_inventory_control.request(p_capability text, p_action text, p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '500ms' AS $$
DECLARE g respond_inventory_control.gate%ROWTYPE; t timestamptz;
BEGIN
 IF p_capability IS NULL OR p_capability !~ '^[A-Za-z0-9_-]{43,128}$'
    OR p_action IS NULL OR p_action NOT IN ('consume','check') THEN
   RETURN jsonb_build_object('status','disabled');
 END IF;
 SELECT * INTO g FROM respond_inventory_control.gate WHERE id=true FOR UPDATE;
 t := clock_timestamp();
 IF NOT FOUND OR NOT g.enabled OR g.expires_at <= t OR
    g.capability_sha256 <> encode(sha256(convert_to(p_capability,'UTF8')),'hex') THEN
   RETURN jsonb_build_object('status','disabled');
 END IF;
 IF p_action='check' THEN
   IF p_generation IS DISTINCT FROM g.generation THEN RETURN jsonb_build_object('status','disabled'); END IF;
 ELSE
   IF t < g.window_start OR t >= g.window_start + interval '60 seconds' THEN
     g.used := 0; g.window_start := t;
   END IF;
   IF g.used >= 10 THEN RETURN jsonb_build_object('status','limited'); END IF;
   UPDATE respond_inventory_control.gate SET used=g.used+1, window_start=g.window_start WHERE id=true;
 END IF;
 RETURN jsonb_build_object('status','allowed','generation',g.generation);
END $$;
REVOKE ALL ON FUNCTION respond_inventory_control.request(text,text,bigint) FROM PUBLIC;
GRANT USAGE ON SCHEMA respond_inventory_control TO anon;
GRANT EXECUTE ON FUNCTION respond_inventory_control.request(text,text,bigint) TO anon;
CREATE FUNCTION public.respond_inventory_gate(p_capability text,p_action text,p_generation bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT respond_inventory_control.request(p_capability,p_action,p_generation)
$$;
REVOKE ALL ON FUNCTION public.respond_inventory_gate(text,text,bigint) FROM PUBLIC,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.respond_inventory_gate(text,text,bigint) TO anon;
-- Increment epoch on disable, reenable, expiry changes or capability rotation.
CREATE FUNCTION respond_inventory_control.version_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.enabled,NEW.capability_sha256,NEW.expires_at) IS DISTINCT FROM
    (OLD.enabled,OLD.capability_sha256,OLD.expires_at) THEN NEW.generation := OLD.generation+1;
 ELSIF NEW.generation IS DISTINCT FROM OLD.generation THEN RAISE EXCEPTION 'generation_managed';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION respond_inventory_control.version_change() FROM PUBLIC;
CREATE TRIGGER version_change BEFORE UPDATE ON respond_inventory_control.gate
FOR EACH ROW EXECUTE FUNCTION respond_inventory_control.version_change();
-- Deliberately no seed, capability or enabled row: missing state fails closed.
COMMIT;
