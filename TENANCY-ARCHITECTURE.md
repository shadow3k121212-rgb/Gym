# Multi-tenant platform foundation

## Decision: identity is global; workspace membership is explicit

A GYM account represents a person, not a gym. A person may own a personal workspace and belong to multiple gym workspaces. Each gym workspace has its own identity, slug, lifecycle state and membership list.

The first schema/API slice introduces:
- `tenants` for personal and gym workspaces
- `tenant_memberships` for explicit active membership and role
- `tenant_invitations` with hashed tokens, expiry, replacement/revocation and matching-email acceptance
- automatic personal-workspace provisioning for existing and new accounts
- authenticated workspace list/create APIs
- an account-deletion guard preventing the only gym owner from orphaning the organization

## Roles and ownership invariants

Membership roles are `owner`, `admin`, `coach`, and `member`. Owners may invite admins, coaches and members; admins may invite only coaches and members. Only active owners/admins can view the workspace roster and invitation list. Personal workspaces are excluded from team-administration endpoints even when their owner calls them directly. A client-supplied tenant ID or role is never proof of permission.

Invitation tokens are high-entropy opaque values; only hashes are persisted. Tokens expire after seven days, can be revoked/replaced, require the signed-in account email to match the invite address, and can be accepted once. Production issuance requires an HTTPS delivery webhook and secret; a timeout/error revokes the invite instead of leaving an unknown live credential.

A gym workspace must always retain an active owner. Account deletion is rejected when the requester is the sole active owner. Ownership transfer/removal UI and APIs are subsequent work.

## Data privacy invariant

Membership in a gym does **not** automatically reveal an athlete's private training history. Existing `/v1/sessions` and movement-event routes remain authenticated-user scoped. A tenant membership listing cannot read or mutate another member's workout data. Tenant-scoped training requires a separate authorization slice that adds a resolved workspace context and checks the actor's role plus the athlete's explicit visibility/coach assignment.

## Next implementation slices

1. Owner transfer/offboarding, membership status administration, invitation audit history and operational support workflows.
2. Tenant-scoped plans/sessions only where product permissions require workspace visibility; preserve athlete ownership and private history.
3. Authorization matrix tests across two workspaces and all roles; repository queries must scope by tenant and owner/assignment.
4. Optional PostgreSQL row-level security as defense-in-depth, not a replacement for server authorization.
5. Tenant suspension, offboarding, export/delete and backup/retention workflows before production.

## Compatibility and migration

Migrations `010_tenants.sql`, `011_tenant_owner_guard.sql`, and `012_tenant_invite_uniqueness.sql` are additive. Existing user IDs anchor personal workspace IDs so the next data-scope migration can map legacy records deterministically without rewriting session identifiers. It does not move, share, or relabel workout rows. New users receive a personal workspace in the same database transaction through a trigger; the in-memory repository mirrors this contract for API tests.

Workspace API:
- `GET /v1/tenants`: returns active memberships of the authenticated user only.
- `POST /v1/tenants`: creates a gym workspace and grants the creator the owner role.
- Settings UI lists and creates workspaces, browses a tenant-scoped roster, and manages invitations.
- Owner/admin-gated roster and invitation listing are tenant scoped and cursor paginated.
- Invitation issuance enforces role hierarchy; admin may invite coaches/members, while only an owner may invite admins.
- Acceptance checks signed-in account email, token hash, expiry, revocation and one-time use; active memberships are not overwritten.
- Production invitation delivery uses a configured HTTPS webhook; delivery failure revokes the just-created invitation.
- Duplicate slugs return a conflict; malformed names/slugs return a client error.

The invitation issuance/acceptance and management UI/API are implemented. This is still not a claim of production-ready multi-tenant workout sharing: ownership transfer, membership suspension/reactivation, explicit coach-to-athlete visibility, tenant-scoped training resources, billing and RLS defense-in-depth remain subsequent work.
