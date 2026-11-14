const tokenPattern = /^[a-z0-9-]+$/
export function instanceClass(base: string, token: string): string[] {
  if (!tokenPattern.test(token)) throw new Error('Invalid instance token')
  return [base, `${base}-i${token}`]
}
