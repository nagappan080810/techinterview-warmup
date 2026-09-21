import { NextResponse } from "next/server";
import { pushBackClaims } from "@/lib/redis-question-queue";
import { deleteSession, getSession } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Return an explicitly abandoned assessment's Redis-sourced questions to the
 * queue and delete the session (memory + Redis). Triggered by the quiz page
 * when the user deliberately skips it ("← New set" / "← Back to welcome" or any
 * SPA navigation away). Browser refreshes and tab unloads intentionally do NOT
 * call this — the session and its answers survive so the quiz can be resumed at
 * the next unanswered question. Finished assessments are exempt.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    console.log(`[api] restore ${id}: session not found — nothing to return (already restored or server restarted)`);
    // Already restored/removed.
    return NextResponse.json({ ok: true, restored: 0 });
  }

  const claims = session.redisClaims ?? [];
  if (session.assessmentCompleted) {
    console.log(`[api] restore ${id}: no-op — assessment was completed`);
    // Finished — leave the session alone so results can be reviewed.
    return NextResponse.json({ ok: true, restored: 0 });
  }

  const keyCount = new Set(claims.map((c) => c.key)).size;
  if (claims.length === 0) {
    console.log(`[api] restore ${id}: no redis claims (model-generated) — deleting abandoned session`);
  } else {
    console.log(`[api] restore ${id}: returning ${claims.length} question(s) across ${keyCount} key(s) to the Redis queue`);
    try {
      await pushBackClaims(claims);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[api] restore ${id}: failed to return ${claims.length} questions: ${msg}`);
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }
  }

  await deleteSession(id);
  console.log(`[api] restore ${id}: returned ${claims.length} question(s) to the queue and deleted the session`);
  return NextResponse.json({ ok: true, restored: claims.length });
}
