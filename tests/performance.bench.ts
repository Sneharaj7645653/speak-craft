import { bench, describe } from "vitest";

import { StudentService } from "@/backend/student/student.service";
import type { SessionRepository } from "@/backend/session/session.repository";
import type { AssignmentRepository } from "@/backend/assignment/assignment.repository";
import { InstructorService } from "@/backend/instructor/instructor.service";
import type { UserRepository } from "@/backend/user/user.repository";
import { AiCoachService } from "@/backend/ai/ai-coach.service";

const history400 = Array.from({ length: 400 }, (_, i) => ({
  session_date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
  seconds_practiced: 600,
}));

const history401 = [
  ...history400,
  { session_date: "2026-02-05", seconds_practiced: 600 },
];

function streakService(history: Array<{ session_date: string; seconds_practiced: number }>) {
  const sessions = {
    getDailyHistory: async () => history,
  };
  return new StudentService(
    sessions as unknown as SessionRepository,
    {} as AssignmentRepository,
  );
}

describe("Student streak calculation", () => {
  bench("400-day history", async () => {
    await streakService(history400).getStreakSummary(
      "student-benchmark",
      new Date("2026-01-01T12:00:00Z"),
    );
  });

  bench("401-day history", async () => {
    await streakService(history401).getStreakSummary(
      "student-benchmark",
      new Date("2026-02-05T12:00:00Z"),
    );
  });
});

describe("Atomic heartbeat service delegation", () => {
  const sessions = {
    recordPracticeHeartbeat: async () => ({
      creditedSeconds: 30,
      sessionSeconds: 30,
      dailyTotalSeconds: 30,
      dailyGoalSeconds: 600,
      dailyCapSeconds: 1800,
      goalMet: false,
      dailyCapReached: false,
      attemptNumber: null,
      isNewSession: false,
      intervalSeconds: 30,
    }),
  };
  const service = new StudentService(
    sessions as unknown as SessionRepository,
    {} as AssignmentRepository,
  );
  const heartbeat = {
    sessionId: "3a4f8c2e-0b7f-4e3f-a9b1-91c9b0d3a111",
    assignmentId: null,
  };

  bench("single heartbeat RPC delegation", async () => {
    await service.recordHeartbeat(
      "student-benchmark",
      heartbeat,
      new Date("2026-01-01T12:00:00Z"),
    );
  });

  bench("50 concurrent heartbeat RPC delegations", async () => {
    await Promise.all(
      Array.from({ length: 50 }, () =>
        service.recordHeartbeat(
          "student-benchmark",
          heartbeat,
          new Date("2026-01-01T12:00:00Z"),
        ),
      ),
    );
  });
});

describe("Instructor assignment distribution", () => {
  function createService(studentCount: number) {
    const users = {
      listStudentIds: async () =>
        Array.from({ length: studentCount }, (_, i) => `student-${i}`),
    };
    const assignments = {
      insertAssignment: async (row: Record<string, unknown>) => ({
        id: "assignment-benchmark",
        title: row.title,
        format_type: row.format_type,
        description: row.description,
        created_at: "2026-01-01T00:00:00Z",
      }),
      insertStudentAssignments: async (rows: unknown[]) => rows.length,
      deleteAssignment: async () => undefined,
    };
    return new InstructorService(
      users as unknown as UserRepository,
      assignments as unknown as AssignmentRepository,
    );
  }

  bench("300-student assignment distribution", async () => {
    await createService(300).createAndDistributeAssignment({
      title: "Benchmark assignment",
      formatType: "extempore",
      description: "Benchmark prompt",
    });
  });

  bench("3000-student assignment distribution", async () => {
    await createService(3000).createAndDistributeAssignment({
      title: "Benchmark assignment",
      formatType: "extempore",
      description: "Benchmark prompt",
    });
  });
});

describe("AI delivery metric calculation", () => {
  const service = new AiCoachService({} as never, {} as never, {} as never);
  const transcript =
    "I mean, this is basically a clear example of public speaking. " +
    "Um, I can explain the issue and provide a specific, practical response.";

  bench("delivery metric computation", () => {
    service.computeMetrics(transcript);
  });
});
