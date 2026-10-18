/** Core::securePath: every run of dots becomes one dot, so no `..` path segment is left. */
export const securePath = (p: string) => p.replace(/\.\.*/g, '.')

/** Util::userDir: `%u` in UploadDir / SaveDir becomes the user name; a trailing slash is ensured. */
export function userDir(user: string, dir: string): string {
  if (dir === '') return ''
  const d = dir.endsWith('/') ? dir : `${dir}/`
  return d.replaceAll('%u', securePath(user))
}
