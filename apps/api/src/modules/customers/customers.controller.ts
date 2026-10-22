import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateContactRequestSchema,
  CreateCustomerRequestSchema,
  CreateTagRequestSchema,
  CustomerListQuerySchema,
  ImportCustomersRequestSchema,
  PERMISSIONS,
  SetCustomerTagsRequestSchema,
  UpdateContactRequestSchema,
  UpdateCustomerRequestSchema,
  UpdateTagRequestSchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ContactsService } from './contacts.service';
import { CustomersIoService } from './customers-io.service';
import { CustomersService } from './customers.service';
import { TagsService } from './tags.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly io: CustomersIoService,
    private readonly contacts: ContactsService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.CUSTOMERS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(CustomerListQuerySchema)) q: Infer<typeof CustomerListQuerySchema>,
  ) {
    return this.customers.list(actor, q);
  }

  @Get('export')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="customers.csv"')
  @Header('Cache-Control', 'no-store')
  exportCsv(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(CustomerListQuerySchema)) q: Infer<typeof CustomerListQuerySchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.io.export(actor, q, req.ip);
  }

  @Post('import')
  @RequirePermission(PERMISSIONS.CUSTOMERS_IMPORT)
  @HttpCode(200)
  importCsv(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(ImportCustomersRequestSchema))
    body: Infer<typeof ImportCustomersRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.io.import(actor, body, req.ip);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.customers.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CUSTOMERS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateCustomerRequestSchema))
    body: Infer<typeof CreateCustomerRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.customers.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateCustomerRequestSchema))
    body: Infer<typeof UpdateCustomerRequestSchema>,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.customers.update(actor, id, body, req.ip, ifMatch);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_DELETE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.customers.remove(actor, id, req.ip);
  }

  @Put(':id/tags')
  @RequirePermission(PERMISSIONS.CUSTOMERS_WRITE)
  setTags(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(SetCustomerTagsRequestSchema))
    body: Infer<typeof SetCustomerTagsRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.customers.setTags(actor, id, body.tagIds, req.ip);
  }

  @Get(':id/contacts')
  @RequirePermission(PERMISSIONS.CUSTOMERS_READ)
  listContacts(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.contacts.listForCustomer(actor, id);
  }

  @Post(':id/contacts')
  @RequirePermission(PERMISSIONS.CUSTOMERS_WRITE)
  createContact(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(CreateContactRequestSchema))
    body: Infer<typeof CreateContactRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.contacts.create(actor, id, body, req.ip);
  }
}

@ApiTags('contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateContactRequestSchema))
    body: Infer<typeof UpdateContactRequestSchema>,
    @Req() req: FastifyRequest,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.contacts.update(actor, id, body, req.ip, ifMatch);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_WRITE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.contacts.remove(actor, id, req.ip);
  }
}

@ApiTags('tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CUSTOMERS_READ)
  list(@CurrentUser() actor: AuthUser) {
    return this.tags.list(actor);
  }

  @Post()
  @RequirePermission(PERMISSIONS.TAGS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateTagRequestSchema)) body: Infer<typeof CreateTagRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.tags.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TAGS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateTagRequestSchema)) body: Infer<typeof UpdateTagRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.tags.update(actor, id, body, req.ip);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TAGS_WRITE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.tags.remove(actor, id, req.ip);
  }
}

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CUSTOMERS_READ)
  search(@CurrentUser() actor: AuthUser, @Query('q') q = '') {
    return this.customers.search(actor, String(q).slice(0, 100));
  }
}
