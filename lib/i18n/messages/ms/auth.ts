import type { enAuth } from "../en/auth";

export const msAuth: typeof enAuth = {
  signIn: {
    pendingEyebrow: "PENDAFTARAN DALAM PROSES",
    pendingTitle: "Menunggu kelulusan admin.",
    pendingBody:
      "Sila hubungi penyelia/pengurus anda untuk meluluskan pendaftaran.",
    backToSignIn: "Kembali ke log masuk",
    eyebrow: "AKSES PASUKAN",
    title: "Selamat kembali.",
    pinDescription:
      "Masukkan PIN anda untuk teruskan di peranti yang diluluskan ini.",
    passwordDescription: "Log masuk untuk daftar masuk dan semak shif anda.",
    pinLabel: "Masukkan PIN enam digit anda",
    identifierLabel: "Nama pengguna atau e-mel",
    passwordLabel: "Kata laluan",
    continueWithPin: "Teruskan dengan PIN",
    signIn: "Log masuk",
    signingIn: "Sedang log masuk…",
    usePasswordInstead: "Guna kata laluan",
    usePinOnBrowser: "Guna PIN di peranti ini",
    newHere:
      "Baru di sini? Minta kod QR atau pautan pendaftaran daripada pengurus outlet anda.",
  },
  register: {
    eyebrow: "PENDAFTARAN KAKITANGAN",
    title: "Cipta akaun anda.",
    checkingLink: "Menyemak pautan pendaftaran…",
    registeringFor:
      "Mendaftar untuk {outlet}. Pengurus di outlet ini akan meluluskan akaun anda.",
    photoPreviewAlt: "Pratonton foto profil anda",
    addPhoto: "Tambah foto",
    photoRequirements: "Wajib · JPEG, PNG, atau WebP · sehingga 2 MB",
    fullName: "Nama penuh",
    username: "Nama pengguna (Panggilan)",
    email: "E-mel",
    createPassword: "Cipta kata laluan",
    confirmPassword: "Sahkan kata laluan",
    language: "Bahasa",
    languageHint: "Anda boleh menukarnya kemudian.",
    asideTitle: "Sertai pasukan outlet anda.",
    stepDetails: "Isi maklumat anda",
    stepApprove: "Pengurus outlet meluluskan",
    stepClockIn: "Log masuk dan mula kerja",
    sectionPhoto: "Foto profil",
    sectionAccount: "Maklumat akaun",
    sectionSecurity: "Kata laluan",
    sectionPreferences: "Keutamaan",
    passwordHint: "Gunakan sekurang-kurangnya 12 aksara.",
    successTitle: "Pendaftaran diterima.",
    submit: "Hantar pendaftaran",
    submitting: "Sedang menghantar…",
    submittedFor:
      "Pendaftaran untuk {outlet} telah dihantar. Akaun anda menunggu kelulusan admin. Sila hubungi penyelia/pengurus anda untuk meluluskan pendaftaran.",
    submitted:
      "Pendaftaran telah dihantar. Akaun anda menunggu kelulusan admin. Sila hubungi penyelia/pengurus anda untuk meluluskan pendaftaran.",
  },
  reset: {
    eyebrow: "AKSES AKAUN",
    title: "Tetapkan kata laluan baharu.",
    updated:
      "Kata laluan dikemas kini. Sesi-sesi anda yang lama telah dilog keluar.",
    returnToSignIn: "Kembali ke log masuk",
    newPassword: "Kata laluan baharu",
    confirmPassword: "Sahkan kata laluan",
    update: "Kemas kini kata laluan",
    updating: "Sedang mengemas kini kata laluan…",
  },
};
