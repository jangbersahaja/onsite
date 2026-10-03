export function GET() {
  return Response.json(
    { error: "Unknown authentication endpoint." },
    { status: 404 },
  );
}

export function POST() {
  return Response.json(
    { error: "Unknown authentication endpoint." },
    { status: 404 },
  );
}
