'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreateContactRequestSchema,
  PERMISSIONS,
  type ContactDto,
  type CustomerDetailDto,
  type TagDto,
} from '@ishan/contracts';
import { fa, formatJalaliDate } from '@ishan/i18n';
import { CustomerActivities } from '@/components/customer-timeline';
import { CustomerFormDialog } from '@/components/customer-form';
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
  Tr,
} from '@/components/ui';
import { ApiClientError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TagChip } from '@/components/tag-chip';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

function Row({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className={ltr ? 'text-end [direction:ltr]' : undefined}>{value || '—'}</dd>
    </div>
  );
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(PERMISSIONS.CUSTOMERS_WRITE);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<ContactDto | 'new' | null>(null);

  const customer = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api<CustomerDetailDto>(`/customers/${id}`),
  });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<TagDto[]>('/tags') });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['customer', id] });
    await qc.invalidateQueries({ queryKey: ['customers'] });
  };
  const setTags = useMutation({
    mutationFn: (tagIds: string[]) =>
      api(`/customers/${id}/tags`, { method: 'PUT', body: { tagIds } }),
    onSuccess: refresh,
    onError: (e) => toast(msg(e), 'error'),
  });
  const del = useMutation({
    mutationFn: () => api(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['customers'] });
      toast(fa.customers.deleted);
      router.replace('/customers');
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const delContact = useMutation({
    mutationFn: (cid: string) => api(`/contacts/${cid}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast(fa.customers.contactDeleted);
      await refresh();
    },
    onError: (e) => toast(msg(e), 'error'),
  });

  if (customer.isLoading) return <Skeleton />;
  if (customer.isError || !customer.data) {
    return <ErrorBanner message={msg(customer.error)} onRetry={() => void customer.refetch()} />;
  }
  const c = customer.data;
  const selected = new Set(c.tags.map((t) => t.id));

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/customers" className="text-[var(--color-brand)] hover:underline">
          ← {fa.customers.back}
        </Link>
      </p>
      <PageHeader
        title={c.name}
        actions={
          <div className="flex gap-2">
            {canWrite ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {fa.common.edit}
              </Button>
            ) : null}
            {can(PERMISSIONS.CUSTOMERS_DELETE) ? (
              <Button
                variant="danger"
                loading={del.isPending}
                onClick={() => {
                  if (window.confirm(fa.customers.deleteConfirm)) del.mutate();
                }}
              >
                {fa.common.delete}
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Row
                label={fa.customers.kind}
                value={c.kind === 'PERSON' ? fa.customers.person : fa.customers.organization}
              />
              <Row label={fa.customers.owner} value={c.owner?.name ?? null} />
              <Row label={fa.customers.nationalId} value={c.nationalId} ltr />
              <Row label={fa.customers.economicCode} value={c.economicCode} ltr />
              <Row label={fa.common.email} value={c.email} ltr />
              <Row label={fa.customers.phone} value={c.phone} ltr />
              <Row label={fa.customers.website} value={c.website} ltr />
              <Row
                label={`${fa.customers.province} / ${fa.customers.city}`}
                value={[c.province, c.city].filter(Boolean).join('، ')}
              />
              <div className="sm:col-span-2">
                <Row label={fa.customers.address} value={c.address} />
              </div>
              <div className="sm:col-span-2">
                <Row label={fa.customers.notes} value={c.notes} />
              </div>
              <Row label={fa.common.createdAt} value={formatJalaliDate(c.createdAt)} />
            </dl>
          </Card>
        </div>
        <Card title={fa.customers.tags}>
          {canWrite ? (
            <ul className="flex flex-wrap gap-2">
              {tags.data?.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      disabled={setTags.isPending}
                      onChange={(e) =>
                        setTags.mutate(
                          e.target.checked
                            ? [...selected, t.id]
                            : [...selected].filter((x) => x !== t.id),
                        )
                      }
                    />
                    <TagChip tag={t} />
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {c.tags.map((t) => (
                <li key={t.id}>
                  <TagChip tag={t} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="lg:col-span-3">
          <Card
            title={fa.customers.contacts}
            actions={
              canWrite ? (
                <Button onClick={() => setContact('new')}>{fa.customers.addContact}</Button>
              ) : undefined
            }
          >
            {c.contacts.length === 0 ? (
              <EmptyState />
            ) : (
              <DataTable
                head={[
                  fa.common.name,
                  fa.customers.jobTitle,
                  fa.common.email,
                  fa.customers.mobile,
                  fa.customers.phone,
                  ...(canWrite ? [fa.common.actions] : []),
                ]}
              >
                {c.contacts.map((k) => (
                  <Tr key={k.id}>
                    <Td>
                      {k.firstName} {k.lastName}{' '}
                      {k.isPrimary ? <Badge tone="brand">{fa.customers.primary}</Badge> : null}
                    </Td>
                    <Td>{k.jobTitle ?? '—'}</Td>
                    <Td className="text-end [direction:ltr]">{k.email ?? '—'}</Td>
                    <Td className="text-end [direction:ltr]">{k.mobile ?? '—'}</Td>
                    <Td className="text-end [direction:ltr]">{k.phone ?? '—'}</Td>
                    {canWrite ? (
                      <Td>
                        <div className="flex gap-1">
                          <Button variant="ghost" onClick={() => setContact(k)}>
                            {fa.common.edit}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm(fa.common.delete + '؟')) delContact.mutate(k.id);
                            }}
                          >
                            {fa.common.delete}
                          </Button>
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </DataTable>
            )}
          </Card>
        </div>
        {can(PERMISSIONS.ACTIVITIES_READ) ? (
          <div className="flex flex-col gap-4 lg:col-span-3">
            <CustomerActivities customerId={c.id} customerName={c.name} />
          </div>
        ) : null}
      </div>
      {editing ? (
        <CustomerFormDialog
          customer={c}
          canListUsers={can(PERMISSIONS.USERS_READ)}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
      {contact ? (
        <ContactDialog
          customerId={c.id}
          contact={contact === 'new' ? undefined : contact}
          onClose={() => setContact(null)}
          onSaved={async () => {
            setContact(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function ContactDialog({
  customerId,
  contact,
  onClose,
  onSaved,
}: {
  customerId: string;
  contact?: ContactDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    jobTitle: contact?.jobTitle ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    mobile: contact?.mobile ?? '',
    isPrimary: contact?.isPrimary ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const parsed = CreateContactRequestSchema.safeParse(f);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? fa.common.error);
      if (contact) {
        const body = Object.fromEntries(
          Object.entries(f).map(([k, v]) => [
            k,
            v === '' && k !== 'firstName' && k !== 'lastName' ? null : v,
          ]),
        );
        return api(`/contacts/${contact.id}`, { method: 'PATCH', body });
      }
      return api(`/customers/${customerId}/contacts`, { method: 'POST', body: parsed.data });
    },
    onSuccess: async () => {
      toast(fa.customers.contactSaved);
      await onSaved();
    },
    onError: (e) => setError(msg(e)),
  });
  return (
    <Modal title={contact ? fa.customers.editContact : fa.customers.addContact} onClose={onClose}>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {error ? (
          <div className="sm:col-span-2">
            <ErrorBanner message={error} />
          </div>
        ) : null}
        <Field label={fa.customers.firstName}>
          {(p) => <Input {...p} value={f.firstName} onChange={set('firstName')} />}
        </Field>
        <Field label={fa.customers.lastName}>
          {(p) => <Input {...p} value={f.lastName} onChange={set('lastName')} />}
        </Field>
        <Field label={fa.customers.jobTitle}>
          {(p) => <Input {...p} value={f.jobTitle} onChange={set('jobTitle')} />}
        </Field>
        <Field label={fa.common.email}>
          {(p) => <Input {...p} dir="ltr" type="email" value={f.email} onChange={set('email')} />}
        </Field>
        <Field label={fa.customers.mobile}>
          {(p) => (
            <Input {...p} dir="ltr" inputMode="tel" value={f.mobile} onChange={set('mobile')} />
          )}
        </Field>
        <Field label={fa.customers.phone}>
          {(p) => (
            <Input {...p} dir="ltr" inputMode="tel" value={f.phone} onChange={set('phone')} />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={f.isPrimary}
            onChange={(e) => setF((s) => ({ ...s, isPrimary: e.target.checked }))}
          />
          {fa.customers.primary}
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
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
