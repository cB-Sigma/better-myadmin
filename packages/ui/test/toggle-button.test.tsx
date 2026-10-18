import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToggleButton } from '../src/components/toggle-button.tsx'

/** functions.ts toggleButton: the sliding switch holds both labels and shows the current one. */
describe('ToggleButton', () => {
  const html = (on: boolean) =>
    renderToStaticMarkup(
      <ToggleButton
        on={on}
        onLabel="active"
        offLabel="not active"
        title="Click to toggle"
        onToggle={() => {}}
      />,
    )

  it('is a toggle-container in the on / off state, both labels in the switch', () => {
    const on = html(true)
    expect(on).toContain('class="wrapper toggleAjax')
    expect(on).toMatch(/toggle-container[^"]* on"/)
    expect(on).toContain('aria-checked="true"')
    expect(on).toContain('title="Click to toggle"')
    expect(on).toMatch(/class="toggleOn[^"]*"[^>]*><span[^>]*>active<\/span>/)
    expect(on).toMatch(/class="toggleOff[^"]*"[^>]*><span[^>]*>not active<\/span>/)
    const off = html(false)
    expect(off).toMatch(/toggle-container[^"]* off"/)
    expect(off).toContain('aria-checked="false"')
  })
})
