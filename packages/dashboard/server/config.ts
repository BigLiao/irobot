import path from 'path';
import { fileURLToPath } from 'url';

export const isDev = process.env.NODE_ENV === 'development';

console.log('isDev', isDev);

// ESM 模式下使用 import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePath(relativePath: string) {
  return path.resolve(__dirname, relativePath);
}

export const PATHS = {
  webDir: resolvePath('../dist/web'),
  injectorDir: resolvePath('../../injector/dist'),
  scriptsDir: resolvePath('../../injector/scripts'),
}
