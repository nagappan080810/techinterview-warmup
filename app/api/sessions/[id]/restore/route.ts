import { NextResponse } from "next/server";
import { pushBackClaims } from "@/lib/redis-question-queue";
import { deleteSession, getSession } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Return an unfinished assessment's Redis-sourced questions to the queue and
 * delete the in-memory session. Triggered by the quiz page's pagehide beacon:
 * if the user leaves before finishing, the questions go straight back (ZADD
 * with their original scores) so they are served to the next student.
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
  if (session.assessmentCompleted || claims.length === 0) {
    console.log(
      `[api] restore ${id}: no-op — ${session.assessmentCompleted ? "assessment was completed" : "session has no redis claims"}`,
    );
    // Finished or nothing to return — leave the session alone.
    return NextResponse.json({ ok: true, restored: 0 });
  }

  const keyCount = new Set(claims.map((c) => c.key)).size;
  console.log(`[api] restore ${id}: returning ${claims.length} question(s) across ${keyCount} key(s) to the Redis queue`);
  try {
    await pushBackClaims(claims);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api] restore ${id}: failed to return ${claims.length} questions: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  await deleteSession(id);
  console.log(`[api] restore ${id}: returned ${claims.length} questions to the queue and deleted the session`);
  return NextResponse.json({ ok: true, restored: claims.length });
}