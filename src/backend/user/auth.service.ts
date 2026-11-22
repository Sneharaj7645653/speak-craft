import "server-only";

import { UserRepository } from "@/backend/user/user.repository";
import {
  EmailNotWhitelistedError,
  ProfilePersistenceError,
} from "@/backend/user/user.errors";
import type {
  SignupRequestDto,
  UserResponseDto,
} from "@/backend/user/user.dto";
import type { UserEntity } from "@/backend/user/user.entity";

/**
 * @file        src/backend/user/auth.service.ts
 * @layer       Service Layer (Business Logic)
 * @description
 *  Orchestrates the user-account lifecycle. Its defining responsibility is the
 *  security invariant: an incoming signup email MUST exist in the
 *  `allowed_emails` whitelist before any auth identity or profile is created.
 *  It coordinates the repository, enforces transactional consistency across the
 *  auth identity and the profile row, and maps persistence entities to
 *  client-facing DTOs.
 *
 * @remarks
 *  The service is deliberately ignorant of HTTP. It receives validated DTOs and
 *  either returns a DTO or throws a typed {@link UserDomainError}; translating
 *  those into status codes is the controller's job. This keeps the business
 *  rule ("whitelist gates signup") testable in isolation from transport.
 */
export class AuthService {
  private readonly users: UserRepository;

  /**
   * @param repository - Optional repository (for dependency injection / tests).
   *                      Defaults to a repository bound to the admin client.
   */
  constructor(repository: UserRepository = new UserRepository()) {
    this.users = repository;
  }

  /**
   * Registers a new account, enforcing the campus whitelist gate.
   *
   * Business logic / flow:
   *  1. **Whitelist gate** — reject with `EmailNotWhitelistedError` (403) if the
   *     email is not present in `allowed_emails`. This happens BEFORE any write.
   *  2. **Identity** — create the Supabase Auth identity (may throw
   *     `EmailAlreadyRegisteredError` / `AuthProviderError`).
   *  3. **Profile** — insert the `users` row keyed to the new identity. If this
   *     fails, COMPENSATE by deleting the just-created identity so the system is
   *     not left with an orphaned auth user, then rethrow.
   *  4. **Projection** — map the persisted entity to a {@link UserResponseDto}.
   *
   * @param dto - A validated, normalised {@link SignupRequestDto}.
   * @returns The created user's public projection.
   * @throws {EmailNotWhitelistedError}   Email absent from the whitelist. (403)
   * @throws {EmailAlreadyRegisteredError} Email already registered.       (409)
   * @throws {AuthProviderError}          Auth provider rejected the request.(502)
   * @throws {ProfilePersistenceError}    Profile row could not be written. (500)
   */
  async signup(dto: SignupRequestDto): Promise<UserResponseDto> {
    // 1. Whitelist gate — the core Phase 1 security invariant.
    const whitelisted = await this.users.findAllowedEmail(dto.email);
    if (!whitelisted) {
      throw new EmailNotWhitelistedError(dto.email);
    }

    // 2. Create the auth identity.
    const identity = await this.users.createAuthUser({
      email: dto.email,
      password: dto.password,
      name: dto.name,
    });

    // 3. Persist the profile, compensating on failure to avoid an orphan. The
    //    role is taken from the whitelist entry, so curating `allowed_emails`
    //    (student vs instructor) is what decides the account's role — no manual
    //    post-signup edit required.
    let entity: UserEntity;
    try {
      entity = await this.users.insertUserProfile({
        id: identity.id,
        email: dto.email,
        name: dto.name,
        role: whitelisted.role,
      });
    } catch (cause) {
      await this.users.deleteAuthUser(identity.id);
      if (cause instanceof ProfilePersistenceError) throw cause;
      throw new ProfilePersistenceError(
        cause instanceof Error ? cause.message : "unknown persistence failure.",
      );
    }

    // 4. Project the entity into the outbound DTO.
    return this.toResponseDto(entity);
  }

  /**
   * Checks whether an email is authorized by the whitelist, without side effects.
   * Useful for a pre-flight UI check on the signup form.
   *
   * @param email - Normalised email address.
   * @returns `true` when the email is on the whitelist.
   */
  async isEmailWhitelisted(email: string): Promise<boolean> {
    return (await this.users.findAllowedEmail(email)) !== null;
  }

  /**
   * Maps a persistence {@link UserEntity} to the client-facing
   * {@link UserResponseDto}, translating snake_case → camelCase and dropping
   * any field not part of the public contract.
   *
   * @param entity - The database row.
   * @returns The sanitised response DTO.
   */
  private toResponseDto(entity: UserEntity): UserResponseDto {
    return {
      id: entity.id,
      email: entity.email,
      name: entity.name,
      role: entity.role,
      createdAt: entity.created_at,
    };
  }
}
