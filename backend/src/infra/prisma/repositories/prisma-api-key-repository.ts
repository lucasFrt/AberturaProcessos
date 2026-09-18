import type { Prisma, PrismaClient } from '@prisma/client';

import type { ApiKey, ApiKeyWithUser, CreateApiKeyData } from '@/domain/entities/api-key';
import type { ApiKeyRepository } from '@/domain/repositories/api-key-repository';

const WITH_USER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, role: true, status: true } },
} satisfies Prisma.ApiKeyInclude;

type ApiKeyRow = Prisma.ApiKeyGetPayload<{ include: typeof WITH_USER_INCLUDE }>;

function mapWithUser(row: ApiKeyRow): ApiKeyWithUser {
  return {
    id: row.id,
    name: row.name,
    keyHash: row.keyHash,
    keyPrefix: row.keyPrefix,
    userId: row.userId,
    createdById: row.createdById,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.user.role,
      status: row.user.status,
    },
  };
}

/** Intervalo mínimo entre dois UPDATEs de `lastUsedAt` da mesma chave. */
const TOUCH_THROTTLE_MS = 60_000;

export class PrismaApiKeyRepository implements ApiKeyRepository {
  private readonly lastTouch = new Map<string, number>();

  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateApiKeyData): Promise<ApiKeyWithUser> {
    const row = await this.prisma.apiKey.create({ data, include: WITH_USER_INCLUDE });
    return mapWithUser(row);
  }

  async findById(id: string): Promise<ApiKeyWithUser | null> {
    const row = await this.prisma.apiKey.findUnique({ where: { id }, include: WITH_USER_INCLUDE });
    return row ? mapWithUser(row) : null;
  }

  async findByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findUnique({ where: { keyHash } });
  }

  async listAll(): Promise<ApiKeyWithUser[]> {
    const rows = await this.prisma.apiKey.findMany({
      include: WITH_USER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapWithUser);
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /**
   * O agente pode fazer centenas de requisições por execução; um UPDATE por
   * requisição só para `lastUsedAt` seria ruído no banco. Um por minuto por
   * chave basta para o propósito (detectar chave sem uso).
   */
  async touchLastUsed(id: string, at: Date): Promise<void> {
    const previous = this.lastTouch.get(id);
    if (previous !== undefined && at.getTime() - previous < TOUCH_THROTTLE_MS) {
      return;
    }
    this.lastTouch.set(id, at.getTime());
    await this.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: at } });
  }
}
