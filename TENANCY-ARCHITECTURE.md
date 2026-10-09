# Multi-tenant platform foundation

## Decision: identity is global; workspace membership is explicit

A GYM account represents a person, not a gym. A person may own a personal workspace and belong to multiple gym workspaces. Each gym workspace has its own identity, slug, lifecycle state and membership list.

The first schema/API slice introduces:
- `tenants` for personal and gym workspaces
- `tenant_memberships` for explicit active membership and role
- `tenant_invitations` as the persistence contract for a later one-time invite/accept flow
- automatic personal-workspace provisioning for existing and new accounts
- authenticated workspace list/create APIs
- an account-deletion guard preventing the only gym owner from orphaning the organization

## Roles and ownership invariants

Membership roles are `owner`, `admin`, `coach`, and `member`. Role names are persisted now, but not every role-management action or permission route is implemented by this slice. Invitation and role-change endpoints must enforce authorization server-side; a client-supplied tenant ID or role is never proof of permission.

A gym workspace must always retain an active owner. Account deletion is rejected when the requester is the sole active owner. Ownership transfer/removal UI and APIs are subsequent work.

## Data privacy invariant

Membership in a gym does **not** automatically reveal an athlete's private training history. Existing `/v1/sessions` and movement-event routes remain authenticated-user scoped. A tenant membership listing cannot read or mutate another member's workout data. Tenant-scoped training requires a separate authorization slice that adds a resolved workspace context and checks the actor's role plus the athlete's explicit visibility/coach assignment.

## Next implementation slices

1. Invitation delivery/acceptance, member listing and owner transfer, with one-time hashed tokens, expiry, email matching and audit trail.
2. Tenant-scoped plans/sessions only where product permissions require workspace visibility; preserve athlete ownership and private history.
3. Authorization matrix tests across two workspaces and all roles; repository queries must scope by tenant and owner/assignment.
4. Optional PostgreSQL row-level security as defense-in-depth, not a replacement for server authorization.
5. Tenant suspension, offboarding, export/delete and backup/retention workflows before production.

## Compatibility and migration

Migrations `010_tenants.sql` and `011_tenant_owner_guard.sql` are additive. Existing user IDs anchor personal workspace IDs so the next data-scope migration can map legacy records deterministically without rewriting session identifiers. It does not move, share, or relabel workout rows. New users receive a personal workspace in the same database transaction through a trigger; the in-memory repository mirrors this contract for API tests.

Workspace API:
- `GET /v1/tenants`: returns active memberships of the authenticated user only.
- `POST /v1/tenants`: creates a gym workspace and grants the creator the owner role.
- Duplicate slugs return a conflict; malformed names/slugs return a client error.

This is the multi-tenant foundation, not a claim that team sharing, invitations, billing or tenant-scoped workout access are already complete.
