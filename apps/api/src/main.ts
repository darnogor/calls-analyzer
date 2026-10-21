import 'reflect-metadata';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig } from './config';
import { ApiExceptionFilter } from './http/exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: false, limit: '2mb' }));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(422).json({ error: 'invalid_payload' });
      return;
    }
    const named = error as { name?: string };
    if (named.name === 'MulterError') {
      res.status(413).json({ error: 'upload_too_large' });
      return;
    }
    next(error);
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const config = app.get(AppConfig);
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
