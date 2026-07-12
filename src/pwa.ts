// Makes a self-hosted copy installable to the home screen. Injected at runtime
// because the app ships as a single inlined HTML file (no separate manifest to
// link). Everything is wrapped so a locked-down host (e.g. a sandboxed iframe)
// can't throw — it just no-ops there.

function iconSvg(size: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="112" fill="#2a78d6"/>` +
    `<g fill="none" stroke="#fff" stroke-width="30" stroke-linejoin="round" stroke-linecap="round">` +
    `<path d="M256 150c-40-34-96-34-136-24v208c40-10 96-10 136 24"/>` +
    `<path d="M256 150c40-34 96-34 136-24v208c-40-10-96-10-136 24"/>` +
    `<path d="M256 150v208"/></g></svg>`
  )
}

function svgDataUri(size: number): string {
  return 'data:image/svg+xml,' + encodeURIComponent(iconSvg(size))
}

/** Rasterise the SVG icon to a PNG data URI (iOS apple-touch-icon needs PNG). */
function pngIcon(size: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, size, size)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => resolve(null)
      img.src = svgDataUri(size)
    } catch {
      resolve(null)
    }
  })
}

export async function setupInstall() {
  try {
    const head = document.head
    const addMeta = (name: string, content: string) => {
      const m = document.createElement('meta')
      m.name = name
      m.content = content
      head.appendChild(m)
    }
    addMeta('apple-mobile-web-app-capable', 'yes')
    addMeta('apple-mobile-web-app-status-bar-style', 'black-translucent')
    addMeta('apple-mobile-web-app-title', 'Study')
    addMeta('mobile-web-app-capable', 'yes')

    const manifest = {
      name: 'Study Scheduler',
      short_name: 'Study',
      description: 'Adaptive study scheduler with spaced review and error tracking',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#0d0d0d',
      theme_color: '#0f1115',
      start_url: '.',
      scope: '.',
      icons: [
        { src: svgDataUri(512), sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
      ],
    }
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = URL.createObjectURL(blob)
    head.appendChild(link)

    const png = await pngIcon(180)
    if (png) {
      const touch = document.createElement('link')
      touch.rel = 'apple-touch-icon'
      touch.href = png
      head.appendChild(touch)
    }
  } catch {
    // Locked-down host — installability simply isn't available; ignore.
  }
}
