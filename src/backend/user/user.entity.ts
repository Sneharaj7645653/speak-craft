import type { Database, UserRoleEnum } from "@/lib/supabase/database.types";

/**
 * @file        src/backend/user/user.entity.ts
 * @layer       Entity Layer (Persistence)
 * @description
 *  Defines the EXACT structure of rows as they exist inside the Supabase
 *  database. Entities are the source of truth for persistence-shaped data:
 *  snake_case columns, ISO-8601 timestamp strings, and enum membership exactly
 *  as PostgreSQL returns them.
 *
 * @remarks
 *  Entities are deliberately distinct from DTOs. A DTO validates data crossing
 *  the API boundary (client-facing, may be camelCase, may omit server-owned
 *  fields); an Entity models the row on disk. Keeping them separate prevents
 *  database column renames from rippling into the public API contract, and vice
 *  versa. Mapping between the two lives in the service layer.
 */

/** Re-export of the role enum so downstream layers depend on the Entity layer. */
export type UserRole = UserRoleEnum;

/**
 * A `public.users` row exactly as stored in and returned from Supabase.
 *
 * @property id         - UUID shared 1:1 with `auth.users.id`.
 * @property email      - Lower-cased, trimmed email address.
 * @property name       - Display name supplied at signup.
 * @property role       - `'student'` (default) or `'instructor'`.
 * @property created_at - ISO-8601 UTC timestamp assigned by the database.
 */
export type UserEntity = Database["public"]["Tables"]["users"]["Row"];

/**
 * The insert shape accepted by the `public.users` table. `id` is required
 * because it must equal the freshly-created `auth.users.id`; defaulted columns
 * (`role`, `created_at`) are optional.
 */
export type UserInsertEntity = Database["public"]["Tables"]["users"]["Insert"];

/**
 * A `public.allowed_emails` row exactly as stored in Supabase. Consumed by the
 * whitelist gatekeeper in the service layer.
 */
export type AllowedEmailEntity =
  Database["public"]["Tables"]["allowed_emails"]["Row"];
