CREATE UNIQUE INDEX tenant_invitations_one_open_per_email_idx
  ON tenant_invitations(tenant_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
