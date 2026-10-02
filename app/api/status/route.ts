import { hasServerConfiguration } from "@/lib/app-config";

export function GET() {
  return Response.json({ configured: hasServerConfiguration() });
}
