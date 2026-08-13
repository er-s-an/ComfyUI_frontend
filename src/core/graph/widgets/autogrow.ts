import { remove } from 'es-toolkit'

import { useChainCallback } from '@/composables/functional/useChainCallback'
import type { ISlotType } from '@/lib/litegraph/src/interfaces'
import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import { LiteGraph } from '@/lib/litegraph/src/litegraph'
import type { LLink } from '@/lib/litegraph/src/LLink'
import { transformInputSpecV1ToV2 } from '@/schemas/nodeDef/migration'
import type { InputSpec } from '@/schemas/nodeDefSchema'
import type { InputSpec as InputSpecV2 } from '@/schemas/nodeDef/nodeDefSchemaV2'
import { zAutogrowOptions } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'
import { app } from '@/scripts/app'
import {
  INLINE_INPUTS,
  ensureWidgetForInput,
  spliceInputs
} from '@/core/graph/widgets/dynamicSlots'

type AutogrowNode = LGraphNode &
  Pick<Required<LGraphNode>, 'onConnectionsChange' | 'widgets'> & {
    comfyDynamic: {
      autogrow: Record<
        string,
        {
          min: number
          max: number
          inputSpecs: InputSpecV2[]
          prefix?: string
          names?: string[]
        }
      >
    }
  }

function autogrowOrdinalToName(
  ordinal: number,
  key: string,
  groupName: string,
  node: AutogrowNode
) {
  const {
    names,
    prefix = '',
    inputSpecs
  } = node.comfyDynamic.autogrow[groupName]
  const baseName = names
    ? names[ordinal]
    : (inputSpecs.length == 1 ? prefix : key) + ordinal
  return { name: `${groupName}.${baseName}`, display_name: baseName }
}

function addAutogrowGroup(
  ordinal: number,
  groupName: string,
  node: AutogrowNode
) {
  const { addNodeInput } = useLitegraphService()
  const { max, min, inputSpecs } = node.comfyDynamic.autogrow[groupName]
  if (ordinal >= max) return

  const namedSpecs = inputSpecs.map((input) => ({
    ...input,
    isOptional: ordinal >= (min ?? 0) || input.isOptional,
    ...autogrowOrdinalToName(ordinal, input.name, groupName, node)
  }))

  const newInputs = namedSpecs.map((namedSpec) => {
    addNodeInput(node, namedSpec)
    const input = spliceInputs(node, node.inputs.length - 1, 1)[0]
    if (inputSpecs.length !== 1 || (INLINE_INPUTS && !input.widget))
      ensureWidgetForInput(node, input)
    return input
  })

  for (const newInput of newInputs) {
    for (const existingInput of remove(
      node.inputs,
      (inp) => inp.name === newInput.name
    )) {
      //NOTE: link.target_slot is updated on spliceInputs call
      newInput.link ??= existingInput.link
    }
  }

  const targetName = autogrowOrdinalToName(
    ordinal - 1,
    inputSpecs.at(-1)!.name,
    groupName,
    node
  ).name
  const lastIndex = node.inputs.findLastIndex((inp) =>
    inp.name.startsWith(targetName)
  )
  const insertionIndex = lastIndex === -1 ? node.inputs.length : lastIndex + 1
  spliceInputs(node, insertionIndex, 0, ...newInputs)
  app.canvas?.setDirty(true, true)
}

