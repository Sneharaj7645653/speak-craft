import { describe, expect, it } from "vitest";

import { AuthService } from "@/backend/user/auth.service";
import {
  EmailAlreadyRegisteredError,
  EmailNotWhitelistedError,
  ProfilePersistenceError,
} from "@/backend/user/user.errors";

function fakeRepository(overrides: Record<string, unknown> = {}) {
  return {
    findAllowedEmail: async () => ({ id: "allowed-1", email: "student@campus.edu", role: "student", created_at: "2026-01-01T00:00:00Z" }),
    createAuthUser: async () => ({ id: "auth-1" }),
    insertUserProfile: async () => ({
      id: "auth-1",
      email: "student@campus.edu",
      name: "Priya",
      role: "student",
      created_at: "2026-01-01T00:00:00Z",
    }),
    deleteAuthUser: async () => undefined,
    ...overrides,
  };
}

describe("AuthService whitelist lifecycle", () => {
  it("rejects a non-whitelisted signup before writes", async () => {
    let created = false;
    const repo = fakeRepository({
      findAllowedEmail: async () => null,
      createAuthUser: async () => {
        created = true;
        return { id: "auth-1" };
      },
    });
    const service = new AuthService(repo as never);
    await expect(service.signup({
      email: "student@campus.edu",
      password: "secure123",
      name: "Priya",
    })).rejects.toBeInstanceOf(EmailNotWhitelistedError);
    expect(created).toBe(false);
  });

  it("assigns the role stored on the whitelist", async () => {
    const repo = fakeRepository({
      findAllowedEmail: async () => ({ id: "allowed-1", email: "teacher@campus.edu", role: "instructor", created_at: "2026-01-01T00:00:00Z" }),
      insertUserProfile: async (row: { id: string; email: string; name: string; role: string }) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        created_at: "2026-01-01T00:00:00Z",
      }),
    });
    const service = new AuthService(repo as never);
    const user = await service.signup({
      email: "teacher@campus.edu",
      password: "secure123",
      name: "Teacher",
    });
    expect(user.role).toBe("instructor");
  });

  it("maps duplicate auth identities to the duplicate domain error", async () => {
    const repo = fakeRepository({
      createAuthUser: async () => {
        throw new EmailAlreadyRegisteredError("student@campus.edu");
      },
    });
    const service = new AuthService(repo as never);
    await expect(service.signup({
      email: "student@campus.edu",
      password: "secure123",
      name: "Priya",
    })).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it("compensates by deleting the auth identity after profile failure", async () => {
    let deletedId: string | null = null;
    const repo = fakeRepository({
      insertUserProfile: async () => {
        throw new ProfilePersistenceError("insert failed");
      },
      deleteAuthUser: async (id: string) => {
        deletedId = id;
      },
    });
    const service = new AuthService(repo as never);
    await expect(service.signup({
      email: "student@campus.edu",
      password: "secure123",
      name: "Priya",
    })).rejects.toBeInstanceOf(ProfilePersistenceError);
    expect(deletedId).toBe("auth-1");
  });
});
