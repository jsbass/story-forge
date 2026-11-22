// Forge Script parser: *.script.md -> AST.
// Format reference: skills/forge-script/reference.md
import { splitTopLevel } from '../lib/util.mjs';

const ID = '[A-Za-z][\\w-]*';
const TITLE_SEP = '\\s+[\u2014\u2013-]{1,2}\\s+';
const TAGS = '(?:\\s*\\[([^\\]]*)\\])?';
const TARGET = `\\.?${ID}(?:\\.${ID})?`;

const SCENE_RE = new RegExp(`^#\\s+SCENE\\s+(${ID})(?:${TITLE_SEP}(.*?))?${TAGS}\\s*$`);
const NODE_RE = new RegExp(`^##\\s+(${ID})(?:${TITLE_SEP}(.*?))?${TAGS}\\s*$`);
const CHOICE_RE = new RegExp(`^\\*\\s+\\[(.+?)\\]\\s*->\\s*(${TARGET})\\s*(?:\\{(.*)\\})?\\s*$`);
const GOTO_RE = new RegExp(`^->\\s*(${TARGET})\\s*(?:\\[(.+?)\\])?\\s*$`);
const END_RE = new RegExp(`^END\\s+(${ID})(?:\\s+"([^"]*)"|${TITLE_SEP}(.+?))?\\s*$`);
const SPEECH_RE = /^([A-Z][A-Z0-9_]*(?: [A-Z0-9_]+)*)\s*(?:\(([^)]*)\))?:\s+(.+)$/;
const COND_RE = /^\?\?\s+(if|elseif|else|end)\b\s*(.*)$/;
const DIRECTIVE_RE = /@([a-z_]+)((?:[ \t]+[^\s@]\S*)*)/g;
const ASSIGN_RE = /^[$_][A-Za-z_]\w*(?:\.\w+|\[[^\]]+\])*\s*(?:=(?!=)|\+=|-=|\*=|\/=|to\b)\s*\S.*$/;

export const MEDIA_KINDS = ['bg', 'music', 'ambience', 'sfx', 'portrait', 'video', 'voice'];

function parseTags(s) {
  return s ? s.split(/\s+/).filter(Boolean) : [];
}

/**
 * Parse Forge Script text.
 * @returns {{file:string, passages:object[], errors:{file,line,message}[]}}
 */
