import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UserRepository } from "@/backend/user/user.repository";

/**
 * @file        src/app/page.tsx
 * @layer       Presentation (index route — session-aware entry)
 * @description
 *  The application index. It reads the current Supabase session server-side and
 *  routes the visitor to the correct home:
 *   - no session            → `/login`
 *   - session, role student → `/student`
 *   - session, role instructor → `/instructor`
 *
 *  This is what lets a successful sign-in (which navigates here) land the user
 *  in their dashboard instead of bouncing back to the login screen.
 *
 * @remarks
 *  Identity is verified via `auth.getUser()` (validates the JWT), and the role
 *  is read from the user's own profile row. Session-cookie refresh is handled by
 *  the middleware; this component only reads.
 *
 * @returns Never returns — always redirects.
 */
export default async function HomePage(): Promise<never> {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await new UserRepository().findUserById(user.id);
  if (!profile) {
    // Authenticated identity with no application profile — send back to sign in.
    redirect("/login");
  }

  redirect(profile.role === "instructor" ? "/instructor" : "/student");
}
