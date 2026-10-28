// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { notFound } from 'next/navigation';
import { ComponentFixture, screensEnabled } from '@/screens';

interface Props {
  params: Promise<{ componentId: string }>;
  searchParams: Promise<{ state?: string }>;
}

// One registered component in one of its required states, from src/screens/components.tsx.
export default async function ComponentInState({ params, searchParams }: Props) {
  if (!screensEnabled()) notFound();
  const { componentId } = await params;
  const { state } = await searchParams;
  return <ComponentFixture id={componentId} state={state ?? 'default'} />;
}
