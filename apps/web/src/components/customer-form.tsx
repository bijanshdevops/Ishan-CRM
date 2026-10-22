'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CreateCustomerRequestSchema, type CustomerDto, type CustomerKind } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { ApiClientError, api } from '@/lib/api';
import { useToast } from './toast';
import { Button, ErrorBanner, Field, Input, Modal, Select } from './ui';

export function CustomerFormDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer?: CustomerDto;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => api<{ items: Array<{ id: string; name: string }> }>('/users/assignable'),
  });
  const [f, setF] = useState({
    kind: (customer?.kind ?? 'PERSON') as CustomerKind,
    name: customer?.name ?? '',
    nationalId: customer?.nationalId ?? '',
    economicCode: customer?.economicCode ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    website: customer?.website ?? '',
    province: customer?.province ?? '',
    city: customer?.city ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? '',
    ownerId: customer?.owner?.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const { ownerId, ...rest } = f;
      const parsed = CreateCustomerRequestSchema.safeParse({
        ...rest,
        ...(ownerId ? { ownerId } : {}),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? fa.common.error);
      if (customer) {
        // send explicit nulls so cleared fields are removed
        const body = Object.fromEntries(
          Object.entries(rest).map(([k, v]) => [k, v === '' && k !== 'name' ? null : v]),
        );
        return api<{ id: string }>(`/customers/${customer.id}`, {
          method: 'PATCH',
          version: customer.updatedAt,
          body: { ...body, ...(ownerId ? { ownerId } : {}) },
        });
      }
      return api<{ id: string }>('/customers', { method: 'POST', body: parsed.data });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['customer'] });
      toast(customer ? fa.customers.updated : fa.customers.created);
      onSaved(res.id);
    },
    onError: (e) =>
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error),
  });

  return (
    <Modal title={customer ? fa.customers.edit : fa.customers.add} onClose={onClose}>
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
        <Field label={fa.customers.kind}>
          {(p) => (
            <Select {...p} value={f.kind} onChange={set('kind')}>
              <option value="PERSON">{fa.customers.person}</option>
              <option value="ORGANIZATION">{fa.customers.organization}</option>
            </Select>
          )}
        </Field>
        <Field label={fa.common.name}>
          {(p) => <Input {...p} value={f.name} onChange={set('name')} />}
        </Field>
        <Field label={fa.customers.nationalId}>
          {(p) => <Input {...p} dir="ltr" value={f.nationalId} onChange={set('nationalId')} />}
        </Field>
        <Field label={fa.customers.economicCode}>
          {(p) => <Input {...p} dir="ltr" value={f.economicCode} onChange={set('economicCode')} />}
        </Field>
        <Field label={fa.common.email}>
          {(p) => <Input {...p} dir="ltr" type="email" value={f.email} onChange={set('email')} />}
        </Field>
        <Field label={fa.customers.phone}>
          {(p) => (
            <Input {...p} dir="ltr" inputMode="tel" value={f.phone} onChange={set('phone')} />
          )}
        </Field>
        <Field label={fa.customers.website}>
          {(p) => <Input {...p} dir="ltr" value={f.website} onChange={set('website')} />}
        </Field>
        <Field label={fa.customers.province}>
          {(p) => <Input {...p} value={f.province} onChange={set('province')} />}
        </Field>
        <Field label={fa.customers.city}>
          {(p) => <Input {...p} value={f.city} onChange={set('city')} />}
        </Field>
        {
          <Field label={fa.customers.owner}>
            {(p) => (
              <Select {...p} value={f.ownerId} onChange={set('ownerId')}>
                <option value="">—</option>
                {users.data?.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        }
        <div className="sm:col-span-2">
          <Field label={fa.customers.address}>
            {(p) => <Input {...p} value={f.address} onChange={set('address')} />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={fa.customers.notes}>
            {(p) => <Input {...p} value={f.notes} onChange={set('notes')} />}
          </Field>
        </div>
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
