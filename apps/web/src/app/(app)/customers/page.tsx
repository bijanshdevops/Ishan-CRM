'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import {
  PERMISSIONS,
  type CustomerDto,
  type ImportReport,
  type Page,
  type TagDto,
} from '@ishan/contracts';
import { fa, formatNumber } from '@ishan/i18n';
import { CustomerFormDialog } from '@/components/customer-form';
import { TagChip } from '@/components/tag-chip';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Td,
  Tr,
} from '@/components/ui';
import { ApiClientError, api, apiBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const msg = (e: unknown) => (e instanceof ApiClientError ? e.message : fa.common.error);

export default function CustomersPage() {
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [tagId, setTagId] = useState('');
  const [applied, setApplied] = useState({ q: '', kind: '', tagId: '' });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const params = (cursor?: string) => {
    const sp = new URLSearchParams({ limit: '25' });
    if (applied.q) sp.set('q', applied.q);
    if (applied.kind) sp.set('kind', applied.kind);
    if (applied.tagId) sp.set('tagId', applied.tagId);
    if (cursor) sp.set('cursor', cursor);
    return sp.toString();
  };

  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<TagDto[]>('/tags') });
  const list = useInfiniteQuery({
    queryKey: ['customers', applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<CustomerDto>>(`/customers?${params(pageParam)}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const exportCsv = useMutation({
    mutationFn: async () => {
      const sp = new URLSearchParams();
      if (applied.q) sp.set('q', applied.q);
      if (applied.kind) sp.set('kind', applied.kind);
      if (applied.tagId) sp.set('tagId', applied.tagId);
      const blob = await apiBlob(`/customers/export?${sp.toString()}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'customers.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  return (
    <>
      <PageHeader
        title={fa.customers.title}
        actions={
          <div className="flex flex-wrap gap-2">
            {can(PERMISSIONS.TAGS_WRITE) ? (
              <Button variant="secondary" onClick={() => setTagsOpen(true)}>
                {fa.customers.manageTags}
              </Button>
            ) : null}
            {can(PERMISSIONS.CUSTOMERS_EXPORT) ? (
              <Button
                variant="secondary"
                loading={exportCsv.isPending}
                onClick={() => exportCsv.mutate()}
              >
                {fa.customers.export}
              </Button>
            ) : null}
            {can(PERMISSIONS.CUSTOMERS_IMPORT) ? (
              <Button variant="secondary" onClick={() => setImporting(true)}>
                {fa.customers.import}
              </Button>
            ) : null}
            {can(PERMISSIONS.CUSTOMERS_WRITE) ? (
              <Button onClick={() => setCreating(true)}>{fa.customers.add}</Button>
            ) : null}
          </div>
        }
      />
      <Card>
        <form
          role="search"
          className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ q: q.trim(), kind, tagId });
          }}
        >
          <Input
            aria-label={fa.common.search}
            placeholder={fa.customers.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            aria-label={fa.customers.kind}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{fa.customers.allKinds}</option>
            <option value="PERSON">{fa.customers.person}</option>
            <option value="ORGANIZATION">{fa.customers.organization}</option>
          </Select>
          <Select
            aria-label={fa.customers.tags}
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
          >
            <option value="">{fa.customers.allTags}</option>
            {tags.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {fa.common.search}
          </Button>
        </form>
        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.common.name,
              fa.customers.kind,
              fa.customers.phone,
              fa.common.email,
              fa.customers.owner,
              fa.customers.tags,
            ]}
          >
            {items.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link
                    className="font-medium text-[var(--color-brand)] underline-offset-4 hover:underline"
                    href={`/customers/${c.id}`}
                  >
                    {c.name}
                  </Link>
                </Td>
                <Td>{c.kind === 'PERSON' ? fa.customers.person : fa.customers.organization}</Td>
                <Td className="text-end [direction:ltr]">{c.phone ?? '—'}</Td>
                <Td className="text-end [direction:ltr]">{c.email ?? '—'}</Td>
                <Td>{c.owner?.name ?? '—'}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <TagChip key={t.id} tag={t} />
                    ))}
                  </span>
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
        {list.hasNextPage ? (
          <div className="mt-4 text-center">
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {fa.common.more}
            </Button>
          </div>
        ) : null}
      </Card>
      {creating ? (
        <CustomerFormDialog
          onClose={() => setCreating(false)}
          onSaved={(id) => router.push(`/customers/${id}`)}
        />
      ) : null}
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
      {tagsOpen ? <TagsDialog onClose={() => setTagsOpen(false)} /> : null}
    </>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api<ImportReport>('/customers/import', { method: 'POST', body: { csv, dryRun } }),
    onSuccess: async (r) => {
      setReport(r);
      if (!r.dryRun) await qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => setError(msg(e)),
  });
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setReport(null);
    if (file) setCsv(await file.text());
  };
  return (
    <Modal title={fa.customers.import} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-text-muted)]">{fa.customers.importHint}</p>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={fa.customers.importFile}>
          {(p) => (
            <Input {...p} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} />
          )}
        </Field>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!csv}
            loading={run.isPending}
            onClick={() => {
              setError(null);
              run.mutate(true);
            }}
          >
            {fa.customers.importDry}
          </Button>
          <Button
            disabled={!csv || !report?.dryRun}
            loading={run.isPending}
            onClick={() => {
              setError(null);
              run.mutate(false);
            }}
          >
            {fa.customers.importRun}
          </Button>
        </div>
        {report ? (
          <section aria-live="polite" className="text-sm">
            <h3 className="mb-2 font-semibold">{fa.customers.importReport}</h3>
            <ul className="mb-2 flex flex-wrap gap-2">
              <li>
                <Badge>
                  {fa.customers.importTotal}: {formatNumber(report.total)}
                </Badge>
              </li>
              <li>
                <Badge tone="success">
                  {fa.customers.importCreated}: {formatNumber(report.created)}
                </Badge>
              </li>
              <li>
                <Badge>
                  {fa.customers.importSkipped}: {formatNumber(report.skipped)}
                </Badge>
              </li>
              <li>
                <Badge tone="danger">
                  {fa.customers.importErrors}: {formatNumber(report.errors.length)}
                </Badge>
              </li>
            </ul>
            {report.errors.length ? (
              <ul className="max-h-40 overflow-auto">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    {fa.customers.row} {formatNumber(e.row)}: {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function TagsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<TagDto[]>('/tags') });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tags'] });
  const create = useMutation({
    mutationFn: () => api('/tags', { method: 'POST', body: { name, color } }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
    onError: (e) => setError(msg(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/tags/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  return (
    <Modal title={fa.customers.manageTags} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {error ? <ErrorBanner message={error} /> : null}
        <ul className="flex flex-wrap gap-2">
          {tags.data?.map((t) => (
            <li key={t.id} className="flex items-center gap-1">
              <TagChip tag={t} />
              <Button
                variant="ghost"
                aria-label={`${fa.common.delete} ${t.name}`}
                onClick={() => remove.mutate(t.id)}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (name.trim()) create.mutate();
          }}
        >
          <div className="grow">
            <Field label={fa.customers.newTag}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </div>
          <Field label={fa.customers.tagColor}>
            {(p) => (
              <Input
                {...p}
                type="color"
                className="h-10 w-14 p-1"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={create.isPending}>
            {fa.common.create}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
