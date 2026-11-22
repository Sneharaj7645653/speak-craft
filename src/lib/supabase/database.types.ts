/**
 * @file        src/lib/supabase/database.types.ts
 * @layer       Infrastructure / Supabase (type contract)
 * @description
 *  Hand-authored mirror of the PostgreSQL schema defined in
 *  `supabase/migrations/0001_initial_schema.sql`. Supplying this generic to the
 *  Supabase clients yields end-to-end type safety on every query — column
 *  names, nullability and enum membership are checked at compile time.
 *
 * @remarks
 *  In a mature pipeline this file would be regenerated via
 *  `supabase gen types typescript`. It is committed by hand for Phase 1 so the
 *  backend compiles without a live database connection. Keep it in lock-step
 *  with the migration.
 */

/** Roles a profile may hold. Mirrors the `public.user_role` enum. */
export type UserRoleEnum = "student" | "instructor";

/** Speaking formats. Mirrors the `public.assignment_format` enum. */
export type AssignmentFormatEnum = "extempore" | "debate" | "declamation";

/** Per-student assignment lifecycle. Mirrors the `public.assignment_status` enum. */
export type AssignmentStatusEnum = "assigned" | "completed";

/** Speaking-session lifecycle. Mirrors the `public.speaking_session_status` enum. */
export type SpeakingSessionStatusEnum = "active" | "ended";

/** LLM provider that served an evaluation. Mirrors the `public.ai_provider` enum. */
export type AiProviderEnum = "groq" | "gemini";

/**
 * The strongly-typed database contract consumed by `SupabaseClient<Database>`.
 * `Row` = shape returned by SELECT, `Insert` = shape accepted by INSERT
 * (defaulted columns optional), `Update` = partial mutation shape.
 */
export interface Database {
  public: {
    Tables: {
      allowed_emails: {
        Row: { id: string; email: string; role: UserRoleEnum; created_at: string };
        Insert: {
          id?: string;
          email: string;
          role?: UserRoleEnum;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: UserRoleEnum;
          created_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          email: string;
          name: string;
          role: UserRoleEnum;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name: string;
          role?: UserRoleEnum;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string;
          role?: UserRoleEnum;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_id_fkey";
            columns: ["id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      assignments: {
        Row: {
          id: string;
          title: string;
          format_type: AssignmentFormatEnum;
          description: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          format_type: AssignmentFormatEnum;
          description?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          format_type?: AssignmentFormatEnum;
          description?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      practice_sessions: {
        Row: {
          id: string;
          student_id: string;
          seconds_practiced: number;
          session_date: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          seconds_practiced?: number;
          session_date?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          seconds_practiced?: number;
          session_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "practice_sessions_student_id_fkey";
            columns: ["student_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      student_assignments: {
        Row: {
          id: string;
          assignment_id: string;
          student_id: string;
          status: AssignmentStatusEnum;
          assigned_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          assignment_id: string;
          student_id: string;
          status?: AssignmentStatusEnum;
          assigned_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          assignment_id?: string;
          student_id?: string;
          status?: AssignmentStatusEnum;
          assigned_at?: string;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "student_assignments_assignment_id_fkey";
            columns: ["assignment_id"];
            referencedRelation: "assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_assignments_student_id_fkey";
            columns: ["student_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      speaking_sessions: {
        Row: {
          id: string;
          student_id: string;
          assignment_id: string | null;
          attempt_number: number | null;
          seconds_accumulated: number;
          status: SpeakingSessionStatusEnum;
          started_at: string;
          last_heartbeat_at: string;
          ended_at: string | null;
        };
        Insert: {
          id: string;
          student_id: string;
          assignment_id?: string | null;
          attempt_number?: number | null;
          seconds_accumulated?: number;
          status?: SpeakingSessionStatusEnum;
          started_at?: string;
          last_heartbeat_at?: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          student_id?: string;
          assignment_id?: string | null;
          attempt_number?: number | null;
          seconds_accumulated?: number;
          status?: SpeakingSessionStatusEnum;
          started_at?: string;
          last_heartbeat_at?: string;
          ended_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "speaking_sessions_assignment_id_fkey";
            columns: ["assignment_id"];
            referencedRelation: "assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "speaking_sessions_student_id_fkey";
            columns: ["student_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      evaluations: {
        Row: {
          id: string;
          student_id: string;
          assignment_id: string | null;
          attempt_number: number | null;
          transcript: string;
          feedback: string;
          score: number;
          provider: AiProviderEnum;
          word_count: number;
          filler_word_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          assignment_id?: string | null;
          attempt_number?: number | null;
          transcript: string;
          feedback: string;
          score: number;
          provider: AiProviderEnum;
          word_count?: number;
          filler_word_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          assignment_id?: string | null;
          attempt_number?: number | null;
          transcript?: string;
          feedback?: string;
          score?: number;
          provider?: AiProviderEnum;
          word_count?: number;
          filler_word_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "evaluations_assignment_id_fkey";
            columns: ["assignment_id"];
            referencedRelation: "assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "evaluations_student_id_fkey";
            columns: ["student_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      student_compliance_metrics: {
        Row: {
          student_id: string;
          name: string;
          email: string;
          assignments_assigned: number;
          assignments_completed: number;
          total_seconds_practiced: number;
          total_sessions: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      /**
       * Atomically records a one-shot coaching attempt (advisory-locked),
       * enforces the retake ceiling, marks the assignment completed, and returns
       * the 1-based attempt number. Raises on ceiling breach.
       */
      record_coaching_attempt: {
        Args: {
          p_student_id: string;
          p_assignment_id: string;
          p_max_attempts: number;
          p_session_id: string;
          p_now: string;
        };
        Returns: number;
      };
      record_practice_heartbeat: {
        Args: {
          p_student_id: string;
          p_session_id: string;
          p_assignment_id: string | null;
          p_now: string;
          p_daily_cap: number;
          p_per_beat_cap: number;
          p_max_attempts: number;
        };
        Returns: Record<string, unknown>;
      };
    };
    Enums: {
      user_role: UserRoleEnum;
      assignment_format: AssignmentFormatEnum;
      assignment_status: AssignmentStatusEnum;
      speaking_session_status: SpeakingSessionStatusEnum;
      ai_provider: AiProviderEnum;
    };
    CompositeTypes: Record<string, never>;
  };
}
