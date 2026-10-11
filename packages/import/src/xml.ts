import { DOMParser } from '@xmldom/xmldom'

/** The few SimpleXML semantics the XML and ODS importers rely on, over a DOM. */
export type El = Element

/** simplexml_load_string: false on a malformed document */
export function loadXml(text: string): El | false {
  let failed = false
  const onError = () => {
    failed = true
  }
  const doc = new DOMParser({
    errorHandler: { error: onError, fatalError: onError, warning: () => {} },
  }).parseFromString(text, 'text/xml')
  if (failed || doc.documentElement === null) return false
  return doc.documentElement as unknown as El
}

/** $el->children($ns, isPrefix): the child elements in a namespace (null: no namespace) */
export function children(el: El, ns: string | null): El[] {
  const out: El[] = []
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType !== 1) continue
    const e = n as El
    if ((e.namespaceURI ?? null) === ns) out.push(e)
  }
  return out
}

/** $el->name (a child in the element's own namespace) */
export function child(el: El, localName: string, ns: string | null = el.namespaceURI ?? null): El | null {
  return children(el, ns).find((c) => c.localName === localName) ?? null
}

/** (string) $el: the element's own text nodes, concatenated */
export function text(el: El): string {
  let s = ''
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue ?? ''
  }
  return s
}

/** (string) $el->attributes($ns)[$name] */
export function attr(el: El, name: string, ns: string | null = null): string {
  if (ns === null) return el.getAttribute(name) ?? ''
  return el.getAttributeNS(ns, name) ?? ''
}

/** SimpleXMLElement::getNamespaces(true): prefix → URI over the whole document */
export function namespaces(root: El): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (e: El) => {
    if (e.prefix !== null && e.prefix !== undefined && e.namespaceURI !== null)
      out[e.prefix] ??= e.namespaceURI
    else if (e.namespaceURI !== null && e.namespaceURI !== undefined) out[''] ??= e.namespaceURI
    const attrs = e.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs.item(i)
      if (a !== null && a.prefix !== null && a.prefix !== 'xmlns' && a.namespaceURI !== null)
        out[a.prefix] ??= a.namespaceURI
    }
    for (const c of childElements(e)) walk(c)
  }
  walk(root)
  return out
}

/** prefix → URI declared on an element (children('office', true) resolves the prefix) */
export function lookupNs(el: El, prefix: string): string | null {
  return el.lookupNamespaceURI(prefix)
}

function childElements(el: El): El[] {
  const out: El[] = []
  for (let n = el.firstChild; n !== null; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El)
  return out
}
