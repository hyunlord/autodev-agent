import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ProjectConfig {
  type: string;
  displayName: string;
  installCmd: string | null;
  buildCmd: string | null;
  devCmd: string;
  defaultPort: number | null;
  language: string;
}

interface Detector {
  markerFile: string;
  detect: (dir: string) => ProjectConfig | null;
}

const DETECTORS: Detector[] = [
  {
    markerFile: 'package.json',
    detect: (dir) => {
      const pkgPath = join(dir, 'package.json');
      if (!existsSync(pkgPath)) return null;

      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const pm = existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm'
        : existsSync(join(dir, 'yarn.lock')) ? 'yarn' : 'npm';

      if (deps.next) return {
        type: 'nextjs', displayName: 'Next.js', language: 'typescript',
        installCmd: `${pm} install`, buildCmd: `${pm} run build`,
        devCmd: `${pm} run dev`, defaultPort: 3000,
      };
      if (deps.vite) return {
        type: 'vite', displayName: 'Vite', language: 'typescript',
        installCmd: `${pm} install`, buildCmd: `${pm} run build`,
        devCmd: `${pm} run dev`, defaultPort: 5173,
      };
      if (deps.react) return {
        type: 'react', displayName: 'React', language: 'typescript',
        installCmd: `${pm} install`, buildCmd: `${pm} run build`,
        devCmd: `${pm} start`, defaultPort: 3000,
      };
      return {
        type: 'node', displayName: 'Node.js', language: 'javascript',
        installCmd: `${pm} install`, buildCmd: null,
        devCmd: `${pm} start`, defaultPort: 3000,
      };
    },
  },
  {
    markerFile: 'Cargo.toml',
    detect: () => ({
      type: 'rust', displayName: 'Rust', language: 'rust',
      installCmd: null, buildCmd: 'cargo build',
      devCmd: 'cargo run', defaultPort: null,
    }),
  },
  {
    markerFile: 'project.godot',
    detect: () => ({
      type: 'godot', displayName: 'Godot 4', language: 'gdscript',
      installCmd: null, buildCmd: null,
      devCmd: 'godot --path .', defaultPort: null,
    }),
  },
  {
    markerFile: 'pyproject.toml',
    detect: () => ({
      type: 'python', displayName: 'Python', language: 'python',
      installCmd: 'pip install -e .', buildCmd: null,
      devCmd: 'python -m app', defaultPort: 8000,
    }),
  },
  {
    markerFile: 'go.mod',
    detect: () => ({
      type: 'go', displayName: 'Go', language: 'go',
      installCmd: 'go mod download', buildCmd: 'go build',
      devCmd: 'go run .', defaultPort: 8080,
    }),
  },
  {
    markerFile: 'index.html',
    detect: () => ({
      type: 'static-html',
      displayName: 'Static HTML',
      language: 'html',
      installCmd: null,
      buildCmd: null,
      devCmd: 'open index.html',
      defaultPort: null,
    }),
  },
];

export function detectProjectType(dir: string): ProjectConfig | null {
  for (const detector of DETECTORS) {
    if (existsSync(join(dir, detector.markerFile))) {
      const config = detector.detect(dir);
      if (config) return config;
    }
  }
  return null;
}
