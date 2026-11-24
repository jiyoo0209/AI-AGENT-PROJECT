// 개발자가 만든 Expo 앱 코드로 안드로이드 설치 파일(APK)을 빌드합니다.
// 필요한 것: Java 17, Android SDK (명령줄 도구 + 라이선스 동의). 처음 빌드는 10분 안팎, 그다음은 몇 분.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class BuildError extends Error {
  constructor(
    message: string,
    public log: string,
  ) {
    super(message);
  }
}

function firstExisting(paths: (string | undefined)[]): string | null {
  for (const p of paths) if (p && existsSync(p)) return p;
  return null;
}

function findJavaHome(): string | null {
  const jvm = '/usr/lib/jvm';
  const linux = existsSync(jvm)
    ? readdirSync(jvm)
        .filter((d) => /17/.test(d))
        .map((d) => join(jvm, d))
    : [];
  return firstExisting([
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home',
    '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home',
    ...linux,
  ]);
}

function findAndroidSdk(): string | null {
  return firstExisting([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library/Android/sdk'),
    '/opt/homebrew/share/android-commandlinetools',
    '/usr/local/share/android-commandlinetools',
    join(homedir(), 'Android/Sdk'),
    '/usr/local/lib/android/sdk',
  ]);
}

/** 명령을 실행하고 출력 끝부분을 모읍니다. 실패하면 BuildError */
function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (b: Buffer) => {
      out += b.toString();
      if (out.length > 400_000) out = out.slice(-200_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new BuildError(`${what} 시간 초과`, out.slice(-20_000)));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new BuildError(`${what} 실행 실패: ${e.message}`, out.slice(-20_000)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new BuildError(`${what} 실패 (종료 코드 ${code})`, out.slice(-60_000)));
    });
  });
}

/** 빌드 로그에서 개발자가 고칠 때 필요한 부분만 뽑습니다. */
export function errorSummary(log: string, max = 6000): string {
  const lines = log.split('\n');
  const important = lines.filter((l) =>
    /error|Error|ERROR|Unable to resolve|SyntaxError|TypeError|Cannot find|not found|FAILURE|What went wrong|> Task .*FAILED|npm ERR/.test(l),
  );
  const tail = lines.slice(-40);
  const text = [...new Set([...important.slice(-60), '...', ...tail])].join('\n');
  return text.length > max ? text.slice(-max) : text;
}

const CODE_FILE = /\.(tsx?|jsx?|json)$/i;

