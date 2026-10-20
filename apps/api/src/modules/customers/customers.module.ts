import { Module } from '@nestjs/common';
import {
  ContactsController,
  CustomersController,
  SearchController,
  TagsController,
} from './customers.controller';
import { ContactsService } from './contacts.service';
import { CustomersIoService } from './customers-io.service';
import { CustomersService } from './customers.service';
import { TagsService } from './tags.service';

@Module({
  controllers: [CustomersController, ContactsController, TagsController, SearchController],
  providers: [CustomersService, CustomersIoService, ContactsService, TagsService],
})
export class CustomersModule {}
