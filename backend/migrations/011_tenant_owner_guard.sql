CREATE FUNCTION gym_guard_active_tenant_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tenant_to_check UUID;
  active_owner_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'owner' OR OLD.status <> 'active' THEN
      RETURN OLD;
    END IF;
    tenant_to_check := OLD.tenant_id;
  ELSE
    IF OLD.role <> 'owner' OR OLD.status <> 'active' THEN
      RETURN NEW;
    END IF;
    IF NEW.tenant_id = OLD.tenant_id AND NEW.role = 'owner' AND NEW.status = 'active' THEN
      RETURN NEW;
    END IF;
    tenant_to_check := OLD.tenant_id;
  END IF;

  -- Serializes owner changes for this workspace. Parent deletion is allowed
  -- to cascade because the tenant row will no longer be present.
  PERFORM 1 FROM tenants WHERE id = tenant_to_check FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO active_owner_count
  FROM tenant_memberships
  WHERE tenant_id = tenant_to_check
    AND role = 'owner'
    AND status = 'active';

  IF active_owner_count <= 1 THEN
    RAISE EXCEPTION 'Transfer gym workspace ownership before removing the last active owner.'
      USING ERRCODE = 'P0001', CONSTRAINT = 'tenant_memberships_keep_active_owner';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_memberships_keep_active_owner
BEFORE DELETE OR UPDATE ON tenant_memberships
FOR EACH ROW EXECUTE FUNCTION gym_guard_active_tenant_owner();
