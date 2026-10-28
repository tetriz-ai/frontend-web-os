import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Alert, Button, Card, EmptyState, StateHandler, TextField } from './index';

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
