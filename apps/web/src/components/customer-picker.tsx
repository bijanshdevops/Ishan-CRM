'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CustomerDto, Page } from '@ishan/contracts';
import { fa } from '@ishan/i18n';
import { api } from '@/lib/api';
import { Field, Input, Select } from './ui';

/** Search box + result select for choosing one customer. */
export function CustomerPicker({
  value,
  onChange,
  initial,
}: {
  value: string;
  onChange: (id: string) => void;
  initial?: { id: string; name: string };
}) {
  const [term, setTerm] = useState('');
  const results = useQuery({
    queryKey: ['customers', 'picker', term],
    queryFn: () =>
      api<Page<CustomerDto>>(`/customers?limit=20${term ? `&q=${encodeURIComponent(term)}` : ''}`),
  });
  const options = results.data?.items.map((c) => ({ id: c.id, name: c.name })) ?? [];
  if (initial && !options.some((o) => o.id === initial.id)) options.unshift(initial);
  return (
    <div className="flex flex-col gap-2">
      <Field label={fa.deals.customerSearch}>
        {(p) => <Input {...p} value={term} onChange={(e) => setTerm(e.target.value)} />}
      </Field>
      <Field label={fa.deals.customer}>
        {(p) => (
          <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
