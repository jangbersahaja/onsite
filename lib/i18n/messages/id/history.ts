import type { enHistory } from "../en/history";

export const idHistory: typeof enHistory = {
  nav: {
    groupMyTime: "WAKTU SAYA",
    groupWorkspace: "RUANG KERJA",
    clock: "Absen",
    history: "Riwayat",
    backoffice: "Backoffice",
  },
  page: {
    eyebrow: "WAKTU SAYA",
    title: "Riwayat",
    subheading: "Shift yang tercatat dan permintaan waktu Anda.",
    fallbackWorkspaceName: "Pencatatan Waktu",
  },
  actions: {
    requestCorrection: "Ajukan koreksi",
    loadMore: "Muat shift lainnya",
    loadingMore: "Memuat…",
  },
  tabs: {
    label: "Tampilan riwayat",
    shifts: "Shift",
    requests: "Permintaan",
  },
  filters: {
    month: "Bulan",
  },
  manualShift: {
    addShift: "Tambah shift lampau",
    title: "Tambah shift lampau",
    description:
      "Untuk shift yang Anda kerjakan tetapi tidak pernah di-clock. Manajer di outlet ini akan meninjaunya sebelum muncul di riwayat Anda.",
    outlet: "Outlet",
    submit: "Kirim untuk ditinjau",
    submitting: "Mengirim…",
    confirmTitle: "Kirim shift lampau ini?",
    confirmDescription:
      "Manajer di outlet ini akan meninjaunya. Riwayat Anda tidak berubah sampai disetujui.",
    confirmLabel: "Kirim permintaan",
    fallbackError: "Permintaan tidak dapat dikirim.",
    pastShift: "Shift lampau",
    closeLabel: "Tutup permintaan shift lampau",
    closeTitle: "Tutup",
    status: {
      pending: "Menunggu tinjauan",
      approved: "Disetujui",
      rejected: "Ditolak",
    },
  },
  summary: {
    allOutlets: "Semua outlet",
    workedHours: "jam kerja dalam shift yang dimuat",
  },
  aria: {
    shifts: "Shift yang tercatat",
    requests: "Permintaan koreksi",
  },
  shift: {
    clockIn: "Masuk",
    clockOut: "Keluar",
    inProgress: "Sedang berlangsung",
    grossDuration: "{duration} kotor · ",
    breakDuration: "{duration} istirahat",
  },
  request: {
    clockIn: "Masuk",
    clockOut: "Keluar",
    review: "Tinjauan: {reason}",
  },
  status: {
    reconciliation: "Perlu rekonsiliasi",
    approved: "Disetujui",
    rejected: "Ditolak",
  },
  states: {
    loadingHistory: "Memuat riwayat Anda…",
    openingBackoffice: "Membuka Backoffice…",
    loadingShifts: "Memuat shift…",
    noShifts: "Tidak ada shift tercatat untuk bulan ini.",
    noRequests: "Tidak ada permintaan koreksi untuk outlet ini.",
  },
  errors: {
    loadFailed: "Tidak dapat memuat riwayat shift.",
  },
  units: {
    hoursMinutes: "{hours}j {minutes}m",
  },
};