const ORDINAL_REGEX = /\d+$/
function resolveAutogrowOrdinal(
  inputName: string,
  groupName: string,
  node: AutogrowNode
): number | undefined {
  //TODO preslice groupname?
  const name = inputName.slice(groupName.length + 1)
  const { names } = node.comfyDynamic.autogrow[groupName]
  if (names) {
    const ordinal = names.findIndex((s) => s === name)
    return ordinal === -1 ? undefined : ordinal
  }
  const match = name.match(ORDINAL_REGEX)
  if (!match) return undefined
  const ordinal = parseInt(match[0])
  return ordinal !== ordinal ? undefined : ordinal
}
function autogrowInputConnected(index: number, node: AutogrowNode) {
  const input = node.inputs[index]
  const groupName = input.name.slice(0, input.name.lastIndexOf('.'))
  const lastInput = node.inputs.findLast((inp) =>
    inp.name.startsWith(groupName + '.')
  )
  const ordinal = resolveAutogrowOrdinal(input.name, groupName, node)
  if (
    !lastInput ||
    ordinal == undefined ||
    (ordinal !== resolveAutogrowOrdinal(lastInput.name, groupName, node) &&
      !app.configuringGraph)
  )
    return
  addAutogrowGroup(ordinal + 1, groupName, node)
}
function autogrowInputDisconnected(index: number, node: AutogrowNode) {
  const input = node.inputs[index]
  if (!input) return
  const groupName = input.name.slice(0, input.name.lastIndexOf('.'))
  const autogrowGroup = node.comfyDynamic.autogrow[groupName]
  if (!autogrowGroup) return

  const { min = 1, inputSpecs } = autogrowGroup
  const ordinal = resolveAutogrowOrdinal(input.name, groupName, node)
  if (ordinal == undefined || ordinal + 1 < min) return

  //resolve all inputs in group
  const groupInputs = node.inputs.filter(
    (inp) =>
      inp.name.startsWith(groupName + '.') &&
      inp.name.lastIndexOf('.') === groupName.length
  )
  const stride = inputSpecs.length
  if (stride + index >= node.inputs.length) return
  if (groupInputs.length % stride !== 0) {
    console.error('Failed to group multi-input autogrow inputs')
    return
  }
  app.canvas?.setDirty(true, true)
  //groupBy would be nice here, but may not be supported
  for (let column = 0; column < stride; column++) {
    for (
      let bubbleOrdinal = ordinal * stride + column;
      bubbleOrdinal + stride < groupInputs.length;
      bubbleOrdinal += stride
    ) {
      const curInput = groupInputs[bubbleOrdinal]
      curInput.link = groupInputs[bubbleOrdinal + stride].link
      if (!curInput.link) continue
      const link = node.graph?.links[curInput.link]
      if (!link) continue
      const curIndex = node.inputs.findIndex((inp) => inp === curInput)
      if (curIndex === -1) throw new Error('missing input')
      link.target_slot = curIndex
      node.onConnectionsChange?.(
        LiteGraph.INPUT,
        curIndex,
        true,
        link,
        curInput
      )
    }
    const lastInput = groupInputs.at(column - stride)
    if (!lastInput) continue
    lastInput.link = null
    node.onConnectionsChange?.(
      LiteGraph.INPUT,
      node.inputs.length + column - stride,
      false,
      null,
      lastInput
    )
  }
  const removalChecks = groupInputs.slice(min * stride)
  let i
  for (i = removalChecks.length - stride; i >= 0; i -= stride) {
    if (removalChecks.slice(i, i + stride).some((inp) => inp.link)) break
  }
  const toRemove = removalChecks.slice(i + stride * 2)
  remove(node.inputs, (inp) => toRemove.includes(inp))
  for (const input of toRemove) {
    const widgetName = input?.widget?.name
    if (!widgetName) continue
    for (const widget of remove(node.widgets, (w) => w.name === widgetName))
      widget.onRemove?.()
  }
  node.size[1] = node.computeSize([...node.size])[1]
}

function withComfyAutogrow(node: LGraphNode): asserts node is AutogrowNode {
  if (node.comfyDynamic?.autogrow) return
  node.comfyDynamic ??= {}
  node.comfyDynamic.autogrow = {}

  let pendingConnection: number | undefined
  let swappingConnection = false

  const originalOnConnectInput = node.onConnectInput
  node.onConnectInput = function (slot: number, ...args) {
    pendingConnection = slot
    requestAnimationFrame(() => (pendingConnection = undefined))
    return originalOnConnectInput?.apply(this, [slot, ...args]) ?? true
  }

  node.onConnectionsChange = useChainCallback(
    node.onConnectionsChange,
    function (
      this: AutogrowNode,
      contype: ISlotType,
      slot: number,
      iscon: boolean,
      linf: LLink | null | undefined
    ) {
      const input = this.inputs[slot]
      if (contype !== LiteGraph.INPUT || !input) return
      //Return if input isn't known autogrow
      const key = input.name.slice(0, input.name.lastIndexOf('.'))
      const autogrowGroup = this.comfyDynamic.autogrow[key]
      if (!autogrowGroup) return
      if (app.configuringGraph && input.widget)
        ensureWidgetForInput(node, input)
      if (iscon) {
        if (swappingConnection || !linf) return
        autogrowInputConnected(slot, this)
      } else {
        if (pendingConnection === slot) {
          swappingConnection = true
          requestAnimationFrame(() => (swappingConnection = false))
          return
        }
        requestAnimationFrame(() => autogrowInputDisconnected(slot, this))
      }
    }
  )
}
export function applyAutogrow(node: LGraphNode, inputSpecV2: InputSpecV2) {
  withComfyAutogrow(node)

  const parseResult = zAutogrowOptions.safeParse(inputSpecV2)
  if (!parseResult.success) throw new Error('invalid Autogrow spec')
  const inputSpec = parseResult.data
  const { input, min = 1, names, prefix, max = 100 } = inputSpec.template

  const inputTypes: (Record<string, InputSpec> | undefined)[] = [
    input.required,
    input.optional
  ]
  const inputsV2 = inputTypes.flatMap((inputType, index) =>
    Object.entries(inputType ?? {}).map(([name, v]) =>
      transformInputSpecV1ToV2(v, { name, isOptional: index === 1 })
    )
  )
  node.comfyDynamic.autogrow[inputSpecV2.name] = {
    names,
    min,
    max: names?.length ?? max,
    prefix,
    inputSpecs: inputsV2
  }
  for (let i = 0; i === 0 || i < min + 1; i++)
    addAutogrowGroup(i, inputSpecV2.name, node)
}