export function createApkBuilder(dataDir: string, repoRoot: string) {
  const work = join(dataDir, 'builds', 'app');
  mkdirSync(work, { recursive: true });

  // 나만의사무실 앱이 실제로 빌드되는 버전 조합을 그대로 씁니다.
  let pinned: Record<string, string> = {};
  try {
    const deps = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).dependencies ?? {};
    pinned = { expo: deps.expo, react: deps.react, 'react-native': deps['react-native'] };
  } catch {
    pinned = {};
  }

  let queue: Promise<unknown> = Promise.resolve();

  function unavailable(): string | null {
    if (!findJavaHome() && !process.env.PATH?.split(':').some((d) => existsSync(join(d, 'java')))) {
      return '맥미니에 Java 17이 없어요. (brew install openjdk@17)';
    }
    if (!findAndroidSdk()) return '맥미니에 Android SDK가 없어요. (brew install --cask android-commandlinetools)';
    if (!pinned.expo) return '저장소의 package.json을 읽지 못했어요.';
    return null;
  }

  async function buildNow(opts: {
    files: { name: string; path: string }[];
    appName: string;
    packageId: string;
  }): Promise<{ apk: string; seconds: number }> {
    const started = Date.now();
    const reason = unavailable();
    if (reason) throw new BuildError(reason, '');

    // 1) 소스 넣기 (node_modules는 다음 빌드를 빠르게 하려고 남김)
    for (const f of readdirSync(work)) {
      if (f === 'node_modules' || f === 'package-lock.json') continue;
      rmSync(join(work, f), { recursive: true, force: true });
    }
    const names = new Set<string>();
    for (const f of opts.files) {
      if (!CODE_FILE.test(f.name)) continue;
      copyFileSync(f.path, join(work, f.name));
      names.add(f.name);
    }
    const app = ['App.tsx', 'App.ts', 'App.jsx', 'App.js'].find((n) => names.has(n));
    if (!app) throw new BuildError('App.tsx(시작 화면) 파일이 없어요.', `파일 목록: ${[...names].join(', ') || '(없음)'}`);

    // 2) 시작 파일, package.json, app.json을 빌드되는 모양으로 맞추기
    writeFileSync(
      join(work, 'index.js'),
      `import { registerRootComponent } from 'expo';\nimport App from './${app.replace(/\.\w+$/, '')}';\n\nregisterRootComponent(App);\n`,
    );
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; [k: string]: unknown } = {};
    try {
      pkg = JSON.parse(readFileSync(join(work, 'package.json'), 'utf8'));
    } catch {
      pkg = {};
    }
    const deps: Record<string, string> = { ...(pkg.dependencies ?? {}) };
    for (const [k, v] of Object.entries(pinned)) if (v) deps[k] = v;
    for (const k of Object.keys(deps)) if (!deps[k] || typeof deps[k] !== 'string') deps[k] = '*';
    pkg = {
      name: 'office-app',
      version: '1.0.0',
      private: true,
      main: 'index.js',
      dependencies: deps,
      devDependencies: { typescript: '*', '@types/react': '*', ...(pkg.devDependencies ?? {}) },
    };
    writeFileSync(join(work, 'package.json'), JSON.stringify(pkg, null, 2));

    let appJson: { expo?: Record<string, unknown> } = {};
    try {
      appJson = JSON.parse(readFileSync(join(work, 'app.json'), 'utf8'));
    } catch {
      appJson = {};
    }
    const expo: Record<string, unknown> = { ...(appJson.expo ?? {}) };
    // 없는 그림 파일을 가리키면 빌드가 실패하므로 지웁니다.
    for (const k of ['icon', 'splash', 'notification']) delete expo[k];
    const android = { ...((expo.android as Record<string, unknown>) ?? {}) };
    delete android.adaptiveIcon;
    expo.name = opts.appName;
    expo.slug = 'office-app';
    expo.version = (expo.version as string) || '1.0.0';
    expo.orientation = expo.orientation || 'portrait';
    expo.android = { ...android, package: opts.packageId };
    delete expo.plugins;
    writeFileSync(join(work, 'app.json'), JSON.stringify({ expo }, null, 2));
    if (!existsSync(join(work, 'tsconfig.json'))) {
      writeFileSync(join(work, 'tsconfig.json'), JSON.stringify({ extends: 'expo/tsconfig.base' }, null, 2));
    }

    // 3) 설치 → 버전 맞추기 → 안드로이드 프로젝트 만들기 → 빌드
    const javaHome = findJavaHome();
    const sdk = findAndroidSdk()!;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CI: '1',
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      NODE_ENV: 'production',
    };
    delete env.NODE_OPTIONS;
    const npm = 'npm';
    const npx = 'npx';
    const log: string[] = [];
    log.push(await run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', '--include=dev'], work, { ...env, NODE_ENV: 'development' }, 20 * 60_000, '패키지 설치'));
    // 라이브러리 버전을 이 Expo 버전에 맞춥니다 (실패해도 빌드는 시도)
    await run(npx, ['expo', 'install', '--fix'], work, env, 10 * 60_000, '버전 맞추기').then(
      (o) => log.push(o),
      (e: BuildError) => log.push(e.log),
    );
    log.push(await run(npx, ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], work, env, 10 * 60_000, '안드로이드 프로젝트 만들기'));
    const gradlew = join(work, 'android', 'gradlew');
    log.push(
      await run(gradlew, ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--console=plain'], join(work, 'android'), env, 45 * 60_000, 'APK 빌드'),
    );
    const apk = join(work, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (!existsSync(apk) || statSync(apk).size < 1000) throw new BuildError('APK 파일이 만들어지지 않았어요.', log.join('\n').slice(-20_000));
    return { apk, seconds: Math.round((Date.now() - started) / 1000) };
  }

  return {
    unavailable,
    /** 한 번에 하나씩 빌드합니다. */
    build(opts: { files: { name: string; path: string }[]; appName: string; packageId: string }) {
      const job = queue.then(
        () => buildNow(opts),
        () => buildNow(opts),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

export type ApkBuilder = ReturnType<typeof createApkBuilder>;
