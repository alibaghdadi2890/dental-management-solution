import { signInRequestSchema } from '@dcm/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { Public } from '../../../platform/http/route-access';
import { SignInService } from '../application/sign-in.service';
import { copySetCookies, forwardedHeaders } from './fetch-bridge';

class SignInDto extends createZodDto(signInRequestSchema) {}

/**
 * The only better-auth endpoints reachable over HTTP, under `/api/v1/auth` (CLAUDE.md §6: auth
 * and health are the only public routes). Sign-up and the organization/admin plugin endpoints are
 * deliberately not exposed; those plugins are driven server-side by `AuthService`.
 */
@Public()
@Controller('auth')
export class AuthHttpController {
  constructor(private readonly signIns: SignInService) {}

  @Post('sign-in/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signIn(
    @Body() body: SignInDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    copySetCookies(await this.signIns.signIn(body, forwardedHeaders(request)), response);
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    copySetCookies(await this.signIns.signOut(forwardedHeaders(request)), response);
  }
}
