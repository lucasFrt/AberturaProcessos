import type { Request, Response } from 'express';
import type { PassportStatic } from 'passport';

import { AppError } from '@/domain/errors/app-error';
import { SocialAuthController } from '@/http/controllers/social-auth-controller';
import type { SocialLoginResult } from '@/services/social-auth-service';

/**
 * Cobre `SocialAuthController` (docs/06, "Login social"; docs/05, rotas
 * `/auth/:provider*`): `providers()`, `start()` (com/sem `redirect`
 * sanitizado) e `callback()` nos quatro desfechos possíveis do resultado
 * do Passport (erro, sem resultado, PENDING, ACTIVE).
 */
describe('SocialAuthController', () => {
  interface MockRes {
    res: Response;
    status: jest.Mock;
    json: jest.Mock;
    redirect: jest.Mock;
    cookie: jest.Mock;
    body?: unknown;
    redirectedTo?: string;
  }

  function buildRes(): MockRes {
    const mock: MockRes = {
      res: {} as Response,
      status: jest.fn(),
      json: jest.fn(),
      redirect: jest.fn(),
      cookie: jest.fn(),
    };
    mock.status.mockImplementation(() => mock.res);
    mock.json.mockImplementation((body: unknown) => {
      mock.body = body;
      return mock.res;
    });
    mock.redirect.mockImplementation((url: string) => {
      mock.redirectedTo = url;
      return mock.res;
    });
    mock.cookie.mockImplementation(() => mock.res);
    mock.res.status = mock.status;
    mock.res.json = mock.json;
    mock.res.redirect = mock.redirect;
    mock.res.cookie = mock.cookie;
    return mock;
  }

  it('providers() responde com local=true e os provedores configurados', () => {
    const controller = new SocialAuthController({} as PassportStatic, {
      google: true,
      microsoft: false,
    });
    const mock = buildRes();

    controller.providers({} as Request, mock.res);

    expect(mock.status).toHaveBeenCalledWith(200);
    expect(mock.body).toEqual({ local: true, google: true, microsoft: false });
  });

  describe('start()', () => {
    it('chama passport.authenticate com o state derivado do redirect sanitizado', () => {
      const authenticateMiddleware = jest.fn();
      const authenticate = jest.fn().mockReturnValue(authenticateMiddleware);
      const controller = new SocialAuthController({ authenticate } as unknown as PassportStatic, {
        google: true,
        microsoft: false,
      });

      const req = { query: { redirect: '/board' } } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      controller.start('google')(req, mock.res, next);

      expect(authenticate).toHaveBeenCalledWith('google', { session: false, state: '/board' });
      expect(authenticateMiddleware).toHaveBeenCalledWith(req, mock.res, next);
    });

    it('usa state=undefined quando o redirect não é válido', () => {
      const authenticateMiddleware = jest.fn();
      const authenticate = jest.fn().mockReturnValue(authenticateMiddleware);
      const controller = new SocialAuthController({ authenticate } as unknown as PassportStatic, {
        google: true,
        microsoft: false,
      });

      const req = { query: { redirect: 'https://evil.com' } } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      controller.start('google')(req, mock.res, next);

      expect(authenticate).toHaveBeenCalledWith('google', { session: false, state: undefined });
    });

    it('lança TypeError quando passport.authenticate não retorna uma função', () => {
      const authenticate = jest.fn().mockReturnValue('nao-e-funcao');
      const controller = new SocialAuthController({ authenticate } as unknown as PassportStatic, {
        google: true,
        microsoft: false,
      });

      const req = { query: {} } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      expect(() => controller.start('google')(req, mock.res, next)).toThrow(TypeError);
    });
  });

  describe('callback()', () => {
    function buildControllerWithCallbackResult(
      result: SocialLoginResult | false,
      error: unknown = null,
    ): { controller: SocialAuthController; capturedHandler: () => void } {
      // Wrapper de objeto: `authenticate` só é chamado (e só então popula o
      // handler real) quando o RequestHandler devolvido por `callback()` é
      // invocado — precisa ser uma referência mutável, não um valor
      // capturado antes dessa chamada.
      const holder: { handler: (() => void) | null } = { handler: null };
      const middleware = jest.fn();
      const authenticate = jest.fn(
        (
          _provider: string,
          _options: unknown,
          handler: (error: unknown, result?: SocialLoginResult | false) => void,
        ) => {
          holder.handler = () => handler(error, result);
          return middleware;
        },
      );
      const controller = new SocialAuthController({ authenticate } as unknown as PassportStatic, {
        google: true,
        microsoft: false,
      });
      return {
        controller,
        capturedHandler: () => {
          if (!holder.handler) throw new Error('authenticate() ainda não foi chamado.');
          holder.handler();
        },
      };
    }

    it('redireciona com status=error e o code do AppError quando authenticate retorna erro', () => {
      const appError = new AppError('EMAIL_NOT_VERIFIED', 'Sem e-mail verificado.', 400);
      const { controller, capturedHandler } = buildControllerWithCallbackResult(false, appError);
      const req = { query: {} } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      controller.callback('google')(req, mock.res, next);
      capturedHandler();

      expect(mock.redirectedTo).toContain('status=error');
      expect(mock.redirectedTo).toContain('code=EMAIL_NOT_VERIFIED');
    });

    it('redireciona com status=error e code=INTERNAL_ERROR quando o erro não é AppError', () => {
      const { controller, capturedHandler } = buildControllerWithCallbackResult(
        false,
        new Error('erro genérico'),
      );
      const req = { query: {} } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      controller.callback('google')(req, mock.res, next);
      capturedHandler();

      expect(mock.redirectedTo).toContain('code=INTERNAL_ERROR');
    });

    it('redireciona com status=error e code=UNAUTHENTICATED quando não há resultado', () => {
      const { controller, capturedHandler } = buildControllerWithCallbackResult(false, null);
      const req = { query: {} } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      controller.callback('google')(req, mock.res, next);
      capturedHandler();

      expect(mock.redirectedTo).toContain('code=UNAUTHENTICATED');
    });

    it('redireciona com status=pending quando o resultado é PENDING', () => {
      const { controller, capturedHandler } = buildControllerWithCallbackResult({
        status: 'PENDING',
      });
      const req = { query: {} } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      controller.callback('google')(req, mock.res, next);
      capturedHandler();

      expect(mock.redirectedTo).toContain('status=pending');
      expect(mock.cookie).not.toHaveBeenCalled();
    });

    it('grava o cookie de refresh token e redireciona com status=ok quando ACTIVE', () => {
      const activeResult: SocialLoginResult = {
        status: 'ACTIVE',
        user: {} as never,
        tokens: { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 },
      };
      const { controller, capturedHandler } = buildControllerWithCallbackResult(activeResult);
      const req = { query: {} } as unknown as Request;
      const mock = buildRes();
      const next = jest.fn();

      controller.callback('google')(req, mock.res, next);
      capturedHandler();

      expect(mock.cookie).toHaveBeenCalled();
      expect(mock.redirectedTo).toContain('status=ok');
    });
  });
});
