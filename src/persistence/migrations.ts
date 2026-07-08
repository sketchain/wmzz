import { GameConfig } from '@/config/GameConfig';
import type { SaveData } from './SaveManager';

/**
 * Save-format migrations, applied in sequence: a save at version N runs
 * migrations[N], then [N+1], … until current. Every breaking schema change
 * bumps GameConfig.persistence.saveVersion and adds exactly one entry here.
 */
const migrations: Record<number, (data: SaveData) => SaveData> = {
  // Example shape for the future:
  // 1: (data) => ({ ...data, newField: defaultValue, version: 2 }),
};

export function migrateSave(data: SaveData): SaveData {
  let current = data;
  while (current.version < GameConfig.persistence.saveVersion) {
    const migrate = migrations[current.version];
    if (!migrate) {
      throw new Error(
        `No migration path from save version ${current.version} to ${GameConfig.persistence.saveVersion}`,
      );
    }
    current = migrate(current);
  }
  if (current.version > GameConfig.persistence.saveVersion) {
    throw new Error(
      `Save version ${current.version} is newer than this build (${GameConfig.persistence.saveVersion})`,
    );
  }
  return current;
}
