'use client';

import { type FormEvent, useState } from 'react';
import { Alert, Button, Card, TextField } from '@/shared/ui';
import { checkLink } from '../model/link';
import type { NewItem } from '../data/types';

export interface SaveLinkFormProps {
  /** The link field's id, so other parts of the page can move focus to it. */
  linkId: string;
  /** Resolves true when the link was saved; on false the fields keep what was typed. */
  onSave: (input: NewItem) => Promise<boolean>;
  saving?: boolean;
  /** Why the last save failed, shown under the form. */
  error?: string;
}

const focusField = (id: string) => document.getElementById(id)?.focus();

/** The link is checked when the field loses focus and on save, then again as you type once a message shows (R-interaction-3). */
export function SaveLinkForm({ linkId, onSave, saving = false, error }: SaveLinkFormProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [urlError, setUrlError] = useState<string>();

  const recheck = (value: string) => {
    const result = checkLink(value);
    setUrlError(result.ok ? undefined : result.message);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const link = checkLink(url);
    if (!link.ok) {
      setUrlError(link.message);
      focusField(linkId);
      return;
    }
    const saved = await onSave({ url: link.url, ...(title.trim() ? { title: title.trim() } : {}) });
    if (!saved) return;
    setUrl('');
    setTitle('');
    setUrlError(undefined);
    focusField(linkId);
  };

  return (
    <Card>
      <form className="flex flex-col gap-4" aria-label="Save a link" noValidate onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id={linkId}
            label="Link"
            hint="Starts with http:// or https://"
            name="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.com/article"
            value={url}
            error={urlError}
            onChange={(e) => {
              setUrl(e.target.value);
              if (urlError) recheck(e.target.value);
            }}
            onBlur={() => {
              if (url.trim()) recheck(url);
            }}
          />
          <TextField
            label="Title (optional)"
            name="title"
            hint="Leave it blank to use the site's name."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        {error ? (
          <Alert tone="critical" title="Couldn't save this link">
            {error}
          </Alert>
        ) : null}
        <div>
          {/* Keep focus in the field on a mouse or touch press: otherwise the field's blur check can
              show its message, push the button down mid-click, and swallow the click on a phone. */}
          <Button type="submit" loading={saving} onMouseDown={(e) => e.preventDefault()}>
            Save link
          </Button>
        </div>
      </form>
    </Card>
  );
}
