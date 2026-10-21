'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  CAMPAIGN_BODY_MAX,
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_SUBJECT_MAX,
  PERMISSIONS,
  type CampaignAudience,
  type CampaignPreviewDto,
  type CampaignSendingState,
  type TagDto,
} from '@ishan/contracts';
import { fa, formatNumber } from '@ishan/i18n';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from './toast';
import { Badge, Button, ErrorBanner, Field, Input, Modal, Select, Skeleton, Textarea } from './ui';

const t = fa.campaignSending;
const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

/** Compose, preview, test, start and cancel the e-mail send of one campaign (ADR 0015). */
export function CampaignSendingDialog({
  campaignId,
  campaignName,
  onClose,
}: {
  campaignId: string;
  campaignName: string;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['campaign-sending', campaignId];
  const canWrite = can(PERMISSIONS.CAMPAIGNS_WRITE);
  const canSend = can(PERMISSIONS.CAMPAIGNS_SEND);

  const state = useQuery({
    queryKey: key,
    queryFn: () => api<CampaignSendingState>(`/campaigns/${campaignId}/sending`),
    refetchInterval: (q) => (q.state.data?.sending?.status === 'SENDING' ? 4000 : false),
  });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<TagDto[]>('/tags') });

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<CampaignAudience>({ tagIds: [], kind: null });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CampaignPreviewDto | null>(null);

  const sending = state.data?.sending ?? null;
  useEffect(() => {
    if (loaded || !state.data) return;
    if (state.data.sending) {
      setSubject(state.data.sending.subject);
      setBody(state.data.sending.body);
      setAudience(state.data.sending.audience);
    }
    setLoaded(true);
  }, [state.data, loaded]);

  const editable = !sending || sending.status === 'DRAFT';
  const touch =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPreview(null); // what was previewed is no longer what would be sent
    };

  const save = useMutation({
    mutationFn: () =>
      api(`/campaigns/${campaignId}/sending`, {
        method: 'PUT',
        body: { subject, body, audience },
      }),
    onError: (e) => setError(msg(e)),
  });
  const previewMut = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      return api<CampaignPreviewDto>(`/campaigns/${campaignId}/sending/preview`, {
        method: 'POST',
      });
    },
    onSuccess: (p) => {
      setError(null);
      setPreview(p);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(msg(e)),
  });
  const test = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      return api(`/campaigns/${campaignId}/sending/test`, { method: 'POST' });
    },
    onSuccess: () => {
      setError(null);
      toast(t.testSent);
    },
    onError: (e) => setError(msg(e)),
  });
  const start = useMutation({
    mutationFn: (expectedRecipients: number) =>
      api(`/campaigns/${campaignId}/sending/start`, {
        method: 'POST',
        body: { expectedRecipients },
      }),
    onSuccess: () => {
      setError(null);
      toast(t.started);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      setPreview(null);
      setError(e instanceof ApiClientError && e.code === 'recipients_changed' ? t.changed : msg(e));
    },
  });
  const cancel = useMutation({
    mutationFn: () => api(`/campaigns/${campaignId}/sending/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast(t.canceled);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(msg(e)),
  });

  const toggleTag = (id: string) =>
    touch(setAudience)({
      ...audience,
      tagIds: audience.tagIds.includes(id)
        ? audience.tagIds.filter((x) => x !== id)
        : [...audience.tagIds, id],
    });

  return (
    <Modal title={`${t.title} — ${campaignName}`} onClose={onClose}>
      {state.isLoading ? (
        <Skeleton rows={4} />
      ) : state.isError ? (
        <ErrorBanner message={msg(state.error)} onRetry={() => void state.refetch()} />
      ) : !state.data?.emailAvailable ? (
        <>
          <p role="status" className="text-sm">
            {t.unavailable}
          </p>
          <div>
            <Button variant="ghost" onClick={onClose}>
              {fa.common.close}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          {error ? <ErrorBanner message={error} /> : null}
          {sending ? (
            <div className="flex flex-wrap items-center gap-2" aria-live="polite">
              <Badge tone={sending.status === 'DONE' ? 'success' : 'brand'}>
                {t.status[sending.status]}
              </Badge>
              {sending.status !== 'DRAFT'
                ? CAMPAIGN_RECIPIENT_STATUSES.map((s) => (
                    <span key={s} className="text-sm">
                      {t.counts[s]}: {formatNumber(sending.counts[s])}
                    </span>
                  ))
                : null}
            </div>
          ) : null}
          {!editable ? <p className="text-sm text-[var(--color-text-muted)]">{t.locked}</p> : null}
          <Field label={t.subject}>
            {(p) => (
              <Input
                {...p}
                value={subject}
                maxLength={CAMPAIGN_SUBJECT_MAX}
                disabled={!editable || !canWrite}
                onChange={(e) => touch(setSubject)(e.target.value)}
              />
            )}
          </Field>
          <Field label={t.body} hint={t.bodyHint}>
            {(p) => (
              <Textarea
                {...p}
                rows={7}
                value={body}
                maxLength={CAMPAIGN_BODY_MAX}
                disabled={!editable || !canWrite}
                onChange={(e) => touch(setBody)(e.target.value)}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2" disabled={!editable || !canWrite}>
            <legend className="text-sm font-medium">{t.audience}</legend>
            <p className="text-sm text-[var(--color-text-muted)]">{t.audienceHint}</p>
            <Field label={t.kind}>
              {(p) => (
                <Select
                  {...p}
                  value={audience.kind ?? ''}
                  onChange={(e) =>
                    touch(setAudience)({
                      ...audience,
                      kind: e.target.value === '' ? null : (e.target.value as 'PERSON'),
                    })
                  }
                >
                  <option value="">{t.allKinds}</option>
                  <option value="PERSON">{t.kinds.PERSON}</option>
                  <option value="ORGANIZATION">{t.kinds.ORGANIZATION}</option>
                </Select>
              )}
            </Field>
            {(tags.data ?? []).length > 0 ? (
              <div role="group" aria-label={t.tags} className="flex flex-wrap gap-3">
                {(tags.data ?? []).map((tag) => (
                  <label key={tag.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={audience.tagIds.includes(tag.id)}
                      onChange={() => toggleTag(tag.id)}
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>

          {preview ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
              <p role="status" className="font-semibold">
                {formatNumber(preview.recipients)} {t.recipients}
                {preview.suppressed > 0
                  ? ` — ${formatNumber(preview.suppressed)} ${t.suppressed}`
                  : ''}
              </p>
              <p className="mt-2 text-[var(--color-text-muted)]">{t.sample}</p>
              <p className="font-medium">{preview.sample.subject}</p>
              <pre className="whitespace-pre-wrap font-[inherit]">{preview.sample.text}</pre>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {editable && canWrite ? (
              <>
                <Button
                  variant="secondary"
                  loading={previewMut.isPending}
                  disabled={!subject.trim() || !body.trim()}
                  onClick={() => previewMut.mutate()}
                >
                  {t.preview}
                </Button>
                <Button
                  variant="secondary"
                  loading={test.isPending}
                  disabled={!subject.trim() || !body.trim()}
                  onClick={() => test.mutate()}
                >
                  {t.sendTest}
                </Button>
              </>
            ) : null}
            {editable && canSend ? (
              <Button
                loading={start.isPending}
                disabled={!preview || preview.recipients < 1}
                onClick={() => {
                  if (
                    preview &&
                    window.confirm(t.startConfirm.replace('{n}', formatNumber(preview.recipients)))
                  )
                    start.mutate(preview.recipients);
                }}
              >
                {t.start}
              </Button>
            ) : null}
            {sending?.status === 'SENDING' && canSend ? (
              <Button
                variant="ghost"
                loading={cancel.isPending}
                onClick={() => {
                  if (window.confirm(t.cancelConfirm)) cancel.mutate();
                }}
              >
                {t.cancel}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              {fa.common.close}
            </Button>
          </div>
          {editable && canWrite && !canSend ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t.noPermission}</p>
          ) : null}
          {editable && canSend && !preview ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t.needPreview}</p>
          ) : null}
          {preview && preview.recipients < 1 ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t.noRecipients}</p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
