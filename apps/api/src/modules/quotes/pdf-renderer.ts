import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

const MAX_CONCURRENT = 2;
const RENDER_TIMEOUT_MS = 20_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export class PdfUnavailableError extends Error {
  constructor(message = 'pdf renderer is not available') {
    super(message);
  }
}

/**
 * Renders one self-contained HTML string to an A4 PDF in headless Chromium (ADR 0016).
 * Hardening: JavaScript off, network off, a fresh context per render, at most two renders at once,
 * a hard timeout and a size cap. The markup is built by us from escaped data, never user HTML.
 */
export class PdfRenderer {
  private browser: Promise<Browser> | null = null;
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly executablePath: string | undefined) {}

  get available(): boolean {
    return Boolean(this.executablePath) && existsSync(this.executablePath!);
  }

  private launch(): Promise<Browser> {
    if (!this.available) return Promise.reject(new PdfUnavailableError());
    this.browser ??= chromium
      .launch({
        executablePath: this.executablePath,
        headless: true,
        // The sandbox needs user namespaces that containers usually lack; the page is our own
        // escaped markup with JavaScript and network disabled.
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      })
      .then((b) => {
        b.on('disconnected', () => (this.browser = null));
        return b;
      })
      .catch((e) => {
        this.browser = null;
        throw e;
      });
    return this.browser;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  render(html: string): Promise<Buffer> {
    return this.slot(async () => {
      const browser = await this.launch();
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
      try {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(RENDER_TIMEOUT_MS);
        await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        });
        if (pdf.length > MAX_PDF_BYTES) throw new Error('pdf is too large');
        return pdf;
      } finally {
        await context.close().catch(() => undefined);
      }
    });
  }

  /** Nest calls this on shutdown so no Chromium process outlives the API. */
  onApplicationShutdown(): Promise<void> {
    return this.close();
  }

  async close(): Promise<void> {
    const b = await this.browser?.catch(() => null);
    this.browser = null;
    await b?.close().catch(() => undefined);
  }
}
