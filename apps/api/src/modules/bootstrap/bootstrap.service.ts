import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_STAGES, PasswordSchema, SYSTEM_ROLES } from '@ishan/contracts';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { PasswordService } from '../auth/password.service';

/**
 * Idempotent startup provisioning:
 *  - ensures the organization and the system roles (permissions are synced from code),
 *  - creates the first admin from BOOTSTRAP_ADMIN_* only when the organization has no users.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  async run(): Promise<void> {
    let org = await this.prisma.organization.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!org) {
      org = await this.prisma.organization.create({
        data: { name: this.config.BOOTSTRAP_ORG_NAME },
      });
      this.logger.log(`Created organization ${org.id}`);
    }

    for (const def of SYSTEM_ROLES) {
      await this.prisma.role.upsert({
        where: { organizationId_key: { organizationId: org.id, key: def.key } },
        create: {
          organizationId: org.id,
          key: def.key,
          name: def.name,
          description: def.description,
          isSystem: true,
          permissions: def.permissions,
        },
        update: {
          name: def.name,
          description: def.description,
          isSystem: true,
          permissions: def.permissions,
        },
      });
    }

    // Default sales pipeline (configuration, editable by admins) - only when none exists.
    const stageCount = await this.prisma.pipelineStage.count({ where: { organizationId: org.id } });
    if (stageCount === 0) {
      await this.prisma.pipelineStage.createMany({
        data: DEFAULT_STAGES.map((s, position) => ({ organizationId: org.id, position, ...s })),
      });
    }

    const userCount = await this.prisma.user.count({ where: { organizationId: org.id } });
    if (userCount > 0) return;

    const { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: password } = this.config;
    if (!email || !password) {
      this.logger.warn(
        'No users exist and BOOTSTRAP_ADMIN_EMAIL/PASSWORD are not set; nobody can log in.',
      );
      return;
    }
    const check = PasswordSchema.safeParse(password);
    if (!check.success) {
      throw new Error(`BOOTSTRAP_ADMIN_PASSWORD rejected: ${check.error.issues[0]?.message}`);
    }
    const adminRole = await this.prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org.id, key: 'admin' } },
    });
    const admin = await this.prisma.user.create({
      data: {
        organizationId: org.id,
        roleId: adminRole.id,
        email: email.toLowerCase(),
        name: 'مدیر سیستم',
        passwordHash: await this.passwords.hash(password),
        mustChangePassword: true,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: null,
        action: 'system.bootstrap_admin_created',
        entityType: 'user',
        entityId: admin.id,
      },
    });
    this.logger.log(
      `Created bootstrap admin ${admin.email} (password change required at first login)`,
    );
  }
}
