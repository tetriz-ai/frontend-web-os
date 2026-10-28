// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { HomeScreen } from '@/screens';
import { guardPage } from '@/shared/session';

// Every page calls guardPage with its ID from docs/app/ia.json first: it declares which page this
// route is, and lets through only the roles and flags ia.json shows it to.
export default async function Home() {
  await guardPage('home');
  return <HomeScreen state="ready" />;
}
