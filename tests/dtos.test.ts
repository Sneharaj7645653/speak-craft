import { describe, expect, it } from "vitest";

import { validateSignupRequest } from "@/backend/user/user.dto";
import { validateRosterUpload } from "@/backend/roster/roster.dto";
import { validateCreateAssignmentRequest } from "@/backend/assignment/assignment.dto";
import { validateHeartbeatRequest } from "@/backend/session/session.dto";
import { validateCoachRequest } from "@/backend/ai/evaluation.dto";

describe("Authentication DTO", () => {
  it("accepts and normalizes a valid signup", () => {
    const result = validateSignupRequest({
      name: " Priya ",
      email: " PRiya@Campus.edu ",
      password: "secure123",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: "Priya",
        email: "priya@campus.edu",
        password: "secure123",
      });
    }
  });

  it("rejects missing and invalid signup fields", () => {
    const result = validateSignupRequest({ name: "", email: "bad", password: "123" });
    expect(result.ok).toBe(false);
  });
});

describe("Roster DTO", () => {
  it("parses valid CSV, normalizes email, and counts duplicates", () => {
    const result = validateRosterUpload({
      csv: "email,name\nStudent@Campus.edu,One\nstudent@campus.edu,Duplicate\nbad,Bad",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.emails).toEqual(["student@campus.edu"]);
      expect(result.value.duplicatesInFile).toBe(1);
      expect(result.value.rejected).toHaveLength(1);
    }
  });

  it("rejects CSV with no email candidates", () => {
    expect(validateRosterUpload({ csv: "name,course\nA,Public Speaking" }).ok).toBe(false);
  });

  it("rejects uploads above 5000 candidates", () => {
    expect(validateRosterUpload({ emails: Array.from({ length: 5001 }, (_, i) => `u${i}@campus.edu`) }).ok).toBe(false);
  });
});

describe("Assignment DTO", () => {
  it("accepts a valid assignment", () => {
    expect(validateCreateAssignmentRequest({
      title: "AI Ethics",
      formatType: "debate",
      description: "Prepare arguments.",
    }).ok).toBe(true);
  });

  it("rejects missing title and invalid format", () => {
    const result = validateCreateAssignmentRequest({ title: "", formatType: "speech" });
    expect(result.ok).toBe(false);
  });
});

describe("Heartbeat DTO", () => {
  it("accepts UUIDs and rejects malformed IDs", () => {
    expect(validateHeartbeatRequest({
      sessionId: "3a4f8c2e-0b7f-4e3f-a9b1-91c9b0d3a111",
    }).ok).toBe(true);
    expect(validateHeartbeatRequest({ sessionId: "not-a-uuid" }).ok).toBe(false);
  });
});

describe("Coach DTO", () => {
  it("accepts converse and evaluate modes", () => {
    expect(validateCoachRequest({
      mode: "converse",
      messages: [{ role: "student", content: "I would like to discuss climate." }],
    }).ok).toBe(true);
  });

  it("rejects missing student turns and invalid modes", () => {
    expect(validateCoachRequest({
      mode: "evaluate",
      messages: [{ role: "coach", content: "Continue." }],
    }).ok).toBe(false);
  });

  it("rejects conversations above turn limits", () => {
    expect(validateCoachRequest({
      mode: "converse",
      messages: Array.from({ length: 61 }, () => ({
        role: "student",
        content: "A valid turn.",
      })),
    }).ok).toBe(false);
  });
});
