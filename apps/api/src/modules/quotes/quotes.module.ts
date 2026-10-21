import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { ContractsService } from './contracts.service';
import { PdfRenderer } from './pdf-renderer';
import { ProductsService } from './products.service';
import { QuoteDeliveryController } from './quote-delivery.controller';
import { PDF_RENDERER, QuoteDeliveryService } from './quote-delivery.service';
import { ContractsController, ProductsController, QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [ProductsController, QuotesController, QuoteDeliveryController, ContractsController],
  providers: [
    ProductsService,
    QuotesService,
    ContractsService,
    QuoteDeliveryService,
    {
      provide: PDF_RENDERER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new PdfRenderer(config.PDF_CHROMIUM_PATH),
    },
  ],
})
export class QuotesModule {}
