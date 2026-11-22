import { describe, expect, it } from "vitest";

import { StudentService } from "@/backend/student/student.service";
import { RetakeLimitExceededError } from "@/backend/student/student.errors";
import type { SessionRepository } from "@/backend/session/session.repository";
import type { AssignmentRepository } from "@/backend/assignment/assignment.repository";

describe("StudentService heartbeat", () => {
  it("delegates heartbeat accounting to the atomic RPC", async () => {
    const rpc = {
      recordPracticeHeartbeat: async (params: Record<string, unknown>) => ({
        creditedSeconds: 30,
        sessionSeconds: 30,
        dailyTotalSeconds: 30,
        dailyGoalSeconds: 600,
        dailyCapSeconds: 1800,
        goalMet: false,
        dailyCapReached: false,
        attemptNumber: 1,
        isNewSession: false,
        intervalSeconds: 30,
        params,
      }),
    };
    const service = new StudentService(
      rpc as unknown as SessionRepository,
      {} as AssignmentRepository,
    );
    const result = await service.recordHeartbeat(
      "student-1",
      {
        sessionId: "3a4f8c2e-0b7f-4e3f-a9b1-91c9b0d3a111",
        assignmentId: null,
      },
      new Date("2026-01-01T12:00:00Z"),
    );
    expect(result.creditedSeconds).toBe(30);
  });

  it("surfaces the retake limit from the atomic repository", async () => {
    const rpc = {
      recordPracticeHeartbeat: async () => {
        throw new RetakeLimitExceededError(4);
      },
    };
    const service = new StudentService(
      rpc as unknown as SessionRepository,
      {} as AssignmentRepository,
    );
    await expect(service.recordHeartbeat(
      "student-1",
      {
        sessionId: "3a4f8c2e-0b7f-4e3f-a9b1-91c9b0d3a111",
        assignmentId: "4a4f8c2e-0b7f-4e3f-a9b1-91c9b0d3a111",
      },
      new Date("2026-01-01T12:00:00Z"),
    )).rejects.toBeInstanceOf(RetakeLimitExceededError);
  });

  it("calculates current and longest streaks deterministically", async () => {
    const sessions = {
      getDailyHistory: async () => [
        { session_date: "2026-01-04", seconds_practiced: 600 },
        { session_date: "2026-01-03", seconds_practiced: 700 },
        { session_date: "2026-01-02", seconds_practiced: 600 },
        { session_date: "2026-01-01", seconds_practiced: 100 },
      ],
    };
    const service = new StudentService(
      sessions as unknown as SessionRepository,
      {} as AssignmentRepository,
    );
    const summary = await service.getStreakSummary(
      "student-1",
      new Date("2026-01-04T12:00:00Z"),
    );
    expect(summary.currentStreak).toBe(3);
    expect(summary.longestStreak).toBe(3);
    expect(summary.goalMetToday).toBe(true);
  });

  it("uses the full practice history rather than an arbitrary streak window", async () => {
    const history: Array<{ session_date: string; seconds_practiced: number }> = [];
    const now = new Date("2026-04-30T12:00:00Z");
    for (let i = 0; i < 401; i += 1) {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - i);
      history.push({
        session_date: date.toISOString().slice(0, 10),
        seconds_practiced: 600,
      });
    }
    const sessions = {
      getDailyHistory: async () => history,
    };
    const service = new StudentService(
      sessions as unknown as SessionRepository,
      {} as AssignmentRepository,
    );
    const summary = await service.getStreakSummary(
      "student-1",
      now,
    );
    expect(summary.currentStreak).toBe(401);
    expect(summary.longestStreak).toBe(401);
  });

  it("rejects formal practice for an assignment not distributed to the student", async () => {
    const assignments = {
      isAssignedToStudent: async () => false,
    };
    const service = new StudentService(
      {} as SessionRepository,
      assignments as unknown as AssignmentRepository,
    );
    await expect(service.assertAssignmentAssigned(
      "student-1",
      "4a4f8c2e-0b7f-4e3f-a9b1-91c9b0d3a111",
    )).rejects.toMatchObject({ status: 403 });
  });
});
