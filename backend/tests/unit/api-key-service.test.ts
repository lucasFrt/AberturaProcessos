import { InMemoryApiKeyRepository } from '../helpers/fakes/in-memory-api-key-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { CreateUserData } from '@/domain/entities/user';
import { NotFoundError, ValidationError } from '@/domain/errors/app-error';
import { hashApiKey } from '@/infra/security/api-key-generator';
import { ApiKeyService } from '@/services/api-key-service';

function buildContext(): {
  service: ApiKeyService;
  userRepository: InMemoryUserRepository;
  apiKeyRepository: InMemoryApiKeyRepository;
} {
  const userRepository = new InMemoryUserRepository();
  const apiKeyRepository = new InMemoryApiKeyRepository(userRepository);
  const service = new ApiKeyService({ apiKeyRepository, userRepository });
  return { service, userRepository, apiKeyRepository };
}

async function seedUser(
  userRepository: InMemoryUserRepository,
  overrides: Partial<CreateUserData> = {},
): Promise<string> {
  const user = await userRepository.create({
    name: 'Agente de E-mail',
    email: 'agente@opusce.com.br',
    passwordHash: null,
    role: 'OPERATIONAL',
    status: 'ACTIVE',
    accessScope: 'ORGANIZATION',
    organizationId: 'org-internal',
    ...overrides,
  });
  return user.id;
}

describe('ApiKeyService (docs/13, decisão 2)', () => {
  describe('create', () => {
    it('devolve a chave em claro uma vez e persiste apenas o hash', async () => {
      const { service, userRepository, apiKeyRepository } = buildContext();
      const userId = await seedUser(userRepository);

      const created = await service.create('admin-1', { name: 'Agente', userId });

      expect(created.plainKey.startsWith('apk_')).toBe(true);
      expect(created.apiKey.keyHash).toBe(hashApiKey(created.plainKey));
      expect(created.apiKey.keyPrefix).toBe(created.plainKey.slice(0, 12));
      expect(created.apiKey.user.id).toBe(userId);
      expect(created.apiKey.createdById).toBe('admin-1');
      expect(apiKeyRepository.items[0]?.keyHash).not.toBe(created.plainKey);
    });

    it('gera chaves diferentes a cada criação', async () => {
      const { service, userRepository } = buildContext();
      const userId = await seedUser(userRepository);

      const first = await service.create('admin-1', { name: 'A', userId });
      const second = await service.create('admin-1', { name: 'B', userId });

      expect(first.plainKey).not.toBe(second.plainKey);
    });

    it('rejeita usuário inexistente com 404', async () => {
      const { service } = buildContext();

      await expect(
        service.create('admin-1', { name: 'Agente', userId: 'nao-existe' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejeita usuário CLIENT com 400 (conta de serviço é sempre interna)', async () => {
      const { service, userRepository } = buildContext();
      const userId = await seedUser(userRepository, { role: 'CLIENT' });

      await expect(service.create('admin-1', { name: 'Agente', userId })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejeita usuário não ativo com 400', async () => {
      const { service, userRepository } = buildContext();
      const userId = await seedUser(userRepository, { status: 'DISABLED' });

      await expect(service.create('admin-1', { name: 'Agente', userId })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('list / revoke', () => {
    it('lista todas as chaves, inclusive revogadas', async () => {
      const { service, userRepository } = buildContext();
      const userId = await seedUser(userRepository);
      const first = await service.create('admin-1', { name: 'A', userId });
      await service.create('admin-1', { name: 'B', userId });
      await service.revoke(first.apiKey.id);

      const list = await service.list();

      expect(list).toHaveLength(2);
      expect(list.find((key) => key.id === first.apiKey.id)?.revokedAt).not.toBeNull();
    });

    it('revogar é idempotente e preserva a primeira data de revogação', async () => {
      const { service, userRepository, apiKeyRepository } = buildContext();
      const userId = await seedUser(userRepository);
      const created = await service.create('admin-1', { name: 'A', userId });

      await service.revoke(created.apiKey.id);
      const revokedAt = apiKeyRepository.items[0]?.revokedAt;
      await service.revoke(created.apiKey.id);

      expect(apiKeyRepository.items[0]?.revokedAt).toBe(revokedAt);
    });

    it('revogar chave inexistente responde 404', async () => {
      const { service } = buildContext();

      await expect(service.revoke('nao-existe')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
