// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { ComponentType } from 'react';
import { HomeScreen } from './home';

export interface ScreenProps {
  /** One of the page's states from docs/app/ia.json. */
  state: string;
}

/**
 * Page id (from docs/app/ia.json) -> the screen, rendered in the requested state on fake data
 * from packages/api-contract/fixtures. The Screens step fills this in; slices later wire real
 * data into the same components. fwos's state harness renders every state here and checks it
 * renders as its state's contract says (fwos check screens/states).
 */
export const screens: Record<string, ComponentType<ScreenProps>> = {
  home: HomeScreen,
};

export const screensEnabled = () => process.env.NODE_ENV === 'development' || process.env.FWOS_SCREENS === '1';
