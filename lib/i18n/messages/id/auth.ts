import type { enAuth } from "../en/auth";

export const idAuth: typeof enAuth = {
  signIn: {
    pendingEyebrow: "PENDAFTARAN MENUNGGU",
    pendingTitle: "Menunggu persetujuan admin.",
    pendingBody:
      "Silakan hubungi manajer/supervisor Anda untuk menyetujui pendaftaran.",
    backToSignIn: "Kembali ke masuk",
    eyebrow: "AKSES TIM",
    title: "Selamat datang kembali.",
    pinDescription:
      "Masukkan PIN Anda untuk melanjutkan di peramban yang disetujui ini.",
    passwordDescription: "Masuk untuk absen dan meninjau shift Anda.",
    pinLabel: "Masukkan PIN enam digit Anda",
    identifierLabel: "Nama pengguna atau email",
    passwordLabel: "Kata sandi",
    continueWithPin: "Lanjutkan dengan PIN",
    signIn: "Masuk",
    signingIn: "Sedang masuk…",
    usePasswordInstead: "Gunakan kata sandi",
    usePinOnBrowser: "Gunakan PIN di peramban ini",
    newHere:
      "Baru di sini? Minta kode QR atau tautan pendaftaran dari manajer outlet Anda.",
  },
  register: {
    eyebrow: "PENDAFTARAN STAF",
    title: "Buat akun Anda.",
    checkingLink: "Memeriksa tautan pendaftaran…",
    registeringFor:
      "Mendaftar untuk {outlet}. Manajer di outlet ini akan menyetujui akun Anda.",
    photoPreviewAlt: "Pratinjau foto profil Anda",
    addPhoto: "Tambah foto",
    photoRequirements: "Wajib · JPEG, PNG, atau WebP · maks. 2 MB",
    fullName: "Nama lengkap",
    username: "Nama pengguna (Panggilan)",
    email: "Email",
    createPassword: "Buat kata sandi",
    confirmPassword: "Konfirmasi kata sandi",
    language: "Bahasa",
    languageHint: "Anda dapat mengubahnya nanti.",
    asideTitle: "Bergabung dengan tim outlet Anda.",
    stepDetails: "Isi data diri Anda",
    stepApprove: "Manajer outlet menyetujui",
    stepClockIn: "Masuk dan mulai bekerja",
    sectionPhoto: "Foto profil",
    sectionAccount: "Detail akun",
    sectionSecurity: "Kata sandi",
    sectionPreferences: "Preferensi",
    passwordHint: "Gunakan minimal 12 karakter.",
    successTitle: "Pendaftaran diterima.",
    submit: "Kirim pendaftaran",
    submitting: "Mengirim…",
    submittedFor:
      "Pendaftaran untuk {outlet} telah dikirim. Akun Anda menunggu persetujuan admin. Silakan hubungi manajer/supervisor Anda untuk menyetujui pendaftaran.",
    submitted:
      "Pendaftaran telah dikirim. Akun Anda menunggu persetujuan admin. Silakan hubungi manajer/supervisor Anda untuk menyetujui pendaftaran.",
  },
  reset: {
    eyebrow: "AKSES AKUN",
    title: "Atur kata sandi baru.",
    updated: "Kata sandi diperbarui. Sesi Anda sebelumnya telah keluar.",
    returnToSignIn: "Kembali ke masuk",
    newPassword: "Kata sandi baru",
    confirmPassword: "Konfirmasi kata sandi",
    update: "Perbarui kata sandi",
    updating: "Memperbarui kata sandi…",
  },
};
