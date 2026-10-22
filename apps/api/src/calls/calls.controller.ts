import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthedRequest } from '../auth/auth.guard';
import { CallsService, type UploadedPart } from './calls.service';

const UPLOAD_LIMIT_BYTES = 512 * 1024 * 1024;

@Controller('api/projects/:projectId/calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.calls.list(req.account, projectId, query);
  }

  @Get(':callId')
  get(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('callId') callId: string,
  ) {
    return this.calls.get(req.account, projectId, callId);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'payload', maxCount: 1 },
      ],
      { limits: { fileSize: UPLOAD_LIMIT_BYTES } },
    ),
  )
  async create(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @UploadedFiles() files: { file?: UploadedPart[]; payload?: UploadedPart[] } | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.calls.create(req.account, projectId, {
      contentType: req.headers['content-type'],
      body,
      file: files?.file?.[0],
      payloadFile: files?.payload?.[0],
      idempotencyKey: req.headers['idempotency-key'],
    });
    res.status(result.status).json(result.body);
  }
}
