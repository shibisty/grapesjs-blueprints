/**
 * Runtime helpers. Each is a small ES5 function emitted once per output file, only when a
 * compiled node uses it. They take the disposer list `d` explicitly so one copy serves every
 * blueprint in the file.
 */
export interface HelperDef {
  code: string;
  deps?: string[];
}

export const HELPER_PREFIX = '__bp_';

export const HELPERS: Record<string, HelperDef> = {
  list: {
    code: `function __bp_list(x) {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  if (typeof x.length === 'number' && typeof x !== 'string' && !x.nodeType) return Array.prototype.slice.call(x);
  return [x];
}`,
  },
  on: {
    code: `function __bp_on(d, target, type, fn, opts) {
  if (!target || !target.addEventListener) return;
  target.addEventListener(type, fn, opts || false);
  d.push(function () { target.removeEventListener(type, fn, opts || false); });
}`,
  },
  delegate: {
    deps: ['on'],
    code: `function __bp_delegate(d, root, type, sel, fn) {
  var map = { mouseenter: 'mouseover', mouseleave: 'mouseout', focus: 'focusin', blur: 'focusout' };
  var hover = type === 'mouseenter' || type === 'mouseleave';
  if (!sel) {
    var self = root.nodeType === 9 ? root.documentElement : root;
    __bp_on(d, root, type, function (e) { fn(e, self); });
    return;
  }
  __bp_on(d, root, map[type] || type, function (e) {
    var t = e.target;
    if (t && t.nodeType !== 1) t = t.parentNode;
    if (!t || !t.closest) return;
    var el;
    try { el = t.closest(sel); } catch (err) { return; }
    if (!el || (root.nodeType === 1 && el !== root && !root.contains(el))) return;
    if (hover && e.relatedTarget && el.contains(e.relatedTarget)) return;
    fn(e, el);
  });
}`,
  },
  q: {
    deps: ['list'],
    code: `function __bp_q(root, sel, mode, from) {
  var out = [];
  if (!sel) return mode && from != null ? __bp_list(from) : out;
  try {
    if (mode === 'closest') {
      __bp_list(from).forEach(function (f) { var c = f && f.closest && f.closest(sel); if (c && out.indexOf(c) < 0) out.push(c); });
      return out;
    }
    var base = mode === 'within' && from != null ? __bp_list(from) : [root];
    base.forEach(function (b) {
      if (!b || !b.querySelectorAll) return;
      var found = b.querySelectorAll(sel);
      for (var i = 0; i < found.length; i++) if (out.indexOf(found[i]) < 0) out.push(found[i]);
    });
  } catch (err) {}
  return out;
}`,
  },
  els: {
    deps: ['list', 'q'],
    code: `function __bp_els(root, x) {
  return typeof x === 'string' ? __bp_q(root, x) : __bp_list(x).filter(function (e) { return e && e.nodeType === 1; });
}`,
  },
  timeout: {
    code: `function __bp_timeout(d, fn, ms) {
  var t = setTimeout(fn, ms);
  d.push(function () { clearTimeout(t); });
  return t;
}`,
  },
  interval: {
    code: `function __bp_interval(d, fn, ms) {
  var t = setInterval(fn, ms);
  d.push(function () { clearInterval(t); });
  return t;
}`,
  },
  show: {
    code: `function __bp_show(el) {
  if (el.style.display === 'none') el.style.display = el.__bpDisplay || '';
  el.removeAttribute('hidden');
  var w = el.ownerDocument && el.ownerDocument.defaultView;
  if (w && w.getComputedStyle(el).display === 'none') el.style.display = 'block';
}`,
  },
  hide: {
    code: `function __bp_hide(el) {
  if (el.style.display && el.style.display !== 'none') el.__bpDisplay = el.style.display;
  el.style.display = 'none';
}`,
  },
  visible: {
    code: `function __bp_visible(el) {
  if (!el || !el.ownerDocument) return false;
  var w = el.ownerDocument.defaultView;
  return !!w && w.getComputedStyle(el).display !== 'none' && !el.hasAttribute('hidden');
}`,
  },
  dispatch: {
    code: `function __bp_dispatch(el, name, detail) {
  var w = (el.ownerDocument || el).defaultView || window;
  var ev;
  if (typeof w.CustomEvent === 'function') ev = new w.CustomEvent(name, { bubbles: true, cancelable: true, detail: detail });
  else { ev = (el.ownerDocument || el).createEvent('CustomEvent'); ev.initCustomEvent(name, true, true, detail); }
  el.dispatchEvent(ev);
}`,
  },
  lib: {
    code: `var __bp_lib = {
  resolve: function (w, path) {
    var parts = String(path).split('.'), ctx = w, val = w;
    for (var i = 0; i < parts.length; i++) {
      ctx = val;
      val = val == null ? undefined : val[parts[i]];
    }
    return { ctx: ctx, val: val };
  },
  get: function (w, path) { return this.resolve(w, path).val; },
  call: function (w, path, args) {
    var r = this.resolve(w, path);
    if (typeof r.val !== 'function') { if (typeof console !== 'undefined') console.warn('[blueprint] not a function: ' + path); return undefined; }
    return r.val.apply(r.ctx, args);
  },
  create: function (w, path, args) {
    var C = this.resolve(w, path).val;
    if (typeof C !== 'function') { if (typeof console !== 'undefined') console.warn('[blueprint] not a class: ' + path); return null; }
    return new (Function.prototype.bind.apply(C, [null].concat(args)))();
  },
  method: function (obj, name, args) {
    if (obj == null || typeof obj[name] !== 'function') { if (typeof console !== 'undefined') console.warn('[blueprint] no method ' + name); return undefined; }
    return obj[name].apply(obj, args);
  }
};`,
  },
  store: {
    code: `var __bp_store = {
  get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set: function (k, v) { try { window.localStorage.setItem(k, v == null ? '' : String(v)); } catch (e) {} },
  remove: function (k) { try { window.localStorage.removeItem(k); } catch (e) {} }
};`,
  },
};

/** Helper names in dependency order (dependencies first). */
export function resolveHelpers(names: Iterable<string>): string[] {
  const out: string[] = [];
  const visit = (n: string) => {
    if (out.includes(n)) return;
    const h = HELPERS[n];
    if (!h) throw new Error(`[blueprint] unknown helper "${n}"`);
    (h.deps || []).forEach(visit);
    out.push(n);
  };
  for (const n of names) visit(n);
  return out;
}
