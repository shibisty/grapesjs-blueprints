import type { ScriptsSettings } from './ScriptsManager';

/** Post-processing of the generated script. Both are optional and loaded only when needed. */
export interface OutputTools {
  minify?(code: string): Promise<string>;
  obfuscate?(code: string): Promise<string>;
}

/** Pinned CDN builds used when no custom tools are given (jsDelivr). */
export const DEFAULT_TOOL_URLS = {
  terser: 'https://cdn.jsdelivr.net/npm/terser@5.36.0/dist/bundle.min.js',
  obfuscator: 'https://cdn.jsdelivr.net/npm/javascript-obfuscator@4.1.1/dist/index.browser.js',
};

const loading = new Map<string, Promise<void>>();

/** Loads a classic script into the editor page once. */
export function loadScriptOnce(url: string, doc: Document = document): Promise<void> {
  const key = url;
  const cached = loading.get(key);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading.delete(key);
      reject(new Error(`[grapesjs-scripts] could not load ${url}`));
    };
    doc.head.appendChild(s);
  });
  loading.set(key, p);
  return p;
}

/** Default tools: terser and javascript-obfuscator from a CDN (or the given URLs). */
export function cdnTools(urls: Partial<typeof DEFAULT_TOOL_URLS> = {}): OutputTools {
  const u = { ...DEFAULT_TOOL_URLS, ...urls };
  return {
    async minify(code) {
      await loadScriptOnce(u.terser);
      const Terser = (window as any).Terser;
      if (!Terser?.minify) throw new Error('[grapesjs-scripts] terser did not load');
      const res = await Terser.minify(code, { compress: { passes: 2 }, mangle: true, format: { comments: false } });
      return String(res.code ?? code);
    },
    async obfuscate(code) {
      await loadScriptOnce(u.obfuscator);
      const O = (window as any).JavaScriptObfuscator;
      if (!O?.obfuscate) throw new Error('[grapesjs-scripts] javascript-obfuscator did not load');
      return String(O.obfuscate(code, { compact: true, stringArray: true, stringArrayThreshold: 0.75, identifierNamesGenerator: 'hexadecimal' }).getObfuscatedCode());
    },
  };
}

/**
 * Applies minification and obfuscation as the settings say. A failing tool does not lose the
 * script: the previous stage is kept and a warning is returned.
 */
export async function processCode(code: string, settings: Pick<ScriptsSettings, 'minify' | 'obfuscate'>, tools: OutputTools): Promise<{ code: string; warnings: string[] }> {
  const warnings: string[] = [];
  let out = code;
  if (settings.minify && out.trim()) {
    if (!tools.minify) warnings.push('minify: no minifier configured');
    else {
      try {
        out = await tools.minify(out);
      } catch (e) {
        warnings.push(`minify: ${(e as Error).message}`);
      }
    }
  }
  if (settings.obfuscate && out.trim()) {
    if (!tools.obfuscate) warnings.push('obfuscate: no obfuscator configured');
    else {
      try {
        out = await tools.obfuscate(out);
      } catch (e) {
        warnings.push(`obfuscate: ${(e as Error).message}`);
      }
    }
  }
  return { code: out, warnings };
}

/** Code safe inside an inline `<script>` element. */
export function inlineSafe(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}
