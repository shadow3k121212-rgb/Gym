CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  slug TEXT NOT NULL UNIQUE CHECK (
    char_length(slug) BETWEEN 2 AND 62
    AND slug ~ '^[a-z0-9]([a-z0-9-]{0,60}[a-z0-9])$'
  ),
  kind TEXT NOT NULL CHECK (kind IN ('personal','gym')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenants_personal_creator_unique
  ON tenants(created_by_user_id) WHERE kind='personal';

CREATE TABLE tenant_memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','coach','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','left')),
  invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,user_id)
);
CREATE INDEX tenant_memberships_user_status_idx
  ON tenant_memberships(user_id,status,tenant_id);
CREATE INDEX tenant_memberships_tenant_role_idx
  ON tenant_memberships(tenant_id,role,status);

CREATE TABLE tenant_invitations (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','coach','member')),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX tenant_invitations_open_idx
  ON tenant_invitations(tenant_id,email,expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX tenant_invitations_token_idx ON tenant_invitations(token_hash);

-- Existing users receive a personal workspace whose stable ID equals their user ID.
-- Training data is not moved or shared by this migration.
INSERT INTO tenants(id,name,slug,kind,status,created_by_user_id)
SELECT id,
       left(coalesce(nullif(split_part(email,'@',1),''),'Athlete'),60) || ' Personal',
       'personal-' || replace(id::text,'-',''),
       'personal','active',id
FROM users
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_memberships(tenant_id,user_id,role,status)
SELECT id,id,'owner','active'
FROM users
ON CONFLICT (tenant_id,user_id) DO NOTHING;

CREATE FUNCTION gym_create_personal_tenant_after_user_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tenants(id,name,slug,kind,status,created_by_user_id)
  VALUES (
    NEW.id,
    left(coalesce(nullif(split_part(NEW.email,'@',1),''),'Athlete'),60) || ' Personal',
    'personal-' || replace(NEW.id::text,'-',''),
    'personal','active',NEW.id
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO tenant_memberships(tenant_id,user_id,role,status)
  VALUES (NEW.id,NEW.id,'owner','active')
  ON CONFLICT (tenant_id,user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_create_personal_tenant
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION gym_create_personal_tenant_after_user_insert();

CREATE FUNCTION gym_delete_personal_tenant_before_user_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM tenants WHERE id=OLD.id AND kind='personal';
  RETURN OLD;
END;
$$;

CREATE TRIGGER users_delete_personal_tenant
BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION gym_delete_personal_tenant_before_user_delete();
