export const fa = {
  app: { name: 'ایشان', tagline: 'مدیریت ارتباط با مشتریان' },
  common: {
    loading: 'در حال بارگذاری…',
    save: 'ذخیره',
    cancel: 'انصراف',
    retry: 'تلاش مجدد',
    empty: 'موردی برای نمایش وجود ندارد',
    error: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.',
  },
} as const;

export type Messages = typeof fa;
