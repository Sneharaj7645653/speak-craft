"use client";

import { useCallback, useState } from "react";

import {
  ASSIGNMENT_FORMATS,
  type AssignmentResponseDto,
  type DistributionResultDto,
} from "@/backend/assignment/assignment.dto";
import type { AssignmentFormat } from "@/backend/assignment/assignment.entity";

/**
 * @file        src/app/instructor/_components/AssignmentComposer.tsx
 * @layer       Presentation (client component)
 * @description
 *  An entry form to dispatch a speaking task to the whole cohort: a title input,
 *  a format select (Extempore / Debate / Declamation), and a description text
 *  area. Submits to `/api/instructor/create-assignment` and confirms how many
 *  students the assignment was distributed to.
 */

/** Human-friendly labels for each speaking format. */
const FORMAT_LABELS: Record<AssignmentFormat, string> = {
  extempore: "Extempore",
  debate: "Debate",
  declamation: "Declamation",
};

/** UI state machine for the composer. */
type ComposerState =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | {
      readonly kind: "success";
      readonly assignment: AssignmentResponseDto;
      readonly recipientCount: number;
    }
  | { readonly kind: "error"; readonly message: string };

/**
 * The assignment composer card.
 *
 * @returns The rendered composer form.
 */
export function AssignmentComposer(): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [formatType, setFormatType] = useState<AssignmentFormat>("extempore");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<ComposerState>({ kind: "idle" });

  const isSubmitting = state.kind === "submitting";

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();

      if (title.trim().length === 0) {
        setState({ kind: "error", message: "A title is required." });
        return;
      }

      setState({ kind: "submitting" });
      try {
        const response = await fetch("/api/instructor/create-assignment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            formatType,
            description: description.trim(),
          }),
        });
        const payload = (await response.json()) as
          | DistributionResultDto
          | { error: { message: string } };

        if (!response.ok) {
          const message =
            "error" in payload ? payload.error.message : "Dispatch failed.";
          setState({ kind: "error", message });
          return;
        }

        const result = payload as DistributionResultDto;
        setState({
          kind: "success",
          assignment: result.assignment,
          recipientCount: result.recipientCount,
        });
        // Reset the form for the next dispatch.
        setTitle("");
        setDescription("");
        setFormatType("extempore");
      } catch {
        setState({
          kind: "error",
          message: "Network error while dispatching the assignment.",
        });
      }
    },
    [title, formatType, description],
  );

  return (
    <section className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">
          Dispatch assignment
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Blast a speaking task to every enrolled student.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <label htmlFor="title" className="block text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isSubmitting}
            maxLength={200}
            placeholder="e.g. The ethics of artificial intelligence"
            className="block w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-primary disabled:opacity-60"
          />
        </div>

        {/* Format */}
        <div className="space-y-1.5">
          <label htmlFor="formatType" className="block text-sm font-medium text-slate-700">
            Format
          </label>
          <select
            id="formatType"
            value={formatType}
            onChange={(e) => setFormatType(e.target.value as AssignmentFormat)}
            disabled={isSubmitting}
            className="block w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-brand-primary disabled:opacity-60"
          >
            {ASSIGNMENT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label
            htmlFor="description"
            className="block text-sm font-medium text-slate-700"
          >
            Prompt / instructions
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSubmitting}
            rows={4}
            maxLength={5000}
            placeholder="Describe the task, constraints, and evaluation focus…"
            className="block w-full resize-y rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-primary disabled:opacity-60"
          />
        </div>

        {state.kind === "error" ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {state.message}
          </div>
        ) : null}

        {state.kind === "success" ? (
          <div
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          >
            “{state.assignment.title}” dispatched to{" "}
            <span className="font-semibold">{state.recipientCount}</span>{" "}
            student{state.recipientCount === 1 ? "" : "s"}.
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Dispatching…" : "Dispatch to cohort"}
        </button>
      </form>
    </section>
  );
}
