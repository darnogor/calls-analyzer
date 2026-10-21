import { Body, Controller, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { AccountsService } from './accounts.service';

@Controller('api/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.accounts.list(req.account);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.accounts.create(req.account, body);
  }

  @Patch(':accountId')
  update(@Req() req: AuthedRequest, @Param('accountId') accountId: string, @Body() body: unknown) {
    return this.accounts.update(req.account, accountId, body);
  }

  @Put(':accountId/projects')
  replaceProjects(
    @Req() req: AuthedRequest,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ) {
    return this.accounts.replaceProjects(req.account, accountId, body);
  }
}
