import type { INodeInputSlot } from '@/lib/litegraph/src/interfaces'
import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import { LiteGraph } from '@/lib/litegraph/src/litegraph'

export const INLINE_INPUTS = false

export function ensureWidgetForInput(node: LGraphNode, input: INodeInputSlot) {
  node.widgets ??= []
  const { widget } = input
  if (widget && node.widgets.some((w) => w.name === widget.name)) return
  node.widgets.push({
    draw(ctx, _n, _w, y) {
      ctx.save()
      ctx.fillStyle = LiteGraph.NODE_TEXT_COLOR
      ctx.fillText(input.label ?? input.name, 20, y + 15)
      ctx.restore()
    },
    name: input.name,
    options: {},
    serialize: false,
    type: 'shim',
    y: 0
  })
  input.alwaysVisible = true
  input.widget = { name: input.name }
}

export function spliceInputs(
  node: LGraphNode,
  startIndex: number,
  deleteCount = -1,
  ...toAdd: INodeInputSlot[]
): INodeInputSlot[] {
  if (deleteCount < 0) return node.inputs.splice(startIndex)
  const ret = node.inputs.splice(startIndex, deleteCount, ...toAdd)
  node.inputs.slice(startIndex).forEach((input, index) => {
    const link = input.link && node.graph?.links?.get(input.link)
    if (link) link.target_slot = startIndex + index
  })
  return ret
}
