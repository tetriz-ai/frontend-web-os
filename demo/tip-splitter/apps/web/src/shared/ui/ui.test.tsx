// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Alert, Button, Card, EmptyState, NumberStepper, SegmentedControl, StateHandler, TextField } from './index';

// One render test per required state in design-system/components.json. The tag in each name
// (@state:<component>:<state>) is how `fwos check` proves the state renders.

describe('button', () => {
  it('renders its label and fires @state:button:default', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps its label in place and blocks clicks while loading @state:button:loading', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(screen.getByText('Save')).toHaveClass('invisible');
  });

  it('is not clickable when disabled @state:button:disabled', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('text-field', () => {
  it('ties the label and hint to the input @state:text-field:default', () => {
    render(<TextField label="Link" hint="Starts with https://" />);
    expect(screen.getByLabelText('Link')).toHaveAccessibleDescription('Starts with https://');
  });

  it('marks the input invalid and reads out the error @state:text-field:invalid', () => {
    render(<TextField label="Link" error="That isn't a web address." />);
    const input = screen.getByLabelText('Link');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription("That isn't a web address.");
  });

  it('can be disabled @state:text-field:disabled', () => {
    render(<TextField label="Link" disabled />);
    expect(screen.getByLabelText('Link')).toBeDisabled();
  });

  it('forwards a ref to the input, so focus can return after a failed save', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField label="Link" ref={ref} />);
    ref.current!.focus();
    expect(screen.getByLabelText('Link')).toHaveFocus();
  });
});

describe('card', () => {
  it('renders its content @state:card:default', () => {
    render(<Card>Inside</Card>);
    expect(screen.getByText('Inside')).toBeInTheDocument();
  });
});

describe('alert', () => {
  it('announces an error with its reason and a retry @state:alert:critical', () => {
    render(<Alert tone="critical" title="Couldn't save" action={<Button>Try again</Button>}>The network dropped.</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't saveThe network dropped.Try again");
  });

  it('shows information politely @state:alert:info', () => {
    render(<Alert tone="info" title="Saved offline" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved offline');
  });
});

describe('empty-state', () => {
  it('shows a zero state with its next step @state:empty-state:zero', () => {
    render(<EmptyState kind="zero" title="Nothing saved yet" action={<Button>Save your first link</Button>} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-kind', 'zero');
    expect(screen.getByRole('button', { name: 'Save your first link' })).toBeInTheDocument();
  });

  it('shows a filtered-empty state that offers to clear filters @state:empty-state:filtered', () => {
    render(<EmptyState kind="filtered" title="No matches" action={<Button variant="secondary">Clear filters</Button>} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-kind', 'filtered');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('state-handler', () => {
  it('shows a skeleton while loading @state:state-handler:loading', () => {
    render(<StateHandler status="loading" label="links" />);
    expect(screen.getByLabelText('Loading links')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the empty state @state:state-handler:empty', () => {
    render(<StateHandler status="empty" label="links" />);
    expect(screen.getByRole('status')).toHaveTextContent('No links yet');
  });

  it('shows the reason and a working retry on error @state:state-handler:error', async () => {
    const onRetry = vi.fn();
    render(<StateHandler status="error" label="links" error={{ message: 'The server timed out.', onRetry }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load links");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the content when ready @state:state-handler:ready', () => {
    render(<StateHandler status="ready" label="links">Content</StateHandler>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});

describe('segmented-control', () => {
  const options = [
    { value: '15', label: '15%' },
    { value: '18', label: '18%' },
  ];

  it('picks an option by its label @state:segmented-control:default', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl legend="Tip" options={options} value={null} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Tip' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '15%' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '18%' }));
    expect(onChange).toHaveBeenCalledWith('18');
  });

  it('shows the picked option as checked @state:segmented-control:selected', () => {
    render(<SegmentedControl legend="Tip" options={options} value="18" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: '18%' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '15%' })).not.toBeChecked();
  });

  it('can be disabled @state:segmented-control:disabled', () => {
    render(<SegmentedControl legend="Tip" options={options} value="15" onChange={() => {}} disabled />);
    expect(screen.getByRole('radio', { name: '18%' })).toBeDisabled();
  });
});

describe('number-stepper', () => {
  const base = { label: 'People', min: 1, max: 50, onChange: () => {}, decrementLabel: 'Decrease people', incrementLabel: 'Increase people' };

  it('steps up and down @state:number-stepper:default', async () => {
    const onStep = vi.fn();
    render(<NumberStepper {...base} value="4" onStep={onStep} />);
    await userEvent.click(screen.getByRole('button', { name: 'Increase people' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decrease people' }));
    expect(onStep.mock.calls).toEqual([[5], [3]]);
    expect(screen.getByLabelText('People')).toHaveValue('4');
  });

  it('turns off the minus button at the minimum @state:number-stepper:at-min', () => {
    render(<NumberStepper {...base} value="1" onStep={() => {}} />);
    expect(screen.getByRole('button', { name: 'Decrease people' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase people' })).toBeEnabled();
  });

  it('turns off the plus button at the maximum @state:number-stepper:at-max', () => {
    render(<NumberStepper {...base} value="50" onStep={() => {}} />);
    expect(screen.getByRole('button', { name: 'Increase people' })).toBeDisabled();
  });

  it('marks the field invalid and reads out the error @state:number-stepper:invalid', () => {
    render(<NumberStepper {...base} value="0" onStep={() => {}} error="Enter 1 to 50 people." />);
    const input = screen.getByLabelText('People');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter 1 to 50 people.');
  });
});
