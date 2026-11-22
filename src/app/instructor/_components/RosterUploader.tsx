"use client";

import { useCallback, useRef, useState } from "react";

import type { RosterIngestionResultDto } from "@/backend/roster/roster.dto";

/**
 * @file        src/app/instructor/_components/RosterUploader.tsx
 * @layer       Presentation (client component)
 * @description
 *  A drag-and-drop upload dashboard for roster distribution sheets. Accepts a
 *  CSV file (dropped or picked), reads it as text, and POSTs it to
 *  `/api/instructor/upload-roster`. Renders a reconciled ingestion summary
 *  (added / already-whitelisted / duplicates / rejected).
 *
 * @remarks
 *  CSV parsing itself is performed server-side by the roster DTO; this component
 *  only transports the file's text. Excel users export to `.csv` first.
 */

/** UI state machine for the uploader. */
type UploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly fileName: string }
  | { readonly kind: "uploading"; readonly fileName: string }
  | {
      readonly kind: "done";
      readonly fileName: string;
      readonly result: RosterIngestionResultDto;
    }
  | { readonly kind: "error"; readonly message: string };

/** Accepted file extensions for the roster sheet. */
const ACCEPTED = ".csv,text/csv,text/plain";

/**
 * The roster uploader card.
 *
 * @returns The rendered uploader.
 */
export function RosterUploader(): React.JSX.Element {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = state.kind === "reading" || state.kind === "uploading";

  /** Reads the file text and uploads it to the ingestion endpoint. */
  const processFile = useCallback(async (file: File): Promise<void> => {
    setState({ kind: "reading", fileName: file.name });
    let csv: string;
    try {
      csv = await file.text();
    } catch {
      setState({ kind: "error", message: "Could not read the selected file." });
      return;
    }

    setState({ kind: "uploading", fileName: file.name });
    try {
      const response = await fetch("/api/instructor/upload-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const payload = (await response.json()) as
        | RosterIngestionResultDto
        | { error: { message: string } };

      if (!response.ok) {
        const message =
          "error" in payload ? payload.error.message : "Upload failed.";
        setState({ kind: "error", message });
        return;
      }

      setState({
        kind: "done",
        fileName: file.name,
        result: payload as RosterIngestionResultDto,
      });
    } catch {
      setState({
        kind: "error",
        message: "Network error while uploading the roster.",
      });
    }
  }, []);

  /** Handles a drop event, guarding against non-file drags. */
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      if (file) void processFile(file);
      // Reset so the same file can be re-selected.
      event.target.value = "";
    },
    [processFile],
  );

  return (
    <section className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">Roster upload</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Drag a CSV of student emails to add them to the campus whitelist.
        </p>
      </header>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload roster CSV. Drag and drop a file, or press Enter to browse."
        aria-disabled={busy}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={[
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          isDragging
            ? "border-brand-primary bg-brand-primary-subtle"
            : "border-surface-border bg-surface-raised hover:border-brand-primary/60",
          busy ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="mb-3 h-8 w-8 text-brand-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 16V4m0 0L8 8m4-4l4 4" />
          <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        <p className="text-sm font-medium text-slate-700">
          {busy
            ? state.kind === "reading"
              ? "Reading file…"
              : "Uploading…"
            : "Drop your roster CSV here, or click to browse"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Accepts a single column of emails, or a sheet with an “email” header.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={onPick}
          className="hidden"
        />
      </div>

      {/* Result / error */}
      {state.kind === "error" ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.message}
        </div>
      ) : null}

      {state.kind === "done" ? (
        <div className="mt-4 rounded-lg border border-surface-border bg-surface-raised p-4">
          <p className="text-sm font-medium text-slate-700">
            Processed <span className="font-semibold">{state.fileName}</span>
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Stat label="Added" value={state.result.added} emphasis />
            <Stat label="Already listed" value={state.result.alreadyWhitelisted} />
            <Stat
              label="Duplicates"
              value={state.result.duplicatesInFile}
            />
          </dl>
          {state.result.rejected.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-slate-600">
                {state.result.rejected.length} entr
                {state.result.rejected.length === 1 ? "y" : "ies"} rejected
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-500">
                {state.result.rejected.map((r, i) => (
                  <li key={`${r.value}-${i}`}>
                    <span className="font-mono">{r.value || "(empty)"}</span> —{" "}
                    {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** A single labelled statistic tile used in the ingestion summary. */
function Stat({
  label,
  value,
  emphasis = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly emphasis?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-surface-border">
      <div
        className={[
          "text-xl font-semibold",
          emphasis ? "text-brand-primary" : "text-slate-900",
        ].join(" ")}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}
