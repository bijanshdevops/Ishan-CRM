import { DEFAULT_LEAD_SOURCES, normalizePhone, normalizeText } from '@ishan/contracts';
import type { Prisma } from '../../generated/prisma/client';
import { activitySearchText } from '../activities/mappers';
import { contactSearchText, customerSearchText } from '../customers/mappers';
import { campaignSearchText } from '../marketing/mappers';
import { contractNumber, quoteNumber } from '../quotes/mappers';
import { leadSearchText } from '../sales/mappers';

/** Everything below is fictional: invented names, `.invalid` e-mail domains, 0900-style placeholder numbers. */
const DAY = 86_400_000;
const rial = (toman: number) => BigInt(toman) * 10n;

interface SeedCustomer {
  key: string;
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  city: string;
  province: string;
  email: string;
  phone: string;
  contact: [first: string, last: string, title: string, mobile: string];
}

const CUSTOMERS: SeedCustomer[] = [
  {
    key: 'c1',
    kind: 'ORGANIZATION',
    name: 'شرکت نمونه آریا صنعت',
    city: 'تهران',
    province: 'تهران',
    email: 'info@arya-sanat.invalid',
    phone: '02100000001',
    contact: ['مهدی', 'کاظمی', 'مدیر خرید', '09000000001'],
  },
  {
    key: 'c2',
    kind: 'ORGANIZATION',
    name: 'گروه بازرگانی نمونه پارسا',
    city: 'اصفهان',
    province: 'اصفهان',
    email: 'sales@parsa-group.invalid',
    phone: '03100000002',
    contact: ['سارا', 'رضایی', 'مدیرعامل', '09000000002'],
  },
  {
    key: 'c3',
    kind: 'ORGANIZATION',
    name: 'مجتمع آموزشی نمونه دانش‌گستر',
    city: 'شیراز',
    province: 'فارس',
    email: 'office@danesh-gostar.invalid',
    phone: '07100000003',
    contact: ['علی', 'احمدی', 'مدیر مالی', '09000000003'],
  },
  {
    key: 'c4',
    kind: 'ORGANIZATION',
    name: 'داروسازی نمونه سینا',
    city: 'تبریز',
    province: 'آذربایجان شرقی',
    email: 'buy@sina-pharma.invalid',
    phone: '04100000004',
    contact: ['نرگس', 'موسوی', 'مدیر تدارکات', '09000000004'],
  },
  {
    key: 'c5',
    kind: 'ORGANIZATION',
    name: 'فروشگاه زنجیره‌ای نمونه مهر',
    city: 'مشهد',
    province: 'خراسان رضوی',
    email: 'hq@mehr-stores.invalid',
    phone: '05100000005',
    contact: ['حسین', 'جعفری', 'مدیر عملیات', '09000000005'],
  },
  {
    key: 'c6',
    kind: 'ORGANIZATION',
    name: 'کارخانه نمونه البرز پلاست',
    city: 'کرج',
    province: 'البرز',
    email: 'info@alborz-plast.invalid',
    phone: '02600000006',
    contact: ['زهرا', 'صادقی', 'مدیر کارخانه', '09000000006'],
  },
  {
    key: 'c7',
    kind: 'ORGANIZATION',
    name: 'مهندسین مشاور نمونه بنیان',
    city: 'تهران',
    province: 'تهران',
    email: 'contact@bonyan-eng.invalid',
    phone: '02100000007',
    contact: ['امیر', 'حسینی', 'شریک اصلی', '09000000007'],
  },
  {
    key: 'c8',
    kind: 'ORGANIZATION',
    name: 'هتل نمونه ساحل',
    city: 'رشت',
    province: 'گیلان',
    email: 'reserve@sahel-hotel.invalid',
    phone: '01300000008',
    contact: ['مریم', 'کریمی', 'مدیر هتل', '09000000008'],
  },
  {
    key: 'c9',
    kind: 'PERSON',
    name: 'پوریا نمونه‌زاده',
    city: 'قم',
    province: 'قم',
    email: 'pouria@example.invalid',
    phone: '02500000009',
    contact: ['پوریا', 'نمونه‌زاده', 'مشاور مستقل', '09000000009'],
  },
  {
    key: 'c10',
    kind: 'PERSON',
    name: 'لیلا نمونه‌پور',
    city: 'یزد',
    province: 'یزد',
    email: 'leila@example.invalid',
    phone: '03500000010',
    contact: ['لیلا', 'نمونه‌پور', 'طراح', '09000000010'],
  },
  {
    key: 'c11',
    kind: 'ORGANIZATION',
    name: 'حمل‌ونقل نمونه ترابر',
    city: 'اهواز',
    province: 'خوزستان',
    email: 'dispatch@tarabar.invalid',
    phone: '06100000011',
    contact: ['رضا', 'نظری', 'مدیر ناوگان', '09000000011'],
  },
  {
    key: 'c12',
    kind: 'ORGANIZATION',
    name: 'کلینیک نمونه آرامش',
    city: 'تهران',
    province: 'تهران',
    email: 'front@aramesh-clinic.invalid',
    phone: '02100000012',
    contact: ['دکتر فاطمه', 'قاسمی', 'مدیر کلینیک', '09000000012'],
  },
];

