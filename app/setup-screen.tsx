export function SetupScreen() {
  return (
    <main className="setup-screen">
      <div className="setup-mark">S</div>
      <p className="eyebrow">SHIFTLINE SETUP</p>
      <h1>Connect your workspace.</h1>
      <p className="setup-copy">
        Add your Neon database URL and a 32-character Better Auth secret to
        <code>.env.local</code>, then run the database migration and create your
        first admin.
      </p>
      <ol className="setup-steps">
        <li>
          <span>01</span>
          <code>cp .env.example .env.local</code>
        </li>
        <li>
          <span>02</span>
          <code>npm run db:migrate</code>
        </li>
        <li>
          <span>03</span>
          <code>npm run bootstrap-admin</code>
        </li>
      </ol>
      <p className="setup-footnote">
        Full environment settings and bootstrap fields are documented in
        README.md.
      </p>
    </main>
  );
}
