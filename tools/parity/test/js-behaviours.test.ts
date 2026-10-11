import { describe, expect, it } from 'vitest'
import { extractJsBehaviours } from '../src/extract/js-behaviours.ts'

const src = `
AJAX.registerOnload('table/structure.js', function () {
  $(document).on('click', 'a.drop_column_anchor.ajax', function (event) {
    var question = window.Messages.strDoYouReally;
    $(this).confirm(question, $(this).attr('href'), function (url) {
      $.post(url, { ajax_request: true }, function () {});
    });
  });
  $('#tablestructure').find('input.checkall').change(function () {});
  $('#tablestructure').find('input.checkall').change(function () {});
  $('#x').focus();
  $(document).on('keydown.ns keyup', '#field', onKey);
  document.getElementById('go').addEventListener('click', () => {
    if (! window.confirm(window.Messages.strReally)) { alert('No!'); }
    fetch('index.php?route=/table/structure/save', { method: 'POST' });
  });
  $.ajax({ type: 'post', url: 'index.php?route=/sql&ajax_request=1' });
  CodeMirror.fromTextArea(el, { extraKeys: { 'Ctrl-Space': 'autocomplete' } });
});
function onKey(e) {
  if (e.ctrlKey && e.keyCode === 13) { return; }
  if (e.key === 'Escape') { return; }
}
`

describe('extractJsBehaviours', () => {
  const items = extractJsBehaviours('table/structure.ts', src)
  const keys = items.map((i) => i.key)

  it('finds delegated, shorthand and DOM event bindings (handlers only, not triggers)', () => {
    expect(keys).toContain('js:table/structure.ts#click:a.drop_column_anchor.ajax')
    expect(keys).toContain('js:table/structure.ts#change:#tablestructure input.checkall')
    expect(keys).toContain('js:table/structure.ts#click:#go')
    expect(keys.some((k) => k.includes('#focus:'))).toBe(false)
    expect(items.find((i) => i.key.endsWith('#change:#tablestructure input.checkall'))?.count).toBe(2)
  })

  it('lists the keys keyboard handlers compare, following named handlers', () => {
    const kd = items.find((i) => i.key === 'js:table/structure.ts#keydown:#field')
    expect(kd?.keys).toEqual(['Enter', 'Escape', 'ctrl'])
    expect(kd?.delegated).toBe(true)
    expect(keys).toContain('js:table/structure.ts#keyup:#field')
  })

  it('finds dialogs with their Messages keys or texts', () => {
    expect(keys).toContain('js:table/structure.ts#confirm:strDoYouReally')
    expect(keys).toContain('js:table/structure.ts#confirm:strReally')
    expect(keys).toContain('js:table/structure.ts#alert:No!')
  })

  it('finds AJAX calls with their routes', () => {
    expect(keys).toContain('js:table/structure.ts#ajax:POST <url>')
    expect(keys).toContain('js:table/structure.ts#ajax:POST /table/structure/save')
    expect(keys).toContain('js:table/structure.ts#ajax:POST /sql')
  })

  it('finds CodeMirror key bindings', () => {
    expect(keys).toContain('js:table/structure.ts#key:Ctrl-Space')
  })
})
