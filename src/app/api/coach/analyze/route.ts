import { requireStudent } from "@/backend/auth/authorization";
import { AiCoachService } from "@/backend/ai/ai-coach.service";
import { validateCoachRequest } from "@/backend/ai/evaluation.dto";
import { CoachUnavailableError } from "@/backend/ai/ai.errors";
import { mapErrorToResponse, jsonError } from "@/backend/shared/http";

/**
 * @file        src/app/api/coach/analyze/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js EDGE Route Handler)
 * @route        POST /api/coach/analyze
 * @description
 *  The analytical endpoint. Runs on the **Edge runtime** to sidestep the rigid
 *  10-second timeout of free-tier serverless functions and to stream character
 *  evaluations token-by-token via a chunked reader pipeline. It authenticates
 *  the caller, validates the transcript DTO, then pipes the live provider stream
 *  (Groq primary → Gemini fallback, chosen inside the service) straight back to
 *  the client as a `text/plain` chunked response.
 *
 * @remarks
 *  Pre-stream failures (auth, validation, unconfigured coach) return a normal
 *  JSON error with a semantic status. Once the `200` stream begins, failures are
 *  handled gracefully *inside* the stream (the service degrades to an on-brand
 *  apology and still persists what it can) — you cannot change the status code
 *  after the first byte is sent.
 */

/** Mandated by the timeout-mitigation rule: this endpoint runs on the Edge. */
export const runtime = "edge";

/** Never cache a live evaluation stream. */
export const dynamic = "force-dynamic";

/**
 * Handles a coaching request and streams the evaluation back token-by-token.
 *
 * Input  (JSON): `{ mode: 'converse'|'evaluate'; assignmentId?: string;
 *                    messages: { role: 'student'|'coach'; content: string }[] }`
 * Output (200) : `text/plain` chunked stream — a short conversational reply
 *                (`converse`) or the Sandwich-Method feedback (`evaluate`).
 *
 * Status contract (pre-stream only):
 *  - `200 OK`            — streaming coaching text.
 *  - `400 Bad Request`   — malformed JSON or transcript validation failure.
 *  - `401 Unauthorized`  — no valid session.
 *  - `403 Forbidden`     — caller is not a student.
 *  - `503 Unavailable`   — neither AI provider is configured.
 *  - `500 Internal`      — unexpected pre-stream error.
 *
 * @param request - The incoming HTTP request.
 * @returns A streaming `Response`, or a JSON error response.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Authorize: students only. Identity comes from the session, not the body.
    const { userId } = await requireStudent();

    // 2. Parse the body defensively.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    // 3. Validate the conversational payload at the DTO boundary.
    const validation = validateCoachRequest(body);
    if (!validation.ok) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        "Coaching request validation failed.",
        validation.errors,
      );
    }

    // 4. Ensure at least one provider is configured before opening the stream.
    const service = new AiCoachService();
    if (!service.isConfigured()) {
      const err = new CoachUnavailableError();
      return jsonError(err.status, err.code, err.message);
    }

    const input = {
      studentId: userId,
      mode: validation.value.mode,
      assignmentId: validation.value.assignmentId,
      messages: validation.value.messages,
    };

    // 5. Retake guardrail — enforced BEFORE streaming, but ONLY for a final
    //    `evaluate` (which consumes an attempt). Conversation turns are free.
    //    A status cannot be changed once the stream opens, hence the pre-check.
    await service.assertAttemptAllowed(input);

    // 6. Open the failover stream and pipe it straight back to the client.
    const stream = service.createCoachStream(input, request.signal);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
        // Discourage intermediary proxies from buffering the chunked stream.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return mapErrorToResponse(error, "POST /api/coach/analyze");
  }
}
