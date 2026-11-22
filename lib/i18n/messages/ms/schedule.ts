import { enSchedule } from "../en/schedule";

export const msSchedule: typeof enSchedule = {
  navigation: "Jadual",
  page: {
    title: "Jadual",
    subheading: "Syif diterbitkan anda, mengikut masa outlet.",
    fallbackWorkspace: "Rekod masa",
  },
  controls: {
    week: "Minggu",
    month: "Bulan",
    calendar: "Kalendar",
    agenda: "Agenda",
    previousWeek: "Minggu sebelumnya",
    nextWeek: "Minggu seterusnya",
    previousMonth: "Bulan sebelumnya",
    nextMonth: "Bulan seterusnya",
    today: "Hari ini",
    jumpToDate: "Pergi ke tarikh",
    refresh: "Muat semula jadual",
    download: "Tambah ke kalendar",
  },
  summary: {
    shifts: "Syif",
    scheduledTime: "Masa dijadualkan",
    nextShift: "Syif seterusnya",
    noneScheduled: "Tiada jadual",
  },
  shift: {
    published: "Diterbitkan",
    start: "Mula",
    end: "Tamat",
    break: "Rehat tidak berbayar",
    paidTime: "Masa berbayar",
    note: "Nota syif",
    outlet: "Outlet",
    overnight: "Tamat pada hari berikutnya",
    openClock: "Buka Rekod Masa",
    details: "Butiran syif",
    close: "Tutup butiran syif",
  },
  states: {
    loading: "Memuatkan jadual anda...",
    openingBackoffice: "Membuka Backoffice...",
    emptyTitle: "Tiada syif diterbitkan",
    emptyBody: "Pengurus anda belum menerbitkan syif untuk julat ini.",
    noOutletTitle: "Tiada outlet ditetapkan",
    noOutletBody: "Keahlian outlet aktif diperlukan untuk melihat jadual anda.",
  },
  errors: {
    loadFailed: "Jadual anda tidak dapat dimuatkan.",
  },
};