const PRODUCTS = [
  { sku: 'SRV-CONSULT', name: 'مشاوره و تحلیل نیاز', unit: 'ساعت', price: 1_500_000 },
  { sku: 'SRV-SETUP', name: 'راه‌اندازی و آموزش', unit: 'پروژه', price: 18_000_000 },
  { sku: 'LIC-STD', name: 'مجوز استفاده سالانه - استاندارد', unit: 'کاربر', price: 6_000_000 },
  { sku: 'LIC-PRO', name: 'مجوز استفاده سالانه - حرفه‌ای', unit: 'کاربر', price: 9_500_000 },
  { sku: 'SUP-GOLD', name: 'پشتیبانی ویژه سالانه', unit: 'سال', price: 24_000_000 },
  { sku: 'SRV-INTEG', name: 'اتصال به سیستم مالی', unit: 'پروژه', price: 30_000_000 },
];

const LEADS: Array<
  [
    name: string,
    company: string,
    status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED',
    source: string,
  ]
> = [
  ['کاوه نمونه', 'نمونه‌سازان کاوه', 'NEW', 'وب‌سایت'],
  ['شبنم نمونه', 'آموزشگاه نمونه شبنم', 'NEW', 'معرفی مشتری'],
  ['بابک نمونه', 'تولیدی نمونه بابک', 'CONTACTED', 'نمایشگاه'],
  ['نیلوفر نمونه', 'گالری نمونه نیلوفر', 'CONTACTED', 'وب‌سایت'],
  ['سعید نمونه', 'شرکت نمونه سعید', 'QUALIFIED', 'معرفی مشتری'],
  ['مینا نمونه', 'مطب نمونه مینا', 'QUALIFIED', 'وب‌سایت'],
  ['فرهاد نمونه', 'کارگاه نمونه فرهاد', 'DISQUALIFIED', 'تماس ورودی'],
  ['الهام نمونه', 'بازرگانی نمونه الهام', 'NEW', 'نمایشگاه'],
];

/** [title, customerKey, stageName, toman, closeInDays, ownerIdx] */
const DEALS: Array<[string, string, string, number, number, number]> = [
  ['استقرار سیستم برای واحد فروش', 'c1', 'مذاکره', 180_000_000, 12, 0],
  ['قرارداد پشتیبانی سالانه', 'c2', 'ارائه پیشنهاد', 96_000_000, 20, 1],
  ['آموزش و راه‌اندازی شعب', 'c3', 'ارزیابی نیاز', 64_000_000, 35, 2],
  ['نسخه حرفه‌ای برای ۴۰ کاربر', 'c4', 'مذاکره', 320_000_000, 9, 0],
  ['اتصال به سیستم حسابداری', 'c5', 'شناسایی', 45_000_000, 45, 1],
  ['پروژه یکپارچه‌سازی تولید', 'c6', 'ارائه پیشنهاد', 210_000_000, 25, 2],
  ['مجوز برای دفتر مهندسی', 'c7', 'برنده شد', 72_000_000, -10, 0],
  ['سیستم رزرو و ارتباط با مهمان', 'c8', 'برنده شد', 128_000_000, -24, 1],
  ['مشاوره مستقل', 'c9', 'از دست رفت', 12_000_000, -18, 2],
  ['بسته طراحی و آموزش', 'c10', 'ارزیابی نیاز', 18_000_000, 30, 1],
  ['مدیریت ناوگان و مشتریان', 'c11', 'شناسایی', 150_000_000, 50, 0],
  ['سامانه نوبت‌دهی و پرونده', 'c12', 'مذاکره', 88_000_000, 14, 2],
];

