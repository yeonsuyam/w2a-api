import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// mkcert keeps the CA private key outside the project. Only the public CA
// certificate is copied here for installation on the browsers' devices.
const certDir = resolve('.certs');
const localMkcert = resolve('.certs/tools/mkcert');
const mkcert = existsSync(localMkcert) ? localMkcert : 'mkcert';
try {
  execFileSync(mkcert, ['-version'], { stdio: 'pipe' });
} catch {
  console.error(
    'Install mkcert first: https://github.com/FiloSottile/mkcert#installation',
  );
  process.exit(1);
}
mkdirSync(certDir, { recursive: true });
const hosts = [
  ...new Set(['localhost', '127.0.0.1', '::1', ...process.argv.slice(2)]),
];
execFileSync(
  mkcert,
  [
    '-cert-file',
    resolve(certDir, 'cert.pem'),
    '-key-file',
    resolve(certDir, 'key.pem'),
    ...hosts,
  ],
  { stdio: 'inherit' },
);
chmodSync(resolve(certDir, 'key.pem'), 0o600);
const caRoot = execFileSync(mkcert, ['-CAROOT'], { encoding: 'utf8' }).trim();
copyFileSync(resolve(caRoot, 'rootCA.pem'), resolve(certDir, 'rootCA.pem'));
console.log('Install .certs/rootCA.pem as a trusted CA on each client device.');
console.log("Never copy or share mkcert's rootCA-key.pem.");
