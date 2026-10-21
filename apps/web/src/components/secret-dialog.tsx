'use client';

import { fa } from '@ishan/i18n';
import { useToast } from './toast';
import { Button, Input, Modal } from './ui';

const t = fa.webhooks;

/**
 * Shows a webhook signing secret. The API returns it exactly once (create, rotate), so this
 * dialog is the only chance to copy it; closing it by any route calls `onDone`.
 */
export function SecretDialog({
  title,
  secret,
  onDone,
}: {
  title: string;
  secret: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast(t.secretCopied);
    } catch {
      // Clipboard can be blocked; the field below is selectable as a fallback.
    }
  };
  return (
    <Modal title={title} onClose={onDone}>
      <p className="text-sm text-[var(--color-text-muted)]">{t.secretBody}</p>
      <Input
        readOnly
        dir="ltr"
        aria-label={t.secret}
        value={secret}
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {t.secretCopy}
        </Button>
        <Button type="button" onClick={onDone}>
          {t.secretDone}
        </Button>
      </div>
    </Modal>
  );
}
