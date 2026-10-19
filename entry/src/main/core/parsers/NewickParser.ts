/**
 * Newick tree parser — replaces parsers/newick_parser.py
 * Full implementation with branch lengths, support values, comments.
 */

export interface NewickNode {
  name: string;
  branchLength: number;
  support: number | null;
  comment: string;
  children: NewickNode[];
}

/** Newick parse failure with position info. */
export class NewickParseError extends Error {
  constructor(message: string, public position: number = 0) {
    super(position > 0 ? `${message} (at position ${position})` : message);
    this.name = 'NewickParseError';
  }
}

export function parseNewick(s: string): NewickNode {
  const str = s.trim().replace(/;\s*$/, '');
  let pos = 0;

  function skipWs(): void { while (pos < str.length && /\s/.test(str[pos])) pos++; }

  // Fixed: use array for efficient string building
  function readUntil(chars: string): string {
    const charsArr: string[] = [];
    while (pos < str.length && !chars.includes(str[pos])) { charsArr.push(str[pos]); pos++; }
    return charsArr.join('');
  }

  function readComment(): string {
    // Fixed: bounds check before accessing str[pos]
    if (pos >= str.length || str[pos] !== '[') return '';
    pos++;
    const comment = readUntil(']');
    // Fixed: handle missing closing bracket
    if (pos < str.length && str[pos] === ']') {
      pos++; // skip ]
    }
    return comment;
  }

  function parseNode(): NewickNode {
    skipWs();
    // Fixed: bounds check
    if (pos >= str.length) {
      throw new NewickParseError('Unexpected end of Newick string', pos);
    }

    const node: NewickNode = { name: '', branchLength: 0, support: null, comment: '', children: [] };

    if (str[pos] === '(') {
      pos++;
      skipWs();
      if (pos < str.length && str[pos] === ')') {
        throw new NewickParseError('Empty element in Newick tree', pos);
      }
      node.children.push(parseNode());
      for (;;) {
        skipWs();
        if (pos < str.length && str[pos] === ',') {
          pos++;
          skipWs();
          if (pos < str.length && str[pos] === ')') {
            throw new NewickParseError('Empty element (stray ",") in Newick tree', pos);
          }
          node.children.push(parseNode());
          continue;
        }
        break;
      }
      skipWs();
      // A missing closing parenthesis used to be accepted silently, which
      // turned a truncated tree into a smaller but perfectly plausible one.
      if (pos >= str.length || str[pos] !== ')') {
        throw new NewickParseError('Unbalanced parentheses: expected ")"', pos);
      }
      pos++;
      node.comment = readComment();
    }

    // Read name (and possibly support value)
    skipWs();
    const nameStart = pos;
    while (pos < str.length && !':,);['.includes(str[pos])) pos++;
    const label = str.slice(nameStart, pos).trim();
    node.comment += readComment();

    if (node.children.length > 0) {
      // After the closing parenthesis the text is a support value, an
      // internal label, or both (`)0.9Homo`). The old code only accepted a
      // support value when the WHOLE text was a number, so `0.9Homo` became
      // the name "0.9Homo" and the support value was lost.
      const supportMatch = label.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([\s\S]*)$/);
      if (supportMatch) {
        node.support = parseFloat(supportMatch[1]);
        const rest = supportMatch[2].trim();
        if (rest) node.name = rest;
      } else if (label) {
        node.name = label;
      }
    } else {
      node.name = label;
    }

    // Read branch length
    if (pos < str.length && str[pos] === ':') {
      pos++;
      const blStr = readUntil(',);[');
      node.branchLength = parseFloat(blStr) || 0;
    }
    // Fixed: bounds check before calling readComment
    if (pos < str.length) node.comment += readComment();

    return node;
  }

  const root = parseNode();
  skipWs();
  if (pos < str.length) {
    // Trailing junk (e.g. "A,B" — the second name used to be dropped
    // silently) means the tree is not what the file says it is.
    throw new NewickParseError(`Unexpected character "${str[pos]}" after the tree`, pos);
  }
  return root;
}

export function toNewick(node: NewickNode): string {
  if (node.children.length === 0) {
    let s = node.name;
    if (node.branchLength > 0) s += ':' + node.branchLength;
    return s;
  }
  let s = '(' + node.children.map(c => toNewick(c)).join(',') + ')';
  // Support value first, then the label — the order `parseNewick` reads.
  if (node.support !== null) {
    s += String(node.support);
  }
  if (node.name) s += node.name;
  if (node.branchLength > 0) s += ':' + node.branchLength;
  return s;
}

export function countTaxa(node: NewickNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + countTaxa(c), 0);
}

export function getLeafNames(node: NewickNode): string[] {
  if (node.children.length === 0) return [node.name];
  return node.children.flatMap(c => getLeafNames(c));
}

export function getTreeHeight(node: NewickNode): number {
  if (node.children.length === 0) return node.branchLength;
  return node.branchLength + Math.max(...node.children.map(c => getTreeHeight(c)));
}

/**
 * Parse a file/string containing one or more Newick trees separated by ';'.
 * Equivalent to Python's read_newick_file(). Whitespace and comments between
 * trees are tolerated.
 */
export function readNewickBatch(content: string): NewickNode[] {
  const trees: NewickNode[] = [];
  if (!content || !content.trim()) return trees;
  const cleaned = content.replace(/\[.*?\]/g, '').trim();
  const parts = cleaned.split(';').map(p => p.trim()).filter(p => p.length > 0);
  for (const p of parts) trees.push(parseNewick(p));
  return trees;
}
