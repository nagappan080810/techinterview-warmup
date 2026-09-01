import { getSession } from "@/lib/sessions";
import { getEmbeddedClient, isSessionGenerating } from "@/lib/generator";

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

      // Subscribe to opencode events for live updates
      try {
        const client = await getEmbeddedClient();
        let lastEventCount = session.eventCount;

        const unsub = client?.global
          .event({
            onSseEvent: () => {
              // Events are handled via polling the session file
            },
          })
          .catch(() => {});

        // Poll session file for updates (more reliable than event filtering)
        const pollInterval = setInterval(async () => {
          try {
            const { getSession: get } = await import("@/lib/sessions");
            const fresh = await get(id);
            if (!fresh) return;

            const newEventCount = fresh.eventCount ?? 0;
            if (newEventCount > lastEventCount) {
              lastEventCount = newEventCount;
              send("progress", {
                eventCount: newEventCount,
                lastEventAt: fresh.lastEventAt,
              });
            }

            if (fresh.status === "complete") {
              send("complete", {
                status: "complete",
                questions: fresh.questions,
                selections: fresh.selections,
                answers: fresh.answers,
                chats: fresh.chats,
                eventCount: fresh.eventCount,
              });
              send("done", { status: "complete" });
              clearInterval(pollInterval);
              unsub?.catch(() => {});
              controller.close();
            } else if (fresh.status === "error") {
              send("error", {
                status: "error",
                error: fresh.error,
              });
              send("done", { status: "error" });
              clearInterval(pollInterval);
              unsub?.catch(() => {});
              controller.close();
            }
          } catch {
            // transient error, keep polling
          }
        }, 500);

        // Handle client disconnect
        request.signal.addEventListener("abort", () => {
          clearInterval(pollInterval);
          unsub?.catch(() => {});
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      } catch {
        send("error", { error: "Failed to connect to event stream." });
        send("done", { status: "error" });
        controller.close();
      }
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