export function parseScript(text, file = 'script') {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const passages = [];
  const errors = [];
  const err = (line, message) => errors.push({ file, line, message });

  let scene = null;
  let cur = null;
  let condStack = [];
  let para = [];
  let paraLine = 0;

  const flushPara = () => {
    if (para.length && cur) cur.body.push({ type: 'text', text: para.join(' '), line: paraLine });
    para = [];
  };
  const closePassage = () => {
    flushPara();
    if (cur && condStack.length) err(condStack[condStack.length - 1], `'?? if' opened here is never closed with '?? end' in ${cur.name}`);
    condStack = [];
  };
  const push = (item) => {
    flushPara();
    cur.body.push(item);
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const line = lines[i].trim();
    if (!line) { flushPara(); continue; }
    if (line.startsWith('//')) continue;

    let m;
    if ((m = SCENE_RE.exec(line))) {
      closePassage();
      scene = { id: m[1] };
      cur = { name: m[1], scene: m[1], local: null, title: (m[2] || '').trim(), tags: parseTags(m[3]), line: ln, body: [], ending: null };
      passages.push(cur);
      continue;
    }
    if (/^#\s/.test(line)) { err(ln, `Malformed scene header. Expected '# SCENE <id> — <Title> [tags]'`); continue; }
    if ((m = NODE_RE.exec(line))) {
      if (!scene) { err(ln, `'## ${m[1]}' appears before any '# SCENE' header`); continue; }
      closePassage();
      cur = { name: `${scene.id}.${m[1]}`, scene: scene.id, local: m[1], title: (m[2] || '').trim(), tags: parseTags(m[3]), line: ln, body: [], ending: null };
      passages.push(cur);
      continue;
    }
    if (/^##/.test(line)) { err(ln, `Malformed node header. Expected '## <id> — <Title> [tags]'`); continue; }
    if (!cur) { err(ln, 'Content before the first "# SCENE" header'); continue; }

    if (line.startsWith('@')) {
      const directives = [];
      let rest = line;
      DIRECTIVE_RE.lastIndex = 0;
      while ((m = DIRECTIVE_RE.exec(line))) {
        const args = m[2].trim().split(/\s+/).filter(Boolean);
        if (!MEDIA_KINDS.includes(m[1])) err(ln, `Unknown directive '@${m[1]}'. Known: ${MEDIA_KINDS.map((k) => '@' + k).join(' ')}`);
        else if (!args.length) err(ln, `'@${m[1]}' needs an asset id`);
        else directives.push({ kind: m[1], args });
        rest = rest.replace(m[0], '');
      }
      if (rest.trim()) err(ln, `Unexpected text on directive line: '${rest.trim()}'`);
      for (const d of directives) push({ type: 'media', ...d, line: ln });
      continue;
    }

    if ((m = CHOICE_RE.exec(line))) {
      const mods = parseMods(m[3], (msg) => err(ln, msg));
      push({ type: 'choice', label: m[1].trim(), target: m[2], ...mods, line: ln });
      continue;
    }
    if (line.startsWith('*')) { err(ln, `Malformed choice. Expected '* [Label] -> target {mods}'`); continue; }

    if ((m = GOTO_RE.exec(line))) {
      push({ type: 'continue', target: m[1], label: m[2] ? m[2].trim() : 'Continue', line: ln });
      continue;
    }
    if (line.startsWith('->')) { err(ln, `Malformed continue. Expected '-> target [Label]'`); continue; }

    if ((m = END_RE.exec(line))) {
      if (cur.ending) err(ln, `Passage ${cur.name} already has an END`);
      cur.ending = { id: m[1], title: (m[2] ?? m[3] ?? '').trim() };
      push({ type: 'end', id: m[1], title: cur.ending.title, line: ln });
      continue;
    }

    if ((m = COND_RE.exec(line))) {
      const [, kw, exprRaw] = m;
      const expr = exprRaw.trim();
      if (kw === 'if') {
        if (!expr) err(ln, `'?? if' needs a condition`);
        condStack.push(ln);
      } else if (kw === 'elseif') {
        if (!condStack.length) err(ln, `'?? elseif' without '?? if'`);
        if (!expr) err(ln, `'?? elseif' needs a condition`);
      } else if (kw === 'else') {
        if (!condStack.length) err(ln, `'?? else' without '?? if'`);
      } else if (kw === 'end') {
        if (!condStack.length) err(ln, `'?? end' without '?? if'`);
        else condStack.pop();
      }
      push({ type: 'cond', kw, expr, line: ln });
      continue;
    }

    if (line.startsWith('>')) {
      for (const stmt of splitTopLevel(line.slice(1), ';').map((s) => s.trim()).filter(Boolean)) {
        const expr = stmt.replace(/^set\s+/, '');
        if (!ASSIGN_RE.test(expr)) err(ln, `Not an assignment: '${stmt}'. Expected e.g. '> set $trust += 1'`);
        push({ type: 'set', expr, line: ln });
      }
      continue;
    }

    if (line.startsWith('<<')) { push({ type: 'raw', text: line, line: ln }); continue; }

    if ((m = SPEECH_RE.exec(line))) {
      push({ type: 'say', speaker: m[1], paren: m[2] ? m[2].trim() : null, text: m[3].trim(), line: ln });
      continue;
    }

    if (!para.length) paraLine = ln;
    para.push(line);
  }
  closePassage();

  const seen = new Map();
  for (const p of passages) {
    if (seen.has(p.name)) err(p.line, `Duplicate passage '${p.name}' (first defined on line ${seen.get(p.name)})`);
    else seen.set(p.name, p.line);
  }
  return { file, passages, errors };
}

/** Parse `{set ...; requires ...; else disabled; do <<macro>>}` choice modifiers. */
export function parseMods(s, err) {
  const mods = { set: [], do: [], requires: null, otherwise: 'hidden' };
  if (!s) return mods;
  for (const raw of splitTopLevel(s, ';')) {
    const part = raw.trim();
    if (!part) continue;
    let m;
    if ((m = /^set\s+(.+)$/.exec(part))) {
      if (!ASSIGN_RE.test(m[1].trim())) err(`Not an assignment in choice modifier: '${part}'`);
      mods.set.push(m[1].trim());
    } else if ((m = /^requires\s+(.+)$/.exec(part))) {
      if (mods.requires) err(`Choice has more than one 'requires'. Combine with && instead`);
      mods.requires = m[1].trim();
    } else if ((m = /^else\s+(hidden|disabled)$/.exec(part))) {
      mods.otherwise = m[1];
    } else if ((m = /^do\s+(<<.+>>)$/.exec(part))) {
      mods.do.push(m[1]);
    } else {
      err(`Unknown choice modifier '${part}'. Use: set <assignment> | requires <expr> | else hidden|disabled | do <<macro>>`);
    }
  }
  return mods;
}
