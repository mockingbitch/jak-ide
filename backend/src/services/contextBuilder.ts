import { buildTree, type TreeNode } from './fileService';

export interface AiContext {
  filePath?: string;
  fileContent?: string;
  selection?: { text: string; startLine: number; endLine: number };
}

function renderTree(node: TreeNode, depth: number, maxDepth: number, prefix = ''): string {
  if (depth > maxDepth) return '';
  let out = '';
  for (const c of node.children ?? []) {
    out += `${prefix}${c.type === 'dir' ? '📁' : '📄'} ${c.path || c.name}\n`;
    if (c.type === 'dir' && depth < maxDepth) {
      out += renderTree(c, depth + 1, maxDepth, prefix + '  ');
    }
  }
  return out;
}

/** A bounded, human-readable rendering of the project tree (default depth 3). */
export async function buildProjectTreeString(maxDepth = 3): Promise<string> {
  const tree = await buildTree();
  return renderTree(tree, 0, maxDepth).trim();
}

/** Extract the lines surrounding a selection (±`pad` lines), with line numbers. */
function windowAround(content: string, startLine: number, endLine: number, pad = 200): string {
  const lines = content.split('\n');
  const from = Math.max(0, startLine - 1 - pad);
  const to = Math.min(lines.length, endLine + pad);
  return lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1}: ${l}`)
    .join('\n');
}

/**
 * Assemble the project-aware context block that is prepended to the user's
 * latest message: project tree (depth 3) + current file (± selection window) + selection.
 */
export async function buildContextBlock(ctx: AiContext): Promise<string> {
  const parts: string[] = [];

  const tree = await buildProjectTreeString(3);
  parts.push(`## Project structure (max depth 3)\n${tree}`);

  if (ctx.filePath) {
    parts.push(`## Active file\nPath: \`${ctx.filePath}\``);
    if (ctx.fileContent != null) {
      if (ctx.selection) {
        const win = windowAround(ctx.fileContent, ctx.selection.startLine, ctx.selection.endLine, 200);
        parts.push(
          `## Active file content (±200 lines around the selection, line-numbered)\n\`\`\`\n${win}\n\`\`\``
        );
      } else {
        const numbered = ctx.fileContent
          .split('\n')
          .map((l, i) => `${i + 1}: ${l}`)
          .join('\n');
        const capped =
          numbered.length > 20000 ? numbered.slice(0, 20000) + '\n... (file truncated for context)' : numbered;
        parts.push(`## Active file content (line-numbered)\n\`\`\`\n${capped}\n\`\`\``);
      }
    }
  }

  if (ctx.selection?.text) {
    parts.push(
      `## Selected code (lines ${ctx.selection.startLine}-${ctx.selection.endLine})\n\`\`\`\n${ctx.selection.text}\n\`\`\``
    );
  }

  return parts.join('\n\n');
}
