import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

// Unicode regex matching typical emojis and emoji symbol blocks
const EMOJI_REGEX = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u;

/**
 * Audits dashboard files for Emil Kowalski aesthetics and anti-AI-slop guidelines
 */
export function auditDashboardAesthetics(dashboardDir) {
  const issues = [];
  const findings = {
    hasTabularNums: false,
    hasActivePressState: false,
    hasSub300msTransitions: false,
    hasCustomEasing: false,
    hasSkipLink: false,
    hasDialogDrawer: false,
    zeroEmojis: true,
    fontStackValid: false,
    totalSourceBytes: 0,
  };

  const htmlPath = join(dashboardDir, 'index.html');
  const cssPath = join(dashboardDir, 'app.css');
  const jsPath = join(dashboardDir, 'app.js');

  let html = '';
  let css = '';
  let js = '';

  try {
    html = readFileSync(htmlPath, 'utf8');
    findings.totalSourceBytes += Buffer.byteLength(html, 'utf8');
  } catch {
    issues.push('Missing or unreadable index.html');
  }

  try {
    css = readFileSync(cssPath, 'utf8');
    findings.totalSourceBytes += Buffer.byteLength(css, 'utf8');
  } catch {
    issues.push('Missing or unreadable app.css');
  }

  try {
    js = readFileSync(jsPath, 'utf8');
    findings.totalSourceBytes += Buffer.byteLength(js, 'utf8');
  } catch {
    issues.push('Missing or unreadable app.js');
  }

  // 1. Emoji check across all files
  if (EMOJI_REGEX.test(html) || EMOJI_REGEX.test(css) || EMOJI_REGEX.test(js)) {
    findings.zeroEmojis = false;
    issues.push('Found emojis in dashboard source code (violates anti-AI-slop rule)');
  }

  // 2. Skip link check
  if (html.includes('class="skip"') && html.includes('href="#board"')) {
    findings.hasSkipLink = true;
  } else {
    issues.push('index.html is missing semantic skip link (<a class="skip" href="#board">)');
  }

  // 3. Tabular numbers in CSS
  if (css.includes('tabular-nums')) {
    findings.hasTabularNums = true;
  } else {
    issues.push('app.css does not enforce font-variant-numeric: tabular-nums');
  }

  // 4. Interactive press state or button styling
  if (css.includes('scale') || css.includes(':active') || css.includes('button') || css.includes('cursor: pointer')) {
    findings.hasActivePressState = true;
  } else {
    issues.push('app.css does not include interactive button styling');
  }

  // 5. Transitions sub-300ms
  const transitionMatches = css.match(/transition:[^;]+;/g) || [];
  let foundFastTransition = false;
  for (const t of transitionMatches) {
    if (/(?:1[0-9]{2}|2[0-9]{2}|[1-9]0)ms/.test(t) || /0\.[1-3]s/.test(t)) {
      foundFastTransition = true;
      break;
    }
  }
  if (foundFastTransition || css.includes('150ms') || css.includes('200ms') || css.includes('220ms')) {
    findings.hasSub300msTransitions = true;
  } else {
    issues.push('app.css does not use sub-300ms transitions');
  }

  // 6. Custom easing curve
  if (css.includes('cubic-bezier')) {
    findings.hasCustomEasing = true;
  }

  // 7. Font stack validation
  if (css.includes('Geist') || css.includes('JetBrains') || css.includes('Inter') || css.includes('monospace')) {
    findings.fontStackValid = true;
  } else {
    issues.push('app.css font-family does not specify Geist Mono, JetBrains Mono, Inter or monospace');
  }

  // 8. Sliding dialog drawer check in app.js / html
  if (html.includes('<dialog') || js.includes('<dialog') || js.includes('showModal') || js.includes('drawer')) {
    findings.hasDialogDrawer = true;
  } else {
    issues.push('Dashboard does not implement a modal sliding dialog drawer');
  }

  // 9. Source size cap (< 65,536 bytes)
  if (findings.totalSourceBytes >= 65536) {
    issues.push(`Dashboard total source bytes (${findings.totalSourceBytes}) exceeds 65,536 byte dossier text limit`);
  }

  return {
    valid: issues.length === 0,
    issues,
    findings,
  };
}

/**
 * Performs strict zero-network scan on all files
 */
export function auditZeroNetwork(dashboardDir) {
  const violations = [];
  const entries = readdirSync(dashboardDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      const fullPath = join(dashboardDir, entry.name);
      const content = readFileSync(fullPath, 'utf8');
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();

      if (ext === '.html') {
        const attrRegex = /\b[a-zA-Z0-9_-]+\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
        let match;
        while ((match = attrRegex.exec(content)) !== null) {
          violations.push({ file: entry.name, location: 'HTML attribute', url: match[1] });
        }
      } else if (ext === '.css') {
        if (/url\s*\(\s*["']?https?:\/\//i.test(content)) {
          violations.push({ file: entry.name, location: 'CSS url()', url: 'external url()' });
        }
        if (/@import\s+["']?https?:\/\//i.test(content)) {
          violations.push({ file: entry.name, location: 'CSS @import', url: 'external @import' });
        }
      } else if (ext === '.js') {
        if (/(?:import|require)\s*\(?\s*["']https?:\/\//i.test(content)) {
          violations.push({ file: entry.name, location: 'JS import', url: 'external import/require' });
        }
      }
    }
  }

  return {
    clean: violations.length === 0,
    violations,
  };
}
