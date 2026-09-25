import { resolve } from 'node:path';

export const REPO_DIR = resolve(import.meta.dirname, '..');

export const defaultRoot = (repoDir = REPO_DIR) =>
  resolve(repoDir, '../../../../data/my/tools/fetch-sitecollection2md');

const pad = n => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
