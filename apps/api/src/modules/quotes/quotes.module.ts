import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ProductsService } from './products.service';
import { ContractsController, ProductsController, QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [ProductsController, QuotesController, ContractsController],
  providers: [ProductsService, QuotesService, ContractsService],
})
export class QuotesModule {}
