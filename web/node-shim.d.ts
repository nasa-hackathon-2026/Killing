declare module "node:fs" {
  export function cpSync(
    source: string,
    destination: string,
    options: { recursive: boolean },
  ): void;
  export function createReadStream(path: string): {
    pipe(destination: unknown): unknown;
  };
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isFile(): boolean };
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
  export const sep: string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
