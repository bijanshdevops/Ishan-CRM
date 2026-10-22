import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ContractListQuerySchema,
  CreateContractRequestSchema,
  CreateProductRequestSchema,
  CreateQuoteRequestSchema,
  PERMISSIONS,
  ProductListQuerySchema,
  QuoteListQuerySchema,
  QuoteTransitionRequestSchema,
  UpdateContractRequestSchema,
  UpdateProductRequestSchema,
  UpdateQuoteRequestSchema,
} from '@ishan/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentUser, RequirePermission, type AuthUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ContractsService } from './contracts.service';
import { ProductsService } from './products.service';
import { QuotesService } from './quotes.service';

type Infer<T extends z.ZodTypeAny> = z.infer<T>;
const uuid = () => new ParseUUIDPipe();

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.PRODUCTS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ProductListQuerySchema)) q: Infer<typeof ProductListQuerySchema>,
  ) {
    return this.products.list(actor, q);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.PRODUCTS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.products.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PRODUCTS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateProductRequestSchema))
    body: Infer<typeof CreateProductRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.products.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PRODUCTS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateProductRequestSchema))
    body: Infer<typeof UpdateProductRequestSchema>,
    @Req() req: FastifyRequest,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.products.update(actor, id, body, req.ip, ifMatch);
  }
}

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.QUOTES_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(QuoteListQuerySchema)) q: Infer<typeof QuoteListQuerySchema>,
  ) {
    return this.quotes.list(actor, q);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.QUOTES_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.quotes.get(actor, id);
  }

  @Get(':id/versions')
  @RequirePermission(PERMISSIONS.QUOTES_READ)
  versions(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.quotes.versions(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.QUOTES_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateQuoteRequestSchema))
    body: Infer<typeof CreateQuoteRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.quotes.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.QUOTES_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateQuoteRequestSchema))
    body: Infer<typeof UpdateQuoteRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.quotes.update(actor, id, body, req.ip);
  }

  @Post(':id/status')
  @RequirePermission(PERMISSIONS.QUOTES_WRITE)
  @HttpCode(200)
  transition(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(QuoteTransitionRequestSchema))
    body: Infer<typeof QuoteTransitionRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.quotes.transition(actor, id, body.status, req.ip);
  }

  @Post(':id/revise')
  @RequirePermission(PERMISSIONS.QUOTES_WRITE)
  revise(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.quotes.revise(actor, id, req.ip);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.QUOTES_DELETE)
  @HttpCode(204)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.quotes.remove(actor, id, req.ip);
  }
}

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CONTRACTS_READ)
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(ContractListQuerySchema)) q: Infer<typeof ContractListQuerySchema>,
  ) {
    return this.contracts.list(actor, q);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CONTRACTS_READ)
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid()) id: string) {
    return this.contracts.get(actor, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CONTRACTS_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateContractRequestSchema))
    body: Infer<typeof CreateContractRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.contracts.create(actor, body, req.ip);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CONTRACTS_WRITE)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(UpdateContractRequestSchema))
    body: Infer<typeof UpdateContractRequestSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.contracts.update(actor, id, body, req.ip);
  }

  @Post(':id/activate')
  @RequirePermission(PERMISSIONS.CONTRACTS_WRITE)
  @HttpCode(200)
  activate(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.contracts.transition(actor, id, 'activate', req.ip);
  }

  @Post(':id/complete')
  @RequirePermission(PERMISSIONS.CONTRACTS_WRITE)
  @HttpCode(200)
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.contracts.transition(actor, id, 'complete', req.ip);
  }

  @Post(':id/terminate')
  @RequirePermission(PERMISSIONS.CONTRACTS_WRITE)
  @HttpCode(200)
  terminate(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid()) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.contracts.transition(actor, id, 'terminate', req.ip);
  }
}
