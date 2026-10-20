'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PERMISSIONS, type Page, type ProductDto } from '@ishan/contracts';
import { fa, formatMoney } from '@ishan/i18n';
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
  Skeleton,
  Td,
  Textarea,
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { rialToTomanInput, tomanInputToRial } from '@/lib/money';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

export default function ProductsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProductDto | 'new' | null>(null);
  const canWrite = can(PERMISSIONS.PRODUCTS_WRITE);

  const list = useInfiniteQuery({
    queryKey: ['products', applied, showArchived],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: '25', activeOnly: String(!showArchived) });
      if (applied) sp.set('q', applied);
      if (pageParam) sp.set('cursor', pageParam);
      return api<Page<ProductDto>>(`/products?${sp.toString()}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const toggle = useMutation({
    mutationFn: (p: ProductDto) =>
      api(`/products/${p.id}`, { method: 'PATCH', body: { active: !p.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e) => toast(msg(e), 'error'),
  });

  return (
    <>
      <PageHeader
        title={fa.products.title}
        actions={
          canWrite ? (
            <Button onClick={() => setEditing('new')}>{fa.products.add}</Button>
          ) : undefined
        }
      />
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q);
        }}
      >
        <Field label={fa.common.search}>
          {(p) => (
            <Input
              {...p}
              value={q}
              placeholder={fa.products.searchPlaceholder}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {fa.common.search}
        </Button>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {fa.products.showArchived}
        </label>
      </form>
      <Card>
        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <DataTable
            head={[
              fa.products.name,
              fa.products.sku,
              fa.products.unit,
              fa.products.unitPrice,
              fa.common.status,
              canWrite ? fa.common.actions : '',
            ]}
          >
            {items.map((p) => (
              <Tr key={p.id}>
                <Td>{p.name}</Td>
                <Td>{p.sku ?? '—'}</Td>
                <Td>{p.unit}</Td>
                <Td className="tabular-nums">{formatMoney(BigInt(p.unitPrice), 'toman')}</Td>
                <Td>
                  {p.active ? (
                    <Badge tone="success">{fa.common.active}</Badge>
                  ) : (
                    <Badge>{fa.products.archived}</Badge>
                  )}
                </Td>
                <Td>
                  {canWrite ? (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setEditing(p)}>
                        {fa.common.edit}
                      </Button>
                      <Button variant="ghost" onClick={() => toggle.mutate(p)}>
                        {p.active ? fa.products.archive : fa.products.restore}
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
        {list.hasNextPage ? (
          <div className="mt-3 text-center">
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
      {editing ? (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function ProductDialog({ product, onClose }: { product: ProductDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'عدد');
  const [price, setPrice] = useState(product ? rialToTomanInput(product.unitPrice) : '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const rial = tomanInputToRial(price);
      if (rial === null) throw new Error('قیمت نامعتبر است');
      const body = {
        name,
        sku: sku.trim() || (product ? null : undefined),
        unit,
        unitPrice: rial.toString(),
        description: description.trim() || (product ? null : undefined),
      };
      return product
        ? api(`/products/${product.id}`, { method: 'PATCH', body })
        : api('/products', { method: 'POST', body });
    },
    onSuccess: () => {
      toast(product ? fa.products.updated : fa.products.created);
      onClose();
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => setError(msg(e)),
  });

  return (
    <Modal title={product ? fa.products.edit : fa.products.add} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          save.mutate();
        }}
      >
        <Field label={fa.products.name}>
          {(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={fa.products.sku}>
            {(p) => <Input {...p} dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} />}
          </Field>
          <Field label={fa.products.unit}>
            {(p) => (
              <Input {...p} required value={unit} onChange={(e) => setUnit(e.target.value)} />
            )}
          </Field>
        </div>
        <Field label={fa.products.unitPrice}>
          {(p) => (
            <Input
              {...p}
              required
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.products.description}>
          {(p) => (
            <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {fa.common.cancel}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {fa.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