export interface DemoSeedContext {
  organizationId: string;
  /** Sales users that own the records (order matters for the tables above). */
  ownerIds: string[];
  demoUserId: string;
}

/** Fills an emptied demo organization. Runs inside the caller's transaction. */
export async function seedDemoData(
  tx: Prisma.TransactionClient,
  ctx: DemoSeedContext,
): Promise<void> {
  const org = ctx.organizationId;
  const now = Date.now();
  const owner = (i: number) => ctx.ownerIds[i % ctx.ownerIds.length];

  // Lead sources are editable by visitors, so the reset restores the defaults.
  await tx.leadSource.createMany({
    data: DEFAULT_LEAD_SOURCES.map((name) => ({ organizationId: org, name })),
  });
  const sources = await tx.leadSource.findMany({ where: { organizationId: org } });
  const sourceId = (name: string) => sources.find((s) => s.name === name)?.id ?? null;
  const stages = await tx.pipelineStage.findMany({ where: { organizationId: org } });
  const stageId = (name: string) => {
    const s = stages.find((x) => x.name === name);
    if (!s) throw new Error(`pipeline stage ${name} is missing`);
    return s;
  };

  const customerIds = new Map<string, string>();
  const contactIds = new Map<string, string>();
  for (const [i, c] of CUSTOMERS.entries()) {
    const customer = await tx.customer.create({
      data: {
        organizationId: org,
        kind: c.kind,
        name: c.name,
        email: c.email,
        phone: c.phone,
        city: c.city,
        province: c.province,
        ownerId: owner(i),
        createdById: ctx.demoUserId,
        searchText: customerSearchText({
          name: c.name,
          email: c.email,
          phone: c.phone,
          city: c.city,
        }),
        createdAt: new Date(now - (40 - i) * DAY),
      },
    });
    customerIds.set(c.key, customer.id);
    const [firstName, lastName, jobTitle, mobile] = c.contact;
    const contact = await tx.contact.create({
      data: {
        organizationId: org,
        customerId: customer.id,
        firstName,
        lastName,
        jobTitle,
        mobile,
        email: c.email,
        isPrimary: true,
        searchText: contactSearchText({ firstName, lastName, jobTitle, email: c.email, mobile }),
      },
    });
    contactIds.set(c.key, contact.id);
  }

  const CAMPAIGNS: Array<
    [
      name: string,
      channel: string,
      status: 'PLANNED' | 'ACTIVE' | 'COMPLETED',
      startAgo: number,
      endIn: number,
      toman: number,
      notes: string,
    ]
  > = [
    ['کمپین نمایشگاه فناوری', 'نمایشگاه', 'COMPLETED', 60, -20, 120_000_000, 'غرفه و معرفی محصول'],
    ['کمپین پیامک بهاره', 'پیامک', 'ACTIVE', 15, 15, 30_000_000, 'معرفی نسخه جدید به مشتریان'],
    ['وبینار معرفی ایشان', 'وبینار', 'ACTIVE', 7, 7, 10_000_000, 'آموزش و پاسخ به پرسش‌ها'],
    ['کمپین معرفی مشتری', 'ارجاع', 'PLANNED', -10, 40, 15_000_000, 'پاداش برای معرفی مشتری'],
  ];
  const campaignIds: string[] = [];
  for (const [i, [name, channel, status, startAgo, endIn, toman, notes]] of CAMPAIGNS.entries()) {
    const c = await tx.campaign.create({
      data: {
        organizationId: org,
        name,
        channel,
        status,
        startDate: new Date(now - startAgo * DAY),
        endDate: new Date(now + endIn * DAY),
        budget: rial(toman),
        ownerId: owner(i),
        createdById: ctx.demoUserId,
        notes,
        searchText: campaignSearchText({ name, channel, notes }),
      },
    });
    campaignIds.push(c.id);
  }

  for (const [i, [name, company, status, source]] of LEADS.entries()) {
    const phone = `0900000${String(100 + i)}`;
    await tx.lead.create({
      data: {
        organizationId: org,
        name,
        company,
        phone,
        email: `lead${i + 1}@example.invalid`,
        status,
        sourceId: sourceId(source),
        campaignId: i % 4 === 3 ? null : (campaignIds[i % 3] ?? null),
        ownerId: owner(i),
        createdById: ctx.demoUserId,
        disqualifyReason: status === 'DISQUALIFIED' ? 'بودجه ندارد' : null,
        searchText: leadSearchText({
          name,
          company,
          phone: normalizePhone(phone),
          sourceName: source,
        }),
        createdAt: new Date(now - (12 - i) * DAY),
      },
    });
  }

  const dealIds = new Map<string, string>();
  for (const [i, [title, ck, stageName, toman, closeIn, ownerIdx]] of DEALS.entries()) {
    const stage = stageId(stageName);
    const closed = stage.kind !== 'OPEN';
    const deal = await tx.deal.create({
      data: {
        organizationId: org,
        title,
        customerId: customerIds.get(ck)!,
        contactId: contactIds.get(ck)!,
        stageId: stage.id,
        amount: rial(toman),
        expectedCloseDate: new Date(now + closeIn * DAY),
        ownerId: owner(ownerIdx),
        createdById: ctx.demoUserId,
        closedAt: closed ? new Date(now + closeIn * DAY) : null,
        lostReason: stage.kind === 'LOST' ? 'انتخاب راهکار دیگر' : null,
        createdAt: new Date(now - (60 - i * 3) * DAY),
      },
    });
    dealIds.set(ck, deal.id);
    await tx.dealStageEvent.create({
      data: {
        dealId: deal.id,
        toStageId: stage.id,
        actorId: owner(ownerIdx),
        createdAt: deal.createdAt,
      },
    });
  }

  const A: Array<
    [
      type: 'CALL' | 'MEETING' | 'TASK' | 'NOTE',
      title: string,
      ck: string,
      offsetDays: number,
      done: boolean,
    ]
  > = [
    ['CALL', 'تماس برای هماهنگی جلسه معرفی', 'c1', 1, false],
    ['MEETING', 'جلسه ارائه نسخه نمایشی', 'c4', 2, false],
    ['TASK', 'ارسال پیش‌فاکتور اصلاح‌شده', 'c2', 0, false],
    ['TASK', 'پیگیری تایید مدیرعامل', 'c6', 3, false],
    ['CALL', 'پیگیری پرداخت پیش‌پرداخت', 'c7', -1, false],
    ['MEETING', 'جلسه تعیین دامنه پروژه', 'c12', 5, false],
    ['CALL', 'تماس اولیه و شناخت نیاز', 'c3', -6, true],
    ['MEETING', 'بازدید از محل و ارزیابی', 'c8', -20, true],
    ['NOTE', 'مشتری حساس به زمان تحویل است؛ برنامه زمان‌بندی دقیق ارائه شود', 'c1', -4, true],
    ['NOTE', 'درخواست تخفیف حجمی مطرح شد', 'c4', -2, true],
    ['TASK', 'تهیه گزارش پایان پروژه', 'c8', -9, true],
    ['CALL', 'تماس تشکر پس از امضای قرارداد', 'c7', -10, true],
  ];
  for (const [i, [type, title, ck, off, done]] of A.entries()) {
    const at = new Date(now + off * DAY);
    await tx.activity.create({
      data: {
        organizationId: org,
        type,
        status: done || type === 'NOTE' ? 'DONE' : 'PLANNED',
        priority: i % 4 === 0 ? 'HIGH' : 'NORMAL',
        title,
        dueAt: type === 'NOTE' ? null : at,
        completedAt: done || type === 'NOTE' ? at : null,
        assigneeId: owner(i),
        createdById: owner(i),
        customerId: customerIds.get(ck)!,
        contactId: contactIds.get(ck)!,
        dealId: dealIds.get(ck) ?? null,
        searchText: activitySearchText({ title }),
      },
    });
  }

  const productIds: string[] = [];
  for (const p of PRODUCTS) {
    const created = await tx.product.create({
      data: {
        organizationId: org,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        unitPrice: rial(p.price),
        createdById: ctx.demoUserId,
        searchText: normalizeText(`${p.name} ${p.sku}`),
      },
    });
    productIds.push(created.id);
  }

  const QUOTES: Array<
    [
      title: string,
      ck: string,
      status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED',
      lines: Array<[number, number]>,
    ]
  > = [
    [
      'پیش‌فاکتور استقرار واحد فروش',
      'c1',
      'SENT',
      [
        [2, 20],
        [1, 1],
        [4, 1],
      ],
    ],
    ['پیش‌فاکتور پشتیبانی سالانه', 'c2', 'DRAFT', [[4, 1]]],
    ['پیش‌فاکتور مجوز دفتر مهندسی', 'c7', 'ACCEPTED', [[3, 8]]],
    [
      'پیش‌فاکتور سیستم رزرو',
      'c8',
      'ACCEPTED',
      [
        [2, 10],
        [1, 1],
        [5, 1],
      ],
    ],
    [
      'پیش‌فاکتور نسخه حرفه‌ای ۴۰ کاربر',
      'c4',
      'SENT',
      [
        [3, 40],
        [4, 1],
      ],
    ],
  ];
  const accepted: Array<{ id: string; seq: number; title: string; ck: string; total: bigint }> = [];
  for (const [i, [title, ck, status, lines]] of QUOTES.entries()) {
    const seq = i + 1;
    const items = lines.map(([pi, qty], position) => {
      const p = PRODUCTS[pi]!;
      return {
        position,
        productId: productIds[pi]!,
        description: p.name,
        quantity: qty,
        unitPrice: rial(p.price),
        lineTotal: rial(p.price) * BigInt(qty),
      };
    });
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0n);
    const taxAmount = (subtotal * 1000n) / 10_000n;
    const issued = new Date(now - (14 - i * 2) * DAY);
    const createdQuote = await tx.quote.create({
      data: {
        organizationId: org,
        seq,
        version: 1,
        title,
        status,
        customerId: customerIds.get(ck)!,
        contactId: contactIds.get(ck)!,
        dealId: dealIds.get(ck) ?? null,
        ownerId: owner(i),
        createdById: ctx.demoUserId,
        issueDate: issued,
        validUntil: new Date(issued.getTime() + 30 * DAY),
        subtotal,
        taxRateBp: 1000,
        taxAmount,
        total: subtotal + taxAmount,
        sentAt: status === 'DRAFT' ? null : issued,
        decidedAt:
          status === 'ACCEPTED' || status === 'REJECTED'
            ? new Date(issued.getTime() + 5 * DAY)
            : null,
        searchText: normalizeText(
          `QT-${String(seq).padStart(6, '0')} ${title} ${CUSTOMERS.find((c) => c.key === ck)!.name}`,
        ),
        items: { create: items },
      },
    });
  }
  const TEAMS: Array<[string, string, number[]]> = [
    ['فروش سازمانی', 'مشتریان حقوقی و قراردادهای بزرگ', [0, 1]],
    ['فروش خرد', 'مشتریان کوچک و پیگیری سرنخ‌های ورودی', [1, 2]],
    ['پشتیبانی مشتریان', 'پاسخ‌گویی و پیگیری پس از فروش', [2, 0]],
  ];
  for (const [name, description, members] of TEAMS) {
    const lead = owner(members[0]!)!;
    const userIds = [...new Set([lead, ...members.slice(1).map((m) => owner(m)!), ctx.demoUserId])];
    await tx.team.create({
      data: {
        organizationId: org,
        name,
        description,
        members: {
          create: userIds.map((userId) => ({
            userId,
            role: userId === lead ? ('LEAD' as const) : ('MEMBER' as const),
          })),
        },
      },
    });
  }
  await tx.documentCounter.upsert({
    where: { organizationId_kind: { organizationId: org, kind: 'quote' } },
    create: { organizationId: org, kind: 'quote', value: QUOTES.length },
    update: { value: QUOTES.length },
  });

  // Contracts come from accepted quotes (one per quote), like in the product.
  for (const [i, q] of accepted.entries()) {
    const seq = i + 1;
    const customerName = CUSTOMERS.find((c) => c.key === q.ck)!.name;
    await tx.contract.create({
      data: {
        organizationId: org,
        seq,
        title: q.title.replace('پیش‌فاکتور', 'قرارداد'),
        status: i === 0 ? 'ACTIVE' : 'DRAFT',
        customerId: customerIds.get(q.ck)!,
        quoteId: q.id,
        amount: q.total,
        startDate: new Date(now - 5 * DAY),
        endDate: new Date(now + (i === 0 ? 25 : 360) * DAY),
        terms: 'پرداخت در سه مرحله؛ پشتیبانی یک‌ساله شامل است.',
        signedAt: i === 0 ? new Date(now - 4 * DAY) : null,
        createdById: ctx.demoUserId,
        searchText: normalizeText(
          `${contractNumber(seq)} ${quoteNumber(q.seq)} ${q.title} ${customerName}`,
        ),
      },
    });
  }
  await tx.documentCounter.upsert({
    where: { organizationId_kind: { organizationId: org, kind: 'contract' } },
    create: { organizationId: org, kind: 'contract', value: accepted.length },
    update: { value: accepted.length },
  });

  const TAGS: Array<[name: string, color: string, customerKeys: string[]]> = [
    ['مشتری ویژه', '#b45309', ['c1', 'c4']],
    ['در حال مذاکره', '#2563eb', ['c2', 'c7', 'c8']],
    ['نیازمند پیگیری', '#dc2626', ['c3', 'c5']],
  ];
  for (const [name, color, keys] of TAGS) {
    const tag = await tx.tag.create({ data: { organizationId: org, name, color } });
    await tx.customerTag.createMany({
      data: keys
        .filter((k) => customerIds.has(k))
        .map((k) => ({ customerId: customerIds.get(k)!, tagId: tag.id })),
    });
  }

  // Internal-only automations (notify / create_task); they are what the visitor can switch on.
  const WORKFLOWS = [
    {
      name: 'اعلان پذیرش پیش‌فاکتور',
      description: 'وقتی مشتری پیش‌فاکتور را می‌پذیرد، مسئول آن مطلع می‌شود.',
      triggerType: 'quote.accepted',
      conditions: [],
      actions: [
        {
          type: 'notify',
          to: 'owner',
          title: 'پیش‌فاکتور {{number}} پذیرفته شد',
          body: '{{title}}',
        },
      ],
      enabled: true,
    },
    {
      name: 'پیگیری سرنخ تازه',
      description: 'برای هر سرنخ جدید یک وظیفهٔ پیگیری ساخته می‌شود.',
      triggerType: 'lead.created',
      conditions: [],
      actions: [
        {
          type: 'create_task',
          title: 'تماس با {{name}}',
          dueInDays: 1,
          priority: 'HIGH',
          assignee: 'owner',
        },
      ],
      enabled: false,
    },
  ];
  for (const w of WORKFLOWS) {
    await tx.workflow.create({
      data: { organizationId: org, createdById: ctx.demoUserId, ...w },
    });
  }

  await tx.notification.createMany({
    data: [
      {
        userId: ctx.demoUserId,
        type: 'system',
        title: 'به نسخهٔ نمایشی ایشان خوش آمدید',
        body: 'همهٔ داده‌ها فرضی است و هر ساعت به حالت اول برمی‌گردد.',
        createdAt: new Date(now - 60_000),
      },
      {
        userId: ctx.demoUserId,
        type: 'workflow',
        title: 'پیش‌فاکتور QT-000003 پذیرفته شد',
        body: 'پیش‌فاکتور مجوز دفتر مهندسی',
        createdAt: new Date(now - 2 * 3_600_000),
      },
    ],
  });
}
