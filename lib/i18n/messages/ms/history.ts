import type { enHistory } from "../en/history";

export const msHistory: typeof enHistory = {
  nav: {
    groupMyTime: "MASA SAYA",
    groupWorkspace: "RUANG KERJA",
    clock: "Jam",
    history: "Sejarah",
    backoffice: "Backoffice",
  },
  page: {
    eyebrow: "MASA SAYA",
    title: "Sejarah",
    subheading: "Shif yang direkod dan permohonan masa anda.",
    fallbackWorkspaceName: "Pengurusan Masa",
  },
  actions: {
    requestCorrection: "Mohon pembetulan",
    loadMore: "Muat lebih banyak shif",
    loadingMore: "Memuatkan…",
  },
  tabs: {
    label: "Paparan sejarah",
    shifts: "Shif",
    requests: "Permohonan",
  },
  filters: {
    month: "Bulan",
  },
  summary: {
    allOutlets: "Semua outlet",
    workedHours: "jam bekerja dalam shif yang dimuatkan",
  },
  aria: {
    shifts: "Shif yang direkod",
    requests: "Permohonan pembetulan",
  },
  shift: {
    clockIn: "Daftar masuk",
    clockOut: "Daftar keluar",
    inProgress: "Sedang berlangsung",
    grossDuration: "{duration} kasar · ",
    breakDuration: "{duration} rehat",
  },
  request: {
    clockIn: "Daftar masuk",
    clockOut: "Daftar keluar",
    review: "Semakan: {reason}",
  },
  status: {
    reconciliation: "Perlu penyelarasan",
    approved: "Diluluskan",
    rejected: "Ditolak",
  },
  states: {
    loadingHistory: "Memuatkan sejarah anda…",
    openingBackoffice: "Membuka Backoffice…",
    loadingShifts: "Memuatkan shif…",
    noShifts: "Tiada shif direkod untuk bulan ini.",
    noRequests: "Tiada permohonan pembetulan untuk outlet ini.",
  },
  errors: {
    loadFailed: "Tidak dapat memuatkan sejarah shif.",
  },
  units: {
    hoursMinutes: "{hours}j {minutes}m",
  },
};
