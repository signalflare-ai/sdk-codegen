import type { AuthPlan } from "../contract/auth.js";

/** Compiler-owned options shared by the standalone native runtime emitters. */
export interface NativeRuntimeOptions {
  [key: string]: unknown;
  authPlan: AuthPlan;
  defaultBaseUrl: string;
  compilerVersion: string;
  sdkVersion: string;
  productId: string;
  productDisplayName: string;
  packageName: string;
  clientClassName: string;
}

export function nativeRuntimeOptionsFor(
  value: unknown,
  language: "Python" | "Go" | "Rust",
): NativeRuntimeOptions {
  const options = value as Partial<NativeRuntimeOptions> | undefined;
  if (
    !options ||
    !options.authPlan ||
    typeof options.defaultBaseUrl !== "string" ||
    typeof options.compilerVersion !== "string" ||
    typeof options.sdkVersion !== "string" ||
    typeof options.productId !== "string" ||
    typeof options.productDisplayName !== "string" ||
    typeof options.packageName !== "string" ||
    typeof options.clientClassName !== "string"
  ) {
    throw new Error(
      `The Signalflare ${language} emitter requires compiler-supplied runtime options.`,
    );
  }
  return options as NativeRuntimeOptions;
}

export function thirdPartyNotices(): string {
  return `# Third-party notices

The generated runtime design is adapted from the MIT-licensed WorkOS SDKs.

- workos-python 10.3.0, commit 7aa689481035f24f41765afe59227f46bbacfdb5
- workos-go 10.4.0, commit be30f8d82e238934a68fdb0c0193c72351d130bd
- workos-rust 3.4.0, commit afcd055c81a398a895dfb7f76e2084913a73d553

Copyright (c) 2021-2026 WorkOS Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}
