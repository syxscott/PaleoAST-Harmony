/**
 * Newick tree parser ¡ª replaces parsers/newick_parser.py
 * Full implementation with branch lengths, support values, comments.
 */

export interface NewickNode {
  name: string;
  branchLength: number;
  support: number | null;
  comment: string;
  children: NewickNode[];
}

export function parseNewick(s: string): NewickNode {
  const str = s.trim().replace(/;\s*$/, '');
  let pos = 0;

  function skipWs(): void { while (pos < str.length && /\s/.test(str[pos])) pos++; }

  function readUntil(chars: string): string {
    let result = '';
    while (pos < str.length && !chars.includes(str[pos])) { result += str[pos]; pos++; }
    return result;
  }

  function readComment(): string {
    if (str[pos] !== '[') return '';
    pos++;
    const comment = readUntil(']');
    if (pos < str.length) pos++; // skip ]
    return comment;
  }

  function parseNode(): NewickNode {
    skipWs();
    const node: NewickNode = { name: '', branchLength: 0, support: null, comment: '', children: [] };

    if (str[pos] === '(') {
      pos++;
      node.children.push(parseNode());
      while (pos < str.length && str[pos] === ',') { pos++; node.children.push(parseNode()); }
      if (pos < str.length && str[pos] === ')') pos++;
      node.comment = readComment();
    }

    // Read name (and possibly support value)
    skipWs();
    const nameStart = pos;
    while (pos < str.length && !':,);['.includes(str[pos])) pos++;
    const nameStr = str.slice(nameStart, pos).trim();
    node.comment += readComment();

    if (node.children.length > 0) {
      // After closing paren: could be support or name
      const num = parseFloat(nameStr);
      if (!isNaN(num) && nameStr === String(num)) {
        node.support = num;
      } else if (nameStr) {
        node.name = nameStr;
      }
    } else {
      node.name = nameStr;
    }

    // Read branch length
    if (pos < str.length && str[pos] === ':') {
      pos++;
      const blStr = readUntil(',);[');
      node.branchLength = parseFloat(blStr) || 0;
    }
    node.comment += readComment();

    return node;
  }

  return parseNode();
}

export function toNewick(node: NewickNode): string {
  if (node.children.length === 0) {
    let s = node.name;
    if (node.branchLength > 0) s += ':' + node.branchLength;
    return s;
  }
  let s = '(' + node.children.map(c => toNewick(c)).join(',') + ')';
  if (node.name) s += node.name;
  if (node.support !== null) s += node.support;
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
