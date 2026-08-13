import { remove } from 'es-toolkit'

import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import { LiteGraph } from '@/lib/litegraph/src/litegraph'
import { resolveNodeRootGraphId } from '@/lib/litegraph/src/utils/widget'
import { transformInputSpecV1ToV2 } from '@/schemas/nodeDef/migration'
import type { ComboInputSpec, InputSpec } from '@/schemas/nodeDefSchema'
import { zDynamicComboInputSpec } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'
import { app } from '@/scripts/app'
import type { ComfyApp } from '@/scripts/app'
import { useWidgetValueStore } from '@/stores/widgetValueStore'
import { widgetId } from '@/types/widgetId'
import {
  INLINE_INPUTS,
  ensureWidgetForInput,
  spliceInputs
} from '@/core/graph/widgets/dynamicSlots'

export function dynamicComboWidget(
  node: LGraphNode,
  inputName: string,
  untypedInputData: InputSpec,
  appArg: ComfyApp,
  widgetName?: string
) {
  const { addNodeInput } = useLitegraphService()
  const { deleteWidget } = useWidgetValueStore()
  const parseResult = zDynamicComboInputSpec.safeParse(untypedInputData)
  if (!parseResult.success) throw new Error('invalid DynamicCombo spec')
  const inputData = parseResult.data
  const options = Object.fromEntries(
    inputData[1].options.map(({ key, inputs }) => [key, inputs])
  )
  const subSpec: ComboInputSpec = [Object.keys(options), {}]
  const { widget, minWidth, minHeight } = app.widgets['COMBO'](
    node,
    inputName,
    subSpec,
    appArg,
    widgetName
  )
  function isInGroup(e: { name: string }): boolean {
    return e.name.startsWith(inputName + '.')
  }
  const updateWidgets = (value?: string) => {
    if (!node.widgets) throw new Error('Not Reachable')
    const newSpec = value ? options[value] : undefined

    const removedInputs = remove(node.inputs, isInGroup)
    for (const widget of remove(node.widgets, isInGroup)) {
      widget.onRemove?.()
      if (widget.widgetId) deleteWidget(widget.widgetId)
    }

    if (!newSpec) return

    const insertionPoint = node.widgets.findIndex((w) => w === widget) + 1
    const startingLength = node.widgets.length
    const startingInputLength = node.inputs.length

    if (insertionPoint === 0)
      throw new Error("Dynamic widget doesn't exist on node")
    const inputTypes: (Record<string, InputSpec> | undefined)[] = [
      newSpec.required,
      newSpec.optional
    ]
    inputTypes.forEach((inputType, idx) => {
      for (const key in inputType ?? {}) {
        const name = `${widget.name}.${key}`
        const specToAdd = transformInputSpecV1ToV2(inputType![key], {
          name,
          isOptional: idx !== 0
        })
        specToAdd.display_name = key
        addNodeInput(node, specToAdd)
        const newInputs = node.inputs
          .slice(startingInputLength)
          .filter((inp) => inp.name.startsWith(name))
        for (const newInput of newInputs) {
          if (INLINE_INPUTS && !newInput.widget)
            ensureWidgetForInput(node, newInput)
        }
      }
    })

    const inputInsertionPoint =
      node.inputs.findIndex((i) => i.name === widget.name) + 1
    const addedWidgets = node.widgets.splice(startingLength)
    node.widgets.splice(insertionPoint, 0, ...addedWidgets)
    if (inputInsertionPoint === 0) {
      if (
        addedWidgets.length === 0 &&
        node.inputs.length !== startingInputLength
      )
        //input is inputOnly, but lacks an insertion point
        throw new Error('Failed to find input socket for ' + widget.name)
      return
    }
    const addedInputs = spliceInputs(node, startingInputLength).map(
      (addedInput) => {
        const existingInput = node.inputs.findIndex(
          (existingInput) => addedInput.name === existingInput.name
        )
        return existingInput === -1
          ? addedInput
          : spliceInputs(node, existingInput, 1)[0]
      }
    )
    //assume existing inputs are in correct order
    spliceInputs(node, inputInsertionPoint, 0, ...addedInputs)

    for (const input of removedInputs) {
      const inputIndex = node.inputs.findIndex((inp) => inp.name === input.name)
      if (inputIndex === -1) {
        node.inputs.push(input)
        node.removeInput(node.inputs.length - 1)
      } else {
        node.inputs[inputIndex].link = input.link
        if (!input.link) continue
        const link = node.graph?.links?.[input.link]
        if (!link) continue
        link.target_slot = inputIndex
        node.onConnectionsChange?.(
          LiteGraph.INPUT,
          inputIndex,
          true,
          link,
          node.inputs[inputIndex]
        )
      }
    }

    node.size[1] = node.computeSize([...node.size])[1]
    if (!node.graph) return
    node._setConcreteSlots()
    node.arrange()
    app.canvas?.setDirty(true, true)
  }
  //A little hacky, but onConfigure won't work.
  //It fires too late and is overly disruptive
  let widgetValue = widget.value
  const getState = () => {
    const graphId = resolveNodeRootGraphId(node)
    if (!graphId) return undefined
    return useWidgetValueStore().getWidget(
      widgetId(graphId, node.id, widget.name)
    )
  }
  Object.defineProperty(widget, 'value', {
    get() {
      return getState()?.value ?? widgetValue
    },
    set(value) {
      const state = getState()
      if (state) state.value = value
      widgetValue = value
      updateWidgets(value)
    }
  })
  widget.value = widgetValue
  return { widget, minWidth, minHeight }
}
