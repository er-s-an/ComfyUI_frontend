import { applyAutogrow } from '@/core/graph/widgets/autogrow'
import { dynamicComboWidget } from '@/core/graph/widgets/dynamicCombo'
import { applyMatchType } from '@/core/graph/widgets/matchType'
import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import type { InputSpec as InputSpecV2 } from '@/schemas/nodeDef/nodeDefSchemaV2'
import type { DynamicControlType } from '@/schemas/nodeDefSchema'

export const dynamicWidgets = { COMFY_DYNAMICCOMBO_V3: dynamicComboWidget }

const dynamicInputs = {
  COMFY_AUTOGROW_V3: applyAutogrow,
  COMFY_MATCHTYPE_V3: applyMatchType
} satisfies Partial<
  Record<DynamicControlType, (node: LGraphNode, spec: InputSpecV2) => void>
>

function isSocketPassControl(type: string): type is keyof typeof dynamicInputs {
  return type in dynamicInputs
}

export function applyDynamicInputs(
  node: LGraphNode,
  inputSpec: InputSpecV2
): boolean {
  if (!isSocketPassControl(inputSpec.type)) return false
  dynamicInputs[inputSpec.type](node, inputSpec)
  return true
}
