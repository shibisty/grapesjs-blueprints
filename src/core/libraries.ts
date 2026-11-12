import { uid } from '../blueprint';

export type LibraryFileType = 'js' | 'css';

export interface LibraryFile {
  url: string;
  type: LibraryFileType;
  /** Subresource Integrity hash (`sha256-…`/`sha384-…`), when the CDN gives one. */
  integrity?: string;
}

/** A JS/CSS library loaded from a CDN. */
export interface Library {
  id: string;
  /** Package name (`gsap`) or a label. */
  name: string;
  /** Exact version (never a range — the page must not change by itself). */
  version?: string;
  /** Where it came from: `jsdelivr`, `cdnjs`, `preset`, `url`. */
  source?: string;
  files: LibraryFile[];
  enabled: boolean;
  /** `editor.Pages` ids; empty = every page. */
  pages?: string[];
  /** JS files: `defer` (default), `async`, `module` or `blocking`. */
  load?: 'defer' | 'async' | 'module' | 'blocking';
  /** Load the JS in the editor canvas too (CSS always is). Default false: only in preview. */
  inCanvas?: boolean;
  /** Global it creates (`gsap`, `Swiper`) — shown in the "Call library" node. */
  global?: string;
  homepage?: string;
}

const LOADS = ['defer', 'async', 'module', 'blocking'];

export function fileTypeOf(url: string): LibraryFileType {
  return /\.css(\?|#|$)/i.test(url) ? 'css' : 'js';
}

/** Keeps only http(s) URLs and well-formed SRI hashes; drops everything else. */
export function normalizeLibrary(raw: unknown): Library | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null;
  if (!r) return null;
  const files: LibraryFile[] = (Array.isArray(r.files) ? r.files : [])
    .filter((f: any) => f && typeof f.url === 'string' && /^https?:\/\//i.test(f.url.trim()))
    .map((f: any) => {
      const out: LibraryFile = { url: f.url.trim(), type: f.type === 'css' || f.type === 'js' ? f.type : fileTypeOf(f.url) };
      if (typeof f.integrity === 'string' && /^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(f.integrity)) out.integrity = f.integrity;
      return out;
    });
  if (!files.length) return null;
  const lib: Library = {
    id: typeof r.id === 'string' && r.id ? r.id : uid('lib'),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : files[0].url.split('/').pop() || 'library',
    files,
    enabled: r.enabled !== false,
  };
  if (typeof r.version === 'string' && r.version) lib.version = r.version;
  if (typeof r.source === 'string') lib.source = r.source;
  if (Array.isArray(r.pages)) lib.pages = r.pages.filter((p: unknown) => typeof p === 'string');
  if (LOADS.includes(r.load)) lib.load = r.load;
  if (r.inCanvas) lib.inCanvas = true;
  if (typeof r.global === 'string' && /^[A-Za-z_$][\w$.]*$/.test(r.global)) lib.global = r.global;
  if (typeof r.homepage === 'string' && /^https?:\/\//.test(r.homepage)) lib.homepage = r.homepage;
  return lib;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `<link>` / `<script src>` tags of libraries (CSS first, then JS, in list order). */
export function libraryTags(libs: Library[]): string {
  const css: string[] = [];
  const js: string[] = [];
  for (const lib of libs) {
    for (const f of lib.files) {
      const sri = f.integrity ? ` integrity="${esc(f.integrity)}" crossorigin="anonymous"` : '';
      if (f.type === 'css') css.push(`<link rel="stylesheet" href="${esc(f.url)}"${sri}>`);
      else {
        const load = lib.load || 'defer';
        const attr = load === 'module' ? ' type="module"' : load === 'blocking' ? '' : ` ${load}`;
        js.push(`<script src="${esc(f.url)}"${attr}${sri}></script>`);
      }
    }
  }
  return [...css, ...js].join('\n');
}
