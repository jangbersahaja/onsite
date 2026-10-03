export function hasServerConfiguration() {
  return Boolean(process.env.DATABASE_URL);
}
