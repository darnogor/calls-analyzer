import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AuthMode, type AuthedRequest } from '../auth/auth.guard';
import { sourceFrom } from '../auth/source-tokens';
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

  @Post('by-external-id/:externalId/recording/missing')
  @AuthMode('source')
  @HttpCode(200)
  markRecordingMissing(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('externalId') externalId: string,
  ) {
    return this.calls.markRecordingMissing(sourceFrom(req), projectId, externalId);
  }

  @Post('by-external-id/:externalId/recording')
  @AuthMode('source')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'file', maxCount: 1 }], { limits: { fileSize: UPLOAD_LIMIT_BYTES } }),
  )
  async attachRecording(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('externalId') externalId: string,
    @UploadedFiles() files: { file?: UploadedPart[] } | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.calls.attachRecording(sourceFrom(req), projectId, externalId, {
      contentType: req.headers['content-type'],
      body,
      file: files?.file?.[0],
    });
    res.status(result.status).json(result.body);
  }

  @Get(':callId/recording')
  async recording(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('callId') callId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.calls.openRecording(req.account, projectId, callId);
    res.status(200);
    res.setHeader('Content-Type', file.contentType);
    if (file.contentLength !== undefined) {
      res.setHeader('Content-Length', String(file.contentLength));
    }
    file.stream.on('error', () => {
      res.destroy();
    });
    file.stream.pipe(res);
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
  @AuthMode('session_or_source')
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
    const result = await this.calls.create({ account: req.account, source: req.source }, projectId, {
      contentType: req.headers['content-type'],
      body,
      file: files?.file?.[0],
      payloadFile: files?.payload?.[0],
      idempotencyKey: req.headers['idempotency-key'],
    });
    res.status(result.status).json(result.body);
  }
}
