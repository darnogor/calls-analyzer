import 'reflect-metadata';
import { Controller, Get, Module, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';

@Controller()
class HealthController {
  @Get('health')
  health(@Res() res: Response): void {
    res.type('text/plain').send('ok');
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

void bootstrap();
