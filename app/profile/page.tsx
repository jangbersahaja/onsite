"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { useReportClockWorkspace } from "@/app/clock/_components/clock-workspace";
import {
  PasswordForm,
  ProfileDetailsForm,
  ProfileIntro,
  ProfileLanguageSection,
  ProfilePhotoSection,
} from "@/app/profile/_components/profile-sections";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

export default function ProfilePage() {
  const { messages } = useLocale();
  const session = authClient.useSession();
  const router = useRouter();
  const user = session.data?.user;
  const isPending = session.isPending;

  const report = useMemo(
    () => ({ pageTitle: messages.profile.title, reconciliationCount: 0 }),
    [messages.profile.title],
  );
  useReportClockWorkspace(report);

  useEffect(() => {
    if (!isPending && !user) router.replace("/clock");
  }, [isPending, user, router]);

  if (!user) return null;

  return (
    <main className="page-content profile-page">
      <ProfileIntro mode="self" />
      <ProfilePhotoSection
        name={user.name}
        photoUrl={user.profilePhotoUrl ?? null}
      />
      <ProfileDetailsForm
        key={user.id}
        initialName={user.name}
        initialEmail={user.email}
        endpoint="/api/account/profile"
        isSelf
      />
      <PasswordForm />
      <ProfileLanguageSection />
    </main>
  );
}
