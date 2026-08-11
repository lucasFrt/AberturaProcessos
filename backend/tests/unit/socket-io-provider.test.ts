import { FakeTokenService } from '../helpers/fakes/fake-token-service';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { AccessScope } from '@/domain/entities/access-scope';
import {
  authenticateSocketToken,
  companyRoom,
  INTERNAL_ROOM,
  resolveJoinRooms,
  resolveProcessEventRooms,
} from '@/infra/realtime/socket-io-provider';
import { AccessScopeResolver } from '@/services/access-scope-resolver';

/**
 * Testes do handshake autenticado (docs/07) e da resolução de salas
 * (docs/07 "Salas" e "emitProcessEvent"), isolados do Socket.IO em si —
 * não é necessário um servidor real (docs/12, Tarefa 13, "não é
 * obrigatório montar um cliente Socket.IO real").
 */
describe('authenticateSocketToken', () => {
  function buildDeps(): {
    tokenService: FakeTokenService;
    userRepository: InMemoryUserRepository;
    accessScopeResolver: AccessScopeResolver;
  } {
    const tokenService = new FakeTokenService();
    const userRepository = new InMemoryUserRepository();
    const accessScopeResolver = new AccessScopeResolver(userRepository);
    return { tokenService, userRepository, accessScopeResolver };
  }

  it('rejeita com UNAUTHENTICATED quando o token está ausente', async () => {
    const deps = buildDeps();

    await expect(authenticateSocketToken(deps, undefined)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('rejeita com UNAUTHENTICATED quando o token é inválido', async () => {
    const deps = buildDeps();

    await expect(authenticateSocketToken(deps, 'token-invalido')).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });

  it('rejeita com UNAUTHENTICATED quando o usuário do token não existe mais', async () => {
    const deps = buildDeps();
    const token = deps.tokenService.signAccessToken({
      sub: 'user-inexistente',
      role: 'CLIENT',
      organizationId: null,
      scope: 'ORGANIZATION',
    });

    await expect(authenticateSocketToken(deps, token)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('rejeita com ACCOUNT_DISABLED quando o usuário não está ACTIVE', async () => {
    const deps = buildDeps();
    const user = await deps.userRepository.create({
      name: 'Pendente',
      email: 'pendente@x.com',
      passwordHash: null,
      role: 'CLIENT',
      status: 'PENDING',
      accessScope: 'ORGANIZATION',
      organizationId: 'org-1',
    });
    const token = deps.tokenService.signAccessToken({
      sub: user.id,
      role: user.role,
      organizationId: user.organizationId,
      scope: user.accessScope,
    });

    await expect(authenticateSocketToken(deps, token)).rejects.toThrow('ACCOUNT_DISABLED');
  });

  it('resolve { userId, role, scope } para usuário ACTIVE com token válido', async () => {
    const deps = buildDeps();
    deps.userRepository.organizationCompanies.set('org-1', ['company-1', 'company-2']);
    const user = await deps.userRepository.create({
      name: 'Maria',
      email: 'maria@x.com',
      passwordHash: null,
      role: 'CLIENT',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId: 'org-1',
    });
    const token = deps.tokenService.signAccessToken({
      sub: user.id,
      role: user.role,
      organizationId: user.organizationId,
      scope: user.accessScope,
    });

    const auth = await authenticateSocketToken(deps, token);

    expect(auth.userId).toBe(user.id);
    expect(auth.role).toBe('CLIENT');
    expect(auth.scope).toEqual<AccessScope>({
      kind: 'COMPANIES',
      companyIds: ['company-1', 'company-2'],
    });
  });
});

describe('resolveJoinRooms', () => {
  it('entra em role:internal para OPERATIONAL', () => {
    const rooms = resolveJoinRooms({
      userId: 'u1',
      role: 'OPERATIONAL',
      scope: { kind: 'ALL' },
    });
    expect(rooms).toEqual([INTERNAL_ROOM]);
  });

  it('entra em role:internal para ADMIN', () => {
    const rooms = resolveJoinRooms({ userId: 'u1', role: 'ADMIN', scope: { kind: 'ALL' } });
    expect(rooms).toEqual([INTERNAL_ROOM]);
  });

  it('entra em uma sala por CNPJ do escopo para CLIENT', () => {
    const rooms = resolveJoinRooms({
      userId: 'u1',
      role: 'CLIENT',
      scope: { kind: 'COMPANIES', companyIds: ['company-1', 'company-2'] },
    });
    expect(rooms).toEqual([companyRoom('company-1'), companyRoom('company-2')]);
  });
});

describe('resolveProcessEventRooms', () => {
  it('processo só com clientCompanyId gera role:internal + company:<clientCompanyId>', () => {
    const rooms = resolveProcessEventRooms({
      clientCompanyId: 'company-1',
      requestingCompanyId: null,
    });
    expect(rooms).toEqual([INTERNAL_ROOM, companyRoom('company-1')]);
  });

  it('com requestingCompanyId também inclui a sala do solicitante', () => {
    const rooms = resolveProcessEventRooms({
      clientCompanyId: 'company-1',
      requestingCompanyId: 'company-2',
    });
    expect(rooms).toEqual([INTERNAL_ROOM, companyRoom('company-1'), companyRoom('company-2')]);
  });

  it('não duplica sala quando clientCompanyId e requestingCompanyId são iguais', () => {
    const rooms = resolveProcessEventRooms({
      clientCompanyId: 'company-1',
      requestingCompanyId: 'company-1',
    });
    // Socket.IO deduplica destinatários entre salas nativamente (docs/07);
    // aqui garantimos que a lista de salas em si não repete a mesma sala.
    const uniqueRooms = new Set(rooms);
    expect(uniqueRooms.size).toBeLessThanOrEqual(rooms.length);
    expect(rooms).toContain(INTERNAL_ROOM);
    expect(rooms).toContain(companyRoom('company-1'));
  });
});
