import { describe, expect, it, vi } from 'vitest'

import {
  registerWorkflowTransientState,
  restoreWorkflowTransientState,
  snapshotWorkflowTransientState
} from './workflowTransientState'

describe('workflowTransientState', () => {
  it('round-trips each provider by its key', () => {
    let stateA = 'a1'
    registerWorkflowTransientState('test.a', {
      snapshot: () => stateA,
      restore: (state) => {
        stateA = typeof state === 'string' ? state : 'cleared'
      }
    })

    const snapshot = snapshotWorkflowTransientState()
    stateA = 'a2'
    restoreWorkflowTransientState(snapshot)
    expect(stateA).toBe('a1')
  })

  it('restores undefined into providers missing from the snapshot', () => {
    const restore = vi.fn()
    registerWorkflowTransientState('test.b', { snapshot: () => 'b', restore })

    restoreWorkflowTransientState(new Map())
    expect(restore).toHaveBeenCalledWith(undefined)

    restoreWorkflowTransientState(undefined)
    expect(restore).toHaveBeenLastCalledWith(undefined)
  })
})
