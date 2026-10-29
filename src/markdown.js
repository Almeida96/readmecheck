import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import GithubSlugger from 'github-slugger';
import { parseFragment } from 'parse5';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']);
const plain = node => node.type === 'html' ? '' : node.value ?? node.alt ?? (node.children ?? []).map(plain).join('');
const visit = (node, callback) => { callback(node); for (const child of node.children ?? []) visit(child, callback); };

export function parseMarkdown(source) {
  const tree = parser.parse(source), slugger = new GithubSlugger();
  const anchors = new Set(), headings = [], links = [], definitions = new Map();
  visit(tree, node => { if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url); });
  visit(tree, node => {
    const position = node.position?.start ?? { line: 1, column: 1 };
    if (node.type === 'heading') {
      const text = plain(node); headings.push(text); anchors.add(slugger.slug(text));
    }
    if (node.type === 'link' || node.type === 'image') links.push({ target: node.url, line: position.line, column: position.column });
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const target = definitions.get(node.identifier);
      if (target !== undefined) links.push({ target, line: position.line, column: position.column });
    }
    if (node.type === 'html') {
      const fragment = parseFragment(node.value, { sourceCodeLocationInfo: true });
      const walk = element => {
        const attrs = new Map((element.attrs ?? []).map(attr => [attr.name, attr.value]));
        if (attrs.has('id')) anchors.add(attrs.get('id'));
        if (element.tagName === 'a' && attrs.has('name')) anchors.add(attrs.get('name'));
        const attribute = ['img', 'source', 'video', 'audio'].includes(element.tagName) ? 'src' : element.tagName === 'a' ? 'href' : null;
        if (attribute && attrs.has(attribute)) {
          const loc = element.sourceCodeLocation?.attrs?.[attribute];
          links.push({ target: attrs.get(attribute), line: position.line + (loc?.startLine ?? 1) - 1, column: (loc?.startCol ?? 1) + ((loc?.startLine ?? 1) === 1 ? position.column - 1 : 0) });
        }
        for (const child of element.childNodes ?? []) walk(child);
      };
      walk(fragment);
    }
  });
  return { anchors, headings, links };
}
