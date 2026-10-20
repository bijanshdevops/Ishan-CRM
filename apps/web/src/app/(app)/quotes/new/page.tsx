'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { fa } from '@ishan/i18n';
import { QuoteForm } from '@/components/quote-form';
import { Card, PageHeader, Skeleton } from '@/components/ui';

function NewQuote() {
  const router = useRouter();
  const sp = useSearchParams();
  const customerId = sp.get('customerId');
  const customerName = sp.get('customerName');
  return (
    <>
      <PageHeader title={fa.quotes.add} />
      <Card>
        <QuoteForm
          presetCustomer={
            customerId && customerName ? { id: customerId, name: customerName } : undefined
          }
          onSaved={(q) => router.push(`/quotes/${q.id}`)}
          onCancel={() => router.push('/quotes')}
        />
      </Card>
    </>
  );
}

export default function NewQuotePage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <NewQuote />
    </Suspense>
  );
}
