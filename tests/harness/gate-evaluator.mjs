import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDossier, DOSSIER_MAX_BYTES } from '../../vendor/makefun-board.ts';

const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function opensWith(bytes, magic) {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

/**
 * Extracts dimensions from PNG or JPEG buffer
 */
function getImageDimensions(buf) {
  if (opensWith(buf, PNG_MAGIC) && buf.length >= 24) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
  if (opensWith(buf, JPEG_MAGIC)) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      // Baseline DCT (SOF0) or Progressive DCT (SOF2)
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      const length = buf.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
  }
  return null;
}

/**
 * Scans a directory recursively checking file names, dot-dirs, and size limits
 */
function walkDashboardDir(dir, relPath = '') {
  const current = relPath === '' ? dir : join(dir, relPath);
  const entries = readdirSync(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const p = relPath === '' ? entry.name : `${relPath}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) {
        throw new Error(`dashboard/${p} is a dot-directory`);
      }
      files.push(...walkDashboardDir(dir, p));
    } else if (entry.isFile()) {
      if (!PLAIN_NAME.test(entry.name)) {
        throw new Error(`dashboard/${p}: filename does not match allowed pattern`);
      }
      const fullPath = join(dir, p);
      const stat = lstatSync(fullPath);
      files.push({ relPath: p, fullPath, size: stat.size });
    } else {
      throw new Error(`dashboard/${p} is neither a file nor a directory`);
    }
  }
  return files;
}

/**
 * Checks for forbidden http:// or https:// in dashboard files
 */
function checkZeroNetwork(file) {
  const content = readFileSync(file.fullPath, 'utf8');
  const ext = file.relPath.slice(file.relPath.lastIndexOf('.')).toLowerCase();

  if (ext === '.html') {
    // Check HTML attribute values (href, src, data-*, action, etc.)
    const attrRegex = /\b[a-zA-Z0-9_-]+\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = attrRegex.exec(content)) !== null) {
      return { pass: false, reason: `Found external URL in HTML attribute: ${match[1]} in ${file.relPath}` };
    }
    // Check <style> tag bodies
    const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    while ((match = styleRegex.exec(content)) !== null) {
      if (/https?:\/\//i.test(match[1])) {
        return { pass: false, reason: `Found external URL in <style> body in ${file.relPath}` };
      }
    }
    // Check inline scripts for remote imports
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    while ((match = scriptRegex.exec(content)) !== null) {
      if (/(?:import|require)\s*\(\s*["']https?:\/\//i.test(match[1])) {
        return { pass: false, reason: `Found remote script import in inline script in ${file.relPath}` };
      }
    }
  } else if (ext === '.css') {
    // Check CSS url() and @import
    if (/url\s*\(\s*["']?https?:\/\//i.test(content) || /@import\s+["']?https?:\/\//i.test(content)) {
      return { pass: false, reason: `Found external URL in CSS file: ${file.relPath}` };
    }
  } else if (ext === '.js' || ext === '.mjs') {
    // Check JS module imports / exports / requires with http:// or https://
    const importRegex = /(?:import|export\s+.*\s+from|require)\s*\(?\s*["']https?:\/\//i;
    if (importRegex.test(content)) {
      return { pass: false, reason: `Found external URL in JS import/export: ${file.relPath}` };
    }
  }

  return { pass: true };
}

/**
 * Evaluates the 7 official competition gates
 */
export function evaluateGates(outputDir, snapshotPath) {
  const gates = {
    dashboard_files: { pass: false, detail: '' },
    board_file: { pass: false, detail: '' },
    sorted_by_value: { pass: false, detail: '' },
    coverage: { pass: false, detail: '' },
    farm_steps: { pass: false, detail: '' },
    screenshots: { pass: false, detail: '' },
    dossier_matches: { pass: false, detail: '' },
  };

  // Read snapshot
  let snapshot;
  try {
    const rawSnap = readFileSync(snapshotPath, 'utf8');
    snapshot = JSON.parse(rawSnap);
  } catch (err) {
    return {
      valid: 0,
      error: `Failed to read snapshot: ${err.message}`,
      gates,
    };
  }

  const validSnapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const watchlistSlugs = new Set(snapshot.watchlist);

  // --- Gate 1: dashboard_files ---
  try {
    const dashDir = join(outputDir, 'dashboard');
    if (!existsSync(dashDir) || !lstatSync(dashDir).isDirectory()) {
      gates.dashboard_files = { pass: false, detail: 'no dashboard/ directory' };
    } else {
      const files = walkDashboardDir(dashDir);
      const hasIndexHtml = files.some((f) => f.relPath === 'index.html');
      const hasCss = files.some((f) => f.relPath.endsWith('.css'));
      const hasJs = files.some((f) => f.relPath.endsWith('.js') || f.relPath.endsWith('.mjs'));
      const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

      if (!hasIndexHtml) {
        gates.dashboard_files = { pass: false, detail: 'missing index.html in dashboard/' };
      } else if (!hasCss) {
        gates.dashboard_files = { pass: false, detail: 'missing at least one .css file in dashboard/' };
      } else if (!hasJs) {
        gates.dashboard_files = { pass: false, detail: 'missing at least one .js file in dashboard/' };
      } else if (files.length > 400) {
        gates.dashboard_files = { pass: false, detail: `dashboard holds ${files.length} files (max 400)` };
      } else if (totalBytes > 4 * 1024 * 1024) {
        gates.dashboard_files = { pass: false, detail: `dashboard total bytes ${totalBytes} exceeds 4 MiB` };
      } else {
        // Zero-network check
        let zeroNetworkPass = true;
        let offenseReason = '';
        for (const f of files) {
          const zn = checkZeroNetwork(f);
          if (!zn.pass) {
            zeroNetworkPass = false;
            offenseReason = zn.reason;
            break;
          }
        }
        if (!zeroNetworkPass) {
          gates.dashboard_files = { pass: false, detail: offenseReason };
        } else {
          gates.dashboard_files = { pass: true, detail: `${files.length} files, ${totalBytes} bytes, offline verified` };
        }
      }
    }
  } catch (err) {
    gates.dashboard_files = { pass: false, detail: err.message };
  }

  // --- Read board.json ---
  let boardRows = null;
  const boardPath = join(outputDir, 'board.json');
  try {
    if (!existsSync(boardPath)) {
      gates.board_file = { pass: false, detail: 'board.json does not exist' };
    } else {
      const boardStat = lstatSync(boardPath);
      if (boardStat.size > 8 * 1024 * 1024) {
        gates.board_file = { pass: false, detail: `board.json size ${boardStat.size} exceeds 8 MiB` };
      } else {
        const rawBoard = readFileSync(boardPath, 'utf8');
        const parsed = JSON.parse(rawBoard);
        boardRows = Array.isArray(parsed) ? parsed : parsed.rows;
        if (!Array.isArray(boardRows)) {
          gates.board_file = { pass: false, detail: 'board.json does not contain rows array' };
        } else if (boardRows.length < 100 || boardRows.length > 4000) {
          gates.board_file = { pass: false, detail: `board has ${boardRows.length} rows, must be between 100 and 4000` };
        } else {
          // Validate individual rows
          let rowError = null;
          const seenSlugs = new Set();
          for (let i = 0; i < boardRows.length; i++) {
            const r = boardRows[i];
            if (!r || typeof r !== 'object') {
              rowError = `row ${i + 1} is not an object`;
              break;
            }
            if (typeof r.slug !== 'string' || r.slug.length === 0 || r.slug.length > 128 || /\s/.test(r.slug)) {
              rowError = `row ${i + 1} has invalid slug`;
              break;
            }
            if (!validSnapshotSlugs.has(r.slug)) {
              rowError = `row ${i + 1} slug "${r.slug}" is invented (not in snapshot)`;
              break;
            }
            if (seenSlugs.has(r.slug)) {
              rowError = `duplicate slug "${r.slug}" at row ${i + 1}`;
              break;
            }
            seenSlugs.add(r.slug);
            if (typeof r.name !== 'string' || r.name.length === 0) {
              rowError = `row ${i + 1} (${r.slug}) has empty name`;
              break;
            }
            if (!Number.isSafeInteger(r.rank) || r.rank < 1) {
              rowError = `row ${i + 1} (${r.slug}) has invalid rank: ${r.rank}`;
              break;
            }
            if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 100_000_000_000_000) {
              rowError = `row ${i + 1} (${r.slug}) has invalid implied_value_usd: ${r.implied_value_usd}`;
              break;
            }
          }

          if (rowError) {
            gates.board_file = { pass: false, detail: rowError };
          } else if (boardRows.length >= 2 && boardRows.every((r) => r.implied_value_usd === boardRows[0].implied_value_usd)) {
            gates.board_file = { pass: false, detail: 'a board that ranks nothing by value is not a ranking (all values identical)' };
          } else {
            gates.board_file = { pass: true, detail: `${boardRows.length} rows valid` };
          }
        }
      }
    }
  } catch (err) {
    gates.board_file = { pass: false, detail: err.message };
  }

  // --- Gate 3: sorted_by_value ---
  if (boardRows && gates.board_file.pass) {
    let sortError = null;
    const ranks = boardRows.map((r) => r.rank).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i] !== i + 1) {
        sortError = `ranks not contiguous: expected ${i + 1}, got ${ranks[i]}`;
        break;
      }
    }
    if (!sortError) {
      for (let i = 1; i < boardRows.length; i++) {
        if (boardRows[i].implied_value_usd > boardRows[i - 1].implied_value_usd) {
          sortError = `row ${i + 1} ($${boardRows[i].implied_value_usd}) exceeds row ${i} ($${boardRows[i - 1].implied_value_usd})`;
          break;
        }
      }
    }
    if (sortError) {
      gates.sorted_by_value = { pass: false, detail: sortError };
    } else {
      gates.sorted_by_value = { pass: true, detail: `ranks 1..${boardRows.length} monotonically non-increasing` };
    }
  } else {
    gates.sorted_by_value = { pass: false, detail: 'board_file check failed' };
  }

  // --- Gate 4: coverage ---
  if (boardRows) {
    const boardSlugs = new Set(boardRows.map((r) => r.slug));
    const missing = snapshot.watchlist.filter((s) => !boardSlugs.has(s));
    if (missing.length > 0) {
      gates.coverage = { pass: false, detail: `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 3).join(', ')}` };
    } else {
      gates.coverage = { pass: true, detail: `100% of ${snapshot.watchlist.length} watchlist slugs covered` };
    }
  } else {
    gates.coverage = { pass: false, detail: 'board_file check failed' };
  }

  // --- Gate 5: farm_steps ---
  if (boardRows) {
    let farmError = null;
    for (let i = 0; i < boardRows.length; i++) {
      const r = boardRows[i];
      const steps = r.farm_steps;
      if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
        farmError = `${r.slug} has ${Array.isArray(steps) ? steps.length : 0} farm steps (allowed 3-12)`;
        break;
      }
      for (let j = 0; j < steps.length; j++) {
        const step = steps[j];
        if (typeof step !== 'string') {
          farmError = `${r.slug} step ${j + 1} is not a string`;
          break;
        }
        const trimmed = step.trim();
        if (trimmed.length < 20 || trimmed.length > 600) {
          farmError = `${r.slug} step ${j + 1} length is ${trimmed.length} chars (allowed 20-600)`;
          break;
        }
      }
      if (farmError) break;
    }
    if (farmError) {
      gates.farm_steps = { pass: false, detail: farmError };
    } else {
      gates.farm_steps = { pass: true, detail: `All ${boardRows.length} rows have 3-12 compliant farm steps` };
    }
  } else {
    gates.farm_steps = { pass: false, detail: 'board_file check failed' };
  }

  // --- Gate 6: screenshots ---
  try {
    const shotsDir = join(outputDir, 'screenshots');
    if (!existsSync(shotsDir) || !lstatSync(shotsDir).isDirectory()) {
      gates.screenshots = { pass: false, detail: 'no screenshots/ directory' };
    } else {
      const entries = readdirSync(shotsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name);

      if (entries.length < 3 || entries.length > 4) {
        gates.screenshots = { pass: false, detail: `screenshots/ holds ${entries.length} images (allowed 3-4)` };
      } else {
        let shotError = null;
        for (const name of entries) {
          if (!PLAIN_NAME.test(name)) {
            shotError = `screenshots/${name}: invalid filename`;
            break;
          }
          const shotPath = join(shotsDir, name);
          const buf = readFileSync(shotPath);
          if (buf.length > 524288) {
            shotError = `screenshots/${name} is ${buf.length} bytes, exceeds 512 KiB`;
            break;
          }
          const dims = getImageDimensions(buf);
          if (!dims) {
            shotError = `screenshots/${name} is neither valid PNG nor JPEG`;
            break;
          }
          const longSide = Math.max(dims.width, dims.height);
          const shortSide = Math.min(dims.width, dims.height);
          if (longSide > 1440) {
            shotError = `screenshots/${name} long side ${longSide}px exceeds 1440px`;
            break;
          }
          if (shortSide < 800) {
            shotError = `screenshots/${name} short side ${shortSide}px is below 800px`;
            break;
          }
        }
        if (shotError) {
          gates.screenshots = { pass: false, detail: shotError };
        } else {
          gates.screenshots = { pass: true, detail: `${entries.length} valid images (dimensions & byte caps verified)` };
        }
      }
    }
  } catch (err) {
    gates.screenshots = { pass: false, detail: err.message };
  }

  // --- Gate 7: dossier_matches ---
  try {
    const dossierPath = join(outputDir, 'dossier.json');
    if (!existsSync(dossierPath)) {
      gates.dossier_matches = { pass: false, detail: 'dossier.json does not exist' };
    } else {
      const actualBytes = readFileSync(dossierPath);
      if (actualBytes.length > 1572864) {
        gates.dossier_matches = { pass: false, detail: `dossier.json is ${actualBytes.length} bytes, exceeds 1.5 MiB` };
      } else {
        const expectedBytes = buildDossier(outputDir, { text_max_bytes: 65536 });
        if (Buffer.compare(actualBytes, expectedBytes) !== 0) {
          gates.dossier_matches = { pass: false, detail: 'dossier.json does not match buildDossier byte-for-byte' };
        } else {
          gates.dossier_matches = { pass: true, detail: `${actualBytes.length} bytes, byte-for-byte match verified` };
        }
      }
    }
  } catch (err) {
    gates.dossier_matches = { pass: false, detail: err.message };
  }

  const allPassed = Object.values(gates).every((g) => g.pass);
  return {
    valid: allPassed ? 1 : 0,
    gates,
  };
}
