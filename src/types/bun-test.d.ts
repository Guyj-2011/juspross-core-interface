// Tipos mínimos para los tests ejecutados con `bun test` (evita añadir bun-types).
declare module "bun:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
  };
}
