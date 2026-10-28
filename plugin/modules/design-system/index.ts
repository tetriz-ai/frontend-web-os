// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the design-system module: the slot contract, DTCG loading, token outputs,
// intake, the component registry and their checks.

export * from './color.ts';
export { SLOTS, CONTRAST_PAIRS, cssVar, slot, type SlotDef, type SlotLevel } from './slots.ts';
export {
  loadDesignSystem,
  loadComponents,
  hasDesignSystem,
  dsConfigPath,
  DS_SCHEMA_VERSION,
  type DesignSystem,
  type ComponentEntry,
} from './load.ts';
export { tokenOutputs, tokensCss, themeCss } from './generate.ts';
export {
  fromShadcn,
  importRows,
  importSummary,
  sourceCopyPath,
  starterFiles,
  assertNoDesignSystem,
  cssVariables,
  type ImportRow,
  type IntakeFile,
  type MappingStatus,
} from './intake.ts';
export {
  mapDesignSystem,
  tokenSummary,
  ROW_STATUSES,
  type ComponentRow,
  type Mapping,
  type RowStatus,
  type TokenRow,
} from './adoption.ts';
export {
  adoptionReport,
  decide,
  designSystemReportPath,
  formatOutcomes,
  galleryModel,
  readDecisions,
  DECISIONS,
  FIDELITY_RECORD,
  REPORT_HEADER as DESIGN_SYSTEM_REPORT_HEADER,
  type AdoptionReport,
  type Decision,
  type DecisionRecord,
  type Outcomes,
} from './fidelity.ts';
export { scanRawValues } from './scan.ts';
export { checks } from './checks/design-system.ts';
export { hooks } from './hooks.ts';
