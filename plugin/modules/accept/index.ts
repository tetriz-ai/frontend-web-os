// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the accept module: the acceptance report and the "done" verdict, and an adopted
// app's change traced from the request to its evidence, with what is open at each handoff. The
// adjudicator and QA explorer agents, and the acceptance skill, are text in this folder.

export { buildReport, reportPath, REPORT_HEADER, type Report } from './report.ts';
export { type ChangeTrace, type OpenItems, handoffName, openItems, openLines, openSummary, traceChange, traceText } from './trace.ts';
