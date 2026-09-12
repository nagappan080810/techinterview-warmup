import { getSession } from "@/lib/sessions";
import { isSessionGenerating } from "@/lib/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial state
      send("status", {
        status: session.status,
        eventCount: session.eventCount,
        questions: session.questions,
        selections: session.selections,
        answers: session.answers,
        chats: session.chats,
        error: session.error,
        hasRedisSourced: session.hasRedisSourced,
      });

      // If already complete or error, close immediately
      if (session.status === "complete" || session.status === "error") {
        send("done", { status: session.status });
        controller.close();
        return;
      }

      // If not generating, close
      if (!isSessionGenerating(id)) {
        send("done", { status: session.status });
        controller.close();
        return;
      }

      // Poll the session store for updates. This works in every generator mode
      // (embedded opencode or direct API) because progress lives in the session
      // file — and forwards the terminal state the moment it settles.
      let lastEventCount = session.eventCount;

      const pollInterval = setInterval(async () => {
        try {
          const { getSession: get } = await import("@/lib/sessions");
          const fresh = await get(id);
          if (!fresh) return;

          if (fresh.status === "complete") {
            clearInterval(pollInterval);
            send("complete", {
              status: "complete",
              questions: fresh.questions,
              selections: fresh.selections,
              answers: fresh.answers,
              chats: fresh.chats,
              eventCount: fresh.eventCount,
              hasRedisSourced: fresh.hasRedisSourced,
            });
            send("done", { status: "complete" });
            controller.close();
          } else if (fresh.status === "error") {
            clearInterval(pollInterval);
            send("error", {
              status: "error",
              error: fresh.error,
            });
            send("done", { status: "error" });
            controller.close();
          } else {
            const newEventCount = fresh.eventCount ?? 0;
            if (newEventCount > lastEventCount) {
              lastEventCount = newEventCount;
              send("progress", {
                eventCount: newEventCount,
                lastEventAt: fresh.lastEventAt,
              });
            }
          }
        } catch {
          // transient error, keep polling
        }
      }, 500);

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(pollInterval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
