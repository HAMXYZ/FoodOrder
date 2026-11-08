export type DishInteractionEvent = { event_id: string; dish_id: string }
export type DishViewEvent = DishInteractionEvent
type InteractionResult = "recorded" | "expired" | "failed" | "cancelled"

// One best-effort retry for transient errors. Reuse the original event ID even
// when the first INSERT succeeded but its HTTP response was lost.
async function recordInteraction(
  path: string, event: DishInteractionEvent, signal: AbortSignal, sameViewer: () => boolean,
): Promise<InteractionResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted || !sameViewer()) return "cancelled"
    try {
      const response = await fetch(path, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(event),
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      })
      if (response.ok) return "recorded"
      if (response.status === 401 || response.status === 403) return "expired"
      if (response.status < 500) return "failed"
    } catch {
      if (signal.aborted) return "cancelled"
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250))
  }
  return "failed"
}

export function recordDishView(event: DishViewEvent, signal: AbortSignal, sameViewer: () => boolean) {
  return recordInteraction("/api/interactions/views", event, signal, sameViewer)
}

export function recordDishAddToCart(event: DishInteractionEvent, signal: AbortSignal, sameViewer: () => boolean) {
  return recordInteraction("/api/interactions/add-to-cart", event, signal, sameViewer)
}
