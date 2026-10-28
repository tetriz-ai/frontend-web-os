import { guardPage } from '../../src/shared/session';

export default async function M() {
  await guardPage('members');
  return null;
}
