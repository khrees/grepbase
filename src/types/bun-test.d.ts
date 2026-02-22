declare module 'bun:test' {
    export interface BunExpectation {
        not: BunExpectation;
        toBe(expected: unknown): void;
        toEqual(expected: unknown): void;
        toThrow(expected?: unknown): void;
    }

    export function describe(name: string, fn: () => void): void;
    export function test(name: string, fn: () => void | Promise<void>): void;
    export function beforeEach(fn: () => void | Promise<void>): void;
    export function afterEach(fn: () => void | Promise<void>): void;
    export function expect<T = unknown>(value: T): BunExpectation;
}
