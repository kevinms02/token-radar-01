import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Creates a lightweight DOM node mock for headless testing
 */
class MockNode {
  constructor(tag = 'div', attrs = {}, registry = null) {
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.className = attrs.class || '';
    this.id = attrs.id || '';
    this.isConnected = false;
    this.open = false;
    this._registry = registry;
    if (this.id && this._registry) {
      this._registry[this.id] = this;
    }
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'id') {
      this.id = String(v);
      if (this._registry) this._registry[this.id] = this;
    }
    if (k === 'open') this.open = true;
  }

  getAttribute(k) {
    return this.attributes[k] ?? null;
  }

  removeAttribute(k) {
    delete this.attributes[k];
    if (k === 'open') this.open = false;
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const fn of list) fn(event);
  }

  appendChild(child) {
    if (child) {
      this.children.push(child);
      child.parentNode = this;
      child.isConnected = this.isConnected;
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    return child;
  }

  querySelectorAll(selector) {
    const results = [];
    const check = (node) => {
      if (matchesSelector(node, selector)) results.push(node);
      for (const c of node.children) check(c);
    };
    for (const c of this.children) check(c);
    return results;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.dispatchEvent({ type: 'close' });
  }
}

function matchesSelector(node, sel) {
  if (sel.startsWith('#')) return node.id === sel.slice(1);
  if (sel.startsWith('.')) return (node.className || '').split(/\s+/).includes(sel.slice(1));
  if (sel.includes('[')) {
    const m = sel.match(/^([a-z0-9_-]*)\[([a-z0-9_-]+)(?:=([a-z0-9_-]+))?\]$/i);
    if (m) {
      const tag = m[1];
      const attr = m[2];
      const val = m[3];
      if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      if (val !== undefined) return node.getAttribute(attr) === val;
      return node.getAttribute(attr) !== null;
    }
  }
  return node.tagName.toLowerCase() === sel.toLowerCase();
}

/**
 * Loads data.js and evaluates it to extract window.RADAR
 */
export function loadRadarData(dataJsPath) {
  const code = readFileSync(dataJsPath, 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window.RADAR;
}

/**
 * Evaluates dashboard/app.js in a headless DOM context
 */
export function evaluateDashboardApp(dataJsPath, appJsPath) {
  const radarData = loadRadarData(dataJsPath);
  const appJsCode = readFileSync(appJsPath, 'utf8');

  const elementsById = {};
  const rootBoard = new MockNode('main', { id: 'board' }, elementsById);
  rootBoard.isConnected = true;
  elementsById.board = rootBoard;

  const listeners = {};
  const mockWindow = {
    RADAR: radarData,
    location: { hash: '', pathname: '/', search: '' },
    history: {
      replaceState: (state, title, url) => {
        if (url && url.includes('#')) {
          mockWindow.location.hash = url.slice(url.indexOf('#'));
        }
      },
    },
    addEventListener: (event, fn) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    dispatchEvent: (event) => {
      const list = listeners[event.type] || [];
      for (const fn of list) fn(event);
    },
  };

  const mockDocument = {
    getElementById: (id) => elementsById[id] || null,
    createElement: (tag, attrs) => new MockNode(tag, attrs, elementsById),
    createTextNode: (text) => new MockNode('text', { text }),
  };

  const context = {
    window: mockWindow,
    document: mockDocument,
    URLSearchParams: globalThis.URLSearchParams,
    Intl: globalThis.Intl,
    Math: globalThis.Math,
    isFinite: globalThis.isFinite,
    Array: globalThis.Array,
    Object: globalThis.Object,
    String: globalThis.String,
    Number: globalThis.Number,
    Set: globalThis.Set,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };

  vm.createContext(context);
  vm.runInContext(appJsCode, context);

  return {
    context,
    rootBoard,
    radarData,
    elementsById,
    window: mockWindow,
  };
}
