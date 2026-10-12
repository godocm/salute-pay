import { Buffer } from "buffer";
// Classic Solana SDK dependencies expect the browser Buffer polyfill.
const runtime = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof window !== "undefined") runtime.Buffer ??= Buffer;
