import path from 'node:path';

import { AppError } from '@/domain/errors/app-error';
import {
  buildRelativePath,
  generateStoredName,
  resolveContainedPath,
} from '@/infra/storage/local-disk-storage';

describe('LocalDiskStorage — resolução de caminho (RNF-11)', () => {
  describe('resolveContainedPath', () => {
    const storageRoot = path.resolve('./storage/test-root');

    it('resolve um caminho relativo normal dentro de STORAGE_ROOT', () => {
      const resolved = resolveContainedPath(storageRoot, '2026/08/process-1/abc.pdf');
      expect(resolved.startsWith(storageRoot)).toBe(true);
    });

    it('nome com ../ não escapa de STORAGE_ROOT — lança AppError', () => {
      expect(() => resolveContainedPath(storageRoot, '../../../etc/passwd')).toThrow(AppError);
    });

    it('caminho absoluto de outro disco/raiz também é rejeitado', () => {
      expect(() => resolveContainedPath(storageRoot, '/etc/passwd')).toThrow(AppError);
    });

    it('combinações menos óbvias de ../ dentro de um segmento válido também são rejeitadas', () => {
      expect(() =>
        resolveContainedPath(storageRoot, '2026/08/process-1/../../../../outside.txt'),
      ).toThrow(AppError);
    });
  });

  describe('generateStoredName', () => {
    it('preserva a extensão original', () => {
      const storedName = generateStoredName('relatório final.pdf');
      expect(storedName.endsWith('.pdf')).toBe(true);
    });

    it('arquivo sem extensão gera nome físico sem extensão', () => {
      const storedName = generateStoredName('arquivo-sem-extensao');
      expect(storedName).not.toContain('.');
    });

    it('nome malicioso com ../ não influencia o resultado alem da extensão', () => {
      const storedName = generateStoredName('../../evil.sh');
      expect(storedName.endsWith('.sh')).toBe(true);
      expect(storedName).not.toContain('..');
      expect(storedName).not.toContain('/');
    });
  });

  describe('buildRelativePath', () => {
    it('monta ano/mês/processId/storedName', () => {
      const now = new Date('2026-08-07T12:00:00.000Z');
      const relativePath = buildRelativePath('process-1', 'abc.pdf', now);
      expect(relativePath).toBe('2026/08/process-1/abc.pdf');
    });
  });
});
