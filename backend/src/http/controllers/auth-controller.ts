import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError } from '@/domain/errors/app-error';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import {
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  setRefreshTokenCookie,
} from '@/http/controllers/auth-cookies';
import { presentLoginResponse, presentMeResponse } from '@/http/presenters/auth-presenter';
import type { LoginBody, RegisterBody } from '@/http/schemas/auth-schemas';
import type { AuthService } from '@/services/auth-service';

function requestContext(req: Request): { userAgent: string | null; ipAddress: string | null } {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? null,
  };
}

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  register = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleRegister(req, res, next);
  };

  private async handleRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as RegisterBody;
      const result = await this.authService.register({ ...body, ...requestContext(req) });

      if (result.status === 'PENDING') {
        res.status(202).json({
          status: 'PENDING',
          message: 'Conta criada. Aguarde a aprovação de um administrador.',
        });
        return;
      }

      setRefreshTokenCookie(res, result.tokens.refreshToken);
      const organization = result.user.organizationId
        ? await this.organizationRepository.findById(result.user.organizationId)
        : null;

      res.status(201).json({
        status: 'ACTIVE',
        message: organization
          ? `Conta criada e vinculada à organização ${organization.name}.`
          : 'Conta criada.',
        ...presentLoginResponse({
          user: result.user,
          accessToken: result.tokens.accessToken,
          expiresInSeconds: result.tokens.expiresInSeconds,
          organizationName: organization?.name ?? null,
        }),
      });
    } catch (error) {
      next(error);
    }
  }

  login = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleLogin(req, res, next);
  };

  private async handleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as LoginBody;
      const { user, tokens } = await this.authService.login({ ...body, ...requestContext(req) });

      setRefreshTokenCookie(res, tokens.refreshToken);
      const organization = user.organizationId
        ? await this.organizationRepository.findById(user.organizationId)
        : null;

      res.status(200).json(
        presentLoginResponse({
          user,
          accessToken: tokens.accessToken,
          expiresInSeconds: tokens.expiresInSeconds,
          organizationName: organization?.name ?? null,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  refresh = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleRefresh(req, res, next);
  };

  private async handleRefresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = getRefreshTokenFromCookie(req.cookies);
      if (!refreshToken) {
        throw new UnauthenticatedError();
      }

      const { tokens } = await this.authService.refresh({ refreshToken, ...requestContext(req) });

      setRefreshTokenCookie(res, tokens.refreshToken);
      res.status(200).json({ accessToken: tokens.accessToken, expiresIn: tokens.expiresInSeconds });
    } catch (error) {
      next(error);
    }
  }

  logout = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleLogout(req, res, next);
  };

  private async handleLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = getRefreshTokenFromCookie(req.cookies);
      if (refreshToken) {
        await this.authService.logout(refreshToken);
      }
      clearRefreshTokenCookie(res);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  me = (req: Request, res: Response, next: NextFunction): void => {
    void this.handleMe(req, res, next);
  };

  private async handleMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // authenticate já garantiu req.auth; se ausente é erro de composição de rota.
      if (!req.auth) throw new UnauthenticatedError();

      const result = await this.authService.me(req.auth.userId);
      res.status(200).json(presentMeResponse(result));
    } catch (error) {
      next(error);
    }
  }
}
