import type { Library, LibraryFile } from '../core/libraries';
import { fileTypeOf } from '../core/libraries';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpContext {
  fetch: FetchLike;
  /** CORS proxy: requests go to `<proxy>?url=<encoded url>` (see proxy/libs-proxy.php). */
  proxy?: string | false;
  timeout?: number;
}

export interface PackageHit {
  name: string;
  version?: string;
  description?: string;
  homepage?: string;
}

export interface PackageFile {
  /** Path inside the package (`/dist/gsap.min.js`). */
  path: string;
  url: string;
  type: 'js' | 'css';
  integrity?: string;
  size?: number;
}

export interface LibraryProvider {
  id: 'jsdelivr' | 'cdnjs';
  label: string;
  search(ctx: HttpContext, query: string): Promise<PackageHit[]>;
  versions(ctx: HttpContext, name: string): Promise<{ versions: string[]; latest?: string }>;
  files(ctx: HttpContext, name: string, version: string): Promise<{ files: PackageFile[]; defaults: string[] }>;
}

async function getJson<T>(ctx: HttpContext, url: string): Promise<T> {
  const target = ctx.proxy ? `${ctx.proxy}${ctx.proxy.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}` : url;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), ctx.timeout ?? 15000) : null;
  try {
    const res = await ctx.fetch(target, { headers: { accept: 'application/json' }, ...(ac ? { signal: ac.signal } : {}) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return (await res.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const isAsset = (p: string) => /\.(m?js|css)$/i.test(p) && !/\.(d\.ts|map)$/i.test(p) && !/(^|\/)(test|tests|__tests__|src)\//.test(p);

/** npm packages: search through the npm registry, files/SRI/entry points through jsDelivr. */
export const jsdelivr: LibraryProvider = {
  id: 'jsdelivr',
  label: 'jsDelivr (npm)',
  async search(ctx, query) {
    const data = await getJson<{ objects?: { package: { name: string; version: string; description?: string; links?: { homepage?: string; npm?: string } } }[] }>(
      ctx,
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`,
    );
    return (data.objects || []).map((o) => ({ name: o.package.name, version: o.package.version, description: o.package.description, homepage: o.package.links?.homepage || o.package.links?.npm }));
  },
  async versions(ctx, name) {
    const data = await getJson<{ tags?: Record<string, string>; versions?: (string | { version: string })[] }>(ctx, `https://data.jsdelivr.com/v1/packages/npm/${name}`);
    const versions = (data.versions || []).map((v) => (typeof v === 'string' ? v : v.version)).filter(Boolean);
    return { versions, latest: data.tags?.latest || versions[0] };
  },
  async files(ctx, name, version) {
    const [flat, entry] = await Promise.all([
      getJson<{ files?: { name: string; hash?: string; size?: number }[] }>(ctx, `https://data.jsdelivr.com/v1/packages/npm/${name}@${version}?structure=flat`),
      getJson<{ entrypoints?: { js?: { file?: string }; css?: { file?: string } } }>(ctx, `https://data.jsdelivr.com/v1/packages/npm/${name}@${version}/entrypoints`).catch(() => ({ entrypoints: {} as { js?: { file?: string }; css?: { file?: string } } })),
    ]);
    const files: PackageFile[] = (flat.files || [])
      .filter((f) => isAsset(f.name))
      .map((f) => ({
        path: f.name,
        url: `https://cdn.jsdelivr.net/npm/${name}@${version}${f.name}`,
        type: fileTypeOf(f.name),
        ...(f.hash ? { integrity: `sha256-${f.hash}` } : {}),
        ...(f.size ? { size: f.size } : {}),
      }));
    const defaults = [entry.entrypoints?.js?.file, entry.entrypoints?.css?.file].filter((p): p is string => !!p && files.some((f) => f.path === p));
    return { files, defaults };
  },
};

/** cdnjs: its own catalogue with SRI hashes. */
export const cdnjs: LibraryProvider = {
  id: 'cdnjs',
  label: 'cdnjs',
  async search(ctx, query) {
    const data = await getJson<{ results?: { name: string; version?: string; description?: string; homepage?: string }[] }>(
      ctx,
      `https://api.cdnjs.com/libraries?search=${encodeURIComponent(query)}&fields=version,description,homepage&limit=20`,
    );
    return (data.results || []).map((r) => ({ name: r.name, version: r.version, description: r.description, homepage: r.homepage }));
  },
  async versions(ctx, name) {
    const data = await getJson<{ versions?: string[]; version?: string }>(ctx, `https://api.cdnjs.com/libraries/${encodeURIComponent(name)}?fields=versions,version`);
    const versions = (data.versions || []).slice().reverse();
    return { versions, latest: data.version || versions[0] };
  },
  async files(ctx, name, version) {
    const data = await getJson<{ files?: string[]; sri?: Record<string, string>; filename?: string }>(
      ctx,
      `https://api.cdnjs.com/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}?fields=files,sri`,
    );
    const files: PackageFile[] = (data.files || [])
      .filter((p) => isAsset(p))
      .map((p) => ({ path: p, url: `https://cdnjs.cloudflare.com/ajax/libs/${name}/${version}/${p}`, type: fileTypeOf(p), ...(data.sri?.[p] ? { integrity: data.sri[p] } : {}) }));
    const main = files.find((f) => /\.min\.js$/.test(f.path) && f.path.split('/').pop()!.startsWith(name.split('.')[0]))?.path || files.find((f) => f.type === 'js')?.path;
    return { files, defaults: main ? [main] : [] };
  },
};

export const PROVIDERS: LibraryProvider[] = [jsdelivr, cdnjs];

/** Files picked in the dialog → library files. */
export function toLibraryFiles(files: PackageFile[]): LibraryFile[] {
  return files.map((f) => ({ url: f.url, type: f.type, ...(f.integrity ? { integrity: f.integrity } : {}) }));
}

/**
 * Popular libraries with pinned versions (jsDelivr). No SRI here: hashes are only taken from a
 * CDN's answer, never typed by hand. Search a library to get them.
 */
export const PRESETS: (Omit<Library, 'id' | 'enabled'> & { description: string })[] = [
  { name: 'gsap', version: '3.12.5', source: 'preset', global: 'gsap', description: 'Animations (GreenSock)', files: [{ url: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js', type: 'js' }] },
  {
    name: 'swiper',
    version: '11.1.14',
    source: 'preset',
    global: 'Swiper',
    description: 'Sliders and carousels',
    files: [
      { url: 'https://cdn.jsdelivr.net/npm/swiper@11.1.14/swiper-bundle.min.css', type: 'css' },
      { url: 'https://cdn.jsdelivr.net/npm/swiper@11.1.14/swiper-bundle.min.js', type: 'js' },
    ],
  },
  {
    name: '@splidejs/splide',
    version: '4.1.4',
    source: 'preset',
    global: 'Splide',
    description: 'Lightweight slider',
    files: [
      { url: 'https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/css/splide.min.css', type: 'css' },
      { url: 'https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/js/splide.min.js', type: 'js' },
    ],
  },
  {
    name: 'glightbox',
    version: '3.3.0',
    source: 'preset',
    global: 'GLightbox',
    description: 'Lightbox for images and videos',
    files: [
      { url: 'https://cdn.jsdelivr.net/npm/glightbox@3.3.0/dist/css/glightbox.min.css', type: 'css' },
      { url: 'https://cdn.jsdelivr.net/npm/glightbox@3.3.0/dist/js/glightbox.min.js', type: 'js' },
    ],
  },
  {
    name: 'aos',
    version: '2.3.4',
    source: 'preset',
    global: 'AOS',
    description: 'Animate on scroll',
    files: [
      { url: 'https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css', type: 'css' },
      { url: 'https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js', type: 'js' },
    ],
  },
  { name: 'animate.css', version: '4.1.1', source: 'preset', description: 'Ready-made CSS animations', files: [{ url: 'https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css', type: 'css' }] },
  { name: 'alpinejs', version: '3.14.1', source: 'preset', global: 'Alpine', description: 'Behaviour in HTML attributes', load: 'defer', files: [{ url: 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js', type: 'js' }] },
  { name: 'jquery', version: '3.7.1', source: 'preset', global: 'jQuery', description: 'jQuery', files: [{ url: 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js', type: 'js' }] },
  { name: 'chart.js', version: '4.4.4', source: 'preset', global: 'Chart', description: 'Charts', files: [{ url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js', type: 'js' }] },
  { name: 'dayjs', version: '1.11.13', source: 'preset', global: 'dayjs', description: 'Dates', files: [{ url: 'https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js', type: 'js' }] },
];
