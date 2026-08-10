export interface WorkflowTransientStateProvider {
  snapshot(): unknown
  restore(state: unknown): void
}

export type WorkflowTransientSnapshot = ReadonlyMap<string, unknown>

const providers = new Map<string, WorkflowTransientStateProvider>()

export function registerWorkflowTransientState(
  key: string,
  provider: WorkflowTransientStateProvider
): void {
  providers.set(key, provider)
}

export function snapshotWorkflowTransientState(): WorkflowTransientSnapshot {
  return new Map(
    [...providers].map(([key, provider]) => [key, provider.snapshot()])
  )
}

export function restoreWorkflowTransientState(
  snapshot: WorkflowTransientSnapshot | undefined
): void {
  for (const [key, provider] of providers) {
    provider.restore(snapshot?.get(key))
  }
}
