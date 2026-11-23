// Dialog extraction + knowledge-timeline risk analysis for the character QA agent.
import { shortestPath } from './static.mjs';

/** All dialog lines, optionally for one character. */
export function linesFor(manifest, characterId = null) {
  return manifest.lines.filter((l) => !characterId || l.speaker === characterId);
}

/**
 * For each character knowledge fact {fact, learned_at}, find lines spoken by that character
 * in passages the player can reach from the start WITHOUT passing through the learned_at scene.
 * Those lines must not reveal the fact; the QA agent reviews them.
 */
export function knowledgeRisks(manifest, graph, characters) {
  const risks = [];
  for (const c of characters) {
    for (const k of c.knowledge || []) {
      if (!k.learned_at) continue;
      const scene = k.learned_at;
      const inScene = (n) => n === scene || n.startsWith(scene + '.');
      const atRisk = [];
      for (const line of linesFor(manifest, c.id)) {
        if (inScene(line.passage)) continue;
        const pathAvoiding = shortestPath(graph, graph.start, line.passage, { avoid: inScene });
        if (pathAvoiding) atRisk.push({ ...line, route: pathAvoiding });
      }
      risks.push({ character: c.id, fact: k.fact, learned_at: scene, linesAtRisk: atRisk });
    }
  }
  return risks;
}
