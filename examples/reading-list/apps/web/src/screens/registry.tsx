import type { ComponentType } from 'react';
import { ListScreen } from './list';

// The screens module's one entry also carries the component fixtures (src/screens/components.tsx).
export { ComponentFixture, ComponentFixtureIndex, componentStates } from './components';

export interface ScreenProps {
  /** One of the page's states from docs/app/ia.json. */
  state: string;
}

/**
 * Page id (from docs/app/ia.json) -> the screen, rendered in the requested state on fake data
 * from packages/api-contract/fixtures. The Screens step fills this in; slices later wire real
 * data into the same components.
 */
export const screens: Record<string, ComponentType<ScreenProps>> = {
  list: ListScreen,
};

export const screensEnabled = () => process.env.NODE_ENV === 'development' || process.env.FWOS_SCREENS === '1';
