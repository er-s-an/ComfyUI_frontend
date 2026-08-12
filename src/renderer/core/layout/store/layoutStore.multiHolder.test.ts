import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { watchEffect } from 'vue'

import { layoutStore } from '@/renderer/core/layout/store/layoutStore'
import { LayoutSource } from '@/renderer/core/layout/types'
import type { NodeLayout } from '@/renderer/core/layout/types'
import { toNodeId } from '@/types/nodeId'
import { createUuidv4 } from '@/utils/uuid'

/**
 * Two consumers can hold the ref for the same node: the node component itself
 * (via useNodeLayout) and any observer of that node's geometry — the first-run
 * tour coachmark, slot element tracking, a minimap. When the component
 * unmounts, its cleanup must not silence the other holders.
 */
describe('layoutStore.getNodeLayoutRef with multiple holders', () => {
  const GRAPH = createUuidv4()
  const nodeId = toNodeId('multi-holder-node')
  const metadata = {
    actor: 'test',
    graphId: GRAPH,
    source: LayoutSource.Canvas,
    timestamp: 1
  } as const

  const layoutAt = (x: number): NodeLayout => ({
    id: nodeId,
    position: { x, y: 100 },
    size: { width: 200, height: 100 },
    zIndex: 0,
    visible: true,
    bounds: { x, y: 100, width: 200, height: 100 }
  })

  const createNode = () =>
    layoutStore.applyOperation({
      ...metadata,
      entity: 'node',
      nodeId,
      layout: layoutAt(100),
      type: 'createNode'
    })

  const moveNodeTo = (x: number) =>
    layoutStore.applyOperation({
      ...metadata,
      entity: 'node',
      nodeId,
      position: { x, y: 100 },
      type: 'moveNode'
    })

  /** Mirrors how canvasCoachTarget observes a node: a watcher over the ref. */
  function observe(ref: { value: NodeLayout | null }) {
    const seen: (number | undefined)[] = []
    const stop = watchEffect(() => seen.push(ref.value?.position.x), {
      flush: 'sync'
    })
    return { seen, stop }
  }

  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    layoutStore.resetForTests()
  })

  // Control: proves the harness observes real notifications.
  it('notifies a second holder while both are alive', () => {
    createNode()
    const holderA = layoutStore.retainNodeLayoutRef(GRAPH, nodeId)
    const holderB = layoutStore.retainNodeLayoutRef(GRAPH, nodeId)

    const { seen, stop } = observe(holderB.layout)
    expect(seen.at(-1)).toBe(100)

    moveNodeTo(500)
    stop()
    holderA.release()
    holderB.release()

    expect(seen.at(-1)).toBe(500)
  })

  it('keeps notifying the second holder after the first unmounts', () => {
    createNode()
    const holderA = layoutStore.retainNodeLayoutRef(GRAPH, nodeId)
    const holderB = layoutStore.retainNodeLayoutRef(GRAPH, nodeId)

    const { seen, stop } = observe(holderB.layout)
    expect(seen.at(-1)).toBe(100)

    // Holder A's component unmounts (viewport virtualization, graph switch...)
    holderA.release()

    moveNodeTo(500)
    stop()
    holderB.release()

    expect(seen.at(-1)).toBe(500)
  })

  it('drops the ref once the last holder releases', () => {
    createNode()
    const holderA = layoutStore.retainNodeLayoutRef(GRAPH, nodeId)
    const holderB = layoutStore.retainNodeLayoutRef(GRAPH, nodeId)

    holderA.release()
    holderB.release()

    expect(layoutStore.getNodeLayoutRef(GRAPH, nodeId)).not.toBe(holderB.layout)
  })
})
