import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { PasswordService } from '../auth/password.service';
import {
  DEMO_PERMISSIONS,
  DEMO_RESET_TABLES,
  DEMO_ROLE_KEY,
  DEMO_USER_EMAIL,
  DEMO_USER_NAME,
} from './demo.constants';
import { seedDemoData } from './demo-seed';

/** Fictional colleagues that own the demo records. Nobody can sign in as them (random, discarded passwords). */
const DEMO_COLLEAGUES = [
  { email: 'sara@ishan-demo.invalid', name: 'سارا محمدی' },
  { email: 'omid@ishan-demo.invalid', name: 'امید رحیمی' },
  { email: 'tina@ishan-demo.invalid', name: 'تینا کرمی' },
];

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Defence in depth next to the config check: never wipe anything outside a `_demo` database. */
  private async assertDemoDatabase(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    const name = rows[0]?.name ?? '';
    if (!this.config.DEMO_MODE || !name.endsWith('_demo')) {
      throw new Error(
        `refusing demo operation: DEMO_MODE=${this.config.DEMO_MODE}, database=${name}`,
      );
    }
  }

  private async unusablePasswordHash(): Promise<string> {
    return this.passwords.hash(randomBytes(32).toString('base64url'));
  }

  /** Ensures the organization-level pieces of the demo (role, users) exist. Idempotent. */
  async provision(): Promise<{ organizationId: string; demoUserId: string; ownerIds: string[] }> {
    await this.assertDemoDatabase();
    const org = await this.prisma.organization.findFirstOrThrow({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const demoRole = await this.prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: DEMO_ROLE_KEY } },
      create: {
        organizationId: org.id,
        key: DEMO_ROLE_KEY,
        name: 'مهمان دمو',
        description: 'دسترسی محدود برای نسخه نمایشی',
        isSystem: true,
        permissions: DEMO_PERMISSIONS,
        dataScope: 'ALL',
      },
      update: { permissions: DEMO_PERMISSIONS, dataScope: 'ALL' },
    });
    const salesRole = await this.prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org.id, key: 'sales' } },
    });

    const ensureUser = async (email: string, name: string, roleId: string) => {
      const existing = await this.prisma.user.findUnique({
        where: { organizationId_email: { organizationId: org.id, email } },
      });
      if (existing) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { roleId, name, status: 'ACTIVE', deletedAt: null, mustChangePassword: false },
        });
      }
      return this.prisma.user.create({
        data: {
          organizationId: org.id,
          roleId,
          email,
          name,
          passwordHash: await this.unusablePasswordHash(),
          emailVerifiedAt: new Date(),
        },
      });
    };

    const demoUser = await ensureUser(DEMO_USER_EMAIL, DEMO_USER_NAME, demoRole.id);
    const owners = [];
    for (const c of DEMO_COLLEAGUES) owners.push(await ensureUser(c.email, c.name, salesRole.id));
    return { organizationId: org.id, demoUserId: demoUser.id, ownerIds: owners.map((o) => o.id) };
  }

  /** Empties the business data and loads the fictional data set again. Sessions of the visitors stay valid. */
  async reset(): Promise<void> {
    const ctx = await this.provision();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `TRUNCATE TABLE ${DEMO_RESET_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
        );
        await seedDemoData(tx, ctx);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    this.logger.log('Demo data reset');
  }

  /** The demo user, for the auto-login endpoint. */
  async demoUserId(): Promise<string> {
    await this.assertDemoDatabase();
    const user = await this.prisma.user.findFirst({
      where: { email: DEMO_USER_EMAIL, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new Error('demo user is not provisioned');
    return user.id;
  }
}
