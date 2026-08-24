const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const tag = process.env.GITHUB_REF_NAME || process.env.APP_VERSION || process.argv[2] || '';
const version = tag.replace(/^v/, '').trim();

if (!version) {
  console.log('[sync-version] No valid version provided, skipping synchronization.');
  process.exit(0);
}

console.log(`[sync-version] Synchronizing project version to: ${version}`);

// 1. Update package.json
const pkgPath = path.join(rootDir, 'package.json');
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[sync-version] Updated ${pkgPath}`);
}

// 2. Update package-lock.json if present
const pkgLockPath = path.join(rootDir, 'package-lock.json');
if (fs.existsSync(pkgLockPath)) {
  const pkgLock = JSON.parse(fs.readFileSync(pkgLockPath, 'utf8'));
  pkgLock.version = version;
  if (pkgLock.packages && pkgLock.packages['']) {
    pkgLock.packages[''].version = version;
  }
  fs.writeFileSync(pkgLockPath, JSON.stringify(pkgLock, null, 2) + '\n', 'utf8');
  console.log(`[sync-version] Updated ${pkgLockPath}`);
}

// 3. Update src-tauri/tauri.conf.json
const tauriPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriPath)) {
  const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
  tauri.version = version;
  fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n', 'utf8');
  console.log(`[sync-version] Updated ${tauriPath}`);
}

// 4. Update src-tauri/Cargo.toml
const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, 'utf8');
  cargo = cargo.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
  fs.writeFileSync(cargoPath, cargo, 'utf8');
  console.log(`[sync-version] Updated ${cargoPath}`);
}

console.log(`[sync-version] Successfully synchronized version to ${version}`);
