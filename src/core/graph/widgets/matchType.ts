import { shallowReactive } from 'vue'

import { useChainCallback } from '@/composables/functional/useChainCallback'
import type {
  ISlotType,
  INodeInputSlot,
  INodeOutputSlot
} from '@/lib/litegraph/src/interfaces'
import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import { LiteGraph } from '@/lib/litegraph/src/litegraph'
import type { LLink } from '@/lib/litegraph/src/LLink'
import { commonType } from '@/lib/litegraph/src/utils/type'
import type { InputSpec as InputSpecV2 } from '@/schemas/nodeDef/nodeDefSchemaV2'
import { zMatchTypeOptions } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'
import { app } from '@/scripts/app'

type MatchTypeNode = LGraphNode &
  Pick<Required<LGraphNode>, 'onConnectionsChange'> & {
    comfyDynamic: { matchType: Record<string, Record<string, string>> }
  }

function changeOutputType(
  node: LGraphNode,
  output: INodeOutputSlot,
  combinedType: ISlotType
) {
  if (output.type === combinedType) return
  output.type = combinedType

  //check and potentially remove links
  if (!node.graph) return
  for (const link_id of output.links ?? []) {
    const link = node.graph.links[link_id]
    if (!link) continue
    const { input, inputNode, subgraphOutput } = link.resolve(node.graph)
    const inputType = (input ?? subgraphOutput)?.type
    if (!inputType) continue
    const keep = LiteGraph.isValidConnection(combinedType, inputType)
    if (!keep && subgraphOutput) subgraphOutput.disconnect()
    else if (!keep && inputNode) inputNode.disconnectInput(link.target_slot)
    if (input && inputNode?.onConnectionsChange)
      inputNode.onConnectionsChange(
        LiteGraph.INPUT,
        link.target_slot,
        keep,
        link,
        input
      )
  }
}

function withComfyMatchType(node: LGraphNode): asserts node is MatchTypeNode {
  if (node.comfyDynamic?.matchType) return
  node.comfyDynamic ??= {}
  node.comfyDynamic.matchType = {}

  const outputGroups = node.constructor.nodeData?.output_matchtypes
  node.onConnectionsChange = useChainCallback(
    node.onConnectionsChange,
    function (
      this: MatchTypeNode,
      contype: ISlotType,
      slot: number,
      iscon: boolean,
      linf: LLink | null | undefined
    ) {
      const input = this.inputs[slot]
      if (contype !== LiteGraph.INPUT || !this.graph || !input) return
      if (app.configuringGraph) return
      const [matchKey, matchGroup] = Object.entries(
        this.comfyDynamic.matchType
      ).find(([, group]) => input.name in group) ?? ['', undefined]
      if (!matchGroup) return
      if (iscon && linf) {
        const { output, subgraphInput } = linf.resolve(this.graph)
        const connectingType = (output ?? subgraphInput)?.type
        if (connectingType) linf.type = connectingType
      }
      //NOTE: inputs contains input
      const groupInputs: INodeInputSlot[] = node.inputs.filter(
        (inp) => inp.name in matchGroup
      )
      const connectedTypes = groupInputs.map((inp) => {
        if (!inp.link) return '*'
        const link = this.graph!.links[inp.link]
        if (!link) return '*'
        const { output, subgraphInput } = link.resolve(this.graph!)
        return (output ?? subgraphInput)?.type ?? '*'
      })
      //An input slot can accept a connection that is
      // - Compatible with original type
      // - Compatible with all other input types
      //An output slot can output
      // - Only what every input can output
      groupInputs.forEach((input, idx) => {
        const otherConnected = [
          ...connectedTypes.slice(0, idx),
          ...connectedTypes.slice(idx + 1)
        ]
        const combinedType = commonType(
          ...otherConnected,
          matchGroup[input.name]
        )
        if (!combinedType) throw new Error('invalid connection')
        input.type = combinedType
      })
      const outputType = commonType(...connectedTypes)
      if (!outputType) throw new Error('invalid connection')
      this.outputs.forEach((output, idx) => {
        if (!(outputGroups?.[idx] == matchKey)) return
        this.outputs[idx] = shallowReactive(this.outputs[idx])
        changeOutputType(this, output, outputType)
      })
      app.canvas?.setDirty(true, true)
    }
  )
}

export function applyMatchType(node: LGraphNode, inputSpec: InputSpecV2) {
  const { addNodeInput } = useLitegraphService()
  const name = inputSpec.name
  const matchTypeSpec = zMatchTypeOptions.safeParse(inputSpec).data
  if (!matchTypeSpec) return

  const { allowed_types, template_id } = matchTypeSpec.template
  const typedSpec = { ...inputSpec, type: allowed_types }
  addNodeInput(node, typedSpec)
  withComfyMatchType(node)
  node.comfyDynamic.matchType[template_id] ??= {}
  node.comfyDynamic.matchType[template_id][name] = allowed_types

  //TODO: instead apply on output add?
  //ensure outputs get updated
  const index = node.inputs.length - 1
  requestAnimationFrame(() => {
    const input = node.inputs[index]
    if (!input) return
    node.inputs[index] = shallowReactive(input)
    node.onConnectionsChange?.(
      LiteGraph.INPUT,
      index,
      !!input.link,
      input.link ? node.graph?.links?.[input.link] : undefined,
      input
    )
  })
}
