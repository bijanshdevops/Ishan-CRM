export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export const themes = ['light', 'dark'] as const;
export type Theme = (typeof themes)[number];
