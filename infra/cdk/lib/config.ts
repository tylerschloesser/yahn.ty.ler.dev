/**
 * The account, zone and domain are hard-coded rather than looked up.
 *
 * They are stable, they are not secret, and the `admin` profile has no default
 * region — so `env` has to be explicit in `bin/app.ts` regardless. A lookup
 * would additionally mean a `cdk.context.json` cache that can go stale between
 * a local synth and a CI one.
 */
export const ACCOUNT = '063257577013'
export const REGION = 'us-east-1'

/** `ty.ler.dev` is delegated separately from `ler.dev`. */
export const HOSTED_ZONE_ID = 'Z038502736IM0QLQT7VFN'
export const ZONE_NAME = 'ty.ler.dev'

export const ROOT_DOMAIN = 'yahn.ty.ler.dev'
