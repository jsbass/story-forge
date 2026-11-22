// Forge Script AST -> Twee 3 (SugarCube 2). Deterministic: same input, same output.
import { parseScript } from './parser.mjs';

const q = (s) => JSON.stringify(String(s));

/** Resolve '.local' targets against the passage's scene. */
export function resolveTarget(target, sceneId) {
  return target.startsWith('.') ? `${sceneId}${target}` : target;
}

export function speakerId(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function choiceHtml(c, target) {
  const body = [...c.set.map((e) => `<<set ${e}>>`), ...c.do].join('');
  const link = `<div class="forge-choice"><<link ${q(c.label)} ${q(target)}>>${body}<</link>></div>`;
  if (!c.requires) return link;
  if (c.otherwise === 'disabled') {
    return `<<if ${c.requires}>>${link}<<else>><div class="forge-choice forge-choice-disabled"><span>${c.label}</span></div><</if>>`;
  }
  return `<<if ${c.requires}>>${link}<</if>>`;
}

/**
 * Compile one parsed script.
 * @returns {{passages:{name,tags,text,source}[], refs:object}}
 */
export function compileAst(ast) {
  const refs = { media: [], lines: [], links: [], endings: [], speakers: new Set() };
  const out = [];

  for (const p of ast.passages) {
    const parts = [];
    if (!p.local) parts.push(`<<forge_scene ${q(p.scene)} ${q(p.title || p.scene)}>>`);
    let choiceRun = [];
    const flushChoices = () => {
      if (choiceRun.length) parts.push(`<div class="forge-choices">${choiceRun.join('')}</div>`);
      choiceRun = [];
    };

    for (const item of p.body) {
      if (item.type !== 'choice') flushChoices();
      switch (item.type) {
        case 'text':
          parts.push(`<p>${item.text}</p>`);
          break;
        case 'say': {
          const id = speakerId(item.speaker);
          refs.speakers.add(id);
          refs.lines.push({ passage: p.name, scene: p.scene, speaker: id, paren: item.paren, text: item.text, file: ast.file, line: item.line });
          const args = item.paren ? `${q(id)} ${q(item.paren)}` : q(id);
          parts.push(`<<forge_say ${args}>>${item.text}<</forge_say>>`);
          break;
        }
        case 'media':
          refs.media.push({ passage: p.name, kind: item.kind, args: item.args, file: ast.file, line: item.line });
          parts.push(`<<forge_media ${[item.kind, ...item.args].map(q).join(' ')}>>`);
          break;
        case 'set':
          parts.push(`<<set ${item.expr}>>`);
          break;
        case 'raw':
          parts.push(item.text);
          break;
        case 'cond':
          parts.push(item.kw === 'if' ? `<<if ${item.expr}>>` : item.kw === 'elseif' ? `<<elseif ${item.expr}>>` : item.kw === 'else' ? '<<else>>' : '<</if>>');
          break;
        case 'choice': {
          const target = resolveTarget(item.target, p.scene);
          refs.links.push({ from: p.name, to: target, label: item.label, conditional: !!item.requires, file: ast.file, line: item.line });
          choiceRun.push(choiceHtml(item, target));
          break;
        }
        case 'continue': {
          const target = resolveTarget(item.target, p.scene);
          refs.links.push({ from: p.name, to: target, label: item.label, conditional: false, file: ast.file, line: item.line });
          parts.push(`<div class="forge-choices"><div class="forge-choice forge-continue"><<link ${q(item.label)} ${q(target)}>><</link>></div></div>`);
          break;
        }
        case 'end':
          refs.endings.push({ id: item.id, title: item.title, passage: p.name, file: ast.file, line: item.line });
          parts.push(`<<forge_ending ${q(item.id)} ${q(item.title || 'The End')}>>`);
          break;
      }
    }
    flushChoices();

    const tags = ['nobr', p.local ? 'node' : 'scene', ...(p.ending ? ['ending'] : []), ...p.tags];
    out.push({ name: p.name, tags: [...new Set(tags)], text: parts.join('\n'), source: { file: ast.file, line: p.line } });
  }
  refs.speakers = [...refs.speakers];
  return { passages: out, refs };
}

/** Parse + compile a script file's text. Throws nothing; returns errors. */
export function compileScript(text, file) {
  const ast = parseScript(text, file);
  const { passages, refs } = compileAst(ast);
  return { ast, passages, refs, errors: ast.errors };
}

/**
 * Cross-file validation: unknown targets, unknown speakers, duplicate passages.
 * @param results array of compileScript() results
 * @param opts {characters?: string[], extraPassages?: string[]}
 */
export function validateScripts(results, opts = {}) {
  const errors = [];
  const names = new Map();
  for (const r of results) {
    for (const p of r.passages) {
      if (names.has(p.name)) errors.push({ file: p.source.file, line: p.source.line, message: `Passage '${p.name}' is also defined in ${names.get(p.name)}` });
      else names.set(p.name, `${p.source.file}:${p.source.line}`);
    }
  }
  const known = new Set([...names.keys(), ...(opts.extraPassages || [])]);
  const chars = opts.characters ? new Set(opts.characters) : null;
  for (const r of results) {
    for (const l of r.refs.links) {
      if (!known.has(l.to)) errors.push({ file: l.file, line: l.line, message: `Choice '${l.label}' points to unknown passage '${l.to}'` });
    }
    if (chars) {
      for (const line of r.refs.lines) {
        if (!chars.has(line.speaker)) errors.push({ file: line.file, line: line.line, message: `Unknown speaker '${line.speaker}'. Add characters/${line.speaker}.yaml or fix the name` });
      }
    }
  }
  return errors;
}

/** Serialise passages to Twee 3 text. */
export function toTwee(passages, header = '') {
  const blocks = passages.map((p) => {
    const tags = p.tags && p.tags.length ? ` [${p.tags.join(' ')}]` : '';
    const meta = p.position ? ` ${JSON.stringify({ position: p.position, size: p.size || '100,100' })}` : '';
    return `:: ${p.name}${tags}${meta}\n${p.text}\n`;
  });
  return (header ? header + '\n\n' : '') + blocks.join('\n');
}
