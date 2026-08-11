import type { Locator } from '@playwright/test'

import type { ComfyPage } from '@e2e/fixtures/ComfyPage'
import { comfyExpect as expect } from '@e2e/fixtures/ComfyPage'
import { fitToViewInstant } from '@e2e/fixtures/utils/fitToView'
import type { RuntimeReflowNode, TestGraphAccess } from '@e2e/types/globals'

/** Minimum height gain (px) a reflow must produce to count as a grow. */
export const REFLOW_GROWTH_THRESHOLD = 40

/**
 * Adds the DevTools `Node Runtime Reflow` node and returns its string id.
 */
async function addRuntimeReflowNode(comfyPage: ComfyPage): Promise<string> {
  const node = await comfyPage.nodeOps.addNode('DevToolsNodeRuntimeReflow')
  return String(node.id)
}

interface ReflowNodeUnderTest {
  nodeId: string
  node: Locator
  initialHeight: number
}

/**
 * Zoom at which the node under test is measured. Must sit above the LOD
 * threshold (~0.57 at DPR 1): below it nodes render as canvas boxes with no
 * Vue components mounted, and this test's subject is DOM reflow.
 */
const MEASUREMENT_ZOOM = 0.8

/** Centers the viewport on a node at a fixed, LOD-safe zoom. */
async function centerOnNode(comfyPage: ComfyPage, nodeId: string) {
  await comfyPage.page.evaluate(
    ([id, zoom]) => {
      const canvas = window.app!.canvas
      const graph = window.graph as unknown as TestGraphAccess
      const node = graph._nodes_by_id[id]
      if (!node) return

      const element = canvas.canvas
      canvas.ds.scale = Number(zoom)
      canvas.ds.offset[0] =
        -(node.pos[0] + node.size[0] / 2) +
        element.clientWidth / 2 / Number(zoom)
      canvas.ds.offset[1] =
        -(node.pos[1] + node.size[1] / 2) +
        element.clientHeight / 2 / Number(zoom)
      canvas.setDirty(true, true)
    },
    [nodeId, MEASUREMENT_ZOOM] as const
  )
  await comfyPage.nextFrame()
}

/**
 * Adds a reflow node, centers it at a deterministic zoom, and captures its
 * starting height so a test can assert on the height delta after triggering
 * runtime growth.
 *
 * Fit-to-view alone can land below the LOD threshold on this workflow, where
 * no Vue node elements exist at all, so the node is centered at a fixed zoom
 * instead of measured wherever fit happens to leave it.
 */
export async function addReflowNodeAndMeasure(
  comfyPage: ComfyPage
): Promise<ReflowNodeUnderTest> {
  const nodeId = await addRuntimeReflowNode(comfyPage)
  await fitToViewInstant(comfyPage)
  await centerOnNode(comfyPage, nodeId)

  const node = comfyPage.vueNodes.getNodeLocator(nodeId)
  await expect(node).toBeVisible()
  const initialHeight = (await node.boundingBox())!.height

  return { nodeId, node, initialHeight }
}

function triggerReflowGrowth(
  comfyPage: ComfyPage,
  nodeId: string,
  trigger: keyof RuntimeReflowNode
): Promise<void> {
  return comfyPage.page.evaluate(
    ([id, method]) => {
      const graph = window.graph as unknown as TestGraphAccess
      const node = graph._nodes_by_id[id] as unknown as RuntimeReflowNode
      node[method]()
    },
    [nodeId, trigger] as const
  )
}

/**
 * Widget-count growth idiom: `addCustomWidget(...)` then `node.size[1] = ...`
 * (rgthree Power Lora Loader, Easy-Use, 0246, ...).
 */
export function growNodeByWidget(
  comfyPage: ComfyPage,
  nodeId: string
): Promise<void> {
  return triggerReflowGrowth(comfyPage, nodeId, 'growByWidget')
}

/**
 * Image-preview growth idiom: on `img.onload` set `node.imgs` and
 * `node.size[1] = ...` with no widget change (Impact-Pack, N-Nodes).
 */
export function growNodeByPreview(
  comfyPage: ComfyPage,
  nodeId: string
): Promise<void> {
  return triggerReflowGrowth(comfyPage, nodeId, 'growByPreview')
}
