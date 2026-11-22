import { describe, expect, it } from "vitest";

import { InstructorService } from "@/backend/instructor/instructor.service";
import { NoRecipientsError } from "@/backend/instructor/instructor.errors";
import type { UserRepository } from "@/backend/user/user.repository";
import type { AssignmentRepository } from "@/backend/assignment/assignment.repository";

describe("InstructorService", () => {
  it("distributes a valid assignment to every student", async () => {
    const users = {
      bulkInsertAllowedEmails: async (emails: string[]) => ({
        inserted: emails,
        skipped: [] as string[],
      }),
      listStudentIds: async () => ["student-1", "student-2"],
    };
    const assignments = {
      insertAssignment: async (row: Record<string, unknown>) => ({
        id: "assignment-1",
        title: row.title,
        format_type: row.format_type,
        description: row.description,
        created_at: "2026-01-01T00:00:00Z",
      }),
      insertStudentAssignments: async (rows: unknown[]) => rows.length,
      deleteAssignment: async () => undefined,
    };
    const service = new InstructorService(
      users as unknown as UserRepository,
      assignments as unknown as AssignmentRepository,
    );
    const result = await service.createAndDistributeAssignment({
      title: "AI Ethics",
      formatType: "debate",
      description: "Prepare arguments.",
    });
    expect(result.recipientCount).toBe(2);
  });

  it("rolls back assignment creation when no students exist", async () => {
    let deleted = false;
    const users = {
      listStudentIds: async () => [],
    };
    const assignments = {
      insertAssignment: async () => ({
        id: "assignment-1",
        title: "AI Ethics",
        format_type: "debate",
        description: "",
        created_at: "2026-01-01T00:00:00Z",
      }),
      deleteAssignment: async () => {
        deleted = true;
      },
    };
    const service = new InstructorService(
      users as unknown as UserRepository,
      assignments as unknown as AssignmentRepository,
    );
    await expect(service.createAndDistributeAssignment({
      title: "AI Ethics",
      formatType: "debate",
      description: "",
    })).rejects.toBeInstanceOf(NoRecipientsError);
    expect(deleted).toBe(true);
  });

  it("rolls back assignment creation on distribution failure", async () => {
    let deleted = false;
    const users = {
      listStudentIds: async () => ["student-1"],
    };
    const assignments = {
      insertAssignment: async () => ({
        id: "assignment-1",
        title: "AI Ethics",
        format_type: "debate",
        description: "",
        created_at: "2026-01-01T00:00:00Z",
      }),
      insertStudentAssignments: async () => {
        throw new Error("distribution failed");
      },
      deleteAssignment: async () => {
        deleted = true;
      },
    };
    const service = new InstructorService(
      users as unknown as UserRepository,
      assignments as unknown as AssignmentRepository,
    );
    await expect(service.createAndDistributeAssignment({
      title: "AI Ethics",
      formatType: "debate",
      description: "",
    })).rejects.toThrow();
    expect(deleted).toBe(true);
  });

  it("reports duplicate and new roster entries", async () => {
    const users = {
      bulkInsertAllowedEmails: async (emails: string[]) => ({
        inserted: [emails[0]!],
        skipped: emails.slice(1),
      }),
    };
    const service = new InstructorService(
      users as unknown as UserRepository,
      {} as AssignmentRepository,
    );
    const result = await service.ingestRoster({
      emails: ["one@campus.edu", "two@campus.edu"],
      rejected: [],
      duplicatesInFile: 1,
    });
    expect(result).toEqual({
      received: 2,
      added: 1,
      alreadyWhitelisted: 1,
      duplicatesInFile: 1,
      rejected: [],
    });
  });
});
