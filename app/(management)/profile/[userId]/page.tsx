import {
  ProfileDetailsForm,
  ProfileIntro,
} from "@/app/profile/_components/profile-sections";
import { user as userTable } from "@/db/schema";
import { getSession } from "@/lib/auth-instance";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export default async function TeamMemberProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await getSession(await headers());
  if (!session) redirect("/clock");

  const access = await getTeamAccess(session.user.id);
  if (!access?.isSuperAdmin) redirect("/clock");

  const { userId } = await params;
  const [target] = await getDb()
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!target) notFound();

  return (
    <main className="page-content profile-page">
      <ProfileIntro mode="admin" name={target.name} />
      <ProfileDetailsForm
        key={target.id}
        initialName={target.name}
        initialEmail={target.email}
        endpoint={`/api/team/${target.id}/profile`}
        isSelf={false}
      />
    </main>
  );
}
